mod admin;
mod auth;
mod extractors;
mod models;
mod passwords;
mod state;
mod tokens;
mod two_factor;
mod workouts;

use std::{env, net::SocketAddr, num::NonZeroU32, sync::Arc, time::Duration};

use axum::{
    Router,
    routing::{delete, get, post, put},
};
use governor::{DefaultKeyedRateLimiter, Quota};
use lettre::{
    AsyncSmtpTransport, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials as SmtpCredentials,
};
use tiberius::{AuthMethod, Config};
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

use crate::admin::{admin_stats, create_reset_link, list_users, set_admin};
use crate::auth::{
    change_password, delete_account, forgot_password, login, logout, reactivate_account, refresh,
    register, reset_password, verify_email,
};
use crate::state::{AppState, ProxyIpKeyExtractor, connect};
use crate::two_factor::{totp_confirm, totp_disable, totp_setup, totp_verify};
use crate::workouts::{create_workout, list_workouts};

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
        mailer,
        mail_from,
        // 5 tries, then one more each minute
        totp_attempts: DefaultKeyedRateLimiter::keyed(
            Quota::with_period(Duration::from_secs(60))
                .unwrap()
                .allow_burst(NonZeroU32::new(5).unwrap()),
        ),
        // 3 emails to one address, then one more every 20 minutes
        mail_attempts: DefaultKeyedRateLimiter::keyed(
            Quota::with_period(Duration::from_secs(20 * 60))
                .unwrap()
                .allow_burst(NonZeroU32::new(3).unwrap()),
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
            cleanup_state.mail_attempts.retain_recent();
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
