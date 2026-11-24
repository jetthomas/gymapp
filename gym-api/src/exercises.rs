use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
};

use crate::extractors::{AdminUser, AuthUser};
use crate::models::{Exercise, ExerciseQuery, NewExercise};
use crate::passwords::{fits, plain};
use crate::state::{ApiResult, Db, all_rows, batch, col, internal, one_row};

// The 17 muscle names free-exercise-db uses; admin-added exercises pick from the same list
pub const MUSCLES: [&str; 17] = [
    "abdominals",
    "abductors",
    "adductors",
    "biceps",
    "calves",
    "chest",
    "forearms",
    "glutes",
    "hamstrings",
    "lats",
    "lower back",
    "middle back",
    "neck",
    "quadriceps",
    "shoulders",
    "traps",
    "triceps",
];

// Checks an exercise before it is saved; returns the trimmed name
pub fn check_exercise(e: &NewExercise) -> Result<&str, String> {
    let name = e.name.trim();
    if name.is_empty() || !fits(name, 100) {
        return Err("Exercise name must be 1 to 100 characters.".into());
    }
    if !plain(name, false) || e.equipment.as_deref().is_some_and(|q| !plain(q, false)) {
        return Err("Names can't contain hidden or control characters.".into());
    }
    if e.primary_muscles.is_empty() {
        return Err("Pick at least one main muscle.".into());
    }
    let all: Vec<&String> = e
        .primary_muscles
        .iter()
        .chain(&e.secondary_muscles)
        .collect();
    if all.iter().any(|m| !MUSCLES.contains(&m.as_str())) {
        return Err("Pick muscles from the list.".into());
    }
    // The table's key is (exercise, muscle), so each muscle may appear once in total
    let unique: std::collections::HashSet<&String> = all.iter().copied().collect();
    if unique.len() != all.len() {
        return Err("Each muscle can only be picked once.".into());
    }
    if e.equipment.as_deref().is_some_and(|q| !fits(q, 30)) {
        return Err("Equipment must be 30 characters or fewer.".into());
    }
    Ok(name)
}

// Every member can read the shared list; only admins change it (the routes below)
pub async fn list_exercises(
    AuthUser(_, mut db): AuthUser,
    Query(f): Query<ExerciseQuery>,
) -> ApiResult<Json<Vec<Exercise>>> {
    let q = f.q.unwrap_or_default();
    let muscle = f.muscle.unwrap_or_default();
    // No name is over 100 characters, so a longer search can't match anything
    if !fits(&q, 100) || (!muscle.is_empty() && !MUSCLES.contains(&muscle.as_str())) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Search up to 100 characters, and pick a muscle from the list.".into(),
        ));
    }
    let rows = all_rows(
        &mut db,
        "SELECT e.Id, e.Name, e.Equipment, m.Muscle, m.Role
         FROM dbo.Exercises e
         LEFT JOIN dbo.ExerciseMuscles m ON m.ExerciseId = e.Id
         WHERE (@P1 = N'' OR e.Name LIKE N'%' + @P1 + N'%')
           AND (@P2 = N'' OR EXISTS (SELECT 1 FROM dbo.ExerciseMuscles x
                                     WHERE x.ExerciseId = e.Id AND x.Muscle = @P2))
         ORDER BY e.Name, e.Id",
        &[&q.as_str(), &muscle.as_str()],
    )
    .await?;
    // One row per muscle; rows for the same exercise arrive together
    let mut out: Vec<Exercise> = Vec::new();
    for r in &rows {
        let id: i32 = col(r, "Id")?;
        if out.last().map(|e| e.id) != Some(id) {
            out.push(Exercise {
                id,
                name: col::<&str>(r, "Name")?.to_string(),
                equipment: r.get::<&str, _>("Equipment").map(str::to_string),
                primary_muscles: vec![],
                secondary_muscles: vec![],
            });
        }
        if let (Some(e), Some(m), Some(role)) = (
            out.last_mut(),
            r.get::<&str, _>("Muscle"),
            r.get::<&str, _>("Role"),
        ) {
            if role == "primary" {
                e.primary_muscles.push(m.to_string());
            } else {
                e.secondary_muscles.push(m.to_string());
            }
        }
    }
    Ok(Json(out))
}

// Writes an exercise's muscle rows; the caller has already cleared any old ones
async fn save_muscles(db: &mut Db, id: i32, e: &NewExercise) -> ApiResult<()> {
    for (muscles, role) in [
        (&e.primary_muscles, "primary"),
        (&e.secondary_muscles, "secondary"),
    ] {
        for m in muscles {
            db.execute(
                "INSERT INTO dbo.ExerciseMuscles (ExerciseId, Muscle, Role) VALUES (@P1, @P2, @P3)",
                &[&id, &m.as_str(), &role],
            )
            .await
            .map_err(internal)?;
        }
    }
    Ok(())
}

pub async fn create_exercise(
    AdminUser(_, mut db): AdminUser,
    Json(e): Json<NewExercise>,
) -> ApiResult<StatusCode> {
    let name = check_exercise(&e).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    // If anything fails before COMMIT, the connection closes and SQL Server undoes it all
    batch(&mut db, "BEGIN TRANSACTION").await?;
    let id: i32 = one_row(
        &mut db,
        "INSERT INTO dbo.Exercises (Name, Equipment) OUTPUT INSERTED.Id VALUES (@P1, @P2)",
        &[&name, &e.equipment],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("insert returned no Id"))?;
    save_muscles(&mut db, id, &e).await?;
    batch(&mut db, "COMMIT").await?;
    Ok(StatusCode::CREATED)
}

pub async fn update_exercise(
    AdminUser(_, mut db): AdminUser,
    Path(id): Path<i32>,
    Json(e): Json<NewExercise>, // Json must be the last argument
) -> ApiResult<StatusCode> {
    let name = check_exercise(&e).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    // Same as create: an early return closes the connection, which undoes the transaction
    batch(&mut db, "BEGIN TRANSACTION").await?;
    let updated = db
        .execute(
            "UPDATE dbo.Exercises SET Name = @P2, Equipment = @P3 WHERE Id = @P1",
            &[&id, &name, &e.equipment],
        )
        .await
        .map_err(internal)?;
    if updated.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "Exercise not found.".into()));
    }
    db.execute(
        "DELETE FROM dbo.ExerciseMuscles WHERE ExerciseId = @P1",
        &[&id],
    )
    .await
    .map_err(internal)?;
    save_muscles(&mut db, id, &e).await?;
    batch(&mut db, "COMMIT").await?;
    Ok(StatusCode::OK)
}

pub async fn delete_exercise(
    AdminUser(_, mut db): AdminUser,
    Path(id): Path<i32>,
) -> ApiResult<StatusCode> {
    let done = db
        .execute("DELETE FROM dbo.Exercises WHERE Id = @P1", &[&id])
        .await
        .map(|r| r.total());
    match done {
        Ok(0) => Err((StatusCode::NOT_FOUND, "Exercise not found.".into())),
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        // 547 = a foreign key stopped it: the exercise is in a logged workout
        Err(tiberius::error::Error::Server(e)) if e.code() == 547 => Err((
            StatusCode::CONFLICT,
            "This exercise is in a logged workout, so it can't be deleted.".into(),
        )),
        Err(e) => Err(internal(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ex(name: &str, primary: &[&str], secondary: &[&str]) -> NewExercise {
        NewExercise {
            name: name.into(),
            equipment: None,
            primary_muscles: primary.iter().map(|s| s.to_string()).collect(),
            secondary_muscles: secondary.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn exercises_are_checked() {
        assert_eq!(
            check_exercise(&ex(" Cable fly ", &["chest"], &["shoulders"])),
            Ok("Cable fly")
        );
        assert!(
            check_exercise(&ex("", &["chest"], &[])).is_err(),
            "empty name"
        );
        assert!(
            check_exercise(&ex("Fly", &[], &["chest"])).is_err(),
            "no main muscle"
        );
        assert!(
            check_exercise(&ex("Fly", &["pecs"], &[])).is_err(),
            "unknown muscle"
        );
        assert!(
            check_exercise(&ex("Fly", &["chest"], &["chest"])).is_err(),
            "both lists"
        );
        assert!(
            check_exercise(&ex("Fly\u{0}", &["chest"], &[])).is_err(),
            "control character"
        );
    }
}
