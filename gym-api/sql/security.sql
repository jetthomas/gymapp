-- Parts 10 and 11: run once, connected as your ADMIN user (not gym_app), after schema.sql.
-- Replace the password with the output of: openssl rand -base64 24
-- Change Gym_App if your DB_NAME differs.

-- Part 10: a login that can only read/write the app's tables
CREATE LOGIN gym_app WITH PASSWORD = '<a long random password>';
GO
USE Gym_App;
GO
CREATE USER gym_app FOR LOGIN gym_app;
-- No DELETE on Users: deactivating sets Active = 0, and deleting goes through dbo.DeleteMember (below)
GRANT SELECT, INSERT, UPDATE ON dbo.Users TO gym_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Workouts TO gym_app;
GRANT SELECT, INSERT ON dbo.Events TO gym_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.RecoveryCodes TO gym_app;
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

-- A workout's exercises and sets; no row-level security, because every query reaches them
-- through a workout that was already checked as the member's own
GRANT SELECT, INSERT, DELETE ON dbo.WorkoutExercises TO gym_app;
GRANT SELECT, INSERT, DELETE ON dbo.Sets TO gym_app;
GO

-- Exercise library: one shared list. Every member reads it; only admins change it,
-- which the API enforces (AdminUser), so there's no row-level security here
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Exercises TO gym_app;
GRANT SELECT, INSERT, DELETE ON dbo.ExerciseMuscles TO gym_app;
GO

-- Calories: the member's own health data
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Profiles TO gym_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.BodyWeights TO gym_app;
GRANT SELECT, INSERT, DELETE ON dbo.FoodEntries TO gym_app;
GO
-- The same owner check as workouts: a connection only sees its own member's rows
ALTER SECURITY POLICY Security.WorkoutPolicy
    ADD FILTER PREDICATE Security.fn_workout_owner(UserId) ON dbo.Profiles,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.Profiles AFTER INSERT,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.Profiles AFTER UPDATE,
    ADD FILTER PREDICATE Security.fn_workout_owner(UserId) ON dbo.BodyWeights,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.BodyWeights AFTER INSERT,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.BodyWeights AFTER UPDATE,
    ADD FILTER PREDICATE Security.fn_workout_owner(UserId) ON dbo.FoodEntries,
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.FoodEntries AFTER INSERT;
GO

-- BarMetric Plus: the shared barcode cache (Users already has SELECT, INSERT, UPDATE above)
GRANT SELECT, INSERT ON dbo.BarcodeFoods TO gym_app;
GO

-- Calories: editing a logged food (PUT /me/food/{id}). Already set up? Run just this part:
-- the UPDATE right, and the same owner check as Profiles and BodyWeights
GRANT UPDATE ON dbo.FoodEntries TO gym_app;
GO
ALTER SECURITY POLICY Security.WorkoutPolicy
    ADD BLOCK PREDICATE Security.fn_workout_owner(UserId) ON dbo.FoodEntries AFTER UPDATE;
GO

-- Deleting an account. Already set up? Run just this part, after schema.sql has made the procedure.
-- An EXECUTE right, not DELETE on Users or Events: the procedure owns those deletes (ownership
-- chaining), and only for the member the connection is tagged with
GRANT EXECUTE ON dbo.DeleteMember TO gym_app;
GO
