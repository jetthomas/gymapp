use std::{env, sync::Arc};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
    routing::{delete, get, post},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use tiberius::{AuthMethod, Client, Config};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use zxcvbn::{Score, zxcvbn};

// ---------- shared state ----------

struct AppState {
    db_config: Config,
    jwt_secret: String,
}

type Db = Client<Compat<TcpStream>>;
type ApiResult<T> = Result<T, (StatusCode, String)>;

async fn connect(state: &AppState) -> Result<Db, tiberius::error::Error> {
    let tcp = TcpStream::connect(state.db_config.get_addr()).await?;
    tcp.set_nodelay(true)?;
    Client::connect(state.db_config.clone(), tcp.compat_write()).await
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
    access_token: String,
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

// ---------- tokens ----------

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

fn make_token(user_id: i32, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let exp = (Utc::now() + chrono::Duration::hours(1)).timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

// Any handler that takes an AuthUser argument requires a valid token
struct AuthUser(i32);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
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
        Ok(AuthUser(id))
    }
}
fn check_password(password: &str, user_inputs: &[&str]) -> Result<(), String> {
    let entropy = zxcvbn(password, user_inputs);
    if entropy.score() >= Score::Three {
        return Ok(());
    }
    let msg = entropy
        .feedback()
        .and_then(|f| f.warning().map(|w| w.to_string()))
        .unwrap_or_else(|| "Password is too weak".into());
    Err(msg)
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else { return false };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
}

fn valid_password(password: &str) -> bool {
    password.chars().count() >= 10 && password.chars().any(|c| !c.is_ascii_alphanumeric())
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
    if !valid_password(&c.password) {
        return Err((
            StatusCode::BAD_REQUEST,
            "password must be at least 10 characters and include a special character".into(),
        ));
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(c.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();
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
            Err((StatusCode::BAD_REQUEST, "email already registered".into()))
        }
        Err(e) => Err(internal(e)),
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(c): Json<Credentials>,
) -> ApiResult<Json<LoginResponse>> {
    let unauthorized = || {
        (
            StatusCode::UNAUTHORIZED,
            "wrong email or password".to_string(),
        )
    };
    let email = c.email.to_lowercase();

    let mut db = connect(&state).await.map_err(internal)?;
    let row = db
        .query(
            "SELECT Id, PasswordHash, Active FROM dbo.Users WHERE Email = @P1",
            &[&email],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;

    let id: i32 = row.get("Id").ok_or_else(|| internal("missing Id"))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    let active: bool = row
        .get("Active")
        .ok_or_else(|| internal("missing Active"))?;
    let parsed = PasswordHash::new(stored).map_err(internal)?;
    Argon2::default()
        .verify_password(c.password.as_bytes(), &parsed)
        .map_err(|_| unauthorized())?;
    // Checked after the password so a stranger can't probe which emails are deactivated
    if !active {
        return Err((StatusCode::FORBIDDEN, "account is deactivated".into()));
    }

    let token = make_token(id, &state.jwt_secret).map_err(internal)?;
    Ok(Json(LoginResponse {
        access_token: token,
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
    let unauthorized = || {
        (
            StatusCode::UNAUTHORIZED,
            "wrong email or password".to_string(),
        )
    };
    let email = c.email.to_lowercase();

    let mut db = connect(&state).await.map_err(internal)?;
    let row = db
        .query(
            "SELECT Id, PasswordHash FROM dbo.Users WHERE Email = @P1",
            &[&email],
        )
        .await
        .map_err(internal)?
        .into_row()
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;

    let id: i32 = row.get("Id").ok_or_else(|| internal("missing Id"))?;
    let stored: &str = row
        .get("PasswordHash")
        .ok_or_else(|| internal("missing hash"))?;
    let parsed = PasswordHash::new(stored).map_err(internal)?;
    Argon2::default()
        .verify_password(c.password.as_bytes(), &parsed)
        .map_err(|_| unauthorized())?;

    db.execute("UPDATE dbo.Users SET Active = 1 WHERE Id = @P1", &[&id])
        .await
        .map_err(internal)?;
    Ok(StatusCode::OK)
}

// ---------- workout endpoints ----------
// The user ID comes from the token (AuthUser), never from the request body

async fn list_workouts(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id): AuthUser,
) -> ApiResult<Json<Vec<Workout>>> {
    let mut db = connect(&state).await.map_err(internal)?;
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
    let mut db = connect(&state).await.map_err(internal)?;
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
                PasswordHash NVARCHAR(512) NOT NULL
            );
         IF OBJECT_ID('dbo.Workouts', 'U') IS NULL
            CREATE TABLE dbo.Workouts (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                UserId INT NOT NULL REFERENCES dbo.Users(Id),
                [Date] DATETIME2 NOT NULL,
                Name NVARCHAR(200) NOT NULL,
                Notes NVARCHAR(MAX) NULL
            );
         -- Adds the account columns to tables created before they existed; Active and CreatedAt are filled by the DB
         IF COL_LENGTH('dbo.Users', 'FirstName') IS NULL
            ALTER TABLE dbo.Users ADD
                FirstName NVARCHAR(100) NULL,
                LastName NVARCHAR(100) NULL,
                Active BIT NOT NULL DEFAULT 1,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();",
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
    db_config.trust_cert(); // accept SQL Server's self-signed certificate (development only)

    let state = Arc::new(AppState {
        db_config,
        jwt_secret: env_required("JWT_SECRET"),
    });

    init_db(&state)
        .await
        .expect("could not connect to SQL Server or create tables");

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/register", post(register))
        .route("/auth/delete", delete(delete_account))
        .route("/auth/reactivate", post(reactivate_account))
        .route("/auth/login", post(login))
        .route("/workouts", get(list_workouts).post(create_workout))
        .with_state(state);

    let addr = env_or("BIND_ADDR", "127.0.0.1:5080");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("could not bind address");
    println!("Listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}
