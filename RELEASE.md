# Legacy infrastructure runbook

> This file contains historical infrastructure notes. For the current PASER
> 2.1.0 App Store release, use [`docs/APP_STORE.md`](docs/APP_STORE.md). That
> checklist is authoritative for versions, privacy disclosures, store metadata,
> Sign in with Apple deletion, screenshots, and submission gates.

# PASER release infrastructure reference

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
alembic upgrade head          # fresh DB: creates everything (0001..0006)
# DB predating Alembic: alembic stamp 0001 && alembic upgrade head
```

Revisions: 0001 baseline · 0002 MultiPolygon · 0003 clan groundwork ·
0004 full clan system (seasons/leagues/weekly goals; seeds Season 1) ·
0005 fitness (splits, PRs, kudos, push tokens, notif prefs) ·
0006 PACER (XP, notifications inbox, clan join requests).

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
eas login && eas init         # project 2ebf801e (@jonfong78/pacer) is linked
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
(currently 2.0.0 / 1 / 1 — counters reset with the com.pacerrun.app identity).

### Apple Health sync (iOS, live)

`@kingstinct/react-native-healthkit` is installed and write-only sync ships in
the binary: `ios.entitlements["com.apple.developer.healthkit"]` plus
`NSHealthUpdateUsageDescription` in `app.json`, the adapter in
`frontend/src/health.js`, and the opt-in switch in
`frontend/src/components/HealthSyncSettings.js`.

There is deliberately **no** `NSHealthShareUsageDescription` and **no**
background-delivery entitlement: PASER never reads Health and never needs to
wake for it. Do not add the package's own config plugin, which would add both.

The HealthKit capability must exist on the App ID. `eas build` syncs it from
the entitlements file on the first production build; if it fails, enable
HealthKit for `com.pacerrun.app` in the Apple Developer portal and rebuild.
This is a native change: OTA updates cannot deliver it.

Android Health Connect is not wired. `src/health.js` no-ops off iOS.

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
- [ ] Apple Health: switch on in You > Settings, finish a run, confirm the
      workout appears in the Health app and that no read prompt was ever shown
