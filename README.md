# Gym App

A full-stack workout tracker. Users create an account, log in, and record their workouts. Admins can see every user.

## Features

- Sign up, log in, deactivate your account, and reactivate it later
- Passwords hashed with Argon2; weak passwords are rejected (zxcvbn strength check)
- JWT sessions that expire after 1 hour
- Log workouts and view your history
- Admin-only list of all users

## Tech stack

| Part                  | Tech                                |
| --------------------- | ----------------------------------- |
| Frontend (`gym-web/`) | React 19, Vite                      |
| API (`gym-api/`)      | Rust, Axum, Tokio                   |
| Database              | Microsoft SQL Server (via Tiberius) |

## Getting started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+ and npm
- SQL Server: a local install, Azure SQL, or Docker:

  ```sh
  docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=<your-password>" \
    -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
  ```

### 1. Clone

```sh
git clone https://github.com/jetthomas/gymapp.git
cd gymapp
```

### 2. Create the database

The API creates its tables on first run, but the database itself must exist:

```sql
CREATE DATABASE GymApp;
```

### 3. Configure the API

Create `gym-api/.env`:

```env
DB_HOST=localhost
DB_USER=sa
DB_PASSWORD=<your-password>
JWT_SECRET=<a-long-random-string>
```

Never commit `.env`. It's already in `.gitignore`.

### 4. Run the API

```sh
cd gym-api
cargo run
```

Check it's up:

```sh
curl http://127.0.0.1:5080/health   # ok
```

### 4b. Lock down the database (recommended)

The first run needs an admin login (like `sa`) because it creates the tables. After that, run [`gym-api/sql/security.sql`](gym-api/sql/security.sql) as the admin. It creates a `gym_app` login that can only read and write the app's tables, and turns on row-level security so each user only sees their own workouts. Then switch `DB_USER`/`DB_PASSWORD` in `.env` to `gym_app`.

### 5. Run the frontend

In a second terminal:

```sh
cd gym-web
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api/*` to the API on port 5080, so keep both running.

### Making yourself an admin

Admin access is controlled by the `IsAdmin` column on `dbo.Users`. Make the first admin with SQL; after that, admins can make others from the Admin screen:

```sql
UPDATE dbo.Users SET IsAdmin = 1 WHERE Email = 'you@example.com';
```

## API

| Method | Route                            | Description                                                          |
| ------ | -------------------------------- | -------------------------------------------------------------------- |
| GET    | `/health`                        | Health check                                                         |
| POST   | `/auth/register`                 | Create an account (`firstName`, `lastName`, `email`, `password`)     |
| POST   | `/auth/login`                    | Log in (`email`, `password`); returns a token, or a 2FA `challenge`  |
| POST   | `/auth/logout`                   | Log out; the current token stops working                             |
| POST   | `/auth/2fa/verify`               | Finish a 2FA login (`challenge`, `code`) and get a token             |
| POST   | `/auth/2fa/setup`                | Start turning on 2FA; returns a QR code and secret                   |
| POST   | `/auth/2fa/confirm`              | Finish turning on 2FA (`code`)                                       |
| POST   | `/auth/reset`                    | Set a new password from a reset link (`token`, `password`); turns 2FA off |
| DELETE | `/auth/delete`                   | Deactivate your account                                              |
| POST   | `/auth/reactivate`               | Reactivate a deactivated account (`email`, `password`)               |
| GET    | `/workouts`                      | List your workouts                                                   |
| POST   | `/workouts`                      | Add a workout                                                        |
| GET    | `/admin/users`                   | List all users (admins only)                                         |
| PUT    | `/admin/users/{id}/admin`        | Make a user an admin or remove it (`isAdmin`) (admins only)          |
| POST   | `/admin/users/{id}/reset-link`   | Make a 15-minute password reset link for a user (admins only)        |

Register, login, 2FA verify, reset and reactivate are rate-limited to one attempt every 2 seconds per IP, with bursts of up to 30.

## Project structure

```
gymapp/
├── gym-api/          Rust API
│   └── src/main.rs   Routes, auth, and database setup
└── gym-web/          React frontend
    ├── src/api.js    API client
    └── src/*.jsx     Pages and forms
```

## Scripts (`gym-web/`)

| Command           | What it does                 |
| ----------------- | ---------------------------- |
| `npm run dev`     | Start the dev server         |
| `npm run build`   | Build for production         |
| `npm run lint`    | Run ESLint                   |
| `npm run preview` | Preview the production build |
