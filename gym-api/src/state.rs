use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use axum::{
    extract::ConnectInfo,
    http::{HeaderMap, Request, StatusCode},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use governor::DefaultKeyedRateLimiter;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox};
use tiberius::{Client, Config, Row, ToSql};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use tower_governor::{GovernorError, key_extractor::KeyExtractor};

use crate::tokens::make_verify_token;

pub struct AppState {
    pub db_config: Config,
    pub jwt_secret: String,
    pub frontend_url: String,
    // Wrong-code budget per user for 2FA, so spreading guesses over many IPs doesn't help
    // shortcut: in memory, so it resets on restart and isn't shared between processes;
    // move it to a DB column if the API ever runs as more than one process
    pub totp_attempts: DefaultKeyedRateLimiter<i32>,
    // Password tries per (account, client IP); see login_limiter.
    // shortcut: in memory like totp_attempts, with the same limit and the same upgrade path
    pub login_attempts: DefaultKeyedRateLimiter<(i32, IpAddr)>,
    // Caps mail that anyone can trigger, per address, so the app can't be used to flood an inbox
    pub mail_attempts: DefaultKeyedRateLimiter<String>,
    pub mailer: AsyncSmtpTransport<Tokio1Executor>,
    pub mail_from: Mailbox,
    pub http: reqwest::Client,
    pub stripe_key: String,
    pub stripe_price_id: String,
    pub stripe_webhook_secret: String,
    // Open Food Facts asks every app to name itself: "AppName/Version (ContactEmail)"
    pub food_user_agent: String,
}

// The API only listens on 127.0.0.1 behind a proxy, so the client IP is the last
// X-Forwarded-For entry that isn't this machine. Earlier entries come from the client and can be faked.
// Loopback entries are skipped: behind a local tunnel (cloudflared -> Vite) Vite adds 127.0.0.1,
// and the real visitor is the entry Cloudflare added just before it.
#[derive(Clone)]
pub struct ProxyIpKeyExtractor;

impl KeyExtractor for ProxyIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<IpAddr, GovernorError> {
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip())
            .ok_or(GovernorError::UnableToExtractKey)?;
        Ok(client_ip(peer, req.headers()))
    }
}

// The client's IP as the rate limits see it; the per-account login limit uses it too
pub fn client_ip(peer: IpAddr, headers: &HeaderMap) -> IpAddr {
    // Only our proxy (on this machine) may tell us the client's IP
    let ip = if peer.is_loopback() {
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.rsplit(',')
                    .filter_map(|ip| ip.trim().parse::<IpAddr>().ok())
                    // ::ffff:127.0.0.1 is loopback too
                    .map(|ip| ip.to_canonical())
                    .find(|ip| !ip.is_loopback())
            })
            .unwrap_or(peer)
    } else {
        peer
    };
    // One IPv6 customer usually gets a whole /64, so treat it as one client
    match ip {
        IpAddr::V6(v6) => {
            let s = v6.segments();
            IpAddr::V6(std::net::Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
        }
        v4 => v4,
    }
}

pub type Db = Client<Compat<TcpStream>>;

pub type ApiResult<T> = Result<T, (StatusCode, String)>;

// shortcut: one new connection per request, because RLS tags each connection read-only;
// move to a pool that resets connections (sp_reset_connection) if requests get slow under load
pub async fn connect(state: &AppState) -> Result<Db, tiberius::error::Error> {
    // Fail after 5 s instead of waiting out the OS timeout when the database host doesn't answer
    let tcp = tokio::time::timeout(
        Duration::from_secs(5),
        TcpStream::connect(state.db_config.get_addr()),
    )
    .await
    .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))??;
    tcp.set_nodelay(true)?;
    Client::connect(state.db_config.clone(), tcp.compat_write()).await
}

// Tags the connection so row-level security knows which user it belongs to
pub async fn set_user(db: &mut Db, user_id: i32) -> Result<(), tiberius::error::Error> {
    db.execute(
        "EXEC sp_set_session_context @key = N'UserId', @value = @P1, @read_only = 1",
        &[&user_id],
    )
    .await?;
    Ok(())
}

// One row per login, failed login, logged workout or admin action; kind is 'login', 'login_failed',
// 'workout', or for admin actions 'admin_changed' / 'reset_link' / 'reactivated' (stored against the admin's id)
// and 'admin_removed' (stored against the member who lost admin access)
pub async fn record(db: &mut Db, user_id: i32, kind: &str) -> ApiResult<()> {
    db.execute(
        "INSERT INTO dbo.Events (UserId, Kind) VALUES (@P1, @P2)",
        &[&user_id, &kind],
    )
    .await
    .map_err(internal)?;
    Ok(())
}

// The previous sign-in, and how many wrong passwords were tried since then
pub async fn last_visit(db: &mut Db, id: i32) -> ApiResult<(Option<DateTime<Utc>>, i32)> {
    let row = one_row(
        db,
        "SELECT l.LastLogin,
                (SELECT COUNT(*) FROM dbo.Events
                 WHERE UserId = @P1 AND Kind = 'login_failed'
                   AND At > ISNULL(l.LastLogin, '19000101')) AS FailedSince
         FROM (SELECT MAX(At) AS LastLogin FROM dbo.Events
               WHERE UserId = @P1 AND Kind = 'login') l",
        &[&id],
    )
    .await?;
    Ok(match row {
        Some(r) => (
            r.get::<NaiveDateTime, _>("LastLogin").map(|t| t.and_utc()),
            r.get("FailedSince").unwrap_or(0),
        ),
        None => (None, 0),
    })
}

// Runs a query and returns its first row, if there is one
pub async fn one_row(db: &mut Db, sql: &str, params: &[&dyn ToSql]) -> ApiResult<Option<Row>> {
    db.query(sql, params)
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)
}

// Runs a query and returns every row
pub async fn all_rows(db: &mut Db, sql: &str, params: &[&dyn ToSql]) -> ApiResult<Vec<Row>> {
    db.query(sql, params)
        .await
        .map_err(internal)?
        .into_first_result()
        .await
        .map_err(internal)
}

// BEGIN TRANSACTION and COMMIT go as a plain batch: execute() wraps them in sp_executesql,
// and SQL Server refuses a transaction that starts or ends inside that (error 266)
pub async fn batch(db: &mut Db, sql: &str) -> ApiResult<()> {
    db.simple_query(sql)
        .await
        .map_err(internal)?
        .into_results()
        .await
        .map_err(internal)?;
    Ok(())
}

// A column that must be there; NULL or the wrong type is a server bug, so it logs and answers 500
pub fn col<'a, T: tiberius::FromSql<'a>>(row: &'a Row, name: &str) -> ApiResult<T> {
    row.get(name)
        .ok_or_else(|| internal(format!("missing {name}")))
}

// Log the real error on the server, send a vague one to the client
pub fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    eprintln!("error: {e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "server error".to_string(),
    )
}

// Sends in the background: the response must not wait, or its timing would reveal who has an account
pub fn send_mail(state: Arc<AppState>, to: String, subject: &'static str, body: String) {
    tokio::spawn(async move {
        let Ok(to) = to.parse() else { return };
        let msg = Message::builder()
            .from(state.mail_from.clone())
            .to(to)
            .subject(subject)
            .body(body);
        match msg {
            Ok(msg) => {
                if let Err(e) = state.mailer.send(msg).await {
                    eprintln!("mail error: {e}");
                }
            }
            Err(e) => eprintln!("mail error: {e}"),
        }
    });
}

// False once an address has had its share of mail that anyone can trigger
pub fn may_mail(state: &AppState, email: &str) -> bool {
    state.mail_attempts.check_key(&email.to_string()).is_ok()
}

// The same confirmation email for a new sign-up and for a login before the address is confirmed
pub fn send_verify_mail(state: &Arc<AppState>, email: String, user_id: i32) -> ApiResult<()> {
    if !may_mail(state, &email) {
        return Ok(());
    }
    let token = make_verify_token(user_id, &state.jwt_secret).map_err(internal)?;
    send_mail(
        state.clone(),
        email,
        "Confirm your Gym App email",
        format!(
            "Confirm your email to finish signing up:\n{}/#verify={token}\n\nThe link works for 24 hours.\n\nIf you didn't create this account, ignore this email.",
            state.frontend_url
        ),
    );
    Ok(())
}

// Tells the member about a security change they may not have made.
// Not capped by may_mail, or an attacker could use up the allowance first to silence it
pub fn send_security_notice(state: &Arc<AppState>, email: &str, what: &'static str) {
    send_mail(
        state.clone(),
        email.to_string(),
        "Your Gym App account was changed",
        format!(
            "{what}\n\nIf this wasn't you, reset your password from the login screen and tell an admin."
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ip_is_the_entry_our_proxy_added() {
        let req = |xff: Option<&str>| {
            let mut b = Request::builder();
            if let Some(v) = xff {
                b = b.header("x-forwarded-for", v);
            }
            let mut r = b.body(()).unwrap();
            r.extensions_mut()
                .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 5173))));
            r
        };
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        // the client faked the first entry; the proxy appended the real one
        assert_eq!(
            ProxyIpKeyExtractor
                .extract(&req(Some("6.6.6.6, 203.0.113.9")))
                .unwrap(),
            ip("203.0.113.9")
        );
        assert_eq!(
            ProxyIpKeyExtractor
                .extract(&req(Some("203.0.113.9")))
                .unwrap(),
            ip("203.0.113.9")
        );
        // behind a local tunnel the last entry is Vite's 127.0.0.1; the visitor is the one before it
        for xff in [
            "6.6.6.6, 203.0.113.9, 127.0.0.1",
            "203.0.113.9, ::ffff:127.0.0.1",
            "203.0.113.9, ::1",
        ] {
            assert_eq!(
                ProxyIpKeyExtractor.extract(&req(Some(xff))).unwrap(),
                ip("203.0.113.9"),
                "{xff}"
            );
        }
        // only loopback entries: fall back to the peer
        assert_eq!(
            ProxyIpKeyExtractor
                .extract(&req(Some("127.0.0.1")))
                .unwrap(),
            ip("127.0.0.1")
        );
        // no header (e.g. curl straight to the API on this machine): fall back to the peer
        assert_eq!(
            ProxyIpKeyExtractor.extract(&req(None)).unwrap(),
            ip("127.0.0.1")
        );

        let from_peer = |peer: SocketAddr, xff: &str| {
            let mut r = Request::builder()
                .header("x-forwarded-for", xff)
                .body(())
                .unwrap();
            r.extensions_mut().insert(ConnectInfo(peer));
            ProxyIpKeyExtractor.extract(&r).unwrap()
        };
        // the peer isn't our proxy, so its header is ignored
        assert_eq!(
            from_peer(SocketAddr::from(([198, 51, 100, 7], 1)), "203.0.113.9"),
            ip("198.51.100.7")
        );
        // two IPv6 addresses in the same /64 share one bucket
        let v6 = |s: &str| SocketAddr::new(ip(s), 1);
        assert_eq!(
            from_peer(v6("2001:db8:1:2::1"), ""),
            from_peer(v6("2001:db8:1:2:ffff::9"), "")
        );
    }
}
