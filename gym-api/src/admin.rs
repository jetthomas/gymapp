use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::NaiveDateTime;

use crate::extractors::AdminUser;
use crate::models::{AdminFlag, DayCount, RangeQuery, ResetLink, UserSummary};
use crate::nutrition::sane;
use crate::state::{
    ApiResult, AppState, GYM_TZ, all_rows, batch, col, internal, one_row, record,
    send_security_notice,
};
use crate::tokens::make_reset_token;

pub async fn set_admin(
    State(state): State<Arc<AppState>>,
    AdminUser(admin_id, mut db): AdminUser,
    Path(user_id): Path<i32>,
    Json(body): Json<AdminFlag>, // Json must be the last argument
) -> ApiResult<StatusCode> {
    // If nobody can remove their own access, the last admin always stays
    if user_id == admin_id && !body.is_admin {
        return Err((
            StatusCode::BAD_REQUEST,
            "You can't remove your own admin access.".to_string(),
        ));
    }
    // One transaction, so a removed admin is never saved without the event create_reset_link checks.
    // An early return closes the connection, which undoes it
    batch(&mut db, "BEGIN TRANSACTION").await?;
    // Active = 1: a deactivated account's role is frozen, here and not just on the Admin screen
    let row = one_row(
        &mut db,
        "UPDATE dbo.Users SET IsAdmin = @P2 OUTPUT INSERTED.Email, DELETED.IsAdmin AS WasAdmin
         WHERE Id = @P1 AND Active = 1",
        &[&user_id, &body.is_admin],
    )
    .await?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "User not found, or deactivated.".to_string(),
        )
    })?;
    let removed = col::<bool>(&row, "WasAdmin")? && !body.is_admin;
    if removed {
        // Against the member, not the admin: create_reset_link looks for it
        record(&mut db, user_id, "admin_removed").await?;
    }
    record(&mut db, admin_id, "admin_changed").await?;
    batch(&mut db, "COMMIT").await?;
    if removed {
        send_security_notice(
            &state,
            col(&row, "Email")?,
            "An admin removed your admin access.",
        );
    }
    Ok(StatusCode::OK)
}

pub async fn create_reset_link(
    State(state): State<Arc<AppState>>,
    AdminUser(admin_id, mut db): AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<Json<ResetLink>> {
    let row = one_row(
        &mut db,
        "SELECT PasswordHash, Email, IsAdmin,
                CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.Events
                                       WHERE UserId = @P1 AND Kind = 'admin_removed')
                     THEN 1 ELSE 0 END AS BIT) AS WasAdmin
         FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "User not found.".to_string()))?;
    // The link turns off 2FA, so one stolen admin login must not open the other admins' accounts,
    // including by removing their admin access first
    if col::<bool>(&row, "IsAdmin")? || col::<bool>(&row, "WasAdmin")? {
        return Err((
            StatusCode::FORBIDDEN,
            "Admins and former admins can't get reset links. Use Forgot password on the login screen."
                .to_string(),
        ));
    }
    let stored: &str = col(&row, "PasswordHash")?;
    let token = make_reset_token(user_id, &state.jwt_secret, stored).map_err(internal)?;
    // The link turns off the member's 2FA, so keep a record of which admin made it
    record(&mut db, admin_id, "reset_link").await?;
    // Told now, not only once it's used, so a member can react within the link's 15 minutes
    send_security_notice(
        &state,
        col(&row, "Email")?,
        "An admin made a password reset link for your account. It works for 15 minutes.",
    );
    Ok(Json(ResetLink {
        link: format!("{}/#reset={token}", state.frontend_url),
    }))
}

// Brings back an account its member deactivated; the member is emailed, as with other account changes
pub async fn reactivate_user(
    State(state): State<Arc<AppState>>,
    AdminUser(admin_id, mut db): AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<StatusCode> {
    let row = one_row(
        &mut db,
        // Bumps SessionVersion like reactivate_account, so tokens from before the deactivation stay dead
        "UPDATE dbo.Users SET Active = 1, SessionVersion = SessionVersion + 1 OUTPUT INSERTED.Email WHERE Id = @P1 AND Active = 0",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "User not found, or already active.".to_string(),
        )
    })?;
    record(&mut db, admin_id, "reactivated").await?;
    send_security_notice(
        &state,
        col(&row, "Email")?,
        "Your account was reactivated by an admin.",
    );
    Ok(StatusCode::OK)
}

pub async fn list_users(
    AdminUser(admin_id, mut db): AdminUser,
) -> ApiResult<Json<Vec<UserSummary>>> {
    let rows = all_rows(
        &mut db,
        "SELECT u.Id, u.FirstName, u.LastName, u.Email, u.Active, u.IsAdmin, u.TotpEnabled,
           COUNT(CASE WHEN e.Kind = 'login' THEN 1 END)    AS Logins,
           MAX(CASE WHEN e.Kind = 'login' THEN e.At END)   AS LastLogin,
           COUNT(CASE WHEN e.Kind = 'login_failed' AND e.At > DATEADD(day, -7, SYSUTCDATETIME()) THEN 1 END) AS FailedLast7d,
           COUNT(CASE WHEN e.Kind = 'workout' THEN 1 END)  AS Workouts
         FROM dbo.Users u
         LEFT JOIN dbo.Events e ON e.UserId = u.Id
         GROUP BY u.Id, u.FirstName, u.LastName, u.Email, u.Active, u.IsAdmin, u.TotpEnabled
         ORDER BY u.Email",
        &[],
    )
    .await?;

    let users = rows
        .iter()
        .map(|r| UserSummary {
            id: r.get("Id").unwrap_or_default(),
            first_name: r.get::<&str, _>("FirstName").map(|s| s.to_string()),
            last_name: r.get::<&str, _>("LastName").map(|s| s.to_string()),
            email: r.get::<&str, _>("Email").unwrap_or_default().to_string(),
            active: r.get("Active").unwrap_or_default(),
            is_admin: r.get("IsAdmin").unwrap_or_default(),
            is_you: r.get::<i32, _>("Id") == Some(admin_id),
            totp_enabled: r.get("TotpEnabled").unwrap_or_default(),
            logins: r.get("Logins").unwrap_or_default(),
            last_login: r.get::<NaiveDateTime, _>("LastLogin").map(|t| t.and_utc()),
            failed_last_7d: r.get("FailedLast7d").unwrap_or_default(),
            workouts: r.get("Workouts").unwrap_or_default(),
        })
        .collect();
    Ok(Json(users))
}

// From before To, at most a year apart, so nobody can ask for every row at once
pub fn check_range(q: &RangeQuery) -> Result<(), &'static str> {
    if !sane(q.from) || !sane(q.to) || q.from > q.to || (q.to - q.from).num_days() > 365 {
        return Err("Pick a From date before the To date, up to a year apart.");
    }
    Ok(())
}

pub async fn admin_stats(
    AdminUser(_, mut db): AdminUser,
    Query(q): Query<RangeQuery>,
) -> ApiResult<Json<Vec<DayCount>>> {
    check_range(&q).map_err(|msg| (StatusCode::BAD_REQUEST, msg.to_string()))?;
    let rows = all_rows(
        &mut db,
        // Days are counted in the gym's time zone, so an evening session isn't split across two UTC days.
        // The inner WHERE takes a day either side in UTC; the outer one trims to exact local days
        &format!(
            "SELECT CONVERT(char(10), Day, 23) AS Day, Kind, N FROM (
            SELECT CAST(At AT TIME ZONE 'UTC' AT TIME ZONE '{GYM_TZ}' AS date) AS Day,
                   Kind, COUNT(*) AS N
            FROM dbo.Events
            WHERE At >= DATEADD(day, -1, CAST(@P1 AS datetime2))
              AND At < DATEADD(day, 2, CAST(@P2 AS datetime2))
            GROUP BY CAST(At AT TIME ZONE 'UTC' AT TIME ZONE '{GYM_TZ}' AS date), Kind
         ) t
         WHERE Day BETWEEN @P1 AND @P2
         ORDER BY Day"
        ),
        &[&q.from, &q.to],
    )
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| DayCount {
                day: r.get::<&str, _>("Day").unwrap_or_default().to_string(),
                kind: r.get::<&str, _>("Kind").unwrap_or_default().to_string(),
                n: r.get("N").unwrap_or_default(),
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn range(from: &str, to: &str) -> RangeQuery {
        RangeQuery {
            from: from.parse::<NaiveDate>().unwrap(),
            to: to.parse::<NaiveDate>().unwrap(),
        }
    }

    #[test]
    fn ranges_are_checked() {
        assert!(check_range(&range("2026-10-01", "2026-10-31")).is_ok());
        assert!(
            check_range(&range("2026-11-19", "2026-11-19")).is_ok(),
            "one day"
        );
        assert!(
            check_range(&range("2026-10-31", "2026-10-01")).is_err(),
            "backwards"
        );
        assert!(
            check_range(&range("2024-01-01", "2026-01-01")).is_err(),
            "over a year"
        );
        assert!(
            check_range(&range("1850-01-01", "1850-02-01")).is_err(),
            "far-off year"
        );
    }
}
