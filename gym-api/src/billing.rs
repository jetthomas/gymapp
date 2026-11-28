// BarMetric Plus: joining (Checkout), managing (Customer Portal) and keeping the database in step
// with Stripe (the webhook). Guide: https://docs.stripe.com/billing/subscriptions/build-subscriptions
use std::sync::Arc;

use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::Value;

use crate::extractors::{AuthUser, PLUS_STATUSES};
use crate::models::RedirectUrl;
use crate::state::{ApiResult, AppState, col, connect, internal, one_row};
use crate::stripe;

// A new Checkout only makes sense with no subscription, or one that has fully ended.
// Anything else (active, past_due, paused...) is changed in the Customer Portal instead
pub fn can_join(status: Option<&str>) -> bool {
    matches!(status, None | Some("canceled" | "incomplete_expired"))
}

// Starts a Checkout Session and returns the address of Stripe's payment page
pub async fn create_checkout(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id, mut db): AuthUser,
) -> ApiResult<Json<RedirectUrl>> {
    let row = one_row(
        &mut db,
        "SELECT Email, IsAdmin, StripeCustomerId, MembershipStatus FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    if col::<bool>(&row, "IsAdmin")? {
        return Err((StatusCode::CONFLICT, "Admins get Plus for free.".into()));
    }
    let already = || {
        (
            StatusCode::CONFLICT,
            "You already have Plus. Use Manage membership to change it.".to_string(),
        )
    };
    if !can_join(row.get("MembershipStatus")) {
        return Err(already());
    }
    // One Stripe customer per member, made the first time they join and reused after that
    let customer = match row.get::<&str, _>("StripeCustomerId") {
        Some(id) => {
            // MembershipStatus waits on the webhook; Stripe already knows about a payment made seconds ago,
            // so a member who taps Upgrade again before the webhook lands isn't charged twice
            let subs = stripe::get(
                &state,
                "subscriptions",
                &[("customer", id), ("status", "all"), ("limit", "10")],
            )
            .await?;
            let subs = subs["data"].as_array().map_or(&[][..], Vec::as_slice);
            if !can_join(best_subscription(subs).0) {
                return Err(already());
            }
            id.to_string()
        }
        None => {
            let email: &str = col(&row, "Email")?;
            let user = user_id.to_string();
            // The Idempotency-Key makes a double tap return the same customer, not a second one
            let made = stripe::post(
                &state,
                "customers",
                &[("email", email), ("metadata[user_id]", &user)],
                Some(&format!("gymapp-customer-{user_id}")),
            )
            .await?;
            let id = made["id"]
                .as_str()
                .ok_or_else(|| internal("customer has no id"))?
                .to_string();
            db.execute(
                "UPDATE dbo.Users SET StripeCustomerId = @P1 WHERE Id = @P2",
                &[&id.as_str(), &user_id],
            )
            .await
            .map_err(internal)?;
            id
        }
    };
    let success_url = format!("{}/?membership=done", state.frontend_url);
    let cancel_url = format!("{}/?membership=cancelled", state.frontend_url);
    // No payment_method_types: Stripe picks the methods to offer from your Dashboard settings
    let session = stripe::post(
        &state,
        "checkout/sessions",
        &[
            ("mode", "subscription"),
            ("customer", &customer),
            // The price comes from .env, never from the request, so nobody can choose their own
            ("line_items[0][price]", &state.stripe_price_id),
            ("line_items[0][quantity]", "1"),
            ("success_url", &success_url),
            ("cancel_url", &cancel_url),
        ],
        None,
    )
    .await?;
    let url = session["url"]
        .as_str()
        .ok_or_else(|| internal("session has no url"))?;
    Ok(Json(RedirectUrl {
        url: url.to_string(),
    }))
}

// A Customer Portal link, where the member cancels or changes their card
pub async fn create_portal(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id, mut db): AuthUser,
) -> ApiResult<Json<RedirectUrl>> {
    let row = one_row(
        &mut db,
        "SELECT StripeCustomerId FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    let customer: &str = row
        .get("StripeCustomerId")
        .ok_or_else(|| (StatusCode::CONFLICT, "Join Plus first.".to_string()))?;
    let return_url = format!("{}/", state.frontend_url);
    let session = stripe::post(
        &state,
        "billing_portal/sessions",
        &[("customer", customer), ("return_url", &return_url)],
        None,
    )
    .await?;
    let url = session["url"]
        .as_str()
        .ok_or_else(|| internal("portal session has no url"))?;
    Ok(Json(RedirectUrl {
        url: url.to_string(),
    }))
}

// Called when the member is back from paying: reads Stripe now instead of waiting on the webhook,
// which can be late or fail (a wrong secret, or the API was down when Stripe sent it)
pub async fn sync_billing(
    State(state): State<Arc<AppState>>,
    AuthUser(user_id, mut db): AuthUser,
) -> ApiResult<StatusCode> {
    let row = one_row(
        &mut db,
        "SELECT StripeCustomerId FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| internal("user missing"))?;
    // No customer = never started a checkout, so Stripe has nothing for them
    if let Some(customer) = row.get::<&str, _>("StripeCustomerId") {
        sync_customer(&state, customer).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

// Stripe calls this; no member token. Bytes, not Json: the signature covers the exact bytes sent
pub async fn webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !stripe::verify_signature(
        signature,
        &body,
        &state.stripe_webhook_secret,
        Utc::now().timestamp(),
    ) {
        return StatusCode::BAD_REQUEST;
    }
    let Ok(event) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let kind = event["type"].as_str().unwrap_or("");
    let object = &event["data"]["object"];
    match kind {
        // Each of these can change whether the member has Plus. All carry the customer's id
        "checkout.session.completed"
        | "checkout.session.async_payment_succeeded"
        | "customer.subscription.created"
        | "customer.subscription.updated"
        | "customer.subscription.deleted"
        | "customer.subscription.paused"
        | "customer.subscription.resumed"
        | "invoice.paid"
        | "invoice.payment_failed" => {
            if let Some(customer) = object["customer"].as_str()
                && sync_customer(&state, customer).await.is_err()
            {
                // Not 2xx, so Stripe tries again later (the error itself was logged by internal())
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
        }
        // Money taken back or at risk: no code acts on these yet, so make sure a person sees them.
        // shortcut: only logged; email the admins if this ever happens more than rarely
        "charge.refunded" | "charge.dispute.created" | "radar.early_fraud_warning.created" => {
            eprintln!(
                "stripe: {kind} for {} (look it up in the Dashboard)",
                object["id"]
            );
        }
        _ => {}
    }
    StatusCode::OK
}

// Reads the customer's subscriptions from Stripe and saves the one that matters.
// It reads Stripe's current state rather than trusting the event, so an event that
// arrives twice or out of order still leaves the right answer in the database
async fn sync_customer(state: &AppState, customer: &str) -> ApiResult<()> {
    let list = stripe::get(
        state,
        "subscriptions",
        &[("customer", customer), ("status", "all"), ("limit", "10")],
    )
    .await?;
    let subs = list["data"].as_array().cloned().unwrap_or_default();
    let (status, ends) = best_subscription(&subs);
    let mut db = connect(state).await.map_err(internal)?;
    db.execute(
        "UPDATE dbo.Users SET MembershipStatus = @P1, MembershipEndsAt = @P2 WHERE StripeCustomerId = @P3",
        &[&status, &ends, &customer],
    )
    .await
    .map_err(internal)?;
    Ok(())
}

// The subscription that decides Plus, as its status and the end of its paid period.
// One that gives Plus wins; otherwise the newest (Stripe lists newest first)
fn best_subscription(subs: &[Value]) -> (Option<&str>, Option<NaiveDateTime>) {
    let best = subs
        .iter()
        .find(|s| {
            s["status"]
                .as_str()
                .is_some_and(|st| PLUS_STATUSES.contains(&st))
        })
        .or(subs.first());
    let status = best.and_then(|s| s["status"].as_str());
    // On current API versions the billing period lives on each subscription item
    let ends = best
        .and_then(|s| s["items"]["data"][0]["current_period_end"].as_i64())
        .and_then(|t| DateTime::from_timestamp(t, 0))
        .map(|t| t.naive_utc());
    (status, ends)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_subscription_that_gives_plus_wins() {
        let sub = |status: &str, end: i64| serde_json::json!({ "status": status, "items": { "data": [{ "current_period_end": end }] } });
        // Newest first: a newer cancelled one must not hide an older one that still gives Plus
        let subs = [
            sub("canceled", 1_800_000_000),
            sub("past_due", 1_790_000_000),
        ];
        let (status, ends) = best_subscription(&subs);
        assert_eq!(status, Some("past_due"));
        assert_eq!(ends.map(|t| t.and_utc().timestamp()), Some(1_790_000_000));
        assert_eq!(
            best_subscription(&[sub("canceled", 1)]).0,
            Some("canceled"),
            "none gives Plus: the newest"
        );
        assert_eq!(best_subscription(&[]), (None, None), "never joined");
    }

    #[test]
    fn only_members_without_a_live_subscription_can_join() {
        assert!(can_join(None), "never joined");
        assert!(can_join(Some("canceled")), "cancelled and ended");
        assert!(
            can_join(Some("incomplete_expired")),
            "first payment never went through"
        );
        for status in [
            "active",
            "trialing",
            "past_due",
            "unpaid",
            "paused",
            "incomplete",
        ] {
            assert!(!can_join(Some(status)), "{status} is managed in the portal");
        }
    }
}
