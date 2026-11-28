use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode, response::Response};
use totp_rs::Secret;

use crate::auth::{finish_login, require_password};
use crate::extractors::AuthUser;
use crate::models::{
    CodeRequest, DisableRequest, PasswordOnly, RecoveryCodes, TotpSetup, VerifyRequest,
};
use crate::passwords::{hash_password, make_totp, recovery_code, totp_for, use_totp_code};
use crate::state::{
    ApiResult, AppState, allow, col, connect, internal, one_row, send_security_notice,
};
use crate::tokens::{challenge_key, make_token, read_token};

pub async fn totp_setup(
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<PasswordOnly>, // Json must be the last argument
) -> ApiResult<Json<TotpSetup>> {
    let row = require_password(&mut db, user_id, r.password).await?;
    let email: &str = col(&row, "Email")?;
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

pub async fn totp_confirm(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<CodeRequest>,
) -> ApiResult<Json<RecoveryCodes>> {
    let row = one_row(
        &mut db,
        "SELECT Email, TotpSecret, TotpEnabled FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    // This route has no rate limit, so it must not become a way to guess codes on a 2FA account
    if row.get::<bool, _>("TotpEnabled") == Some(true) {
        return Err((StatusCode::CONFLICT, "Two-factor is already on.".into()));
    }
    let email: &str = col(&row, "Email")?;
    let secret: &str = row.get("TotpSecret").ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Start two-factor setup first.".to_string(),
        )
    })?;

    let totp = totp_for(secret, email)?;
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
    // Signs out every session, including this one: they were made without a code.
    // This device just proved a code, so it gets a new token (no cookie: the page signs out
    // once the codes are saved). Without it, any request before then would log it out and lose the codes
    let new_version: i32 = one_row(
        &mut db,
        "UPDATE dbo.Users SET TotpEnabled = 1, SessionVersion = SessionVersion + 1 OUTPUT INSERTED.SessionVersion WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("update returned no version"))?;
    send_security_notice(&state, email, "Two-factor was turned on.");
    let access_token = make_token(user_id, new_version, &state.jwt_secret).map_err(internal)?;
    Ok(Json(RecoveryCodes {
        codes,
        access_token,
    }))
}

pub async fn totp_verify(
    State(state): State<Arc<AppState>>,
    Json(r): Json<VerifyRequest>,
) -> ApiResult<Response> {
    let expired = || {
        (
            StatusCode::UNAUTHORIZED,
            "Your login expired. Log in again.".to_string(),
        )
    };
    let (id, _) =
        read_token(&r.challenge, &challenge_key(&state.jwt_secret)).ok_or_else(expired)?;
    let mut db = connect(&state).await.map_err(internal)?;
    // Counted per user, not per IP, so an attacker with the password can't spread guesses out:
    // 5 tries, then one more each minute
    if !allow(&mut db, &format!("totp:{id}"), 60, 5).await? {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many tries. Wait a minute and try again.".into(),
        ));
    }

    let row = one_row(
        &mut db,
        "SELECT Email, TotpSecret, IsAdmin, SessionVersion, Active FROM dbo.Users WHERE Id = @P1",
        &[&id],
    )
    .await?
    .ok_or_else(expired)?;
    // Deactivated in the minutes between the password and the code
    if row.get::<bool, _>("Active") != Some(true) {
        return Err(expired());
    }
    let email: &str = col(&row, "Email")?;
    let secret: &str = row.get("TotpSecret").ok_or_else(expired)?;
    let is_admin: bool = row.get("IsAdmin").unwrap_or(false);
    let session_version: i32 = col(&row, "SessionVersion")?;

    let totp = totp_for(secret, email)?;
    use_totp_code(&mut db, id, &totp, &r.code).await?;
    finish_login(
        &mut db,
        &state,
        id,
        is_admin,
        session_version,
        true,
        r.remember,
    )
    .await
}

pub async fn totp_disable(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id, mut db): AuthUser,
    Json(r): Json<DisableRequest>,
) -> ApiResult<StatusCode> {
    let row = require_password(&mut db, user_id, r.password).await?;
    let secret: &str = match (row.get::<bool, _>("TotpEnabled"), row.get("TotpSecret")) {
        (Some(true), Some(secret)) => secret,
        _ => return Err((StatusCode::CONFLICT, "Two-factor is already off.".into())),
    };
    let email: &str = col(&row, "Email")?;
    let totp = totp_for(secret, email)?;
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
    send_security_notice(&state, email, "Two-factor was turned off.");
    Ok(StatusCode::OK)
}
