-- Parts 10 to 12: run once, connected as your ADMIN user (not gym_app).
-- Replace the password with the output of: openssl rand -base64 24
-- Change GymApp if your DB_NAME differs.

-- Part 10: a login that can only read/write the app's two tables
CREATE LOGIN gym_app WITH PASSWORD = '<a long random password>';
GO
USE GymApp;
GO
CREATE USER gym_app FOR LOGIN gym_app;
-- No DELETE on Users: delete_account only sets Active = 0
GRANT SELECT, INSERT, UPDATE ON dbo.Users TO gym_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Workouts TO gym_app;
GO

-- Part 11: row-level security on dbo.Workouts
CREATE SCHEMA Security;
GO
-- Returns a row (= allowed) only when the workout belongs to the connection's user
CREATE FUNCTION Security.fn_workout_owner(@UserId INT)
    RETURNS TABLE
    WITH SCHEMABINDING
AS
    RETURN SELECT 1 AS allowed
    WHERE @UserId = CAST(SESSION_CONTEXT(N'UserId') AS INT);
GO
CREATE SECURITY POLICY Security.WorkoutPolicy
    ADD FILTER PREDICATE Security.fn_workout_owner(UserId) ON dbo.Workouts,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.Workouts AFTER INSERT,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.Workouts AFTER UPDATE
    WITH (STATE = ON);
GO

-- Part 12: the calorie and workout tracker tables (run after the API has created them)
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.FoodEntries TO gym_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.WorkoutSets TO gym_app;
-- Every user shares the exercise library; the app can read it but never change it
GRANT SELECT ON dbo.Exercises TO gym_app;
-- The barcode cache is shared too; no DELETE, entries are refreshed in place
GRANT SELECT, INSERT, UPDATE ON dbo.FoodProducts TO gym_app;
GO
-- fn_workout_owner only checks UserId, so it works for any table that has one
ALTER SECURITY POLICY Security.WorkoutPolicy
    ADD FILTER PREDICATE Security.fn_workout_owner(UserId) ON dbo.FoodEntries,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.FoodEntries AFTER INSERT,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.FoodEntries AFTER UPDATE,
    ADD FILTER PREDICATE Security.fn_workout_owner(UserId) ON dbo.WorkoutSets,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.WorkoutSets AFTER INSERT,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.WorkoutSets AFTER UPDATE;
GO
