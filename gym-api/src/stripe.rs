// Talks to Stripe's REST API. Stripe has no official Rust library, so this is a thin wrapper:
// form-encoded requests in, JSON out. Docs: https://docs.stripe.com/api
use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::state::{ApiResult, AppState, internal};

// Pinned so a change on Stripe's side can't alter the JSON this code reads.
// Upgrade on purpose: https://docs.stripe.com/upgrades
pub const API_VERSION: &str = "2026-11-18.endive";

// POST https://api.stripe.com/v1/<path>. `once` = an Idempotency-Key: the same key twice
// returns the first answer instead of doing the work again
pub async fn post(
    state: &AppState,
    path: &str,
    form: &[(&str, &str)],
    once: Option<&str>,
) -> ApiResult<Value> {
    let mut req = state
        .http
        .post(format!("https://api.stripe.com/v1/{path}"))
        .form(form);
    if let Some(key) = once {
        req = req.header("Idempotency-Key", key);
    }
    send(state, req).await
}
// GET https://api.stripe.com/v1/<path>?<query>
pub async fn get(state: &AppState, path: &str, query: &[(&str, &str)]) -> ApiResult<Value> {
    let req = state
        .http
        .get(format!("https://api.stripe.com/v1/{path}"))
        .query(query);
    send(state, req).await
}

async fn send(state: &AppState, req: reqwest::RequestBuilder) -> ApiResult<Value> {
    let res = req
        // The key is the username with no password, as in Stripe's curl examples (-u "sk_...:")
        .basic_auth(&state.stripe_key, None::<&str>)
        .header("Stripe-Version", API_VERSION)
        .send()
        .await
        .map_err(internal)?;
    let status = res.status();
    let body: Value = res.json().await.map_err(internal)?;
    if !status.is_success() {
        // Logged in full on the server; the member only sees "server error"
        return Err(internal(format!(
            "Stripe answered {status}: {}",
            body["error"]["message"]
        )));
    }
    Ok(body)
}
// True when a webhook really came from Stripe: https://docs.stripe.com/webhooks#verify-manually
// The Stripe-Signature header looks like t=1798765432,v1=5257a8...,v1=38c9f7...
pub fn verify_signature(header: &str, body: &[u8], secret: &str, now: i64) -> bool {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        match part.trim().split_once('=') {
            Some(("t", t)) => timestamp = t.parse::<i64>().ok(),
            // Only v1: other schemes (v0) must be ignored, or an attacker could pick a weaker one
            Some(("v1", sig)) => signatures.push(sig),
            _ => {}
        }
    }
    let Some(t) = timestamp else { return false };
    // Older than 5 minutes (Stripe's own libraries' tolerance) = maybe a replayed request
    if (now - t).abs() > 300 {
        return false;
    }
    signatures.iter().any(|sig| {
        let Ok(expected) = hex::decode(sig) else {
            return false;
        };
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
            .expect("HMAC takes a key of any length");
        // The signed payload is "<t>.<the raw body>"
        mac.update(t.to_string().as_bytes());
        mac.update(b".");
        mac.update(body);
        // verify_slice compares in constant time, so timing can't leak how much of a guess matched
        mac.verify_slice(&expected).is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Signs the way Stripe does, to test the checker against
    fn sign(t: i64, body: &[u8], secret: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(format!("{t}.").as_bytes());
        mac.update(body);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn only_stripes_recent_signature_passes() {
        let secret = "whsec_test";
        let body = br#"{"id":"evt_1","type":"invoice.paid"}"#;
        let now = 1_798_765_432;
        let good = sign(now, body, secret);
        let header = format!("t={now},v1={good}");
        assert!(verify_signature(&header, body, secret, now));
        assert!(
            verify_signature(&format!("t={now},v1=00ff,v1={good}"), body, secret, now),
            "any one v1 may match"
        );
        assert!(
            !verify_signature(&header, br#"{"id":"evt_2"}"#, secret, now),
            "changed body"
        );
        assert!(
            !verify_signature(&header, body, "whsec_other", now),
            "wrong secret"
        );
        assert!(
            !verify_signature(&header, body, secret, now + 301),
            "older than 5 minutes"
        );
        assert!(
            !verify_signature(&format!("t={now},v0={good}"), body, secret, now),
            "v0 is ignored"
        );
        assert!(!verify_signature("", body, secret, now), "no header");
    }
}
