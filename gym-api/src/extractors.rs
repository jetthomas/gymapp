use std::{net::IpAddr, sync::Arc};

use axum::{
    extract::FromRequestParts,
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
};
use tiberius::Row;

use crate::models::Credentials;
use crate::passwords::{DUMMY_HASH, password_matches};
use crate::state::{ApiResult, AppState, Db, allow, col, connect, internal, one_row, record};
use crate::tokens::{read_token, session_valid};

pub const PLUS_STATUSES: [&str; 3] = ["active", "trialing", "past_due"];
// Admins always have Plus and never pay. Needs IsAdmin and MembershipStatus in the row
pub fn has_plus(row: &Row) -> bool {
    row.get::<bool, _>("IsAdmin") == Some(true)
        || row
            .get::<&str, _>("MembershipStatus")
            .is_some_and(|s| PLUS_STATUSES.contains(&s))
}

// Checks the token and that the account is still active;
// returns (user id, is admin, has Plus, connection)
pub async fn authenticate(
    parts: &Parts,
    state: &AppState,
) -> Result<(i32, bool, bool, Db), (StatusCode, String)> {
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
        "SELECT Active, IsAdmin, SessionVersion, MembershipStatus FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(unauthorized)?;
    if !session_valid(&row, ver) {
        return Err(unauthorized());
    }
    let is_admin = row.get("IsAdmin").unwrap_or(false);
    Ok((id, is_admin, has_plus(&row), db))
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
        let (id, _, _, db) = authenticate(parts, state).await?;
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
        let (id, is_admin, _, db) = authenticate(parts, state).await?;
        if !is_admin {
            return Err((StatusCode::FORBIDDEN, "Admins only.".to_string()));
        }
        Ok(AdminUser(id, db))
    }
}

// Any signed-in member, plus whether they have Plus: for routes that do more for Plus members
pub struct Member(pub i32, pub bool, pub Db);

impl FromRequestParts<Arc<AppState>> for Member {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (id, _, plus, db) = authenticate(parts, state).await?;
        Ok(Member(id, plus, db))
    }
}

// Routes that only Plus members (and admins) may use
pub struct PlusUser(pub i32, pub Db);

impl FromRequestParts<Arc<AppState>> for PlusUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let (id, _, plus, db) = authenticate(parts, state).await?;
        if !plus {
            return Err((
                StatusCode::FORBIDDEN,
                "Upgrade to Plus to use this.".to_string(),
            ));
        }
        Ok(PlusUser(id, db))
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
pub async fn verify_credentials(
    db: &mut Db,
    c: &Credentials,
    ip: IpAddr,
) -> ApiResult<Account> {
    let unauthorized = || {
        (
            StatusCode::UNAUTHORIZED,
            "Wrong email or password.".to_string(),
        )
    };
    let email = c.email.to_lowercase();
    let row = one_row(
        db,
        "SELECT Id, PasswordHash, Active, IsAdmin, TotpEnabled, SessionVersion, EmailVerified FROM dbo.Users WHERE Email = @P1",
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
    // Check the password even when over the limit, so that answers as slowly as a wrong password
    let ok = password_matches(c.password.clone(), stored.to_string()).await?;
    // Every try counts, right or wrong: the limit can't be read without spending one.
    // 10 tries at one account from one IP, then one more every 90 s. Keyed by IP as well,
    // so a stranger guessing at a member's email only locks out their own address, not the member
    if !allow(db, &format!("login:{id}:{ip}"), 90, 10).await? {
        return Err(unauthorized());
    }
    if !ok {
        record(db, id, "login_failed").await?;
        return Err(unauthorized());
    }
    Ok(Account {
        id,
        active,
        is_admin,
        totp_enabled,
        session_version,
        email_verified,
    })
}
