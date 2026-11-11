-- Parts 10 and 11: run once, connected as your ADMIN user (not gym_app).
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

-- Speeds up each member's workout list (the gym_app login can't create indexes)
CREATE INDEX IX_Workouts_UserId_Date ON dbo.Workouts (UserId, [Date] DESC);
GO
