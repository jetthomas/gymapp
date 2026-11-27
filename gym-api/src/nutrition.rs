use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{Datelike, NaiveDate};
use serde_json::Value;

use crate::extractors::{AuthUser, PlusUser};
use crate::models::{DayQuery, Food, FoodEntry, HealthProfile, NewFood};
use crate::passwords::{fits, plain};
use crate::state::{ApiResult, AppState, all_rows, col, internal, one_row, set_user};
use tiberius::Row;

// Everything here is health information: every query is tied to the member's own id from the token,
// row-level security repeats that check in the database, and no admin route reads these tables.

const GOALS: [&str; 4] = ["lose", "maintain", "lean_bulk", "bulk"];
const MEALS: [&str; 4] = ["breakfast", "lunch", "dinner", "snacks"];

// Far-off years make the database driver panic, and no member was born in 1850
pub fn sane(d: NaiveDate) -> bool {
    (1900..=2100).contains(&d.year())
}

fn bad(msg: &str) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, msg.to_string())
}

// Every field is optional; this only rejects values that make no sense
pub fn check_profile(p: &HealthProfile) -> Result<(), &'static str> {
    if p.goal.as_deref().is_some_and(|g| !GOALS.contains(&g)) {
        return Err("Pick a goal from the list.");
    }
    if p.sex
        .as_deref()
        .is_some_and(|s| s != "male" && s != "female")
    {
        return Err("Sex must be male, female or left blank.");
    }
    if p.birth_date.is_some_and(|d| !sane(d)) || p.today.is_some_and(|d| !sane(d)) {
        return Err("That date is out of range.");
    }
    if p.height_cm.is_some_and(|h| !(50.0..=272.0).contains(&h)) {
        return Err("Height must be 50 to 272 cm.");
    }
    if p.weight_kg.is_some_and(|w| !(20.0..=500.0).contains(&w)) {
        return Err("Weight must be 20 to 500 kg.");
    }
    if p.activity.is_some_and(|a| !(1..=5).contains(&a)) {
        return Err("Pick an activity level from the list.");
    }
    if p.kcal_target.is_some_and(|k| !(800..=10_000).contains(&k)) {
        return Err("A calorie target must be 800 to 10,000.");
    }
    Ok(())
}

// The limits every stored food meets, whether a member typed it or it came from a barcode
fn check_food_values(name: &str, kcal: i32, grams: [f64; 3]) -> Result<(), &'static str> {
    if name.is_empty() || !fits(name, 100) {
        return Err("Food name must be 1 to 100 characters.");
    }
    if !plain(name, false) {
        return Err("Food name can't contain hidden or control characters.");
    }
    if !(0..=10_000).contains(&kcal) {
        return Err("Calories must be 0 to 10,000.");
    }
    // NaN fails every comparison, so this rejects it too
    if grams.iter().any(|g| !(0.0..=2000.0).contains(g)) {
        return Err("Macros must be 0 to 2,000 g.");
    }
    Ok(())
}

// Checks a food entry before it is saved; returns the trimmed name
pub fn check_food(f: &NewFood) -> Result<&str, &'static str> {
    let name = f.name.trim();
    check_food_values(name, f.kcal, [f.protein_g, f.carbs_g, f.fat_g])?;
    if !MEALS.contains(&f.meal.as_str()) {
        return Err("Pick a meal from the list.");
    }
    if !sane(f.date) {
        return Err("That date is out of range.");
    }
    Ok(name)
}

// A food's name, calories and macros, from a FoodEntries row
pub fn to_food(r: &Row) -> ApiResult<Food> {
    Ok(Food {
        name: col::<&str>(r, "Name")?.to_string(),
        kcal: col(r, "Kcal")?,
        protein_g: col(r, "ProteinG")?,
        carbs_g: col(r, "CarbsG")?,
        fat_g: col(r, "FatG")?,
    })
}

// The member's answers and their latest weight; null until they have saved some
pub async fn get_health(
    AuthUser(user_id, mut db): AuthUser,
) -> ApiResult<Json<Option<HealthProfile>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let row = one_row(
        &mut db,
        "SELECT p.Goal, p.BirthDate, p.Sex, p.HeightCm, p.Activity, p.KcalTarget,
           (SELECT TOP 1 Kg FROM dbo.BodyWeights b WHERE b.UserId = p.UserId ORDER BY b.[Date] DESC) AS WeightKg
         FROM dbo.Profiles p WHERE p.UserId = @P1",
        &[&user_id],
    )
    .await?;
    Ok(Json(row.map(|r| HealthProfile {
        goal: r.get::<&str, _>("Goal").map(str::to_string),
        birth_date: r.get("BirthDate"),
        sex: r.get::<&str, _>("Sex").map(str::to_string),
        height_cm: r.get("HeightCm"),
        activity: r.get("Activity"),
        kcal_target: r.get("KcalTarget"),
        weight_kg: r.get("WeightKg"),
        today: None,
    })))
}

pub async fn put_health(
    AuthUser(user_id, mut db): AuthUser,
    Json(p): Json<HealthProfile>,
) -> ApiResult<StatusCode> {
    check_profile(&p).map_err(bad)?;
    set_user(&mut db, user_id).await.map_err(internal)?;
    // Update the member's row, or make it the first time. UPDLOCK + HOLDLOCK lock the row,
    // or the gap where it would go, so two first saves at once can't both INSERT (a duplicate key, 500)
    db.execute(
        "BEGIN TRANSACTION;
         UPDATE dbo.Profiles WITH (UPDLOCK, HOLDLOCK) SET Goal = @P2, BirthDate = @P3, Sex = @P4,
                HeightCm = @P5, Activity = @P6, KcalTarget = @P7
         WHERE UserId = @P1;
         IF @@ROWCOUNT = 0
            INSERT INTO dbo.Profiles (UserId, Goal, BirthDate, Sex, HeightCm, Activity, KcalTarget)
            VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7);
         COMMIT;",
        &[
            &user_id,
            &p.goal,
            &p.birth_date,
            &p.sex,
            &p.height_cm,
            &p.activity,
            &p.kcal_target,
        ],
    )
    .await
    .map_err(internal)?;
    // A weight is one row per day in the weight log; `today` is the member's own date, not the server's
    if let (Some(kg), Some(day)) = (p.weight_kg, p.today) {
        db.execute(
            // Locked the same way as the profile above
            "BEGIN TRANSACTION;
             UPDATE dbo.BodyWeights WITH (UPDLOCK, HOLDLOCK) SET Kg = @P3
             WHERE UserId = @P1 AND [Date] = @P2;
             IF @@ROWCOUNT = 0
                INSERT INTO dbo.BodyWeights (UserId, [Date], Kg) VALUES (@P1, @P2, @P3);
             COMMIT;",
            &[&user_id, &day, &kg],
        )
        .await
        .map_err(internal)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

// Removes everything this file stores about the member, for good
pub async fn delete_health(AuthUser(user_id, mut db): AuthUser) -> ApiResult<StatusCode> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    db.execute(
        "DELETE FROM dbo.FoodEntries WHERE UserId = @P1;
         DELETE FROM dbo.BodyWeights WHERE UserId = @P1;
         DELETE FROM dbo.Profiles WHERE UserId = @P1;",
        &[&user_id],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_food(
    AuthUser(user_id, mut db): AuthUser,
    Query(q): Query<DayQuery>,
) -> ApiResult<Json<Vec<FoodEntry>>> {
    if !sane(q.date) {
        return Err(bad("That date is out of range."));
    }
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        "SELECT Id, Meal, Name, Kcal, ProteinG, CarbsG, FatG FROM dbo.FoodEntries
         WHERE UserId = @P1 AND [Date] = @P2 ORDER BY Id",
        &[&user_id, &q.date],
    )
    .await?;
    let mut out = Vec::new();
    for r in &rows {
        out.push(FoodEntry {
            id: col(r, "Id")?,
            meal: col::<&str>(r, "Meal")?.to_string(),
            food: to_food(r)?,
        });
    }
    Ok(Json(out))
}

// The 20 foods the member logged most recently, each once, to add again in one tap
pub async fn recent_food(AuthUser(user_id, mut db): AuthUser) -> ApiResult<Json<Vec<Food>>> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let rows = all_rows(
        &mut db,
        "SELECT TOP 20 Name, Kcal, ProteinG, CarbsG, FatG FROM dbo.FoodEntries
         WHERE UserId = @P1
         GROUP BY Name, Kcal, ProteinG, CarbsG, FatG
         ORDER BY MAX(Id) DESC",
        &[&user_id],
    )
    .await?;
    Ok(Json(rows.iter().map(to_food).collect::<ApiResult<_>>()?))
}

pub async fn add_food(
    AuthUser(user_id, mut db): AuthUser,
    Json(f): Json<NewFood>,
) -> ApiResult<StatusCode> {
    let name = check_food(&f).map_err(bad)?;
    set_user(&mut db, user_id).await.map_err(internal)?;
    // A cap per day, so one account can't fill the database's disk
    let count: i32 = one_row(
        &mut db,
        "SELECT COUNT(*) FROM dbo.FoodEntries WHERE UserId = @P1 AND [Date] = @P2",
        &[&user_id, &f.date],
    )
    .await?
    .and_then(|r| r.get(0))
    .unwrap_or(0);
    if count >= 100 {
        return Err(bad("That day is full: 100 entries is the limit."));
    }
    db.execute(
        "INSERT INTO dbo.FoodEntries (UserId, [Date], Meal, Name, Kcal, ProteinG, CarbsG, FatG)
         VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8)",
        &[
            &user_id,
            &f.date,
            &f.meal.as_str(),
            &name,
            &f.kcal,
            &f.protein_g,
            &f.carbs_g,
            &f.fat_g,
        ],
    )
    .await
    .map_err(internal)?;
    Ok(StatusCode::CREATED)
}

pub async fn delete_food(
    AuthUser(user_id, mut db): AuthUser,
    Path(id): Path<i32>,
) -> ApiResult<StatusCode> {
    set_user(&mut db, user_id).await.map_err(internal)?;
    let done = db
        .execute(
            "DELETE FROM dbo.FoodEntries WHERE Id = @P1 AND UserId = @P2",
            &[&id, &user_id],
        )
        .await
        .map_err(internal)?;
    if done.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "Entry not found.".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// Changes a logged food's name, calories and macros. Its day and meal stay, so the per-day cap holds
pub async fn update_food(
    AuthUser(user_id, mut db): AuthUser,
    Path(id): Path<i32>,
    Json(f): Json<NewFood>,
) -> ApiResult<StatusCode> {
    let name = check_food(&f).map_err(bad)?;
    set_user(&mut db, user_id).await.map_err(internal)?;
    let done = db
        .execute(
            "UPDATE dbo.FoodEntries SET Name = @P1, Kcal = @P2, ProteinG = @P3, CarbsG = @P4, FatG = @P5
             WHERE Id = @P6 AND UserId = @P7",
            &[&name, &f.kcal, &f.protein_g, &f.carbs_g, &f.fat_g, &id, &user_id],
        )
        .await
        .map_err(internal)?;
    if done.total() == 0 {
        return Err((StatusCode::NOT_FOUND, "Entry not found.".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
// Plus: a packaged food by its barcode, per 100 g. Looked up on Open Food Facts the first time,
// then kept in dbo.BarcodeFoods, so repeat scans are instant and stay under their limit
// of 15 product reads a minute. API: https://openfoodfacts.github.io/openfoodfacts-server/api/
pub async fn barcode_food(
    State(state): State<Arc<AppState>>,
    PlusUser(_, mut db): PlusUser,
    Path(code): Path<String>,
) -> ApiResult<Json<Food>> {
    // EAN-8, UPC-A (12), EAN-13 and GTIN-14 are 8 to 14 digits
    if !(8..=14).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad("That isn't a food barcode."));
    }
    // Not member data, so no set_user: every member shares one cache
    if let Some(r) = one_row(
        &mut db,
        "SELECT Name, Kcal, ProteinG, CarbsG, FatG FROM dbo.BarcodeFoods WHERE Code = @P1",
        &[&code.as_str()],
    )
    .await?
    {
        return Ok(Json(to_food(&r)?));
    }
    let not_found = || {
        (
            StatusCode::NOT_FOUND,
            "We couldn't find that food. Type it in instead.".to_string(),
        )
    };
    // v2, not v3: v3.6 answers this request with an empty nutriments object
    let res = state
        .http
        .get(format!(
            "https://world.openfoodfacts.org/api/v2/product/{code}.json"
        ))
        .query(&[("fields", "product_name,nutriments")])
        .header(reqwest::header::USER_AGENT, &state.food_user_agent)
        .send()
        .await
        .map_err(internal)?;
    // An unknown barcode is a 404 with {"status":0}; anything else not OK (503 = their limit) is a retry later
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(not_found());
    }
    if !res.status().is_success() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "The food database is busy. Try again in a minute.".to_string(),
        ));
    }
    let body: Value = res.json().await.map_err(internal)?;
    if body["status"].as_i64() != Some(1) {
        return Err(not_found());
    }
    let product = &body["product"];
    let n = &product["nutriments"];
    let mut name = product["product_name"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    // FoodEntries.Name holds 100; leave room for " (100 g)"
    while !fits(&name, 92) {
        name.pop();
    }
    let Some(kcal) = n["energy-kcal_100g"].as_f64() else {
        return Err(not_found());
    };
    let grams = |key: &str| n[key].as_f64().unwrap_or(0.0);
    let food = Food {
        name: format!("{name} (100 g)"),
        kcal: kcal.round() as i32,
        protein_g: grams("proteins_100g"),
        carbs_g: grams("carbohydrates_100g"),
        fat_g: grams("fat_100g"),
    };
    // Outside data gets the same checks as a member's own entry; `name` is the product's own, without " (100 g)"
    if name.is_empty()
        || check_food_values(
            &food.name,
            food.kcal,
            [food.protein_g, food.carbs_g, food.fat_g],
        )
        .is_err()
    {
        return Err(not_found());
    }
    // Two members scanning the same new food at once: the second insert fails, which is fine
    if let Err(e) = db
        .execute(
            "INSERT INTO dbo.BarcodeFoods (Code, Name, Kcal, ProteinG, CarbsG, FatG)
             VALUES (@P1, @P2, @P3, @P4, @P5, @P6)",
            &[
                &code.as_str(),
                &food.name.as_str(),
                &food.kcal,
                &food.protein_g,
                &food.carbs_g,
                &food.fat_g,
            ],
        )
        .await
    {
        eprintln!("barcode cache: {e}");
    }
    Ok(Json(food))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn food(name: &str, meal: &str, kcal: i32, protein_g: f64) -> NewFood {
        NewFood {
            date: NaiveDate::from_ymd_opt(2026, 11, 17).unwrap(),
            meal: meal.into(),
            name: name.into(),
            kcal,
            protein_g,
            carbs_g: 0.0,
            fat_g: 0.0,
        }
    }

    #[test]
    fn food_is_checked() {
        assert_eq!(
            check_food(&food(" Oats ", "breakfast", 300, 10.0)),
            Ok("Oats")
        );
        assert!(
            check_food(&food("", "breakfast", 300, 10.0)).is_err(),
            "no name"
        );
        assert!(
            check_food(&food("Oats\u{7}", "breakfast", 300, 10.0)).is_err(),
            "control character"
        );
        assert!(
            check_food(&food("Oats", "brunch", 300, 10.0)).is_err(),
            "unknown meal"
        );
        assert!(
            check_food(&food("Oats", "lunch", -1, 10.0)).is_err(),
            "negative calories"
        );
        assert!(
            check_food(&food("Oats", "lunch", 300, f64::NAN)).is_err(),
            "NaN macro"
        );
    }

    #[test]
    fn barcode_foods_meet_the_same_limits() {
        assert!(check_food_values("Oats (100 g)", 389, [16.9, 66.3, 6.9]).is_ok());
        assert!(
            check_food_values("Oats (100 g)", 389, [2001.0, 0.0, 0.0]).is_err(),
            "too much protein"
        );
        assert!(
            check_food_values("Oats (100 g)", 10_001, [0.0; 3]).is_err(),
            "too many calories"
        );
    }

    #[test]
    fn profiles_are_checked() {
        let blank = HealthProfile {
            goal: None,
            birth_date: None,
            sex: None,
            height_cm: None,
            activity: None,
            kcal_target: None,
            weight_kg: None,
            today: None,
        };
        assert!(check_profile(&blank).is_ok(), "every field is optional");
        assert!(
            check_profile(&HealthProfile {
                goal: Some("shred".into()),
                ..blank
            })
            .is_err(),
            "unknown goal"
        );
    }
}
