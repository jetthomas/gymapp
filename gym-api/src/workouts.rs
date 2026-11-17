use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
};
use chrono::{Datelike, NaiveDateTime};
use tiberius::Row;

use crate::extractors::AuthUser;
use crate::models::{
    LoggedExercise, LoggedSet, MuscleSets, NewWorkout, StatsQuery, Workout, WorkoutDetail,
};
use crate::passwords::fits;
use crate::state::{ApiResult, Db, all_rows, col, internal, one_row, record, set_user};

// The user ID comes from the token (AuthUser), never from the request body

// A workout's own columns plus how many sets were logged in it
const WORKOUT_COLS: &str = "w.Id, w.[Date], w.Name, w.Notes, w.DurationSec,
    (SELECT COUNT(*) FROM dbo.Sets s
     JOIN dbo.WorkoutExercises we ON we.Id = s.WorkoutExerciseId
     WHERE we.WorkoutId = w.Id) AS Sets";

fn to_workout(r: &Row) -> Workout {
    Workout {
        id: r.get("Id").unwrap_or_default(),
        name: r.get::<&str, _>("Name").unwrap_or_default().to_string(),
        date: r
            .get::<NaiveDateTime, _>("Date")
            .unwrap_or_default()
            .and_utc(),
        notes: r.get::<&str, _>("Notes").map(|s| s.to_string()),
        duration_sec: r.get("DurationSec"),
        sets: r.get("Sets").unwrap_or_default(),
    }
}

fn to_set(r: &Row) -> ApiResult<LoggedSet> {
    Ok(LoggedSet {
        weight_kg: col(r, "WeightKg")?,
        reps: col(r, "Reps")?,
        rir: r.get("Rir"),
    })
}

// Checks a workout before it is saved; returns the trimmed name
pub fn check_workout(w: &NewWorkout) -> Result<&str, String> {
    // The Name column is NVARCHAR(200)
    let name = w.name.trim();
    if name.is_empty() || !fits(name, 200) {
        return Err("workout name must be 1 to 200 characters".into());
    }
    // Notes is NVARCHAR(MAX), so without a cap one account could fill the database's disk
    if w.notes.as_deref().is_some_and(|n| !fits(n, 2000)) {
        return Err("notes must be 2000 characters or fewer".into());
    }
    // Years outside 1..=9999 make the database driver panic
    if !(1..=9999).contains(&w.date.year()) {
        return Err("date is out of range".into());
    }
    // crypto.randomUUID() in the browser: 36 characters of hex and dashes
    if w.client_id
        .as_deref()
        .is_some_and(|c| c.len() != 36 || !c.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-'))
    {
        return Err("clientId must be a UUID".into());
    }
    if w.duration_sec.is_some_and(|d| !(0..=86_400).contains(&d)) {
        return Err("duration is out of range".into());
    }
    if w.exercises.len() > 50 || w.exercises.iter().any(|e| e.sets.len() > 50) {
        return Err("a workout holds up to 50 exercises of 50 sets".into());
    }
    for s in w.exercises.iter().flat_map(|e| &e.sets) {
        // NaN fails every comparison, so this rejects it too
        if !(0.0..=1000.0).contains(&s.weight_kg) {
            return Err("weight must be 0 to 1000 kg".into());
        }
        if !(1..=1000).contains(&s.reps) {
            return Err("reps must be 1 to 1000".into());
        }
        if s.rir.is_some_and(|r| !(0..=10).contains(&r)) {
            return Err("RIR must be 0 to 10".into());
        }
    }
    Ok(name)
}

pub async fn list_workouts(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<Vec<Workout>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        // shortcut: newest 200 only; add paging if members need older history
        &format!(
            "SELECT TOP 200 {WORKOUT_COLS} FROM dbo.Workouts w WHERE w.UserId = @P1 ORDER BY w.[Date] DESC"
        ),
        &[&user_id],
    )
    .await?;
    Ok(Json(rows.iter().map(to_workout).collect()))
}

// The workout this member already saved under a client ID, if any
async fn saved_as(db: &mut Db, user_id: i32, client_id: &str) -> ApiResult<Option<Workout>> {
    let row = one_row(
        db,
        &format!(
            "SELECT {WORKOUT_COLS} FROM dbo.Workouts w WHERE w.UserId = @P1 AND w.ClientId = @P2"
        ),
        &[&user_id, &client_id],
    )
    .await?;
    Ok(row.as_ref().map(to_workout))
}

pub async fn create_workout(
    AuthUser(user_id, mut db): AuthUser,
    Json(w): Json<NewWorkout>,
) -> ApiResult<(StatusCode, Json<Workout>)> {
    let name = check_workout(&w).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    set_user(&mut db, user_id).await.map_err(internal)?;
    // A phone that never heard our answer sends the workout again: give it the one already saved.
    // Two copies arriving in the same instant: the unique index fails the second, which answers 500 and is retried
    if let Some(c) = &w.client_id
        && let Some(saved) = saved_as(&mut db, user_id, c).await?
    {
        return Ok((StatusCode::OK, Json(saved)));
    }
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
    // Every exercise must still be in the library; an admin may have deleted one since it was picked
    let ids: HashSet<i32> = w.exercises.iter().map(|e| e.exercise_id).collect();
    let id_list = format!(
        "[{}]",
        ids.iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    let known: i32 = one_row(
        &mut db,
        "SELECT COUNT(*) FROM dbo.Exercises WHERE Id IN (SELECT CAST(value AS INT) FROM OPENJSON(@P1))",
        &[&id_list],
    )
    .await?
    .and_then(|r| r.get(0))
    .unwrap_or(0);
    if known as usize != ids.len() {
        return Err((
            StatusCode::BAD_REQUEST,
            "An exercise in this workout is no longer in the library.".into(),
        ));
    }

    // If anything fails before COMMIT, the connection closes and SQL Server undoes it all
    db.execute("BEGIN TRANSACTION", &[])
        .await
        .map_err(internal)?;
    let date = w.date.naive_utc();
    let id: i32 = one_row(
        &mut db,
        "INSERT INTO dbo.Workouts (UserId, [Date], Name, Notes, DurationSec, ClientId)
         OUTPUT INSERTED.Id
         VALUES (@P1, @P2, @P3, @P4, @P5, COALESCE(@P6, CONVERT(VARCHAR(36), NEWID())))",
        &[
            &user_id,
            &date,
            &name,
            &w.notes,
            &w.duration_sec,
            &w.client_id,
        ],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("insert returned no Id"))?;
    let mut sets = 0;
    // shortcut: one INSERT per set (about 30 for a normal workout); send them as one OPENJSON insert if saving gets slow
    for (i, e) in w.exercises.iter().enumerate() {
        let we_id: i32 = one_row(
            &mut db,
            "INSERT INTO dbo.WorkoutExercises (WorkoutId, ExerciseId, Position)
             OUTPUT INSERTED.Id VALUES (@P1, @P2, @P3)",
            &[&id, &e.exercise_id, &(i as i32)],
        )
        .await?
        .and_then(|r| r.get(0))
        .ok_or_else(|| internal("insert returned no Id"))?;
        for (j, s) in e.sets.iter().enumerate() {
            db.execute(
                "INSERT INTO dbo.Sets (WorkoutExerciseId, Position, WeightKg, Reps, Rir)
                 VALUES (@P1, @P2, @P3, @P4, @P5)",
                &[&we_id, &(j as i32), &s.weight_kg, &s.reps, &s.rir],
            )
            .await
            .map_err(internal)?;
            sets += 1;
        }
    }
    record(&mut db, user_id, "workout").await?;
    db.execute("COMMIT", &[]).await.map_err(internal)?;
    let saved = Workout {
        id,
        name: name.to_string(),
        date: w.date,
        notes: w.notes,
        duration_sec: w.duration_sec,
        sets,
    };
    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn get_workout(
    AuthUser(user_id, mut db): AuthUser,
    Path(id): Path<i32>,
) -> ApiResult<Json<WorkoutDetail>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let workout = one_row(
        &mut db,
        &format!("SELECT {WORKOUT_COLS} FROM dbo.Workouts w WHERE w.Id = @P1 AND w.UserId = @P2"),
        &[&id, &user_id],
    )
    .await?
    .as_ref()
    .map(to_workout)
    .ok_or((StatusCode::NOT_FOUND, "Workout not found.".to_string()))?;
    // WorkoutExercises and Sets have no UserId of their own: the workout above was already checked as this member's
    let rows = all_rows(
        &mut db,
        "SELECT we.Id AS WeId, we.ExerciseId, e.Name, s.WeightKg, s.Reps, s.Rir
         FROM dbo.WorkoutExercises we
         JOIN dbo.Exercises e ON e.Id = we.ExerciseId
         JOIN dbo.Sets s ON s.WorkoutExerciseId = we.Id
         WHERE we.WorkoutId = @P1
         ORDER BY we.Position, s.Position",
        &[&id],
    )
    .await?;
    // One row per set; rows for the same exercise arrive together
    let mut exercises: Vec<LoggedExercise> = Vec::new();
    let mut last_we = None;
    for r in &rows {
        let we_id: i32 = col(r, "WeId")?;
        if last_we != Some(we_id) {
            last_we = Some(we_id);
            exercises.push(LoggedExercise {
                exercise_id: col(r, "ExerciseId")?,
                name: col::<&str>(r, "Name")?.to_string(),
                sets: vec![],
            });
        }
        if let Some(e) = exercises.last_mut() {
            e.sets.push(to_set(r)?);
        }
    }
    Ok(Json(WorkoutDetail { workout, exercises }))
}

// The sets from the last time this member did an exercise: the grey "previous" column
pub async fn last_sets(
    AuthUser(user_id, mut db): AuthUser,
    Path(exercise_id): Path<i32>,
) -> ApiResult<Json<Vec<LoggedSet>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        "SELECT s.WeightKg, s.Reps, s.Rir FROM dbo.Sets s
         WHERE s.WorkoutExerciseId = (
            SELECT TOP 1 we.Id FROM dbo.WorkoutExercises we
            JOIN dbo.Workouts w ON w.Id = we.WorkoutId
            WHERE w.UserId = @P1 AND we.ExerciseId = @P2
            ORDER BY w.[Date] DESC, we.Id DESC)
         ORDER BY s.Position",
        &[&user_id, &exercise_id],
    )
    .await?;
    Ok(Json(rows.iter().map(to_set).collect::<ApiResult<_>>()?))
}

// How many sets hit each muscle lately, for the muscle map. Muscles with none are left out
pub async fn muscle_sets(
    AuthUser(user_id, mut db): AuthUser,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Json<Vec<MuscleSets>>> {
    let days = q.days.unwrap_or(30).clamp(1, 365);
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        // 1e0 and 5e-1 are FLOAT literals, so the sum comes back as a float, not a DECIMAL
        "SELECT m.Muscle, SUM(CASE WHEN m.Role = 'primary' THEN 1e0 ELSE 5e-1 END) AS Sets
         FROM dbo.Workouts w
         JOIN dbo.WorkoutExercises we ON we.WorkoutId = w.Id
         JOIN dbo.Sets s ON s.WorkoutExerciseId = we.Id
         JOIN dbo.ExerciseMuscles m ON m.ExerciseId = we.ExerciseId
         WHERE w.UserId = @P1 AND w.[Date] >= DATEADD(day, -@P2, SYSUTCDATETIME())
         GROUP BY m.Muscle",
        &[&user_id, &days],
    )
    .await?;
    let mut out = Vec::new();
    for r in &rows {
        out.push(MuscleSets {
            muscle: col::<&str>(r, "Muscle")?.to_string(),
            sets: col(r, "Sets")?,
        });
    }
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NewSet, NewWorkoutExercise};

    fn workout(weight_kg: f64, reps: i32, client_id: Option<&str>) -> NewWorkout {
        NewWorkout {
            name: " Push day ".into(),
            date: chrono::Utc::now(),
            notes: None,
            client_id: client_id.map(String::from),
            duration_sec: Some(3600),
            exercises: vec![NewWorkoutExercise {
                exercise_id: 1,
                sets: vec![NewSet {
                    weight_kg,
                    reps,
                    rir: Some(2),
                }],
            }],
        }
    }

    #[test]
    fn workouts_are_checked() {
        let id = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
        assert_eq!(check_workout(&workout(62.5, 8, Some(id))), Ok("Push day"));
        assert!(
            check_workout(&workout(62.5, 8, None)).is_ok(),
            "no client id"
        );
        assert!(check_workout(&workout(62.5, 0, None)).is_err(), "zero reps");
        assert!(
            check_workout(&workout(-1.0, 8, None)).is_err(),
            "negative weight"
        );
        assert!(
            check_workout(&workout(f64::NAN, 8, None)).is_err(),
            "NaN weight"
        );
        assert!(
            check_workout(&workout(62.5, 8, Some("abc"))).is_err(),
            "bad client id"
        );
    }
}
