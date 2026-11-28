// Routines: a member's own workout plans. Each lists exercises in order, with how many sets of
// each and the reps, weight and RIR to aim for; the Workout tab starts a workout from one in a tap
use axum::{Json, extract::Path, http::StatusCode};

use crate::extractors::{AuthUser, Member};
use crate::models::{NewRoutine, Routine, RoutineExercise};
use crate::passwords::{fits, plain};
use crate::state::{ApiResult, Db, all_rows, batch, col, count_rows, internal, one_row, set_user};
use crate::workouts::check_exercises;

// Free members keep this many; Plus members up to MAX_ROUTINES, a cap so one account can't fill the disk
const FREE_ROUTINES: i32 = 3;
const MAX_ROUTINES: i32 = 100;

// Checks a routine before it is saved; returns the trimmed name
pub fn check_routine(r: &NewRoutine) -> Result<&str, String> {
    let name = r.name.trim();
    if name.is_empty() || !fits(name, 200) {
        return Err("Routine name must be 1 to 200 characters.".into());
    }
    if !plain(name, false) {
        return Err("Routine name can't contain hidden or control characters.".into());
    }
    if r.exercises.is_empty() || r.exercises.len() > 50 {
        return Err("A routine holds 1 to 50 exercises.".into());
    }
    for e in &r.exercises {
        if !(1..=20).contains(&e.sets) {
            return Err("Sets must be 1 to 20.".into());
        }
        if e.reps.is_some_and(|n| !(1..=1000).contains(&n)) {
            return Err("Reps must be 1 to 1000.".into());
        }
        // NaN fails every comparison, so this rejects it too
        if e.weight_kg.is_some_and(|w| !(0.0..=1000.0).contains(&w)) {
            return Err("Weight must be 0 to 1000 kg.".into());
        }
        if e.rir.is_some_and(|n| !(0..=10).contains(&n)) {
            return Err("RIR must be 0 to 10.".into());
        }
    }
    Ok(name)
}

pub async fn list_routines(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<Vec<Routine>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        "SELECT r.Id, r.Name, re.ExerciseId, e.Name AS ExerciseName, e.Equipment, re.Sets, re.Reps,
                re.WeightKg, re.Rir, re.SupersetWithNext
         FROM dbo.Routines r
         LEFT JOIN dbo.RoutineExercises re ON re.RoutineId = r.Id
         LEFT JOIN dbo.Exercises e ON e.Id = re.ExerciseId
         WHERE r.UserId = @P1
         ORDER BY r.Name, r.Id, re.Position",
        &[&user_id],
    )
    .await?;
    // One row per exercise; rows for the same routine arrive together
    let mut out: Vec<Routine> = Vec::new();
    for r in &rows {
        let id: i32 = col(r, "Id")?;
        if out.last().map(|x| x.id) != Some(id) {
            out.push(Routine {
                id,
                name: col::<&str>(r, "Name")?.to_string(),
                exercises: vec![],
            });
        }
        // A routine whose exercises were all deleted from the library comes back as one empty row
        if let (Some(routine), Some(exercise_id)) = (out.last_mut(), r.get::<i32, _>("ExerciseId"))
        {
            routine.exercises.push(RoutineExercise {
                exercise_id,
                name: col::<&str>(r, "ExerciseName")?.to_string(),
                equipment: r.get::<&str, _>("Equipment").map(String::from),
                sets: col(r, "Sets")?,
                reps: r.get("Reps"),
                weight_kg: r.get("WeightKg"),
                rir: r.get("Rir"),
                superset_with_next: col(r, "SupersetWithNext")?,
            });
        }
    }
    Ok(Json(out))
}

// Writes a routine's exercises, in order. The caller has the transaction open
async fn insert_items(db: &mut Db, routine_id: i32, r: &NewRoutine) -> ApiResult<()> {
    for (i, e) in r.exercises.iter().enumerate() {
        db.execute(
            "INSERT INTO dbo.RoutineExercises
                (RoutineId, ExerciseId, Position, Sets, Reps, WeightKg, Rir, SupersetWithNext)
             VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8)",
            &[
                &routine_id,
                &e.exercise_id,
                &(i as i32),
                &e.sets,
                &e.reps,
                &e.weight_kg,
                &e.rir,
                &e.superset_with_next,
            ],
        )
        .await
        .map_err(internal)?;
    }
    Ok(())
}

pub async fn create_routine(
    Member(user_id, plus, mut db): Member,
    Json(r): Json<NewRoutine>,
) -> ApiResult<StatusCode> {
    let name = check_routine(&r).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    set_user(&mut db, user_id).await.map_err(internal)?;
    let count = count_rows(
        &mut db,
        "SELECT COUNT(*) FROM dbo.Routines WHERE UserId = @P1",
        &[&user_id],
    )
    .await?;
    if !plus && count >= FREE_ROUTINES {
        return Err((
            StatusCode::FORBIDDEN,
            "Free members can keep 3 routines. Upgrade to Plus for more.".into(),
        ));
    }
    if count >= MAX_ROUTINES {
        return Err((
            StatusCode::BAD_REQUEST,
            "You can keep up to 100 routines.".into(),
        ));
    }
    check_exercises(&mut db, user_id, r.exercises.iter().map(|e| e.exercise_id)).await?;
    // If anything fails before COMMIT, the connection closes and SQL Server undoes it all
    batch(&mut db, "BEGIN TRANSACTION").await?;
    let id: i32 = one_row(
        &mut db,
        "INSERT INTO dbo.Routines (UserId, Name) OUTPUT INSERTED.Id VALUES (@P1, @P2)",
        &[&user_id, &name],
    )
    .await?
    .and_then(|r| r.get(0))
    .ok_or_else(|| internal("insert returned no Id"))?;
    insert_items(&mut db, id, &r).await?;
    batch(&mut db, "COMMIT").await?;
    Ok(StatusCode::CREATED)
}

// Renames a routine and replaces what's in it. Editing one is allowed past the free cap
pub async fn update_routine(
    AuthUser(user_id, mut db): AuthUser,
    Path(id): Path<i32>,
    Json(r): Json<NewRoutine>, // Json must be the last argument
) -> ApiResult<StatusCode> {
    let name = check_routine(&r).map_err(|msg| (StatusCode::BAD_REQUEST, msg))?;
    set_user(&mut db, user_id).await.map_err(internal)?;
    check_exercises(&mut db, user_id, r.exercises.iter().map(|e| e.exercise_id)).await?;
    // Same as create: an early return closes the connection, which undoes the transaction
    batch(&mut db, "BEGIN TRANSACTION").await?;
    let updated = db
        .execute(
            "UPDATE dbo.Routines SET Name = @P3 WHERE Id = @P1 AND UserId = @P2",
            &[&id, &user_id, &name],
        )
        .await
        .map_err(internal)?;
    if updated.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "Routine not found.".into()));
    }
    db.execute(
        "DELETE FROM dbo.RoutineExercises WHERE RoutineId = @P1",
        &[&id],
    )
    .await
    .map_err(internal)?;
    insert_items(&mut db, id, &r).await?;
    batch(&mut db, "COMMIT").await?;
    Ok(StatusCode::OK)
}

pub async fn delete_routine(
    AuthUser(user_id, mut db): AuthUser,
    Path(id): Path<i32>,
) -> ApiResult<StatusCode> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    // Its exercises cascade
    let done = db
        .execute(
            "DELETE FROM dbo.Routines WHERE Id = @P1 AND UserId = @P2",
            &[&id, &user_id],
        )
        .await
        .map_err(internal)?;
    if done.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "Routine not found.".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::RoutineItem;

    fn routine(name: &str, sets: i32, reps: Option<i32>) -> NewRoutine {
        NewRoutine {
            name: name.into(),
            exercises: vec![RoutineItem {
                exercise_id: 1,
                sets,
                reps,
                weight_kg: Some(80.0),
                rir: Some(2),
                superset_with_next: false,
            }],
        }
    }

    #[test]
    fn routines_are_checked() {
        assert_eq!(
            check_routine(&routine(" Push A ", 3, Some(8))),
            Ok("Push A")
        );
        assert!(
            check_routine(&routine("Pull", 4, None)).is_ok(),
            "no rep target"
        );
        assert!(check_routine(&routine("  ", 3, None)).is_err(), "no name");
        assert!(check_routine(&routine("Legs", 0, None)).is_err(), "no sets");
        assert!(
            check_routine(&routine("Legs", 21, None)).is_err(),
            "too many sets"
        );
        assert!(
            check_routine(&routine("Legs", 3, Some(0))).is_err(),
            "zero reps"
        );
        assert!(
            check_routine(&routine("Legs\u{202E}", 3, None)).is_err(),
            "bidi override in name"
        );
        let mut heavy = routine("Legs", 3, None);
        heavy.exercises[0].weight_kg = Some(1000.5);
        assert!(check_routine(&heavy).is_err(), "too heavy");
        heavy.exercises[0].weight_kg = Some(f64::NAN);
        assert!(check_routine(&heavy).is_err(), "NaN weight");
        heavy.exercises[0].weight_kg = None;
        heavy.exercises[0].rir = Some(11);
        assert!(check_routine(&heavy).is_err(), "RIR past 10");
        heavy.exercises[0].rir = None;
        assert!(check_routine(&heavy).is_ok(), "no weight or RIR target");
        let mut empty = routine("Legs", 3, None);
        empty.exercises.clear();
        assert!(check_routine(&empty).is_err(), "no exercises");
    }
}
