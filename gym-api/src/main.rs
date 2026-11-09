use std::{
    env,
    net::{IpAddr, SocketAddr},
    num::NonZeroU32,
    sync::{Arc, LazyLock},
    time::Duration,
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, FromRequestParts, Path, State},
    http::{Request, StatusCode, header::AUTHORIZATION, request::Parts},
    routing::{delete, get, post},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use governor::{DefaultKeyedRateLimiter, Quota};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use tiberius::{AuthMethod, Client, Config};
use tokio::net::TcpStream;
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

// ---------- shared state ----------

struct AppState {
    db_config: Config,
    jwt_secret: String,
    frontend_url: String,
    // Wrong-code budget per user for 2FA, so spreading guesses over many IPs doesn't help
    // shortcut: in memory, so it resets on restart and isn't shared between processes;
    // move it to a DB column if the API ever runs as more than one process
    totp_attempts: DefaultKeyedRateLimiter<i32>,
}

// The API only listens on 127.0.0.1 behind a proxy, so the client IP is the last
// X-Forwarded-For entry (added by our proxy). Earlier entries come from the client and can be faked.
#[derive(Clone)]
struct ProxyIpKeyExtractor;

impl KeyExtractor for ProxyIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<IpAddr, GovernorError> {
        let forwarded = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit(',').next())
            .and_then(|ip| ip.trim().parse().ok());
        let peer = || req.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
        forwarded.or_else(peer).ok_or(GovernorError::UnableToExtractKey)
    }
}

type Db = Client<Compat<TcpStream>>;
type ApiResult<T> = Result<T, (StatusCode, String)>;

async fn connect(state: &AppState) -> Result<Db, tiberius::error::Error> {
    let tcp = TcpStream::connect(state.db_config.get_addr()).await?;
    tcp.set_nodelay(true)?;
    Client::connect(state.db_config.clone(), tcp.compat_write()).await
}

// Opens a connection that row-level security knows belongs to this user
async fn connect_as(state: &AppState, user_id: i32) -> Result<Db, tiberius::error::Error> {
    let mut db = connect(state).await?;
    db.execute(
        "EXEC sp_set_session_context @key = N'UserId', @value = @P1, @read_only = 1",
        &[&user_id],
    )
    .await?;
    Ok(db)
}

// Log the real error on the server, send a vague one to the client
fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    eprintln!("error: {e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "server error".to_string(),
    )
}

// ---------- JSON shapes ----------

#[derive(Deserialize)]
struct Credentials {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct ResetRequest {
    token: String,
    password: String,
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
    needs_code: bool,
    challenge: Option<String>,
}

#[derive(Serialize)]
struct TotpSetup {
    qr: String,     // a PNG image, base64-encoded
    secret: String, // the same secret as text, for people who can't scan
}

#[derive(Deserialize)]
struct CodeRequest {
    code: String,
}

#[derive(Deserialize)]
struct VerifyRequest {
    challenge: String,
    code: String,
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
async fn create_reset_link(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<Json<ResetLink>> {
    let mut db = connect(&state).await.map_err(internal)?;
    let row = db
        .query(
            "SELECT PasswordHash FROM dbo.Users WHERE Id = @P1",
            &[&user_id],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "user not found".to_string()))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    let token = make_reset_token(user_id, &state.jwt_secret, stored).map_err(internal)?;
    Ok(Json(ResetLink {
        link: format!("{}/?reset={token}", state.frontend_url),
    }))
}

// Each token kind is signed with its own key, so one kind can never pass as another
fn sign(user_id: i32, ver: i32, key: &[u8], ttl: chrono::Duration) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now() + ttl).timestamp() as usize,
        ver,
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(key))
}

fn make_token(user_id: i32, session_version: i32, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    sign(user_id, session_version, secret.as_bytes(), chrono::Duration::hours(1))
}

fn reset_key(secret: &str, password_hash: &str) -> Vec<u8> {
    format!("{secret}{password_hash}").into_bytes()
}
fn make_reset_token(
    user_id: i32,
    secret: &str,
    password_hash: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    sign(user_id, 0, &reset_key(secret, password_hash), chrono::Duration::minutes(15))
}

fn challenge_key(secret: &str) -> Vec<u8> {
    format!("{secret}:2fa").into_bytes()
}

fn make_challenge(user_id: i32, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    sign(user_id, 0, &challenge_key(secret), chrono::Duration::minutes(5))
}

// Argon2 is deliberately slow, so it runs off the async threads that serve requests
async fn hash_password(password: String) -> ApiResult<String> {
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
        email.to_string(),
    )
    .map_err(|e| format!("{e:?}"))
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
    let row = db
        .query(
            "SELECT PasswordHash, Email, FirstName, LastName FROM dbo.Users WHERE Id = @P1",
            &[&id],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(invalid)?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    decode::<Claims>(
        &r.token,
        &DecodingKey::from_secret(&reset_key(&state.jwt_secret, stored)),
        &Validation::default(),
    )
    .map_err(|_| invalid())?;
    let user_inputs: Vec<&str> = ["Email", "FirstName", "LastName"]
        .iter()
        .filter_map(|col| row.get::<&str, _>(*col))
        .collect();
    check_password(&r.password, &user_inputs).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    let hash = hash_password(r.password).await?;
    // Also turns 2FA off: an admin reset link is the way back in after losing the phone.
    // Bumping SessionVersion signs out every existing session (e.g. a thief's).
    db.execute(
        "UPDATE dbo.Users SET PasswordHash = @P1, TotpEnabled = 0, TotpSecret = NULL, SessionVersion = SessionVersion + 1 WHERE Id = @P2",
        &[&hash, &id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

// Checks the token and that the account is still active; returns (user id, is admin)
async fn authenticate(parts: &Parts, state: &AppState) -> Result<(i32, bool), (StatusCode, String)> {
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
    let row = db
        .query(
            "SELECT Active, IsAdmin, SessionVersion FROM dbo.Users WHERE Id = @P1",
            &[&id],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    if row.get::<bool, _>("Active") != Some(true)
        || row.get::<i32, _>("SessionVersion") != Some(data.claims.ver)
    {
        return Err(unauthorized());
    }
    Ok((id, row.get("IsAdmin").unwrap_or(false)))
}

// Any handler that takes an AuthUser argument requires a valid token
struct AuthUser(i32);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (id, _) = authenticate(parts, state).await?;
        Ok(AuthUser(id))
    }
}

struct AdminUser;

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (_, is_admin) = authenticate(parts, state).await?;
        if !is_admin {
            return Err((StatusCode::FORBIDDEN, "admins only".to_string()));
        }
        Ok(AdminUser)
    }
}

struct Account {
    id: i32,
    active: bool,
    is_admin: bool,
    totp_enabled: bool,
    session_version: i32,
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
    let row = db
        .query(
            "SELECT Id, PasswordHash, Active, IsAdmin, TotpEnabled, SessionVersion FROM dbo.Users WHERE Email = @P1",
            &[&email],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?;
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
    if !password_matches(c.password.clone(), stored.to_string()).await? {
        return Err(unauthorized());
    }
    Ok(Account {
        id,
        active,
        is_admin,
        totp_enabled,
        session_version,
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

// The length + symbol rule, then rejects guessable passwords (common words, patterns, the user's own name/email)
fn check_password(password: &str, user_inputs: &[&str]) -> Result<(), String> {
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
    if !valid_email(&c.email) {
        return Err((StatusCode::BAD_REQUEST, "invalid email address".into()));
    }
    check_password(&c.password, &[&c.email, first_name, last_name])
        .map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    let hash = hash_password(c.password.clone()).await?;
    let email = c.email.to_lowercase();
    let mut db = connect(&state).await.map_err(internal)?;
    let result = db
        .execute(
            "INSERT INTO dbo.Users (FirstName, LastName, Email, PasswordHash) VALUES (@P1, @P2, @P3, @P4)",
            &[&first_name, &last_name, &email, &hash],
        )
        .await;

    match result {
        Ok(_) => Ok(StatusCode::OK),
        // 2627 / 2601 = unique constraint violated, so the email already exists
        Err(tiberius::error::Error::Server(e)) if e.code() == 2627 || e.code() == 2601 => {
            Err((StatusCode::CONFLICT, "email already registered".into()))
        }
        Err(e) => Err(internal(e)),
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(c): Json<Credentials>,
) -> ApiResult<Json<LoginResponse>> {
    let mut db = connect(&state).await.map_err(internal)?;
    let account = verify_credentials(&mut db, &c).await?;
    // Checked after the password so a stranger can't probe which emails are deactivated
    if !account.active {
        return Err((StatusCode::FORBIDDEN, "account is deactivated".into()));
    }
    if account.totp_enabled {
        let challenge = make_challenge(account.id, &state.jwt_secret).map_err(internal)?;
        return Ok(Json(LoginResponse {
            access_token: None,
            is_admin: false,
            needs_code: true,
            challenge: Some(challenge),
        }));
    }

    let token =
        make_token(account.id, account.session_version, &state.jwt_secret).map_err(internal)?;
    Ok(Json(LoginResponse {
        access_token: Some(token),
        is_admin: account.is_admin,
        needs_code: false,
        challenge: None,
    }))
}

async fn totp_setup(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
) -> ApiResult<Json<TotpSetup>> {
    let mut db = connect(&state).await.map_err(internal)?;
    let row = db
        .query(
            "SELECT Email, TotpEnabled FROM dbo.Users WHERE Id = @P1",
            &[&user_id],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
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
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
    Json(r): Json<CodeRequest>,
) -> ApiResult<StatusCode> {
    let mut db = connect(&state).await.map_err(internal)?;
    let row = db
        .query(
            "SELECT Email, TotpSecret FROM dbo.Users WHERE Id = @P1",
            &[&user_id],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
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
    // Signs out every session, including this one: they were made without a code
    db.execute(
        "UPDATE dbo.Users SET TotpEnabled = 1, SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

async fn totp_verify(
    State(state): State<Arc<AppState>>,
    Json(r): Json<VerifyRequest>,
) -> ApiResult<Json<LoginResponse>> {
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
    let row = db
        .query(
            "SELECT Email, TotpSecret, IsAdmin, SessionVersion FROM dbo.Users WHERE Id = @P1",
            &[&id],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(expired)?;
    let email: &str = row.get("Email").ok_or_else(|| internal("missing Email"))?;
    let secret: &str = row.get("TotpSecret").ok_or_else(expired)?;
    let is_admin: bool = row.get("IsAdmin").unwrap_or(false);
    let session_version: i32 = row
        .get("SessionVersion")
        .ok_or_else(|| internal("missing SessionVersion"))?;

    let totp = make_totp(decode_secret(secret).map_err(internal)?, email).map_err(internal)?;
    if !totp.check_current(&r.code).map_err(internal)? {
        return Err((
            StatusCode::UNAUTHORIZED,
            "That code didn't match. Try the newest one.".into(),
        ));
    }
    let token = make_token(id, session_version, &state.jwt_secret).map_err(internal)?;
    Ok(Json(LoginResponse {
        access_token: Some(token),
        is_admin,
        needs_code: false,
        challenge: None,
    }))
}

async fn delete_account(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
) -> ApiResult<StatusCode> {
    let mut db = connect(&state).await.map_err(internal)?;
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
    // Bump SessionVersion so tokens from before the deactivation don't come back to life
    db.execute(
        "UPDATE dbo.Users SET Active = 1, SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&account.id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

// Signs this user out everywhere: every token they hold stops working
async fn logout(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
) -> ApiResult<StatusCode> {
    let mut db = connect(&state).await.map_err(internal)?;
    db.execute(
        "UPDATE dbo.Users SET SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

async fn list_users(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
) -> ApiResult<Json<Vec<UserSummary>>> {
    let mut db = connect(&state).await.map_err(internal)?;
    let rows = db
        .query(
            "SELECT Id, FirstName, LastName, Email, Active, IsAdmin FROM dbo.Users ORDER BY Email",
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
        })
        .collect();
    Ok(Json(users))
}

// ---------- workout endpoints ----------
// The user ID comes from the token (AuthUser), never from the request body

async fn list_workouts(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
) -> ApiResult<Json<Vec<Workout>>> {
    let mut db = connect_as(&state, user_id).await.map_err(internal)?;
    let rows = db
        .query(
            "SELECT Id, [Date], Name, Notes FROM dbo.Workouts WHERE UserId = @P1 ORDER BY [Date] DESC",
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
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
    Json(w): Json<NewWorkout>,
) -> ApiResult<(StatusCode, Json<Workout>)> {
    // The Name column is NVARCHAR(200)
    if w.name.trim().is_empty() || w.name.chars().count() > 200 {
        return Err((
            StatusCode::BAD_REQUEST,
            "workout name must be 1 to 200 characters".into(),
        ));
    }
    let mut db = connect_as(&state, user_id).await.map_err(internal)?;
    let date = w.date.naive_utc();
    let row = db
        .query(
            "INSERT INTO dbo.Workouts (UserId, [Date], Name, Notes) OUTPUT INSERTED.Id VALUES (@P1, @P2, @P3, @P4)",
            &[&user_id, &date, &w.name, &w.notes],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("insert returned no row"))?;

    let id: i32 = row.get(0).ok_or_else(|| internal("missing new Id"))?;
    let saved = Workout {
        id,
        name: w.name,
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
                SessionVersion INT NOT NULL DEFAULT 0
            );
         IF OBJECT_ID('dbo.Workouts', 'U') IS NULL
            CREATE TABLE dbo.Workouts (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                UserId INT NOT NULL REFERENCES dbo.Users(Id),
                [Date] DATETIME2 NOT NULL,
                Name NVARCHAR(200) NOT NULL,
                Notes NVARCHAR(MAX) NULL
            );
         IF COL_LENGTH('dbo.Users', 'IsAdmin') IS NULL
            ALTER TABLE dbo.Users ADD IsAdmin BIT NOT NULL DEFAULT 0;
         IF COL_LENGTH('dbo.Users', 'TotpSecret') IS NULL
            ALTER TABLE dbo.Users ADD TotpSecret NVARCHAR(64) NULL;
         IF COL_LENGTH('dbo.Users', 'TotpEnabled') IS NULL
            ALTER TABLE dbo.Users ADD TotpEnabled BIT NOT NULL DEFAULT 0;
         IF COL_LENGTH('dbo.Users', 'SessionVersion') IS NULL
            ALTER TABLE dbo.Users ADD SessionVersion INT NOT NULL DEFAULT 0;",
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

    let state = Arc::new(AppState {
        db_config,
        jwt_secret: env_required("JWT_SECRET"),
        frontend_url: env_or("FRONTEND_URL", "http://localhost:5173"),
        // 5 tries, then one more each minute
        totp_attempts: DefaultKeyedRateLimiter::keyed(
            Quota::with_period(Duration::from_secs(60))
                .unwrap()
                .allow_burst(NonZeroU32::new(5).unwrap()),
        ),
    });

    init_db(&state)
        .await
        .expect("could not connect to SQL Server or create tables");

    // One new attempt every 12 seconds per client IP, bursts of up to 5: about 5 a minute
    let limit = GovernorConfigBuilder::default()
        .key_extractor(ProxyIpKeyExtractor)
        .per_second(12)
        .burst_size(5)
        .finish()
        .unwrap();
    let limited = Router::new()
        // runs a full Argon2 hash, so it needs a limit too
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/2fa/verify", post(totp_verify))
        .route("/auth/reset", post(reset_password))
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
        assert!(totp.check_current(&totp.generate_current().unwrap()).unwrap());    }

    #[test]
    fn login_token_carries_session_version() {
        let token = make_token(7, 3, "secret").unwrap();
        let claims = decode::<Claims>(&token, &DecodingKey::from_secret(b"secret"), &Validation::default())
            .unwrap()
            .claims;
        assert_eq!(claims.ver, 3);
        // tokens made before this field existed read as version 0, the column's default
        #[derive(Serialize)]
        struct OldClaims {
            sub: String,
            exp: usize,
        }
        let old_claims = OldClaims { sub: "7".into(), exp: 4_000_000_000 };
        let old = encode(&Header::default(), &old_claims, &EncodingKey::from_secret(b"secret")).unwrap();
        let claims = decode::<Claims>(&old, &DecodingKey::from_secret(b"secret"), &Validation::default())
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
        assert_eq!(ProxyIpKeyExtractor.extract(&req(Some("6.6.6.6, 203.0.113.9"))).unwrap(), ip("203.0.113.9"));
        assert_eq!(ProxyIpKeyExtractor.extract(&req(Some("203.0.113.9"))).unwrap(), ip("203.0.113.9"));
        // no header (e.g. curl straight to the API on this machine): fall back to the peer
        assert_eq!(ProxyIpKeyExtractor.extract(&req(None)).unwrap(), ip("127.0.0.1"));
    }

    #[test]
    fn rejects_bad_emails_and_passwords() {
        assert!(valid_email("a@b.com"));
        for bad in ["", "ab.com", "@b.com", "a@b", "a@.com", "a@b.", "a@b@c.com", "a b@c.com"] {
            assert!(!valid_email(bad), "{bad:?} should be rejected");
        }
        assert!(check_password("short!", &[]).is_err(), "too short");
        assert!(check_password("nosymbolsatall123", &[]).is_err(), "no symbol");
        assert!(check_password("correct-Horse-battery-staple-9", &[]).is_ok());
        assert!(
            check_password("jet.thomas@gym.com!", &["jet.thomas@gym.com"]).is_err(),
            "the user's own email is guessable"
        );
    }
}
