use axum::{
    Json,
    http::{
        HeaderMap,
        header::{COOKIE, SET_COOKIE},
    },
    response::{IntoResponse, Response},
};
use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use tiberius::Row;

use crate::models::{Claims, LoginResponse};
use crate::state::{ApiResult, AppState, internal};

// Each token kind is signed with its own key, so one kind can never pass as another
pub fn sign(
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

pub fn make_token(
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

pub fn reset_key(secret: &str, password_hash: &str) -> Vec<u8> {
    format!("{secret}{password_hash}").into_bytes()
}

// Different from the admin key, so the server can tell the two kinds of link apart
pub fn self_reset_key(secret: &str, password_hash: &str) -> Vec<u8> {
    format!("{secret}{password_hash}:self").into_bytes()
}

pub fn make_reset_token(
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

pub fn refresh_key(secret: &str) -> Vec<u8> {
    format!("{secret}:refresh").into_bytes()
}

// ver = SessionVersion, so logout, a password reset or a 2FA change also kills this cookie
pub fn make_refresh_token(
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
pub fn refresh_cookie(token: &str) -> String {
    format!("refresh={token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000")
}

pub const CLEAR_REFRESH: &str =
    "refresh=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0";

// Reads one cookie from the Cookie header
pub fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|kv| kv.trim().strip_prefix(name)?.strip_prefix('='))
}

pub fn challenge_key(secret: &str) -> Vec<u8> {
    format!("{secret}:2fa").into_bytes()
}

pub fn make_challenge(user_id: i32, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    sign(
        user_id,
        0,
        &challenge_key(secret),
        chrono::Duration::minutes(5),
    )
}

pub fn verify_key(secret: &str) -> Vec<u8> {
    format!("{secret}:verify").into_bytes()
}

pub fn make_verify_token(
    user_id: i32,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    sign(user_id, 0, &verify_key(secret), chrono::Duration::hours(24))
}

// The user id and session version from a token signed with `key`; None if it is forged or expired
pub fn read_token(token: &str, key: &[u8]) -> Option<(i32, i32)> {
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(key),
        &Validation::default(),
    )
    .ok()?
    .claims;
    Some((claims.sub.parse().ok()?, claims.ver))
}

// True when the account is active and the token was made after the last logout
pub fn session_valid(row: &Row, ver: i32) -> bool {
    row.get::<bool, _>("Active") == Some(true) && row.get::<i32, _>("SessionVersion") == Some(ver)
}

// Adds the "Stay logged in" cookie to a response when `set` is true
pub fn with_refresh_cookie(
    resp: Json<LoginResponse>,
    set: bool,
    id: i32,
    session_version: i32,
    state: &AppState,
) -> ApiResult<Response> {
    if !set {
        return Ok(resp.into_response());
    }
    let refresh = make_refresh_token(id, session_version, &state.jwt_secret).map_err(internal)?;
    Ok(([(SET_COOKIE, refresh_cookie(&refresh))], resp).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde::Serialize;

    use totp_rs::Secret;

    use crate::passwords::{decode_secret, make_totp};

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
}
