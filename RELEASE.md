# Territory Run — Release Runbook

## Required environment variables

### Backend (see `backend/.env.example`)

| Var | Required in prod | Notes |
|-----|------------------|-------|
| `ENV` | yes (`production`) | enables boot-time config checks |
| `DATABASE_URL` | yes | Postgres + PostGIS |
| `JWT_SECRET` | yes | `openssl rand -hex 32`; server refuses the dev default |
| `CORS_ORIGINS` | yes | explicit comma-separated list; `*` refuses to boot |
| `SENTRY_DSN` | recommended | empty = telemetry off |
| `APP_VERSION` | recommended | surfaced by `GET /version` |
| `RATE_LIMIT_*` | optional | defaults: auth 10/min, submit-path 60/min, end-run 6/min, 120/min elsewhere |

### Frontend

| Var | Where | Notes |
|-----|-------|-------|
| `EXPO_PUBLIC_API_BASE` | eas.json build profiles | prod API URL |
| `EXPO_PUBLIC_SENTRY_DSN` | eas.json build profiles | empty = telemetry off |
| `extra.apiBase` | app.json | dev fallback (cloudflared tunnel) |

## Backend deploy (Fly.io)

```bash
cd backend
fly launch --no-deploy                      # first time only
fly postgres create --name territory-run-db --region sin
fly postgres attach territory-run-db
fly secrets set ENV=production JWT_SECRET=$(openssl rand -hex 32) \
    CORS_ORIGINS=https://your-app-origin SENTRY_DSN=<dsn> APP_VERSION=1.0.0
fly deploy

# Migrations (schema is owned by Alembic — schema.sql is documentation only):
fly ssh console -C "alembic upgrade head"
# For a database that predates Alembic: alembic stamp 0001 && alembic upgrade head
```

Render: **New → Blueprint** with `backend/render.yaml`, then set the same
env vars and run `alembic upgrade head` in a shell.

## Mobile builds (EAS)

```bash
cd frontend
npm install -g eas-cli
eas login
eas init                                   # writes projectId into app.json
                                           # (replaces REPLACE_WITH_EAS_PROJECT_ID)

# TestFlight (internal)
eas build --profile preview --platform ios
eas submit --profile preview --platform ios

# Play internal track
eas build --profile preview --platform android
eas submit --profile preview --platform android

# Store-ready
eas build --profile production --platform all
eas submit --profile production --platform all
```

Remember to bump `version` / `buildNumber` / `versionCode` in `app.json`
for every store submission.

## Local development (this machine)

Docker does not run here — Postgres is native.

```powershell
# Backend (uvicorn --reload is unreliable here; kill + restart instead):
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Expose to the phone:
cloudflared tunnel --url http://localhost:8000
# -> paste the URL into frontend/app.json extra.apiBase

# Frontend:
cd frontend
npx expo start --tunnel
```

## Pre-flight checklist

- [ ] `python backend/smoke_test.py` green against staging (includes the
      spoofed-run shadow-flag case)
- [ ] `GET /health` returns `{"ok": true, "db": true}` on staging
- [ ] `GET /version` reports the version you're about to ship
- [ ] Sentry receiving events from BOTH backend and a staging app build
- [ ] `alembic current` on staging == `alembic heads`
- [ ] Full staging run on a real device: signup → onboarding → location
      explainer → run with loop close (haptic + pill) → Result card →
      Share → territory on World Map → leaderboard row
- [ ] Kill the app mid-run → relaunch → "Unfinished run found" recovery works
- [ ] Airplane mode mid-run → GPS keeps recording → end-run Retry works
- [ ] Privacy policy hosted and reachable from Profile
- [ ] Store listings: screenshots, description, privacy questionnaire
      (location "linked to user", motion "not linked")
