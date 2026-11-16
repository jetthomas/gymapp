use axum::{Json, http::StatusCode};
use chrono::{Datelike, NaiveDateTime};

use crate::extractors::AuthUser;
use crate::models::{NewWorkout, Workout};
use crate::passwords::fits;
use crate::state::{ApiResult, all_rows, internal, one_row, record, set_user};

// The user ID comes from the token (AuthUser), never from the request body

pub async fn list_workouts(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<Vec<Workout>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        // shortcut: newest 200 only; add paging if members need older history
        "SELECT TOP 200 Id, [Date], Name, Notes FROM dbo.Workouts WHERE UserId = @P1 ORDER BY [Date] DESC",
        &[&user_id],
    )
    .await?;

    let workouts = rows
        .iter()
        .map(|r| Workout {
            id: r.get("Id").unwrap_or_default(),
            name: r.get::<&str, _>("Name").unwrap_or_default().to_string(),
            date: r
                .get::<NaiveDateTime, _>("Date")
                .unwrap_or_default()
                .and_utc(),
            notes: r.get::<&str, _>("Notes").map(|s| s.to_string()),
        })
        .collect();
    Ok(Json(workouts))
}

pub async fn create_workout(
    AuthUser(user_id, mut db): AuthUser,
    Json(w): Json<NewWorkout>,
) -> ApiResult<(StatusCode, Json<Workout>)> {
    // The Name column is NVARCHAR(200)
    let name = w.name.trim();
    if name.is_empty() || !fits(name, 200) {
        return Err((
            StatusCode::BAD_REQUEST,
            "workout name must be 1 to 200 characters".into(),
        ));
    }
    // Notes is NVARCHAR(MAX), so without a cap one account could fill the database's disk
    if w.notes.as_deref().is_some_and(|n| !fits(n, 2000)) {
        return Err((
            StatusCode::BAD_REQUEST,
            "notes must be 2000 characters or fewer".into(),
        ));
    }
    // Years outside 1..=9999 make the database driver panic
    if !(1..=9999).contains(&w.date.year()) {
        return Err((StatusCode::BAD_REQUEST, "date is out of range".into()));
    }
    set_user(&mut db, user_id).await.map_err(internal)?;
    let count: i32 = one_row(
        &mut db,
        "SELECT COUNT(*) FROM dbo.Workouts WHERE UserId = @P1",
        &[&user_id],
    )
    .await?
    .and_then(|r| r.get(0))
    .unwrap_or(0);
    if count >= 5000 {
        return Err((StatusCode::BAD_REQUEST, "workout limit reached".into()));
    }
    let date = w.date.naive_utc();
    let id: i32 = one_row(
        &mut db,
        "INSERT INTO dbo.Workouts (UserId, [Date], Name, Notes) OUTPUT INSERTED.Id VALUES (@P1, @P2, @P3, @P4)",
        &[&user_id, &date, &name, &w.notes],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("insert returned no Id"))?;
    record(&mut db, user_id, "workout").await?;
    let saved = Workout {
        id,
        name: name.to_string(),
        date: w.date,
        notes: w.notes,
    };
    Ok((StatusCode::CREATED, Json(saved)))
}
