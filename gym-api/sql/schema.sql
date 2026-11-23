-- Every table, column and index the API uses. Run as your ADMIN user (not gym_app), before
-- security.sql. Safe to run again: it skips whatever already exists, so an existing database
-- only gets what's new (e.g. the Events indexes).
-- Change GymApp if your DB_NAME differs.
USE Gym_App;
GO

IF OBJECT_ID('dbo.Users', 'U') IS NULL
    CREATE TABLE dbo.Users (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Email NVARCHAR(256) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(512) NOT NULL,
        FirstName NVARCHAR(100) NULL,
        LastName NVARCHAR(100) NULL,
        Active BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        IsAdmin BIT NOT NULL DEFAULT 0,
        TotpSecret NVARCHAR(64) NULL,
        TotpEnabled BIT NOT NULL DEFAULT 0,
        SessionVersion INT NOT NULL DEFAULT 0,
        LastTotpStep BIGINT NULL,
        TotpFailures INT NOT NULL DEFAULT 0,
        LoginFailures INT NOT NULL DEFAULT 0,
        LockedUntil DATETIME2 NULL,
        EmailVerified BIT NOT NULL DEFAULT 0
    );
IF OBJECT_ID('dbo.Workouts', 'U') IS NULL
    CREATE TABLE dbo.Workouts (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL REFERENCES dbo.Users(Id),
        [Date] DATETIME2 NOT NULL,
        Name NVARCHAR(200) NOT NULL,
        Notes NVARCHAR(MAX) NULL,
        DurationSec INT NULL,
        ClientId VARCHAR(36) NOT NULL
            CONSTRAINT DF_Workouts_ClientId DEFAULT CONVERT(VARCHAR(36), NEWID()),
        -- One workout per (member, ClientId): a save that is sent twice is stored once
        CONSTRAINT UX_Workouts_User_Client UNIQUE (UserId, ClientId)
    );
IF OBJECT_ID('dbo.Events', 'U') IS NULL
    CREATE TABLE dbo.Events (
        Id BIGINT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL REFERENCES dbo.Users(Id),
        Kind NVARCHAR(20) NOT NULL,
        At DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
IF OBJECT_ID('dbo.RecoveryCodes', 'U') IS NULL
    CREATE TABLE dbo.RecoveryCodes (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL REFERENCES dbo.Users(Id),
        CodeHash NVARCHAR(200) NOT NULL,
        UsedAt DATETIME2 NULL
    );
IF OBJECT_ID('dbo.Exercises', 'U') IS NULL
    CREATE TABLE dbo.Exercises (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Name NVARCHAR(200) NOT NULL,
        Category NVARCHAR(30) NULL,
        Equipment NVARCHAR(30) NULL,
        SourceId NVARCHAR(100) NULL,      -- the free-exercise-db id; NULL for ones an admin added
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
IF OBJECT_ID('dbo.ExerciseMuscles', 'U') IS NULL
    CREATE TABLE dbo.ExerciseMuscles (
        ExerciseId INT NOT NULL REFERENCES dbo.Exercises(Id) ON DELETE CASCADE,
        Muscle NVARCHAR(20) NOT NULL,
        Role NVARCHAR(9) NOT NULL CHECK (Role IN ('primary', 'secondary')),
        PRIMARY KEY (ExerciseId, Muscle)
    );
IF OBJECT_ID('dbo.WorkoutExercises', 'U') IS NULL
    CREATE TABLE dbo.WorkoutExercises (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        WorkoutId INT NOT NULL REFERENCES dbo.Workouts(Id) ON DELETE CASCADE,
        ExerciseId INT NOT NULL REFERENCES dbo.Exercises(Id),
        Position INT NOT NULL
    );
IF OBJECT_ID('dbo.Sets', 'U') IS NULL
    CREATE TABLE dbo.Sets (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        WorkoutExerciseId INT NOT NULL REFERENCES dbo.WorkoutExercises(Id) ON DELETE CASCADE,
        Position INT NOT NULL,
        WeightKg FLOAT NOT NULL,
        Reps INT NOT NULL,
        Rir INT NULL
    );
IF OBJECT_ID('dbo.Profiles', 'U') IS NULL
    CREATE TABLE dbo.Profiles (
        UserId INT NOT NULL PRIMARY KEY REFERENCES dbo.Users(Id),
        Goal NVARCHAR(9) NULL,
        BirthDate DATE NULL,
        Sex NVARCHAR(6) NULL,
        HeightCm FLOAT NULL,
        Activity INT NULL,
        KcalTarget INT NULL
    );
IF OBJECT_ID('dbo.BodyWeights', 'U') IS NULL
    CREATE TABLE dbo.BodyWeights (
        UserId INT NOT NULL REFERENCES dbo.Users(Id),
        [Date] DATE NOT NULL,
        Kg FLOAT NOT NULL,
        PRIMARY KEY (UserId, [Date])  -- one weight per member per day
    );
IF OBJECT_ID('dbo.FoodEntries', 'U') IS NULL
    CREATE TABLE dbo.FoodEntries (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL REFERENCES dbo.Users(Id),
        [Date] DATE NOT NULL,
        Meal NVARCHAR(9) NOT NULL,
        Name NVARCHAR(100) NOT NULL,
        Kcal INT NOT NULL,
        ProteinG FLOAT NOT NULL,
        CarbsG FLOAT NOT NULL,
        FatG FLOAT NOT NULL,
        INDEX IX_FoodEntries_UserId_Date (UserId, [Date])
    );
GO

-- Indexes (the gym_app login can't create them, so they live here)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Workouts_UserId_Date')
    CREATE INDEX IX_Workouts_UserId_Date ON dbo.Workouts (UserId, [Date] DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WorkoutExercises_WorkoutId')
    CREATE INDEX IX_WorkoutExercises_WorkoutId ON dbo.WorkoutExercises (WorkoutId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WorkoutExercises_ExerciseId')
    CREATE INDEX IX_WorkoutExercises_ExerciseId ON dbo.WorkoutExercises (ExerciseId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sets_WorkoutExerciseId')
    CREATE INDEX IX_Sets_WorkoutExerciseId ON dbo.Sets (WorkoutExerciseId);
-- last_visit (every login) and list_users (Admin screen)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Events_UserId_Kind_At')
    CREATE INDEX IX_Events_UserId_Kind_At ON dbo.Events (UserId, Kind, At);
-- admin_stats
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Events_At')
    CREATE INDEX IX_Events_At ON dbo.Events (At) INCLUDE (Kind);
GO
