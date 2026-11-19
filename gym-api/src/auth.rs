use std::sync::Arc;

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header::SET_COOKIE},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{DecodingKey, Validation, decode};

use crate::extractors::{AuthUser, verify_credentials};
use crate::models::{
    Claims, Credentials, ForgotRequest, LoginResponse, NewUser, PasswordChange, PasswordOnly,
    Profile, ResetRequest, TokenRequest,
};
use crate::passwords::{
    check_password, fits, hash_password, password_matches, totp_for, use_totp_code, valid_email,
};
use crate::state::{
    ApiResult, AppState, Db, col, connect, internal, last_visit, may_mail, one_row, record,
    send_mail, send_security_notice, send_verify_mail,
};
use crate::tokens::{
    CLEAR_REFRESH, cookie, make_challenge, make_token, read_token, refresh_key, reset_key,
    self_reset_key, session_valid, sign, verify_key, with_refresh_cookie,
};
use tiberius::Row;

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(c): Json<NewUser>,
) -> ApiResult<StatusCode> {
    let first_name = c.first_name.trim();
    let last_name = c.last_name.trim();
    if first_name.is_empty() || last_name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "First and last name are required.".into(),
        ));
    }
    if !fits(first_name, 100) || !fits(last_name, 100) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Names must be 100 characters or fewer.".into(),
        ));
    }
    if !valid_email(&c.email) || !fits(&c.email, 256) {
        return Err((StatusCode::BAD_REQUEST, "Invalid email address.".into()));
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
            send_verify_mail(&state, email.clone(), id)?;
            Ok(StatusCode::OK)
        }
        // 2627 / 2601 = unique constraint violated, so the email already exists.
        // Answer exactly as for a new account, so sign-up can't reveal who's a member
        Err(tiberius::error::Error::Server(e)) if e.code() == 2627 || e.code() == 2601 => {
            if may_mail(&state, &email) {
                send_mail(
                    state.clone(),
                    email.clone(),
                    "Someone tried to sign up with your email",
                    "Someone tried to create a Gym App account with this email. If that was you, log in or use Forgot password.".into(),
                );
            }
            Ok(StatusCode::OK)
        }
        Err(e) => Err(internal(e)),
    }
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(c): Json<Credentials>,
) -> ApiResult<Response> {
    let mut db = connect(&state).await.map_err(internal)?;
    let account = verify_credentials(&mut db, &c).await?;
    // Checked after the password so a stranger can't probe which emails are deactivated
    if !account.active {
        return Err((StatusCode::FORBIDDEN, "Account is deactivated.".into()));
    }
    if !account.email_verified {
        send_verify_mail(&state, c.email.to_lowercase(), account.id)?;
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
    finish_login(
        &mut db,
        &state,
        account.id,
        account.is_admin,
        account.session_version,
        false,
        c.remember,
    )
    .await
}

// The last steps of every login: record it, make the token, and set the cookie if asked
pub async fn finish_login(
    db: &mut Db,
    state: &AppState,
    id: i32,
    is_admin: bool,
    session_version: i32,
    two_factor: bool,
    remember: bool,
) -> ApiResult<Response> {
    // Read before recording this login, or "last login" would be this one
    let (last_login, failed_since) = last_visit(db, id).await?;
    record(db, id, "login").await?;
    let token = make_token(id, session_version, &state.jwt_secret).map_err(internal)?;
    let resp = Json(LoginResponse {
        access_token: Some(token),
        is_admin,
        challenge: None,
        two_factor,
        last_login,
        failed_since,
    });
    with_refresh_cookie(resp, remember, id, session_version, state)
}

// Always answers 200, so it can't be used to find out who has an account
pub async fn forgot_password(
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
    // The answer is the same either way, so the cap reveals nothing
    if let Some(row) = row
        && may_mail(&state, &email)
    {
        let id: i32 = col(&row, "Id")?;
        let stored: &str = col(&row, "PasswordHash")?;
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

pub async fn reset_password(
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
    let stored: &str = col(&row, "PasswordHash")?;
    let signed_with = |key: Vec<u8>| read_token(&r.token, &key).is_some();
    // An admin's link first, as before; then a member's own "Forgot password?" link
    let by_admin = if signed_with(reset_key(&state.jwt_secret, stored)) {
        true
    } else if signed_with(self_reset_key(&state.jwt_secret, stored)) {
        false
    } else {
        return Err(invalid());
    };
    check_password(&r.password, &own_words(&row)).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    let email: &str = col(&row, "Email")?;

    // A self-service reset must not get around 2FA, so it needs the current code
    if !by_admin && row.get::<bool, _>("TotpEnabled") == Some(true) {
        let code = r.code.as_deref().ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "Enter your two-factor code to finish.".to_string(),
            )
        })?;
        let totp = totp_for(col(&row, "TotpSecret")?, email)?;
        use_totp_code(&mut db, id, &totp, code).await?;
    }
    let hash = hash_password(r.password).await?;
    // Bumping SessionVersion signs out every existing session (e.g. a thief's)
    let (sql, notice) = if by_admin {
        // Also turns 2FA off: an admin reset link is the way back in after losing the phone
        (
            "UPDATE dbo.Users SET PasswordHash = @P1, TotpEnabled = 0, TotpSecret = NULL, TotpFailures = 0, LoginFailures = 0, LockedUntil = NULL, SessionVersion = SessionVersion + 1 WHERE Id = @P2",
            "Your password was reset with a link from an admin, and two-factor was turned off.",
        )
    } else {
        (
            "UPDATE dbo.Users SET PasswordHash = @P1, LoginFailures = 0, LockedUntil = NULL, SessionVersion = SessionVersion + 1 WHERE Id = @P2",
            "Your password was reset.",
        )
    };
    db.execute(sql, &[&hash, &id]).await.map_err(internal)?;
    send_security_notice(&state, email, notice);
    Ok(StatusCode::OK)
}

pub async fn verify_email(
    State(state): State<Arc<AppState>>,
    Json(r): Json<TokenRequest>,
) -> ApiResult<StatusCode> {
    let invalid = || {
        (
            StatusCode::BAD_REQUEST,
            "This link is invalid or has expired.".to_string(),
        )
    };
    let (id, _) = read_token(&r.token, &verify_key(&state.jwt_secret)).ok_or_else(invalid)?;
    let mut db = connect(&state).await.map_err(internal)?;
    db.execute(
        "UPDATE dbo.Users SET EmailVerified = 1 WHERE Id = @P1",
        &[&id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::OK)
}

pub async fn reactivate_account(
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

pub async fn get_profile(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<Profile>> {
    let row = one_row(
        &mut db,
        "SELECT FirstName, LastName, Email FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    Ok(Json(Profile {
        first_name: row.get::<&str, _>("FirstName").map(str::to_string),
        last_name: row.get::<&str, _>("LastName").map(str::to_string),
        email: col::<&str>(&row, "Email")?.to_string(),
    }))
}

pub async fn delete_account(
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<PasswordOnly>,
) -> ApiResult<StatusCode> {
    require_password(&mut db, user_id, r.password).await?;
    db.execute(
        "UPDATE dbo.Users SET Active = 0 WHERE Id = @P1",
        &[&user_id],
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
// Checks the signed-in member's current password before a security change. Returns their row,
// which has every column those changes read, so callers don't query the user twice
pub async fn require_password(db: &mut Db, user_id: i32, password: String) -> ApiResult<Row> {
    let row = one_row(
        db,
        "SELECT PasswordHash, Email, FirstName, LastName, IsAdmin, TotpEnabled, TotpSecret
         FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    let stored: &str = col(&row, "PasswordHash")?;
    if !password_matches(password, stored.to_string()).await? {
        return Err(wrong_password());
    }
    Ok(row)
}

// The member's own email and names, which a new password must not be built from
fn own_words(row: &Row) -> Vec<&str> {
    ["Email", "FirstName", "LastName"]
        .iter()
        .filter_map(|c| row.get::<&str, _>(*c))
        .collect()
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<PasswordChange>,
) -> ApiResult<Response> {
    let row = require_password(&mut db, user_id, r.current).await?;
    check_password(&r.new, &own_words(&row)).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
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
    if let Some(email) = row.get::<&str, _>("Email") {
        send_security_notice(&state, email, "Your password was changed.");
    }
    let token = make_token(user_id, new_version, &state.jwt_secret).map_err(internal)?;
    let resp = Json(LoginResponse {
        access_token: Some(token),
        is_admin: row.get("IsAdmin").unwrap_or(false),
        challenge: None,
        two_factor: row.get("TotpEnabled").unwrap_or(false),
        last_login: None,
        failed_since: 0,
    });
    // The version bump also kills this device's "Stay logged in" cookie, so replace it if there was one
    with_refresh_cookie(
        resp,
        cookie(&headers, "refresh").is_some(),
        user_id,
        new_version,
        &state,
    )
}

// Swaps the "Stay logged in" cookie for a fresh access token; called once per page load
pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let expired = || (StatusCode::UNAUTHORIZED, "not signed in".to_string());
    let token = cookie(&headers, "refresh").ok_or_else(expired)?;
    let (id, ver) = read_token(token, &refresh_key(&state.jwt_secret)).ok_or_else(expired)?;
    let mut db = connect(&state).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT Active, IsAdmin, SessionVersion, TotpEnabled FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(expired)?;
    // Same checks as authenticate(): deactivated, or signed out since the cookie was made
    if !session_valid(&row, ver) {
        return Ok(([(SET_COOKIE, CLEAR_REFRESH)], expired()).into_response());
    }
    let access = make_token(id, ver, &state.jwt_secret).map_err(internal)?;
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
pub async fn logout(AuthUser(user_id, mut db): AuthUser) -> ApiResult<impl IntoResponse> {
    db.execute(
        "UPDATE dbo.Users SET SessionVersion = SessionVersion + 1 WHERE Id = @P1",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    // The version bump already kills the cookie; this also deletes it from the browser
    Ok(([(SET_COOKIE, CLEAR_REFRESH)], StatusCode::OK))
}
