use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
};
use chrono::{NaiveDateTime, Utc};

use crate::models::Credentials;
use crate::passwords::{DUMMY_HASH, password_matches};
use crate::state::{ApiResult, AppState, Db, col, connect, internal, one_row, record};
use crate::tokens::{read_token, session_valid};

// Checks the token and that the account is still active; returns (user id, is admin, connection)
pub async fn authenticate(
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
    let (id, ver) = read_token(token, state.jwt_secret.as_bytes()).ok_or_else(unauthorized)?;
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
    if !session_valid(&row, ver) {
        return Err(unauthorized());
    }
    let is_admin = row.get("IsAdmin").unwrap_or(false);
    Ok((id, is_admin, db))
}

// Any handler that takes an AuthUser argument requires a valid token,
// and reuses the connection the check already opened
pub struct AuthUser(pub i32, pub Db);

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

pub struct AdminUser(pub i32, pub Db);

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (id, is_admin, db) = authenticate(parts, state).await?;
        if !is_admin {
            return Err((StatusCode::FORBIDDEN, "Admins only.".to_string()));
        }
        Ok(AdminUser(id, db))
    }
}

pub struct Account {
    pub id: i32,
    pub active: bool,
    pub is_admin: bool,
    pub totp_enabled: bool,
    pub session_version: i32,
    pub email_verified: bool,
}

// Returns the user's account flags when the email and password match
pub async fn verify_credentials(db: &mut Db, c: &Credentials) -> ApiResult<Account> {
    let unauthorized = || {
        (
            StatusCode::UNAUTHORIZED,
            "Wrong email or password.".to_string(),
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

    let id: i32 = col(&row, "Id")?;
    let stored: &str = col(&row, "PasswordHash")?;
    let active: bool = col(&row, "Active")?;
    let is_admin: bool = col(&row, "IsAdmin")?;
    let totp_enabled: bool = col(&row, "TotpEnabled")?;
    let session_version: i32 = col(&row, "SessionVersion")?;
    let email_verified: bool = col(&row, "EmailVerified")?;
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
