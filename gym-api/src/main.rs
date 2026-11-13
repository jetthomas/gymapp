use std::{
    env,
    net::{IpAddr, SocketAddr},
    num::NonZeroU32,
    sync::{Arc, LazyLock},
    time::Duration,
};

use argon2::{
    Argon2,
    password_hash::{
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
        rand_core::{OsRng, RngCore},
    },
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, FromRequestParts, Path, Query, State},
    http::{
        HeaderMap, Request, StatusCode,
        header::{AUTHORIZATION, COOKIE, SET_COOKIE},
        request::Parts,
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use chrono::{DateTime, Datelike, NaiveDateTime, Utc};
use governor::{DefaultKeyedRateLimiter, Quota};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials as SmtpCredentials,
};
use serde::{Deserialize, Serialize};
use tiberius::{AuthMethod, Client, Config, Row, ToSql};
use tokio::{net::TcpStream, sync::Semaphore};
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use totp_rs::{Algorithm, Secret, TOTP};
use tower_governor::{
    GovernorError, GovernorLayer, governor::GovernorConfigBuilder, key_extractor::KeyExtractor,
};
use zxcvbn::{Score, zxcvbn};

// A real Argon2 hash, so checking a password against it takes as long as a real login
static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| {
    Argon2::default()
        .hash_password(b"not-a-real-password", &SaltString::generate(&mut OsRng))
        .expect("hashing a constant can't fail")
        .to_string()
});

// Caps Argon2 work in flight: each hash takes ~19 MiB and a full core
static HASH_SLOTS: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(std::thread::available_parallelism().map_or(4, |n| n.get())));

// ---------- shared state ----------

struct AppState {
    db_config: Config,
    jwt_secret: String,
    frontend_url: String,
    // Wrong-code budget per user for 2FA, so spreading guesses over many IPs doesn't help
    // shortcut: in memory, so it resets on restart and isn't shared between processes;
    // move it to a DB column if the API ever runs as more than one process
    totp_attempts: DefaultKeyedRateLimiter<i32>,
    mailer: AsyncSmtpTransport<Tokio1Executor>,
    mail_from: Mailbox,
}

// The API only listens on 127.0.0.1 behind a proxy, so the client IP is the last
// X-Forwarded-For entry (added by our proxy). Earlier entries come from the client and can be faked.
#[derive(Clone)]
struct ProxyIpKeyExtractor;

impl KeyExtractor for ProxyIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<IpAddr, GovernorError> {
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip())
            .ok_or(GovernorError::UnableToExtractKey)?;
        // Only our proxy (on this machine) may tell us the client's IP
        let ip = if peer.is_loopback() {
            req.headers()
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.rsplit(',').next())
                .and_then(|ip| ip.trim().parse().ok())
                .unwrap_or(peer)
        } else {
            peer
        };
        // One IPv6 customer usually gets a whole /64, so treat it as one client
        Ok(match ip {
            IpAddr::V6(v6) => {
                let s = v6.segments();
                IpAddr::V6(std::net::Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
            }
            v4 => v4,
        })
    }
}

type Db = Client<Compat<TcpStream>>;
type ApiResult<T> = Result<T, (StatusCode, String)>;

// shortcut: one new connection per request, because RLS tags each connection read-only;
// move to a pool that resets connections (sp_reset_connection) if requests get slow under load
async fn connect(state: &AppState) -> Result<Db, tiberius::error::Error> {
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
async fn set_user(db: &mut Db, user_id: i32) -> Result<(), tiberius::error::Error> {
    db.execute(
        "EXEC sp_set_session_context @key = N'UserId', @value = @P1, @read_only = 1",
        &[&user_id],
    )
    .await?;
    Ok(())
}

// One row per sign-in, failed sign-in or logged workout; kind is 'login', 'login_failed' or 'workout'
async fn record(db: &mut Db, user_id: i32, kind: &str) -> ApiResult<()> {
    db.execute(
        "INSERT INTO dbo.Events (UserId, Kind) VALUES (@P1, @P2)",
        &[&user_id, &kind],
    )
    .await
    .map_err(internal)?;
    Ok(())
}

// The previous sign-in, and how many wrong passwords were tried since then
async fn last_visit(db: &mut Db, id: i32) -> ApiResult<(Option<DateTime<Utc>>, i32)> {
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
async fn one_row(db: &mut Db, sql: &str, params: &[&dyn ToSql]) -> ApiResult<Option<Row>> {
    db.query(sql, params)
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)
}

// Log the real error on the server, send a vague one to the client
fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    eprintln!("error: {e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "server error".to_string(),
    )
}

// Sends in the background: the response must not wait, or its timing would reveal who has an account
fn send_mail(state: Arc<AppState>, to: String, subject: &'static str, body: String) {
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

// ---------- JSON shapes ----------

#[derive(Deserialize)]
struct Credentials {
    email: String,
    password: String,
    // "Stay signed in"; old requests without the field still work
    #[serde(default)]
    remember: bool,
}

#[derive(Deserialize)]
struct ResetRequest {
    token: String,
    password: String,
    // Self-service links on a 2FA account need the current code too
    code: Option<String>,
}

#[derive(Deserialize)]
struct ForgotRequest {
    email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewUser {
    first_name: String,
    last_name: String,
    email: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    access_token: Option<String>,
    is_admin: bool,
    challenge: Option<String>,
    // So the frontend knows whether to offer "Turn on two-factor" after a page refresh
    two_factor: bool,
    // The previous sign-in and wrong passwords since; only set on a fresh sign-in
    last_login: Option<DateTime<Utc>>,
    failed_since: i32,
}

#[derive(Serialize)]
struct TotpSetup {
    qr: String,     // a PNG image, base64-encoded
    secret: String, // the same secret as text, for people who can't scan
}

#[derive(Deserialize)]
struct TokenRequest {
    token: String,
}

#[derive(Serialize)]
struct RecoveryCodes {
    codes: Vec<String>,
}

#[derive(Deserialize)]
struct PasswordChange {
    current: String,
    new: String,
}

#[derive(Deserialize)]
struct DisableRequest {
    password: String,
    code: String,
}

#[derive(Deserialize)]
struct CodeRequest {
    code: String,
}

#[derive(Deserialize)]
struct VerifyRequest {
    challenge: String,
    code: String,
    #[serde(default)]
    remember: bool,
}

#[derive(Deserialize)]
struct NewWorkout {
    name: String,
    date: DateTime<Utc>,
    notes: Option<String>,
}

#[derive(Serialize)]
struct Workout {
    id: i32,
    name: String,
    date: DateTime<Utc>,
    notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserSummary {
    id: i32,
    first_name: Option<String>,
    last_name: Option<String>,
    email: String,
    active: bool,
    is_admin: bool,
    totp_enabled: bool,
    created_at: DateTime<Utc>,
    logins: i32,
    last_login: Option<DateTime<Utc>>,
    failed_last_7d: i32,
    workouts: i32,
    last_workout: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct StatsQuery {
    days: Option<i32>,
}

#[derive(Serialize)]
struct DayCount {
    day: String, // YYYY-MM-DD, gym time
    kind: String,
    n: i32,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
    // Login tokens only: must match Users.SessionVersion, so bumping it signs every session out
    #[serde(default)]
    ver: i32,
}

#[derive(Serialize)]
struct ResetLink {
    link: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminFlag {
    is_admin: bool,
}

async fn set_admin(
    AdminUser(mut db): AdminUser,
    Path(user_id): Path<i32>,
    Json(body): Json<AdminFlag>, // Json must be the last argument
) -> ApiResult<StatusCode> {
    let updated = db
        .execute(
            "UPDATE dbo.Users SET IsAdmin = @P2 WHERE Id = @P1",
            &[&user_id, &body.is_admin],
        )
        .await
        .map_err(internal)?;
    if updated.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "user not found".to_string()));
    }
    Ok(StatusCode::OK)
}

async fn create_reset_link(
    State(state): State<Arc<AppState>>,
    AdminUser(mut db): AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<Json<ResetLink>> {
    let row = one_row(
        &mut db,
        "SELECT PasswordHash FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "user not found".to_string()))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    let token = make_reset_token(user_id, &state.jwt_secret, stored).map_err(internal)?;
    Ok(Json(ResetLink {
        link: format!("{}/#reset={token}", state.frontend_url),
    }))
}

// Each token kind is signed with its own key, so one kind can never pass as another
fn sign(
    user_id: i32,
    ver: i32,
    key: &[u8],
    ttl: chrono::Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + ttl).timestamp() as usize,
        ver,
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(key))
}

fn make_token(
    user_id: i32,
    session_version: i32,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    sign(
        user_id,
        session_version,
        secret.as_bytes(),
        chrono::Duration::hours(1),
    )
}

fn reset_key(secret: &str, password_hash: &str) -> Vec<u8> {
    format!("{secret}{password_hash}").into_bytes()
}
// Different from the admin key, so the server can tell the two kinds of link apart
fn self_reset_key(secret: &str, password_hash: &str) -> Vec<u8> {
    format!("{secret}{password_hash}:self").into_bytes()
}

fn make_reset_token(
    user_id: i32,
    secret: &str,
    password_hash: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    sign(
        user_id,
        0,
        &reset_key(secret, password_hash),
        chrono::Duration::minutes(15),
    )
}

fn refresh_key(secret: &str) -> Vec<u8> {
    format!("{secret}:refresh").into_bytes()
}

// ver = SessionVersion, so logout, a password reset or a 2FA change also kills this cookie
fn make_refresh_token(
    user_id: i32,
    session_version: i32,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    sign(
        user_id,
        session_version,
        &refresh_key(secret),
        chrono::Duration::days(30),
    )
}

// HttpOnly: JavaScript can't read it. SameSite=Strict: other sites can't make the browser send it.
// Path=/api/auth: it's only sent to the auth routes, not with every request
fn refresh_cookie(token: &str) -> String {
    format!("refresh={token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000")
}
const CLEAR_REFRESH: &str =
    "refresh=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0";

// Reads one cookie from the Cookie header
fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|kv| kv.trim().strip_prefix(name)?.strip_prefix('='))
}

fn challenge_key(secret: &str) -> Vec<u8> {
    format!("{secret}:2fa").into_bytes()
}

fn make_challenge(user_id: i32, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    sign(
        user_id,
        0,
        &challenge_key(secret),
        chrono::Duration::minutes(5),
    )
}

fn verify_key(secret: &str) -> Vec<u8> {
    format!("{secret}:verify").into_bytes()
}

fn make_verify_token(user_id: i32, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    sign(user_id, 0, &verify_key(secret), chrono::Duration::hours(24))
}

// Argon2 is deliberately slow, so it runs off the async threads that serve requests
async fn hash_password(password: String) -> ApiResult<String> {
    let _slot = HASH_SLOTS.acquire().await.map_err(internal)?;
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
    })
    .await
    .map_err(internal)?
    .map_err(internal)
}

async fn password_matches(password: String, stored: String) -> ApiResult<bool> {
    let _slot = HASH_SLOTS.acquire().await.map_err(internal)?;
    tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&stored)?;
        Ok::<_, argon2::password_hash::Error>(
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok(),
        )
    })
    .await
    .map_err(internal)?
    .map_err(internal)
}

// SHA1, 6 digits, 30-second steps: the settings every authenticator app expects
fn make_totp(secret: Vec<u8>, email: &str) -> Result<TOTP, String> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("GymApp".to_string()),
        // ":" separates the app name from the account in the QR code's link, so the library rejects it
        email.replace(':', ""),
    )
    .map_err(|e| format!("{e:?}"))
}

// 32 symbols with no 0/O or 1/I to misread; 32 divides 2^32 evenly, so % 32 has no bias
const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
fn recovery_code() -> String {
    let mut code: String = (0..10)
        .map(|_| ALPHABET[(OsRng.next_u32() % 32) as usize] as char)
        .collect();
    code.insert(5, '-'); // e.g. K7MQX-3RHPA
    code
}

// Which 30-second step the code belongs to (this one or one either side), if any
fn matched_step(totp: &TOTP, code: &str, now: u64) -> Option<i64> {
    let mut exact = totp.clone();
    exact.skew = 0; // check one step at a time so we know which one matched
    [now - 30, now, now + 30]
        .into_iter()
        .find(|&t| exact.check(code, t))
        .map(|t| (t / 30) as i64)
}

// Turns the stored base32 text back into the secret's bytes
fn decode_secret(base32: &str) -> Result<Vec<u8>, String> {
    Secret::Encoded(base32.to_string())
        .to_bytes()
        .map_err(|e| format!("{e:?}"))
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(r): Json<ResetRequest>,
) -> ApiResult<StatusCode> {
    let invalid = || {
        (
            StatusCode::BAD_REQUEST,
            "This reset link is invalid or has expired.".to_string(),
        )
    };
    let mut peek = Validation::default();
    peek.insecure_disable_signature_validation();
    let unverified =
        decode::<Claims>(&r.token, &DecodingKey::from_secret(&[]), &peek).map_err(|_| invalid())?;
    let id: i32 = unverified.claims.sub.parse().map_err(|_| invalid())?;
    let mut db = connect(&state).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT PasswordHash, Email, FirstName, LastName, TotpEnabled, TotpSecret FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(invalid)?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    let signed_with = |key: Vec<u8>| {
        decode::<Claims>(
            &r.token,
            &DecodingKey::from_secret(&key),
            &Validation::default(),
        )
        .is_ok()
    };
    // An admin's link first, as before; then a member's own "Forgot password?" link
    let by_admin = if signed_with(reset_key(&state.jwt_secret, stored)) {
        true
    } else if signed_with(self_reset_key(&state.jwt_secret, stored)) {
        false
    } else {
        return Err(invalid());
    };
    let user_inputs: Vec<&str> = ["Email", "FirstName", "LastName"]
        .iter()
        .filter_map(|col| row.get::<&str, _>(*col))
        .collect();
    check_password(&r.password, &user_inputs).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;

    if by_admin {
        let hash = hash_password(r.password).await?;
        // Also turns 2FA off: an admin reset link is the way back in after losing the phone.
        // Bumping SessionVersion signs out every existing session (e.g. a thief's).
        db.execute(
            "UPDATE dbo.Users SET PasswordHash = @P1, TotpEnabled = 0, TotpSecret = NULL, TotpFailures = 0, LoginFailures = 0, LockedUntil = NULL, SessionVersion = SessionVersion + 1 WHERE Id = @P2",
            &[&hash, &id],
        )
        .await
        .map_err(internal)?;
        return Ok(StatusCode::OK);
    }

    // A self-service reset must not get around 2FA, so it needs the current code
    if row.get::<bool, _>("TotpEnabled") == Some(true) {
        let code = r.code.as_deref().ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "Enter your two-factor code to finish.".to_string(),
            )
        })?;
        let email: &str = row.get("Email").ok_or_else(|| internal("missing Email"))?;
        let secret: &str = row
            .get("TotpSecret")
            .ok_or_else(|| internal("missing TotpSecret"))?;
        let totp = make_totp(decode_secret(secret).map_err(internal)?, email).map_err(internal)?;
        use_totp_code(&mut db, id, &totp, code).await?;
    }
    let hash = hash_password(r.password).await?;
    db.execute(
        "UPDATE dbo.Users SET PasswordHash = @P1, LoginFailures = 0, LockedUntil = NULL, SessionVersion = SessionVersion + 1 WHERE Id = @P2",
        &[&hash, &id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

// Checks the token and that the account is still active; returns (user id, is admin, connection)
async fn authenticate(
    parts: &Parts,
    state: &AppState,
) -> Result<(i32, bool, Db), (StatusCode, String)> {
    let unauthorized = || (StatusCode::UNAUTHORIZED, "not logged in".to_string());
    let header = parts
        .headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(unauthorized)?;
    let token = header.strip_prefix("Bearer ").ok_or_else(unauthorized)?;
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| unauthorized())?;
    let id = data.claims.sub.parse::<i32>().map_err(|_| unauthorized())?;
    // A deleted (deactivated) account's token stops working straight away, and so does
    // any token from before the last logout, password reset, 2FA change or reactivation
    let mut db = connect(state).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT Active, IsAdmin, SessionVersion FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(unauthorized)?;
    if row.get::<bool, _>("Active") != Some(true)
        || row.get::<i32, _>("SessionVersion") != Some(data.claims.ver)
    {
        return Err(unauthorized());
    }
    let is_admin = row.get("IsAdmin").unwrap_or(false);
    Ok((id, is_admin, db))
}

// Any handler that takes an AuthUser argument requires a valid token,
// and reuses the connection the check already opened
struct AuthUser(i32, Db);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (id, _, db) = authenticate(parts, state).await?;
        Ok(AuthUser(id, db))
    }
}

struct AdminUser(Db);

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (_, is_admin, db) = authenticate(parts, state).await?;
        if !is_admin {
            return Err((StatusCode::FORBIDDEN, "admins only".to_string()));
        }
        Ok(AdminUser(db))
    }
}

struct Account {
    id: i32,
    active: bool,
    is_admin: bool,
    totp_enabled: bool,
    session_version: i32,
    email_verified: bool,
}

// Returns the user's account flags when the email and password match
async fn verify_credentials(db: &mut Db, c: &Credentials) -> ApiResult<Account> {
    let unauthorized = || {
        (
            StatusCode::UNAUTHORIZED,
            "wrong email or password".to_string(),
        )
    };
    let email = c.email.to_lowercase();
    let row = one_row(
        db,
        "SELECT Id, PasswordHash, Active, IsAdmin, TotpEnabled, SessionVersion, LockedUntil, EmailVerified FROM dbo.Users WHERE Email = @P1",
        &[&email],
    )
    .await?;
    let Some(row) = row else {
        // Unknown email: still spend the time of a real check, so timing reveals nothing
        password_matches(c.password.clone(), DUMMY_HASH.clone()).await?;
        return Err(unauthorized());
    };

    let id: i32 = row.get("Id").ok_or_else(|| internal("missing Id"))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    let active: bool = row
        .get("Active")
        .ok_or_else(|| internal("missing Active"))?;
    let is_admin: bool = row
        .get("IsAdmin")
        .ok_or_else(|| internal("missing IsAdmin"))?;
    let totp_enabled: bool = row
        .get("TotpEnabled")
        .ok_or_else(|| internal("missing TotpEnabled"))?;
    let session_version: i32 = row
        .get("SessionVersion")
        .ok_or_else(|| internal("missing SessionVersion"))?;
    let email_verified: bool = row
        .get("EmailVerified")
        .ok_or_else(|| internal("missing EmailVerified"))?;
    let locked = row
        .get::<NaiveDateTime, _>("LockedUntil")
        .is_some_and(|t| t.and_utc() > Utc::now());
    // Check the password even when locked, so a locked account answers as slowly as a wrong password
    let ok = password_matches(c.password.clone(), stored.to_string()).await?;
    if locked {
        return Err(unauthorized());
    }
    if !ok {
        // Lock for 15 minutes after 10 wrong passwords in a row; time-based so nobody can lock a member out for good
        db.execute(
            // The counter goes back to 0 when the lock starts, so one typo after it ends doesn't relock.
            // SQL Server reads the old LoginFailures in both CASEs.
            "UPDATE dbo.Users SET
                LoginFailures = CASE WHEN LoginFailures + 1 >= 10 THEN 0 ELSE LoginFailures + 1 END,
                LockedUntil = CASE WHEN LoginFailures + 1 >= 10
                                   THEN DATEADD(minute, 15, SYSUTCDATETIME()) END
             WHERE Id = @P1",
            &[&id],
        )
        .await
        .map_err(internal)?;
        record(db, id, "login_failed").await?;
        return Err(unauthorized());
    }
    db.execute(
        "UPDATE dbo.Users SET LoginFailures = 0, LockedUntil = NULL WHERE Id = @P1",
        &[&id],
    )
    .await
    .map_err(internal)?;
    Ok(Account {
        id,
        active,
        is_admin,
        totp_enabled,
        session_version,
        email_verified,
    })
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
}
// SQL Server's NVARCHAR(n) holds n UTF-16 units; an emoji takes 2
fn fits(s: &str, max: usize) -> bool {
    s.encode_utf16().count() <= max
}

// The length + symbol rule, then rejects guessable passwords (common words, patterns, the user's own name/email)
fn check_password(password: &str, user_inputs: &[&str]) -> Result<(), String> {
    if password.chars().count() > 128 {
        return Err("password must be 128 characters or fewer".into());
    }
    if password.chars().count() < 10 || password.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(
            "password must be at least 10 characters and include a special character".into(),
        );
    }
    let entropy = zxcvbn(password, user_inputs);
    if entropy.score() >= Score::Four {
        return Ok(());
    }
    let msg = entropy
        .feedback()
        .and_then(|f| f.warning().map(|w| w.to_string()))
        .unwrap_or_else(|| "Password is too weak".into());
    Err(msg)
}
// ---------- auth endpoints ----------

async fn register(
    State(state): State<Arc<AppState>>,
    Json(c): Json<NewUser>,
) -> ApiResult<StatusCode> {
    let first_name = c.first_name.trim();
    let last_name = c.last_name.trim();
    if first_name.is_empty() || last_name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "first and last name are required".into(),
        ));
    }
    if !fits(first_name, 100) || !fits(last_name, 100) {
        return Err((
            StatusCode::BAD_REQUEST,
            "names must be 100 characters or fewer".into(),
        ));
    }
    if !valid_email(&c.email) || !fits(&c.email, 256) {
        return Err((StatusCode::BAD_REQUEST, "invalid email address".into()));
    }
    check_password(&c.password, &[&c.email, first_name, last_name])
        .map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    let hash = hash_password(c.password.clone()).await?;
    let email = c.email.to_lowercase();
    let mut db = connect(&state).await.map_err(internal)?;
    // The duplicate-email error can surface from either await, so both feed one match
    let inserted = match db
        .query(
            "INSERT INTO dbo.Users (FirstName, LastName, Email, PasswordHash) OUTPUT INSERTED.Id VALUES (@P1, @P2, @P3, @P4)",
            &[&first_name, &last_name, &email, &hash],
        )
        .await
    {
        Ok(stream) => stream.into_row().await,
        Err(e) => Err(e),
    };

    match inserted {
        Ok(row) => {
            let id: i32 = row
                .and_then(|r| r.get(0))
                .ok_or_else(|| internal("insert returned no Id"))?;
            let token = make_verify_token(id, &state.jwt_secret).map_err(internal)?;
            send_mail(
                state.clone(),
                email.clone(),
                "Confirm your Gym App email",
                format!(
                    "Confirm your email to finish signing up:\n{}/#verify={token}\n\nThe link works for 24 hours.",
                    state.frontend_url
                ),
            );
            Ok(StatusCode::OK)
        }
        // 2627 / 2601 = unique constraint violated, so the email already exists.
        // Answer exactly as for a new account, so sign-up can't reveal who's a member
        Err(tiberius::error::Error::Server(e)) if e.code() == 2627 || e.code() == 2601 => {
            send_mail(
                state.clone(),
                email.clone(),
                "Someone tried to sign up with your email",
                "Someone tried to create a Gym App account with this email. If that was you, log in or use Forgot password.".into(),
            );
            Ok(StatusCode::OK)
        }
        Err(e) => Err(internal(e)),
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(c): Json<Credentials>,
) -> ApiResult<Response> {
    let mut db = connect(&state).await.map_err(internal)?;
    let account = verify_credentials(&mut db, &c).await?;
    // Checked after the password so a stranger can't probe which emails are deactivated
    if !account.active {
        return Err((StatusCode::FORBIDDEN, "account is deactivated".into()));
    }
    if !account.email_verified {
        let token = make_verify_token(account.id, &state.jwt_secret).map_err(internal)?;
        send_mail(
            state.clone(),
            c.email.to_lowercase(),
            "Confirm your Gym App email",
            format!("{}/#verify={token}", state.frontend_url),
        );
        // 409, not 403: the frontend reads 403 as "deactivated" (section 2.5)
        return Err((
            StatusCode::CONFLICT,
            "Check your email: we've sent a new link to finish signing up.".into(),
        ));
    }
    if account.totp_enabled {
        let challenge = make_challenge(account.id, &state.jwt_secret).map_err(internal)?;
        return Ok(Json(LoginResponse {
            access_token: None,
            is_admin: false,
            challenge: Some(challenge),
            two_factor: false,
            last_login: None,
            failed_since: 0,
        })
        .into_response());
    }
    // Read before recording this sign-in, or "last sign-in" would be this one
    let (last_login, failed_since) = last_visit(&mut db, account.id).await?;
    record(&mut db, account.id, "login").await?;
    let token =
        make_token(account.id, account.session_version, &state.jwt_secret).map_err(internal)?;
    let resp = Json(LoginResponse {
        access_token: Some(token),
        is_admin: account.is_admin,
        challenge: None,
        two_factor: false,
        last_login,
        failed_since,
    });
    if c.remember {
        let refresh = make_refresh_token(account.id, account.session_version, &state.jwt_secret)
            .map_err(internal)?;
        return Ok(([(SET_COOKIE, refresh_cookie(&refresh))], resp).into_response());
    }
    Ok(resp.into_response())
}

async fn totp_setup(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<TotpSetup>> {
    let row = one_row(
        &mut db,
        "SELECT Email, TotpEnabled FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    let email: &str = row.get("Email").ok_or_else(|| internal("missing Email"))?;
    let enabled: bool = row.get("TotpEnabled").unwrap_or(false);
    if enabled {
        return Err((StatusCode::CONFLICT, "Two-factor is already on.".into()));
    }

    let bytes = Secret::generate_secret()
        .to_bytes()
        .map_err(|e| internal(format!("{e:?}")))?;
    let totp = make_totp(bytes, email).map_err(internal)?;
    let secret = totp.get_secret_base32();
    let qr = totp.get_qr_base64().map_err(internal)?;

    // Saved but NOT enabled: totp_confirm switches it on once the user proves they scanned it
    db.execute(
        "UPDATE dbo.Users SET TotpSecret = @P1 WHERE Id = @P2",
        &[&secret, &user_id],
    )
    .await
    .map_err(internal)?;
    Ok(Json(TotpSetup { qr, secret }))
}

async fn totp_confirm(
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<CodeRequest>,
) -> ApiResult<Json<RecoveryCodes>> {
    let row = one_row(
        &mut db,
        "SELECT Email, TotpSecret FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    let email: &str = row.get("Email").ok_or_else(|| internal("missing Email"))?;
    let secret: &str = row.get("TotpSecret").ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Start two-factor setup first.".to_string(),
        )
    })?;

    let totp = make_totp(decode_secret(secret).map_err(internal)?, email).map_err(internal)?;
    if !totp.check_current(&r.code).map_err(internal)? {
        return Err((
            StatusCode::BAD_REQUEST,
            "That code didn't match. Try the newest one.".into(),
        ));
    }
    // Codes first, so a failure here leaves 2FA off rather than on with no way back in.
    // Only hashes are stored; the plain codes exist only in this one response
    db.execute(
        "DELETE FROM dbo.RecoveryCodes WHERE UserId = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    let codes: Vec<String> = (0..10).map(|_| recovery_code()).collect();
    for code in &codes {
        let hash = hash_password(code.clone()).await?;
        db.execute(
            "INSERT INTO dbo.RecoveryCodes (UserId, CodeHash) VALUES (@P1, @P2)",
            &[&user_id, &hash],
        )
        .await
        .map_err(internal)?;
    }
    // Signs out every session, including this one: they were made without a code
    db.execute(
        "UPDATE dbo.Users SET TotpEnabled = 1, SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    Ok(Json(RecoveryCodes { codes }))
}

// Wrong 2FA codes in a row before the account needs an admin reset link.
// Each guess hits 3 in a million, so 10 tries give an attacker about a 1 in 33,000 chance
const MAX_TOTP_FAILURES: i32 = 10;

// Spends one of the user's tries, then accepts the code at most once
async fn use_totp_code(db: &mut Db, id: i32, totp: &TOTP, code: &str) -> ApiResult<()> {
    // Spends one try before checking (a correct code gives them all back), so the cap
    // survives restarts and racing requests can't get past it
    let reserved = db
        .execute(
            "UPDATE dbo.Users SET TotpFailures = TotpFailures + 1 WHERE Id = @P1 AND TotpFailures < @P2",
            &[&id, &MAX_TOTP_FAILURES],
        )
        .await
        .map_err(internal)?;
    if reserved.total() == 0 {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many wrong codes. Ask an admin for a reset link.".into(),
        ));
    }
    // 400, not 401: the frontend reads 401 as "challenge expired, start over"
    let wrong = || {
        (
            StatusCode::BAD_REQUEST,
            "That code didn't match. Try the newest one.".to_string(),
        )
    };
    // A recovery code looks like K7MQX-3RHPA; a wrong one has already used up a try above
    if code.len() == 11 && code.as_bytes()[5] == b'-' {
        let rows = db
            .query(
                "SELECT Id, CodeHash FROM dbo.RecoveryCodes WHERE UserId = @P1 AND UsedAt IS NULL",
                &[&id],
            )
            .await
            .map_err(internal)?
            .into_first_result()
            .await
            .map_err(internal)?;
        for r in rows {
            let hash: &str = r
                .get("CodeHash")
                .ok_or_else(|| internal("missing CodeHash"))?;
            if password_matches(code.to_uppercase(), hash.to_string()).await? {
                let code_id: i32 = r.get("Id").ok_or_else(|| internal("missing Id"))?;
                // UsedAt IS NULL again, so two requests racing with one code can't both pass
                let used = db
                    .execute(
                        "UPDATE dbo.RecoveryCodes SET UsedAt = SYSUTCDATETIME() WHERE Id = @P1 AND UsedAt IS NULL",
                        &[&code_id],
                    )
                    .await
                    .map_err(internal)?;
                if used.total() == 0 {
                    return Err(wrong());
                }
                db.execute(
                    "UPDATE dbo.Users SET TotpFailures = 0 WHERE Id = @P1",
                    &[&id],
                )
                .await
                .map_err(internal)?;
                return Ok(());
            }
        }
        return Err(wrong());
    }
    let step = matched_step(totp, code, Utc::now().timestamp() as u64).ok_or_else(wrong)?;
    // Saves the step only if it's newer than the last one used, so each code works once.
    // One UPDATE means two requests racing with the same code can't both pass.
    let saved = db
        .execute(
            "UPDATE dbo.Users SET LastTotpStep = @P1, TotpFailures = 0 WHERE Id = @P2 AND (LastTotpStep IS NULL OR LastTotpStep < @P1)",
            &[&step, &id],
        )
        .await
        .map_err(internal)?;
    if saved.total() == 0 {
        return Err(wrong());
    }
    Ok(())
}

async fn totp_verify(
    State(state): State<Arc<AppState>>,
    Json(r): Json<VerifyRequest>,
) -> ApiResult<Response> {
    let expired = || {
        (
            StatusCode::UNAUTHORIZED,
            "Your sign-in expired. Log in again.".to_string(),
        )
    };
    let data = decode::<Claims>(
        &r.challenge,
        &DecodingKey::from_secret(&challenge_key(&state.jwt_secret)),
        &Validation::default(),
    )
    .map_err(|_| expired())?;
    let id: i32 = data.claims.sub.parse().map_err(|_| expired())?;
    // Counted per user, not per IP, so an attacker with the password can't spread guesses out
    if state.totp_attempts.check_key(&id).is_err() {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many tries. Wait a minute and try again.".into(),
        ));
    }

    let mut db = connect(&state).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT Email, TotpSecret, IsAdmin, SessionVersion FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(expired)?;
    let email: &str = row.get("Email").ok_or_else(|| internal("missing Email"))?;
    let secret: &str = row.get("TotpSecret").ok_or_else(expired)?;
    let is_admin: bool = row.get("IsAdmin").unwrap_or(false);
    let session_version: i32 = row
        .get("SessionVersion")
        .ok_or_else(|| internal("missing SessionVersion"))?;

    let totp = make_totp(decode_secret(secret).map_err(internal)?, email).map_err(internal)?;
    use_totp_code(&mut db, id, &totp, &r.code).await?;
    let (last_login, failed_since) = last_visit(&mut db, id).await?;
    record(&mut db, id, "login").await?;
    let token = make_token(id, session_version, &state.jwt_secret).map_err(internal)?;
    let resp = Json(LoginResponse {
        access_token: Some(token),
        is_admin,
        challenge: None,
        two_factor: true,
        last_login,
        failed_since,
    });
    if r.remember {
        let refresh =
            make_refresh_token(id, session_version, &state.jwt_secret).map_err(internal)?;
        return Ok(([(SET_COOKIE, refresh_cookie(&refresh))], resp).into_response());
    }
    Ok(resp.into_response())
}

// Always answers 200, so it can't be used to find out who has an account
async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(r): Json<ForgotRequest>,
) -> ApiResult<StatusCode> {
    let email = r.email.to_lowercase();
    let mut db = connect(&state).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT Id, PasswordHash FROM dbo.Users WHERE Email = @P1 AND Active = 1",
        &[&email],
    )
    .await?;
    if let Some(row) = row {
        let id: i32 = row.get("Id").ok_or_else(|| internal("missing Id"))?;
        let stored: &str = row
            .get("PasswordHash")
            .ok_or_else(|| internal("missing hash"))?;
        let token = sign(
            id,
            0,
            &self_reset_key(&state.jwt_secret, stored),
            chrono::Duration::minutes(15),
        )
        .map_err(internal)?;
        send_mail(
            state.clone(),
            email,
            "Reset your Gym App password",
            format!(
                "Choose a new password:\n{}/#reset={token}\n\nThe link works for 15 minutes. If you didn't ask for this, you can ignore this email.",
                state.frontend_url
            ),
        );
    }
    Ok(StatusCode::OK)
}

async fn verify_email(
    State(state): State<Arc<AppState>>,
    Json(r): Json<TokenRequest>,
) -> ApiResult<StatusCode> {
    let invalid = || {
        (
            StatusCode::BAD_REQUEST,
            "This link is invalid or has expired.".to_string(),
        )
    };
    let data = decode::<Claims>(
        &r.token,
        &DecodingKey::from_secret(&verify_key(&state.jwt_secret)),
        &Validation::default(),
    )
    .map_err(|_| invalid())?;
    let id: i32 = data.claims.sub.parse().map_err(|_| invalid())?;
    let mut db = connect(&state).await.map_err(internal)?;
    db.execute(
        "UPDATE dbo.Users SET EmailVerified = 1 WHERE Id = @P1",
        &[&id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

async fn delete_account(AuthUser(user_id, mut db): AuthUser) -> ApiResult<StatusCode> {
    db.execute(
        "UPDATE dbo.Users SET Active = 0 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

async fn reactivate_account(
    State(state): State<Arc<AppState>>,
    Json(c): Json<Credentials>,
) -> ApiResult<StatusCode> {
    let mut db = connect(&state).await.map_err(internal)?;
    let account = verify_credentials(&mut db, &c).await?;
    // Bump SessionVersion so tokens from before the deactivation don't come back to life.
    // Active = 0 means an already-active account isn't touched, so this can't sign anyone out.
    db.execute(
        "UPDATE dbo.Users SET Active = 1, SessionVersion = SessionVersion + 1 WHERE Id = @P1 AND Active = 0",
        &[&account.id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

// 400 for a wrong current password, not 401: the frontend reads 401 as "session expired"
fn wrong_password() -> (StatusCode, String) {
    (
        StatusCode::BAD_REQUEST,
        "Your current password is wrong.".to_string(),
    )
}

async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<PasswordChange>,
) -> ApiResult<Response> {
    let row = one_row(
        &mut db,
        "SELECT PasswordHash, Email, FirstName, LastName, IsAdmin, TotpEnabled FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    if !password_matches(r.current, stored.to_string()).await? {
        return Err(wrong_password());
    }
    let user_inputs: Vec<&str> = ["Email", "FirstName", "LastName"]
        .iter()
        .filter_map(|col| row.get::<&str, _>(*col))
        .collect();
    check_password(&r.new, &user_inputs).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    let hash = hash_password(r.new).await?;
    // Signs out every other device; this one gets a new token below
    let new_version: i32 = one_row(
        &mut db,
        "UPDATE dbo.Users SET PasswordHash = @P1, SessionVersion = SessionVersion + 1 OUTPUT INSERTED.SessionVersion WHERE Id = @P2",
        &[&hash, &user_id],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("update returned no version"))?;
    let token = make_token(user_id, new_version, &state.jwt_secret).map_err(internal)?;
    let resp = Json(LoginResponse {
        access_token: Some(token),
        is_admin: row.get("IsAdmin").unwrap_or(false),
        challenge: None,
        two_factor: row.get("TotpEnabled").unwrap_or(false),
        last_login: None,
        failed_since: 0,
    });
    // The version bump also kills this device's "Stay signed in" cookie, so replace it if there was one
    if cookie(&headers, "refresh").is_some() {
        let refresh =
            make_refresh_token(user_id, new_version, &state.jwt_secret).map_err(internal)?;
        return Ok(([(SET_COOKIE, refresh_cookie(&refresh))], resp).into_response());
    }
    Ok(resp.into_response())
}

async fn totp_disable(
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<DisableRequest>,
) -> ApiResult<StatusCode> {
    let row = one_row(
        &mut db,
        "SELECT PasswordHash, Email, TotpSecret, TotpEnabled FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    if !password_matches(r.password, stored.to_string()).await? {
        return Err(wrong_password());
    }
    let secret: &str = match (row.get::<bool, _>("TotpEnabled"), row.get("TotpSecret")) {
        (Some(true), Some(secret)) => secret,
        _ => return Err((StatusCode::CONFLICT, "Two-factor is already off.".into())),
    };
    let email: &str = row.get("Email").ok_or_else(|| internal("missing Email"))?;
    let totp = make_totp(decode_secret(secret).map_err(internal)?, email).map_err(internal)?;
    use_totp_code(&mut db, user_id, &totp, &r.code).await?;
    // Signs out every session, like turning it on does
    db.execute(
        "UPDATE dbo.Users SET TotpEnabled = 0, TotpSecret = NULL, LastTotpStep = NULL, TotpFailures = 0, SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    db.execute(
        "DELETE FROM dbo.RecoveryCodes WHERE UserId = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

// Swaps the "Stay signed in" cookie for a fresh access token; called once per page load
async fn refresh(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Response> {
    let expired = || (StatusCode::UNAUTHORIZED, "not signed in".to_string());
    let token = cookie(&headers, "refresh").ok_or_else(expired)?;
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(&refresh_key(&state.jwt_secret)),
        &Validation::default(),
    )
    .map_err(|_| expired())?;
    let id: i32 = data.claims.sub.parse().map_err(|_| expired())?;
    let mut db = connect(&state).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT Active, IsAdmin, SessionVersion, TotpEnabled FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(expired)?;
    // Same checks as authenticate(): deactivated, or signed out since the cookie was made
    if row.get::<bool, _>("Active") != Some(true)
        || row.get::<i32, _>("SessionVersion") != Some(data.claims.ver)
    {
        return Ok(([(SET_COOKIE, CLEAR_REFRESH)], expired()).into_response());
    }
    let access = make_token(id, data.claims.ver, &state.jwt_secret).map_err(internal)?;
    Ok(Json(LoginResponse {
        access_token: Some(access),
        is_admin: row.get("IsAdmin").unwrap_or(false),
        challenge: None,
        two_factor: row.get("TotpEnabled").unwrap_or(false),
        last_login: None,
        failed_since: 0,
    })
    .into_response())
}

// Signs this user out everywhere: every token they hold stops working
async fn logout(AuthUser(user_id, mut db): AuthUser) -> ApiResult<impl IntoResponse> {
    db.execute(
        "UPDATE dbo.Users SET SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    // The version bump already kills the cookie; this also deletes it from the browser
    Ok(([(SET_COOKIE, CLEAR_REFRESH)], StatusCode::OK))
}

async fn list_users(AdminUser(mut db): AdminUser) -> ApiResult<Json<Vec<UserSummary>>> {
    let rows = db
        .query(
            "SELECT u.Id, u.FirstName, u.LastName, u.Email, u.Active, u.IsAdmin, u.TotpEnabled, u.CreatedAt,
               COUNT(CASE WHEN e.Kind = 'login' THEN 1 END)    AS Logins,
               MAX(CASE WHEN e.Kind = 'login' THEN e.At END)   AS LastLogin,
               COUNT(CASE WHEN e.Kind = 'login_failed' AND e.At > DATEADD(day, -7, SYSUTCDATETIME()) THEN 1 END) AS FailedLast7d,
               COUNT(CASE WHEN e.Kind = 'workout' THEN 1 END)  AS Workouts,
               MAX(CASE WHEN e.Kind = 'workout' THEN e.At END) AS LastWorkout
             FROM dbo.Users u
             LEFT JOIN dbo.Events e ON e.UserId = u.Id
             GROUP BY u.Id, u.FirstName, u.LastName, u.Email, u.Active, u.IsAdmin, u.TotpEnabled, u.CreatedAt
             ORDER BY u.Email",
            &[],
        )
        .await
        .map_err(internal)?
        .into_first_result()
        .await
        .map_err(internal)?;

    let users = rows
        .iter()
        .map(|r| UserSummary {
            id: r.get("Id").unwrap_or_default(),
            first_name: r.get::<&str, _>("FirstName").map(|s| s.to_string()),
            last_name: r.get::<&str, _>("LastName").map(|s| s.to_string()),
            email: r.get::<&str, _>("Email").unwrap_or_default().to_string(),
            active: r.get("Active").unwrap_or_default(),
            is_admin: r.get("IsAdmin").unwrap_or_default(),
            totp_enabled: r.get("TotpEnabled").unwrap_or_default(),
            created_at: r
                .get::<NaiveDateTime, _>("CreatedAt")
                .unwrap_or_default()
                .and_utc(),
            logins: r.get("Logins").unwrap_or_default(),
            last_login: r.get::<NaiveDateTime, _>("LastLogin").map(|t| t.and_utc()),
            failed_last_7d: r.get("FailedLast7d").unwrap_or_default(),
            workouts: r.get("Workouts").unwrap_or_default(),
            last_workout: r
                .get::<NaiveDateTime, _>("LastWorkout")
                .map(|t| t.and_utc()),
        })
        .collect();
    Ok(Json(users))
}

async fn admin_stats(
    AdminUser(mut db): AdminUser,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Json<Vec<DayCount>>> {
    // Clamped so nobody can ask for years of rows
    let days = q.days.unwrap_or(30).clamp(7, 365);
    let rows = db
        .query(
            // Days are counted in Sydney/Melbourne time, so an evening session isn't split across two UTC days
            "SELECT CONVERT(char(10), Day, 23) AS Day, Kind, N FROM (
                SELECT CAST(At AT TIME ZONE 'UTC' AT TIME ZONE 'AUS Eastern Standard Time' AS date) AS Day,
                       Kind, COUNT(*) AS N
                FROM dbo.Events
                WHERE At >= DATEADD(day, -@P1, SYSUTCDATETIME())
                GROUP BY CAST(At AT TIME ZONE 'UTC' AT TIME ZONE 'AUS Eastern Standard Time' AS date), Kind
             ) t ORDER BY Day",
            &[&days],
        )
        .await
        .map_err(internal)?
        .into_first_result()
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.iter()
            .map(|r| DayCount {
                day: r.get::<&str, _>("Day").unwrap_or_default().to_string(),
                kind: r.get::<&str, _>("Kind").unwrap_or_default().to_string(),
                n: r.get("N").unwrap_or_default(),
            })
            .collect(),
    ))
}

// ---------- workout endpoints ----------
// The user ID comes from the token (AuthUser), never from the request body

async fn list_workouts(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<Vec<Workout>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = db
        .query(
            // shortcut: newest 200 only; add paging if members need older history
            "SELECT TOP 200 Id, [Date], Name, Notes FROM dbo.Workouts WHERE UserId = @P1 ORDER BY [Date] DESC",
            &[&user_id],
        )
        .await
        .map_err(internal)?
        .into_first_result()
        .await
        .map_err(internal)?;

    let workouts = rows
        .iter()
        .map(|r| Workout {
            id: r.get("Id").unwrap_or_default(),
            name: r.get::<&str, _>("Name").unwrap_or_default().to_string(),
            date: r
                .get::<NaiveDateTime, _>("Date")
                .unwrap_or_default()
                .and_utc(),
            notes: r.get::<&str, _>("Notes").map(|s| s.to_string()),
        })
        .collect();
    Ok(Json(workouts))
}

async fn create_workout(
    AuthUser(user_id, mut db): AuthUser,
    Json(w): Json<NewWorkout>,
) -> ApiResult<(StatusCode, Json<Workout>)> {
    // The Name column is NVARCHAR(200)
    let name = w.name.trim();
    if name.is_empty() || !fits(name, 200) {
        return Err((
            StatusCode::BAD_REQUEST,
            "workout name must be 1 to 200 characters".into(),
        ));
    }
    // Notes is NVARCHAR(MAX), so without a cap one account could fill the database's disk
    if w.notes.as_deref().is_some_and(|n| !fits(n, 2000)) {
        return Err((
            StatusCode::BAD_REQUEST,
            "notes must be 2000 characters or fewer".into(),
        ));
    }
    // Years outside 1..=9999 make the database driver panic
    if !(1..=9999).contains(&w.date.year()) {
        return Err((StatusCode::BAD_REQUEST, "date is out of range".into()));
    }
    set_user(&mut db, user_id).await.map_err(internal)?;
    let count: i32 = one_row(
        &mut db,
        "SELECT COUNT(*) FROM dbo.Workouts WHERE UserId = @P1",
        &[&user_id],
    )
    .await?
    .and_then(|r| r.get(0))
    .unwrap_or(0);
    if count >= 5000 {
        return Err((StatusCode::BAD_REQUEST, "workout limit reached".into()));
    }
    let date = w.date.naive_utc();
    let id: i32 = one_row(
        &mut db,
        "INSERT INTO dbo.Workouts (UserId, [Date], Name, Notes) OUTPUT INSERTED.Id VALUES (@P1, @P2, @P3, @P4)",
        &[&user_id, &date, &name, &w.notes],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("insert returned no Id"))?;
    record(&mut db, user_id, "workout").await?;
    let saved = Workout {
        id,
        name: name.to_string(),
        date: w.date,
        notes: w.notes,
    };
    Ok((StatusCode::CREATED, Json(saved)))
}

// ---------- startup ----------

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_required(key: &str) -> String {
    env::var(key).unwrap_or_else(|_| panic!("{key} is not set. Check your .env file."))
}

// Creates the tables the first time the API runs
async fn init_db(state: &AppState) -> Result<(), tiberius::error::Error> {
    let mut db = connect(state).await?;
    db.simple_query(
        "IF OBJECT_ID('dbo.Users', 'U') IS NULL
            CREATE TABLE dbo.Users (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                Email NVARCHAR(256) NOT NULL UNIQUE,
                PasswordHash NVARCHAR(512) NOT NULL,
                FirstName NVARCHAR(100) NULL,
                LastName NVARCHAR(100) NULL,
                Active BIT NOT NULL DEFAULT 1,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                IsAdmin BIT NOT NULL DEFAULT 0,
                TotpSecret NVARCHAR(64) NULL,
                TotpEnabled BIT NOT NULL DEFAULT 0,
                SessionVersion INT NOT NULL DEFAULT 0,
                LastTotpStep BIGINT NULL,
                TotpFailures INT NOT NULL DEFAULT 0,
                LoginFailures INT NOT NULL DEFAULT 0,
                LockedUntil DATETIME2 NULL,
                EmailVerified BIT NOT NULL DEFAULT 0
            );
         IF OBJECT_ID('dbo.Workouts', 'U') IS NULL
            CREATE TABLE dbo.Workouts (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                UserId INT NOT NULL REFERENCES dbo.Users(Id),
                [Date] DATETIME2 NOT NULL,
                Name NVARCHAR(200) NOT NULL,
                Notes NVARCHAR(MAX) NULL
            );
         IF OBJECT_ID('dbo.Events', 'U') IS NULL
            CREATE TABLE dbo.Events (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                UserId INT NOT NULL REFERENCES dbo.Users(Id),
                Kind NVARCHAR(20) NOT NULL,
                At DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
         IF OBJECT_ID('dbo.RecoveryCodes', 'U') IS NULL
            CREATE TABLE dbo.RecoveryCodes (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                UserId INT NOT NULL REFERENCES dbo.Users(Id),
                CodeHash NVARCHAR(200) NOT NULL,
                UsedAt DATETIME2 NULL
            );",
    )
    .await?
    .into_results()
    .await?;
    Ok(())
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let mut db_config = Config::new();
    db_config.host(env_required("DB_HOST"));
    db_config.port(
        env_or("DB_PORT", "1433")
            .parse()
            .expect("DB_PORT must be a number"),
    );
    db_config.database(env_or("DB_NAME", "GymApp"));
    db_config.authentication(AuthMethod::sql_server(
        env_required("DB_USER"),
        env_required("DB_PASSWORD"),
    ));
    if env_or("DB_TRUST_CERT", "false") == "true" {
        db_config.trust_cert(); // development only: accepts SQL Server's self-signed certificate
    }

    let jwt_secret = env_required("JWT_SECRET");
    // A short key can be cracked from any token, letting someone forge an admin login
    assert!(
        jwt_secret.len() >= 32,
        "JWT_SECRET must be at least 32 characters. Make one with: openssl rand -base64 48"
    );
    let smtp_port: u16 = env_or("SMTP_PORT", "587")
        .parse()
        .expect("SMTP_PORT must be a number");
    let smtp_host = env_required("SMTP_HOST");
    // Port 1025 = Mailpit on this machine, which has no TLS; real providers get TLS via relay()
    let mut mailer = if smtp_port == 1025 {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&smtp_host).port(smtp_port)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host)
            .expect("bad SMTP_HOST")
            .port(smtp_port)
    };
    if let (Ok(u), Ok(p)) = (env::var("SMTP_USER"), env::var("SMTP_PASSWORD")) {
        mailer = mailer.credentials(SmtpCredentials::new(u, p));
    }
    let mailer = mailer.build();
    let mail_from: Mailbox = env_required("MAIL_FROM")
        .parse()
        .expect("MAIL_FROM must look like Gym App <no-reply@yourgym.com>");

    let state = Arc::new(AppState {
        db_config,
        jwt_secret,
        frontend_url: env_or("FRONTEND_URL", "http://localhost:5173"),
        // 5 tries, then one more each minute
        mailer,
        mail_from,
        totp_attempts: DefaultKeyedRateLimiter::keyed(
            Quota::with_period(Duration::from_secs(60))
                .unwrap()
                .allow_burst(NonZeroU32::new(5).unwrap()),
        ),
    });

    init_db(&state)
        .await
        .expect("could not connect to SQL Server or create tables");

    // One new attempt every 2 seconds per client IP, bursts of up to 30:
    // room for a gym's members logging in over one shared Wi-Fi
    let limit = GovernorConfigBuilder::default()
        .key_extractor(ProxyIpKeyExtractor)
        .per_second(2)
        .burst_size(30)
        .finish()
        .unwrap();
    // Both limiters keep an entry per IP / user until pruned; drop the ones that are idle again
    let ip_limiter = limit.limiter().clone();
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut every_minute = tokio::time::interval(Duration::from_secs(60));
        loop {
            every_minute.tick().await;
            ip_limiter.retain_recent();
            cleanup_state.totp_attempts.retain_recent();
        }
    });
    let limited = Router::new()
        // runs a full Argon2 hash, so it needs a limit too
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/2fa/verify", post(totp_verify))
        .route("/auth/reset", post(reset_password))
        .route("/auth/verify", post(verify_email))
        .route("/auth/forgot", post(forgot_password))
        .route("/auth/refresh", post(refresh))
        // both check a password, so they share the login limit
        .route("/auth/password", post(change_password))
        .route("/auth/2fa/disable", post(totp_disable))
        // checks a password, so it needs the same limit as login
        .route("/auth/reactivate", post(reactivate_account))
        .layer(GovernorLayer::new(limit));

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/logout", post(logout))
        .route("/auth/delete", delete(delete_account))
        .route("/auth/2fa/setup", post(totp_setup))
        .route("/auth/2fa/confirm", post(totp_confirm))
        .route("/workouts", get(list_workouts).post(create_workout))
        .route("/admin/users", get(list_users))
        .route("/admin/stats", get(admin_stats))
        .route("/admin/users/{id}/admin", put(set_admin))
        .route("/admin/users/{id}/reset-link", post(create_reset_link))
        .merge(limited)
        .with_state(state);

    let addr = env_or("BIND_ADDR", "127.0.0.1:5080");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("could not bind address");
    println!("Listening on http://{addr}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_token_only_works_with_the_hash_it_was_made_for() {
        let token = make_reset_token(7, "secret", "old-hash").unwrap();
        let check = |hash: &str| {
            decode::<Claims>(
                &token,
                &DecodingKey::from_secret(&reset_key("secret", hash)),
                &Validation::default(),
            )
        };
        assert_eq!(check("old-hash").unwrap().claims.sub, "7");
        assert!(
            check("new-hash").is_err(),
            "link must die once the password changes"
        );
        // a reset token must not pass as a login token
        assert!(
            decode::<Claims>(
                &token,
                &DecodingKey::from_secret(b"secret"),
                &Validation::default()
            )
            .is_err()
        );
    }

    #[test]
    fn challenge_is_not_a_login_token_and_totp_round_trips() {
        let challenge = make_challenge(7, "secret").unwrap();
        let as_login = decode::<Claims>(
            &challenge,
            &DecodingKey::from_secret(b"secret"),
            &Validation::default(),
        );
        assert!(as_login.is_err(), "a challenge must not log anyone in");

        let base32 = make_totp(Secret::generate_secret().to_bytes().unwrap(), "a@b.com")
            .unwrap()
            .get_secret_base32();
        let totp = make_totp(decode_secret(&base32).unwrap(), "a@b.com").unwrap();
        assert!(
            totp.check_current(&totp.generate_current().unwrap())
                .unwrap()
        );
        assert!(make_totp(Secret::generate_secret().to_bytes().unwrap(), "a:b@c.com").is_ok());
    }

    #[test]
    fn login_token_carries_session_version() {
        let token = make_token(7, 3, "secret").unwrap();
        let claims = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(b"secret"),
            &Validation::default(),
        )
        .unwrap()
        .claims;
        assert_eq!(claims.ver, 3);
        // tokens made before this field existed read as version 0, the column's default
        #[derive(Serialize)]
        struct OldClaims {
            sub: String,
            exp: usize,
        }
        let old_claims = OldClaims {
            sub: "7".into(),
            exp: 4_000_000_000,
        };
        let old = encode(
            &Header::default(),
            &old_claims,
            &EncodingKey::from_secret(b"secret"),
        )
        .unwrap();
        let claims = decode::<Claims>(
            &old,
            &DecodingKey::from_secret(b"secret"),
            &Validation::default(),
        )
        .unwrap()
        .claims;
        assert_eq!(claims.ver, 0);
    }

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

    #[test]
    fn cookie_parser_finds_only_the_named_cookie() {
        let mut h = HeaderMap::new();
        h.insert(
            COOKIE,
            "theme=dark; refresh=abc.def; refreshx=nope"
                .parse()
                .unwrap(),
        );
        assert_eq!(cookie(&h, "refresh"), Some("abc.def"));
        assert_eq!(cookie(&h, "missing"), None);
    }

    #[test]
    fn recovery_codes_look_right_and_differ() {
        let a = recovery_code();
        assert_eq!(a.len(), 11);
        assert_eq!(a.as_bytes()[5], b'-');
        assert!(
            a.chars()
                .filter(|&c| c != '-')
                .all(|c| ALPHABET.contains(&(c as u8)))
        );
        assert_ne!(a, recovery_code());
    }

    #[test]
    fn rejects_bad_emails_and_passwords() {
        assert!(valid_email("a@b.com"));
        for bad in [
            "",
            "ab.com",
            "@b.com",
            "a@b",
            "a@.com",
            "a@b.",
            "a@b@c.com",
            "a b@c.com",
        ] {
            assert!(!valid_email(bad), "{bad:?} should be rejected");
        }
        assert!(check_password("short!", &[]).is_err(), "too short");
        assert!(
            check_password("nosymbolsatall123", &[]).is_err(),
            "no symbol"
        );
        assert!(check_password("correct-Horse-battery-staple-9", &[]).is_ok());
        assert!(check_password(&"a!".repeat(65), &[]).is_err(), "too long");
        assert!(
            check_password("jet.thomas@gym.com!", &["jet.thomas@gym.com"]).is_err(),
            "the user's own email is guessable"
        );
    }

    #[test]
    fn length_counts_utf16_units_like_sql_server() {
        assert!(fits(&"a".repeat(100), 100));
        assert!(!fits(&"a".repeat(101), 100));
        assert!(!fits(&"😀".repeat(51), 100), "an emoji takes 2 units");
    }

    #[test]
    fn matched_step_finds_the_codes_time_step() {
        let totp = make_totp(Secret::generate_secret().to_bytes().unwrap(), "a@b.com").unwrap();
        let now = 1_700_000_000;
        assert_eq!(
            matched_step(&totp, &totp.generate(now), now),
            Some((now / 30) as i64)
        );
        assert_eq!(
            matched_step(&totp, &totp.generate(now - 30), now),
            Some((now / 30 - 1) as i64)
        );
        assert_eq!(matched_step(&totp, &totp.generate(now - 90), now), None);
    }
}
