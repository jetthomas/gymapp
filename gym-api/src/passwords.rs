use std::sync::LazyLock;

use argon2::{
    Argon2,
    password_hash::{
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
        rand_core::{OsRng, RngCore},
    },
};
use axum::http::StatusCode;
use chrono::Utc;
use tokio::sync::Semaphore;
use totp_rs::{Algorithm, Secret, TOTP};
use zxcvbn::{Score, zxcvbn};

use crate::state::{ApiResult, Db, all_rows, col, internal};

// A real Argon2 hash, so checking a password against it takes as long as a real login
pub static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| {
    Argon2::default()
        .hash_password(b"not-a-real-password", &SaltString::generate(&mut OsRng))
        .expect("hashing a constant can't fail")
        .to_string()
});

// Caps Argon2 work in flight: each hash takes ~19 MiB and a full core
pub static HASH_SLOTS: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(std::thread::available_parallelism().map_or(4, |n| n.get())));

// Argon2 is deliberately slow, so it runs off the async threads that serve requests
pub async fn hash_password(password: String) -> ApiResult<String> {
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

pub async fn password_matches(password: String, stored: String) -> ApiResult<bool> {
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

pub fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
        // Rejects forms like <a@b.com> or name<a@b.com>, which the mail library reads as a@b.com
        && email.parse::<lettre::Address>().is_ok()
}

// SQL Server's NVARCHAR(n) holds n UTF-16 units; an emoji takes 2
pub fn fits(s: &str, max: usize) -> bool {
    s.encode_utf16().count() <= max
}

// No invisible control characters (null bytes, escape codes) or bidi overrides,
// which can make a name on the Admin screen read as something else. Newlines only where asked for
pub fn plain(s: &str, newlines: bool) -> bool {
    !s.chars().any(|c| {
        (c.is_control() && !(newlines && matches!(c, '\n' | '\r' | '\t')))
            || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
    })
}

// The length + symbol rule, then rejects guessable passwords (common words, patterns, the user's own name/email)
pub fn check_password(password: &str, user_inputs: &[&str]) -> Result<(), String> {
    if password.chars().count() > 128 {
        return Err("Password must be 128 characters or fewer.".into());
    }
    if password.chars().count() < 10 || password.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(
            "Password must be at least 10 characters and include a special character.".into(),
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

// SHA1, 6 digits, 30-second steps: the settings every authenticator app expects
pub fn make_totp(secret: Vec<u8>, email: &str) -> Result<TOTP, String> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("BarMetric".to_string()),
        // ":" separates the app name from the account in the QR code's link, so the library rejects it
        email.replace(':', ""),
    )
    .map_err(|e| format!("{e:?}"))
}

// 32 symbols with no 0/O or 1/I to misread; 32 divides 2^32 evenly, so % 32 has no bias
pub const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub fn recovery_code() -> String {
    let mut code: String = (0..10)
        .map(|_| ALPHABET[(OsRng.next_u32() % 32) as usize] as char)
        .collect();
    code.insert(5, '-'); // e.g. K7MQX-3RHPA
    code
}

// Which 30-second step the code belongs to (this one or one either side), if any
pub fn matched_step(totp: &TOTP, code: &str, now: u64) -> Option<i64> {
    let mut exact = totp.clone();
    exact.skew = 0; // check one step at a time so we know which one matched
    [now - 30, now, now + 30]
        .into_iter()
        .find(|&t| exact.check(code, t))
        .map(|t| (t / 30) as i64)
}

// Turns the stored base32 text back into the secret's bytes
pub fn decode_secret(base32: &str) -> Result<Vec<u8>, String> {
    Secret::Encoded(base32.to_string())
        .to_bytes()
        .map_err(|e| format!("{e:?}"))
}

// The TOTP checker for a stored base32 secret
pub fn totp_for(secret: &str, email: &str) -> ApiResult<TOTP> {
    make_totp(decode_secret(secret).map_err(internal)?, email).map_err(internal)
}

// Wrong 2FA codes in a row before only a recovery code (or an admin reset link) gets in.
// Each guess hits 3 in a million, so 10 tries give an attacker about a 1 in 33,000 chance
pub const MAX_TOTP_FAILURES: i32 = 10;

// Spends one of the user's tries, then accepts the code at most once
pub async fn use_totp_code(db: &mut Db, id: i32, totp: &TOTP, code: &str) -> ApiResult<()> {
    // Spends one try before checking (a correct code gives them all back), so the cap
    // survives restarts and racing requests can't get past it
    let reserved = db
        .execute(
            "UPDATE dbo.Users SET TotpFailures = TotpFailures + 1 WHERE Id = @P1 AND TotpFailures < @P2",
            &[&id, &MAX_TOTP_FAILURES],
        )
        .await
        .map_err(internal)?;
    let capped = reserved.total() == 0;
    let too_many = || {
        (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many wrong codes. Use a recovery code, or ask an admin for a reset link.".to_string(),
        )
    };
    // 400, not 401: the frontend reads 401 as "challenge expired, start over"
    let wrong = || {
        (
            StatusCode::BAD_REQUEST,
            "That code didn't match. Try the newest one.".to_string(),
        )
    };
    // A recovery code looks like K7MQX-3RHPA. It's checked even past the cap: the cap guards the
    // 6-digit codes, and a recovery code is too long to guess. Without this an admin at the cap
    // has no way back in, since admins can't get reset links
    if code.len() == 11 && code.as_bytes()[5] == b'-' {
        let rows = all_rows(
            db,
            "SELECT Id, CodeHash FROM dbo.RecoveryCodes WHERE UserId = @P1 AND UsedAt IS NULL",
            &[&id],
        )
        .await?;
        for r in rows {
            let hash: &str = col(&r, "CodeHash")?;
            if password_matches(code.to_uppercase(), hash.to_string()).await? {
                let code_id: i32 = col(&r, "Id")?;
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
        return Err(if capped { too_many() } else { wrong() });
    }
    if capped {
        return Err(too_many());
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

#[cfg(test)]
mod tests {
    use super::*;

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
            "<a@b.com>",
            "x<a@b.com>",
        ] {
            assert!(!valid_email(bad), "{bad:?} should be rejected");
        }
        assert!(plain("Jet Thomas 💪", false));
        assert!(plain("line one\nline two", true));
        for bad in ["a\0b", "a\u{1b}[31mb", "evil\u{202E}nimda", "two\nlines"] {
            assert!(!plain(bad, false), "{bad:?} should be rejected");
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
