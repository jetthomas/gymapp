mod admin;
mod auth;
mod billing;
mod exercises;
mod extractors;
mod models;
mod nutrition;
mod passwords;
mod routines;
mod state;
mod stripe;
mod tokens;
mod two_factor;
mod workouts;

use std::{env, net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    Router, middleware,
    routing::{delete, get, post, put},
};
use lettre::{
    AsyncSmtpTransport, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials as SmtpCredentials,
};
use tiberius::{AuthMethod, Config};

use crate::admin::{admin_stats, create_reset_link, list_users, reactivate_user, set_admin};
use crate::auth::{
    change_password, delete_account, delete_avatar, erase_account, forgot_password, get_profile,
    login, logout, put_avatar, reactivate_account, refresh, register, reset_password, verify_email,
};
use crate::billing::{create_checkout, create_portal, webhook};
use crate::exercises::{
    create_exercise, create_my_exercise, delete_exercise, delete_my_exercise, list_exercises,
    update_exercise, update_my_exercise,
};
use crate::nutrition::{
    add_food, add_foods, barcode_food, create_saved_meal, delete_food, delete_health,
    delete_saved_meal, get_health, list_food, list_saved_meals, list_weights, put_health,
    put_weight, recent_food, update_food,
};
use crate::routines::{create_routine, delete_routine, list_routines, update_routine};
use crate::state::{AppState, batch, connect, internal, ip_limit};
use crate::two_factor::{totp_confirm, totp_disable, totp_setup, totp_verify};
use crate::workouts::{
    best_lift, create_workout, delete_workout, exercise_progress, export_data, get_workout,
    last_sets, list_workouts, muscle_sets, update_workout, workout_days,
};

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_required(key: &str) -> String {
    env::var(key).unwrap_or_else(|_| panic!("{key} is not set. Check your .env file."))
}

// The loader stops at the first line it can't read, so every setting after it goes missing.
// Names the line and setting but never prints the value: it may be a password.
// None = nothing to fix (no .env at all is fine when the settings come from the real environment)
fn env_file_problem(e: dotenvy::Error, contents: &str) -> Option<String> {
    match e {
        dotenvy::Error::Io(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        // `bad` is just the part that failed (usually the value), so find the line it's on
        dotenvy::Error::LineParse(bad, _) => Some(
            match contents
                .lines()
                .enumerate()
                .find(|(_, l)| l.contains(bad.as_str()))
            {
                Some((n, line)) => format!(
                    "Line {} of .env ({}) can't be read. Put a value with spaces in double quotes.",
                    n + 1,
                    line.split_once('=')
                        .map_or("no = sign", |(key, _)| key.trim())
                ),
                None => "A line in .env can't be read. Put a value with spaces in double quotes."
                    .to_string(),
            },
        ),
        _ => Some("Can't read .env.".to_string()),
    }
}

fn db_config() -> Config {
    let mut db_config = Config::new();
    db_config.host(env_required("DB_HOST"));
    db_config.port(
        env_or("DB_PORT", "1433")
            .parse()
            .expect("DB_PORT must be a number"),
    );
    db_config.database(env_or("DB_NAME", "Gym_App"));
    db_config.authentication(AuthMethod::sql_server(
        env_required("DB_USER"),
        env_required("DB_PASSWORD"),
    ));
    if env_or("DB_TRUST_CERT", "false") == "true" {
        db_config.trust_cert(); // development only: accepts SQL Server's self-signed certificate
    }
    db_config
}

// Fails fast at startup when SQL Server can't be reached or isn't set up as the API needs.
// The tables come from sql/schema.sql
async fn init_db(state: &AppState) {
    let mut db = connect(state)
        .await
        .expect("could not connect to SQL Server");
    // Every login, sign-up and refresh is counted here; without it they'd all answer "server error"
    batch(&mut db, "SELECT TOP 0 Bucket FROM dbo.RateLimits")
        .await
        .expect("dbo.RateLimits is missing or gym_app can't use it: run its parts of sql/schema.sql and sql/security.sql");
}

#[tokio::main]
async fn main() {
    // The API runs from gym-api/, where .env lives; the file is only read again to word the error
    if let Err(e) = dotenvy::dotenv()
        && let Some(problem) =
            env_file_problem(e, &std::fs::read_to_string(".env").unwrap_or_default())
    {
        panic!("{problem}");
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
    } else if smtp_port == 587 {
        // 587 starts unencrypted and upgrades with STARTTLS; relay() expects TLS from the first byte (465)
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_host)
            .expect("bad SMTP_HOST")
            .port(smtp_port)
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
        .expect("MAIL_FROM must look like BarMetric <no-reply@yourgym.com>");

    let state = Arc::new(AppState {
        db_config: db_config(),
        jwt_secret,
        // Required: a forgotten one would quietly put localhost links in every email and Stripe redirect
        frontend_url: env_required("FRONTEND_URL"),
        mailer,
        mail_from,
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("could not build the HTTPS client"),
        stripe_key: env_required("STRIPE_KEY"),
        stripe_price_id: env_required("STRIPE_PRICE_ID"),
        stripe_webhook_secret: env_required("STRIPE_WEBHOOK_SECRET"),
        food_user_agent: env_required("FOOD_USER_AGENT"),
    });

    init_db(&state).await;

    // A rate-limit row past its Tat has every try back, the same as no row; drop those so the
    // table stays small. Each process does it, which is harmless
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut every_hour = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            every_hour.tick().await;
            // internal() logs a failure; the next hour tries again
            if let Ok(mut db) = connect(&cleanup_state).await.map_err(internal) {
                let _ = batch(
                    &mut db,
                    "DELETE FROM dbo.RateLimits WHERE Tat < SYSUTCDATETIME()",
                )
                .await;
            }
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
        // /auth/delete only deactivates (an older name); /auth/erase deletes for good
        .route("/auth/delete", delete(delete_account))
        .route("/auth/erase", delete(erase_account))
        .route("/auth/2fa/setup", post(totp_setup))
        .layer(middleware::from_fn_with_state(state.clone(), ip_limit));

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/logout", post(logout))
        .route("/account", get(get_profile))
        .route("/account/avatar", put(put_avatar).delete(delete_avatar))
        .route("/auth/2fa/confirm", post(totp_confirm))
        .route("/admin/users", get(list_users))
        .route("/admin/stats", get(admin_stats))
        .route("/admin/users/{id}/admin", put(set_admin))
        .route("/admin/users/{id}/reset-link", post(create_reset_link))
        .route("/admin/users/{id}/reactivate", post(reactivate_user))
        .route("/exercises", get(list_exercises))
        .route("/admin/exercises", post(create_exercise))
        .route("/workouts", get(list_workouts).post(create_workout))
        .route("/me/muscles", get(muscle_sets))
        .route("/me/export", get(export_data))
        .route("/me/workout-days", get(workout_days))
        .route("/me/exercises", post(create_my_exercise))
        .route(
            "/me/exercises/{id}",
            put(update_my_exercise).delete(delete_my_exercise),
        )
        .route(
            "/workouts/{id}",
            get(get_workout).put(update_workout).delete(delete_workout),
        )
        .route("/exercises/{id}/last", get(last_sets))
        .route("/exercises/{id}/best", get(best_lift))
        .route("/routines", get(list_routines).post(create_routine))
        .route("/routines/{id}", put(update_routine).delete(delete_routine))
        .route(
            "/admin/exercises/{id}",
            put(update_exercise).delete(delete_exercise),
        )
        .route(
            "/me/health",
            get(get_health).put(put_health).delete(delete_health),
        )
        .route("/me/food", get(list_food).post(add_food))
        .route("/me/food/recent", get(recent_food))
        .route("/me/food/many", post(add_foods))
        .route("/me/meals", get(list_saved_meals).post(create_saved_meal))
        .route("/me/meals/{id}", delete(delete_saved_meal))
        .route("/me/weights", get(list_weights).put(put_weight))
        .route("/me/food/{id}", put(update_food).delete(delete_food))
        .route("/billing/checkout", post(create_checkout))
        .route("/billing/portal", post(create_portal))
        .route("/food/barcode/{code}", get(barcode_food))
        .route("/exercises/{id}/progress", get(exercise_progress))
        .route("/stripe/webhook", post(webhook))
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
    fn a_bad_env_line_is_named_without_its_value() {
        let file = "A=1\nSMTP_PASSWORD=abcd efgh ijkl\nMAIL_FROM=x\n";
        let err = dotenvy::from_read_iter(file.as_bytes())
            .find_map(Result::err)
            .unwrap();
        let msg = env_file_problem(err, file).unwrap();
        assert!(
            msg.contains("Line 2") && msg.contains("SMTP_PASSWORD"),
            "{msg}"
        );
        assert!(
            !msg.contains("abcd"),
            "the value must not be printed: {msg}"
        );
        let missing = dotenvy::Error::Io(std::io::ErrorKind::NotFound.into());
        assert!(env_file_problem(missing, "").is_none(), "no .env is fine");
    }

    // CI has no database. Run after schema.sql and security.sql: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "needs SQL Server"]
    async fn a_rate_limit_allows_its_burst_then_refills() {
        use tokio_util::compat::TokioAsyncWriteCompatExt;
        let _ = dotenvy::dotenv();
        let config = db_config();
        let tcp = tokio::net::TcpStream::connect(config.get_addr())
            .await
            .unwrap();
        let mut db = tiberius::Client::connect(config, tcp.compat_write())
            .await
            .unwrap();
        let bucket = format!("test:{}", std::process::id());
        let other = format!("{bucket}:other");
        // 2 at once, then one more every second
        let mut try_once = async |b: &str| state::allow(&mut db, b, 1, 2).await.unwrap();
        assert!(try_once(&bucket).await && try_once(&bucket).await);
        assert!(!try_once(&bucket).await, "the 3rd try at once");
        assert!(try_once(&other).await, "another bucket has its own tries");
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert!(try_once(&bucket).await, "a try back after a second");
        assert!(!try_once(&bucket).await, "but only one");
        db.execute(
            "DELETE FROM dbo.RateLimits WHERE Bucket IN (@P1, @P2)",
            &[&bucket, &other],
        )
        .await
        .unwrap();
    }
}
