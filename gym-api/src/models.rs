use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
    // "Stay logged in"; old requests without the field still work
    #[serde(default)]
    pub remember: bool,
}

#[derive(Deserialize)]
pub struct ResetRequest {
    pub token: String,
    pub password: String,
    // Self-service links on a 2FA account need the current code too
    pub code: Option<String>,
}
#[derive(Serialize)]
pub struct MuscleSets {
    pub muscle: String,
    pub sets: f64,
}

#[derive(Deserialize)]
pub struct ForgotRequest {
    pub email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewUser {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub access_token: Option<String>,
    pub is_admin: bool,
    pub challenge: Option<String>,
    // So the frontend knows whether to offer "Turn on two-factor" after a page refresh
    pub two_factor: bool,
    // The previous sign-in and wrong passwords since; only set on a fresh sign-in
    pub last_login: Option<DateTime<Utc>>,
    pub failed_since: i32,
}

#[derive(Serialize)]
pub struct TotpSetup {
    pub qr: String,     // a PNG image, base64-encoded
    pub secret: String, // the same secret as text, for people who can't scan
}

#[derive(Deserialize)]
pub struct TokenRequest {
    pub token: String,
}

#[derive(Serialize)]
pub struct RecoveryCodes {
    pub codes: Vec<String>,
}

#[derive(Deserialize)]
pub struct PasswordChange {
    pub current: String,
    pub new: String,
}

#[derive(Deserialize)]
pub struct DisableRequest {
    pub password: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct PasswordOnly {
    pub password: String,
}

#[derive(Deserialize)]
pub struct CodeRequest {
    pub code: String,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub challenge: String,
    pub code: String,
    #[serde(default)]
    pub remember: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSet {
    pub weight_kg: f64,
    pub reps: i32,
    pub rir: Option<i32>, // reps in reserve; only sent when the member has "Show RIR" on
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorkoutExercise {
    pub exercise_id: i32,
    pub sets: Vec<NewSet>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorkout {
    pub name: String,
    pub date: DateTime<Utc>,
    pub notes: Option<String>,
    // Made on the phone, so a save that is sent twice is stored once
    pub client_id: Option<String>,
    pub duration_sec: Option<i32>,
    #[serde(default)]
    pub exercises: Vec<NewWorkoutExercise>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workout {
    pub id: i32,
    pub name: String,
    pub date: DateTime<Utc>,
    pub notes: Option<String>,
    pub duration_sec: Option<i32>,
    pub sets: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedSet {
    pub weight_kg: f64,
    pub reps: i32,
    pub rir: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedExercise {
    pub exercise_id: i32,
    pub name: String,
    pub sets: Vec<LoggedSet>,
}

// One workout with everything logged in it
#[derive(Serialize)]
pub struct WorkoutDetail {
    #[serde(flatten)]
    pub workout: Workout,
    pub exercises: Vec<LoggedExercise>,
}
#[derive(Deserialize)]
pub struct ExerciseQuery {
    pub q: Option<String>,
    pub muscle: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExercise {
    pub name: String,
    pub equipment: Option<String>,
    pub primary_muscles: Vec<String>,
    pub secondary_muscles: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exercise {
    pub id: i32,
    pub name: String,
    pub equipment: Option<String>,
    pub primary_muscles: Vec<String>,
    pub secondary_muscles: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub id: i32,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: String,
    pub active: bool,
    pub is_admin: bool,
    pub is_you: bool, // the admin who asked, so the screen can mark their own row
    pub totp_enabled: bool,
    pub logins: i32,
    pub last_login: Option<DateTime<Utc>>,
    pub failed_last_7d: i32,
    pub workouts: i32,
}

#[derive(Deserialize)]
pub struct StatsQuery {
    pub days: Option<i32>,
}

#[derive(Serialize)]
pub struct DayCount {
    pub day: String, // YYYY-MM-DD, gym time
    pub kind: String,
    pub n: i32,
}

#[derive(Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    // Login tokens only: must match Users.SessionVersion, so bumping it signs every session out
    #[serde(default)]
    pub ver: i32,
}

#[derive(Serialize)]
pub struct ResetLink {
    pub link: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminFlag {
    pub is_admin: bool,
}

// Who is logged in, for the Account screen
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: String,
}
