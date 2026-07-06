# Territory Run v2 — Release Runbook

## Environment variables

### Backend (`backend/.env.example`)

| Var | Required in prod | Notes |
|-----|------------------|-------|
| `ENV` | yes (`production`) | enables boot-time config checks |
| `DATABASE_URL` | yes | Postgres + PostGIS |
| `JWT_SECRET` | yes | `openssl rand -hex 32`; server refuses the dev default |
| `CORS_ORIGINS` | yes | explicit comma-separated list; `*` refuses to boot |
| `SENTRY_DSN` | recommended | empty = telemetry off |
| `APP_VERSION` | recommended | `GET /version` (default 2.0.0) |
| `RATE_LIMIT_*` | optional | auth 10/min, submit-path 60/min, end-run 6/min, 120/min default |

### Frontend / EAS (`eas.json` build profiles, or shell for dev)

| Var | Notes |
|-----|-------|
| `EXPO_PUBLIC_API_BASE` | prod API URL (dev: the cloudflared tunnel) |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | Mapbox **public** token `pk.…` (runtime) |
| `MAPBOX_DOWNLOAD_TOKEN` | Mapbox **download** secret `sk.…` (build-time; `eas secret:create`) |
| `EXPO_PUBLIC_MAP_STYLE_LIGHT` / `_DARK` | custom Studio style URLs (optional) |
| `EXPO_PUBLIC_SENTRY_DSN` | empty = telemetry off |

Mapbox account/token setup and the two hand-designed Studio styles are
documented in **SETUP_MAPBOX.md**.

## Database migrations (Alembic owns the schema)

`schema.sql` and `backend/migrations/*.sql` are **documentation only**.

```bash
cd backend
alembic upgrade head          # fresh DB: creates everything (0001..0005)
# DB predating Alembic: alembic stamp 0001 && alembic upgrade head
```

Revisions: 0001 baseline · 0002 MultiPolygon · 0003 clan groundwork ·
0004 full clan system (seasons/leagues/weekly goals; seeds Season 1) ·
0005 fitness (splits, PRs, kudos, push tokens, notif prefs).

### Seed / cron

- **Season 1** is seeded by migration 0004. To roll a new season, insert a
  `seasons` row (name, starts_at, ends_at).
- Clan **colors (12)** and **badges (16)** are code constants
  (`backend/app/clans_meta.py`) — no seeding needed.
- **Nightly:** `POST /admin/recompute-season` (refresh clan areas + assign
  league tiers). **Monday:** `POST /admin/weekly-recap` (push last-week
  recap). Wire both to a scheduler (cron / Fly Machines / Render cron) and
  **lock the `/admin/*` routes down** (add an admin token) before production.

## Backend deploy (Fly.io / Render)

```bash
cd backend
fly launch --no-deploy
fly postgres create --name territory-run-db --region sin
fly postgres attach territory-run-db
fly secrets set ENV=production JWT_SECRET=$(openssl rand -hex 32) \
    CORS_ORIGINS=https://your-origin SENTRY_DSN=<dsn> APP_VERSION=2.0.0
fly deploy
fly ssh console -C "alembic upgrade head"
```

Render: New → Blueprint with `backend/render.yaml`, set the same env, run
`alembic upgrade head` in a shell.

## Mobile builds (EAS)

`@rnmapbox/maps` needs a **dev/native build** — it does not run in Expo Go.

```bash
cd frontend
eas login && eas init         # project 01ac36c0 is already linked
eas secret:create --scope project --name MAPBOX_DOWNLOAD_TOKEN --value sk.…

# Dev client (iterate):
eas build --profile development --platform ios      # needs Apple Developer + eas device:create
eas build --profile development --platform android
npx expo start --dev-client

# Store builds:
eas build --profile production --platform all
eas submit --profile production --platform ios      # TestFlight
eas submit --profile production --platform android   # Play internal track
```

Bump `version` / `buildNumber` / `versionCode` in `app.json` per submission
(currently 2.0.0 / 3 / 3).

### Health sync native modules (optional)

Health write is scaffolded but the native modules aren't installed. To
activate: `npx expo install react-native-health` (iOS) and
`react-native-health-connect` (Android), add their config plugins, then
rebuild the dev client. Purpose strings are already in `app.json`.

## Local development (this machine — native Postgres, no Docker)

```powershell
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
.venv\Scripts\python.exe smoke_test.py      # full e2e suite
cloudflared tunnel --url http://localhost:8000   # -> app.json extra.apiBase
```

## Pre-flight checklist

- [ ] `python backend/smoke_test.py` green against staging
- [ ] `GET /health` → `{"ok": true, "db": true}`; `GET /version` correct
- [ ] `alembic current` == `alembic heads` on staging
- [ ] Sentry receiving from backend + a staging app build
- [ ] Mapbox custom styles set (or fallbacks acceptable); camera locked to SG
- [ ] Full device run: signup → onboarding → location → run + loop close →
      Result (splits/PRs/share) → territory on Map → feed + kudos → clan
      create/join → clan hub weekly goal → leaderboards
- [ ] Push: register token, receive a "land attacked" / kudos notification
- [ ] `/admin/*` cron endpoints locked down + scheduled
- [ ] Privacy policy hosted + linked from You
- [ ] Store listings: screenshots, description, privacy questionnaire
      (location "linked to user"; motion/health "not linked" / health write-only)
