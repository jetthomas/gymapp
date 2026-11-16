use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::NaiveDateTime;

use crate::extractors::AdminUser;
use crate::models::{AdminFlag, DayCount, ResetLink, StatsQuery, UserSummary};
use crate::state::{ApiResult, AppState, all_rows, col, internal, one_row, record};
use crate::tokens::make_reset_token;

pub async fn set_admin(
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
    let updated = db
        .execute(
            "UPDATE dbo.Users SET IsAdmin = @P2 WHERE Id = @P1",
            &[&user_id, &body.is_admin],
        )
        .await
        .map_err(internal)?;
    if updated.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "User not found.".to_string()));
    }
    record(&mut db, admin_id, "admin_changed").await?;
    Ok(StatusCode::OK)
}

pub async fn create_reset_link(
    State(state): State<Arc<AppState>>,
    AdminUser(admin_id, mut db): AdminUser,
    Path(user_id): Path<i32>,
) -> ApiResult<Json<ResetLink>> {
    let row = one_row(
        &mut db,
        "SELECT PasswordHash FROM dbo.Users WHERE Id = @P1",
        &[&user_id],
    )
    .await?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "User not found.".to_string()))?;
    let stored: &str = col(&row, "PasswordHash")?;
    let token = make_reset_token(user_id, &state.jwt_secret, stored).map_err(internal)?;
    // The link turns off the member's 2FA, so keep a record of which admin made it
    record(&mut db, admin_id, "reset_link").await?;
    Ok(Json(ResetLink {
        link: format!("{}/#reset={token}", state.frontend_url),
    }))
}

pub async fn list_users(AdminUser(_, mut db): AdminUser) -> ApiResult<Json<Vec<UserSummary>>> {
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
            totp_enabled: r.get("TotpEnabled").unwrap_or_default(),
            logins: r.get("Logins").unwrap_or_default(),
            last_login: r.get::<NaiveDateTime, _>("LastLogin").map(|t| t.and_utc()),
            failed_last_7d: r.get("FailedLast7d").unwrap_or_default(),
            workouts: r.get("Workouts").unwrap_or_default(),
        })
        .collect();
    Ok(Json(users))
}

pub async fn admin_stats(
    AdminUser(_, mut db): AdminUser,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Json<Vec<DayCount>>> {
    // Clamped so nobody can ask for years of rows
    let days = q.days.unwrap_or(30).clamp(7, 365);
    let rows = all_rows(
        &mut db,
        // Days are counted in Sydney/Melbourne time, so an evening session isn't split across two UTC days
        "SELECT CONVERT(char(10), Day, 23) AS Day, Kind, N FROM (
            SELECT CAST(At AT TIME ZONE 'UTC' AT TIME ZONE 'AUS Eastern Standard Time' AS date) AS Day,
                   Kind, COUNT(*) AS N
            FROM dbo.Events
            WHERE At >= DATEADD(day, -@P1, SYSUTCDATETIME())
            GROUP BY CAST(At AT TIME ZONE 'UTC' AT TIME ZONE 'AUS Eastern Standard Time' AS date), Kind
         ) t ORDER BY Day",
        &[&days],
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
