# Territory Run

A run-and-claim mobile game. Run a closed loop, the polygon you traced becomes your territory. Overlap a rival's land and you steal it.

```
run/
├── backend/                  FastAPI + PostgreSQL/PostGIS
│   ├── app/
│   │   ├── main.py           CORS + router wiring
│   │   ├── config.py         tuneables (loop radius, JWT, CORS, etc.)
│   │   ├── database.py       SQLAlchemy engine/session
│   │   ├── models.py         User / Run / Territory ORM
│   │   ├── schemas.py        Pydantic request/response (accepts `t` or `timestamp`)
│   │   ├── geospatial.py     loop detection, projection, polygon construction
│   │   ├── security.py       bcrypt + JWT + current_user dependency
│   │   └── routes/
│   │       ├── auth.py        /auth/signup, /auth/login, /me, PATCH /me, DELETE /me
│   │       ├── runs.py        /start-run, /submit-path, /end-run (auth-gated)
│   │       ├── territories.py /map-polygons (bbox-indexed)
│   │       ├── leaderboard.py /leaderboard
│   │       └── users.py       GET /users/{id}
│   ├── migrations/001_password_hash.sql
│   ├── schema.sql
│   ├── Dockerfile + .dockerignore
│   ├── fly.toml              Fly.io
│   ├── render.yaml           Render blueprint
│   └── requirements.txt
└── frontend/                 React Native (Expo)
    ├── App.js                onboarding → auth → main stack
    ├── app.json + eas.json   bundle IDs, splash, EAS profiles
    ├── assets/               icon, adaptive-icon, splash, favicon
    ├── scripts/make-assets.ps1   regenerates icon/splash from code
    └── src/
        ├── api/client.js     fetch wrapper, JWT bearer, ApiError
        ├── auth/AuthContext.js
        ├── data/regions.js   5 Singapore territory regions
        ├── theme.js          dark-mode tokens
        ├── ui/toast.js       global error/success toast
        └── screens/
            ├── OnboardingScreen.js
            ├── AuthScreen.js          login + signup
            ├── HomeScreen.js          map of SG with the 5 regions
            ├── RunningScreen.js       live map, polyline, loop preview
            ├── ResultScreen.js        captured polygon + area
            ├── GlobalMapScreen.js     bbox-fetched territories
            ├── LeaderboardScreen.js
            └── ProfileScreen.js       rename, sign out, delete account
```

## Auth model

- **POST `/auth/signup`** — `{username, password}` → `{access_token, user}`. Username `[a-z0-9_]{3,32}`. Password 8-128 chars, must include a letter and a digit.
- **POST `/auth/login`** — same body, same response.
- **GET `/me`** — `Authorization: Bearer <jwt>` → `{id, username}`.
- **PATCH `/me`** — `{username}` (rename).
- **DELETE `/me`** — hard delete; cascades remove runs + territories.

The token is a 30-day HS256 JWT signed with `JWT_SECRET`. The frontend stores it in `expo-secure-store` and replays it on every request via `Authorization: Bearer …`. `AuthContext.js` verifies the token against `/me` on launch and signs out on 401.

## Local backend setup

```bash
# 1) Postgres + PostGIS, e.g. via Docker:
docker run -d --name run-db -e POSTGRES_PASSWORD=run -e POSTGRES_USER=run \
    -e POSTGRES_DB=run -p 5432:5432 postgis/postgis:16-3.4

# 2) Apply schema (creates extensions, tables, indices):
psql postgresql://run:run@localhost:5432/run -f backend/schema.sql

# If you upgraded an existing DB, also apply:
psql postgresql://run:run@localhost:5432/run -f backend/migrations/001_password_hash.sql

# 3) Run the API:
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env              # then set JWT_SECRET (openssl rand -hex 32)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check: `GET http://localhost:8000/health` → `{"ok": true}`.

## Local frontend setup

```bash
cd frontend
npm install
npx expo start                # LAN mode if phone + PC share Wi-Fi
npx expo start --tunnel       # any network (Expo will install @expo/ngrok the first time)
```

The app reads its API base URL in this order:
1. `EXPO_PUBLIC_API_BASE` (set by EAS build profiles).
2. `extra.apiBase` in `app.json`.
3. The fallback baked into `src/api/client.js`.

## Mobile-data testing (no shared Wi-Fi)

```powershell
# In one terminal:
cloudflared tunnel --url http://localhost:8000
# Copy the printed *.trycloudflare.com URL into app.json → extra.apiBase
# (and into the dev profile's EXPO_PUBLIC_API_BASE in eas.json if needed).

# In another terminal:
cd frontend
npx expo start --tunnel
```

Scan the QR with Expo Go and run anywhere — the app reaches your laptop through Cloudflare.

## Deploy: backend

### Fly.io

```bash
cd backend
fly launch --no-deploy
fly postgres create --name territory-run-db --region sin
fly postgres attach territory-run-db
fly secrets set JWT_SECRET=$(openssl rand -hex 32) CORS_ORIGINS=*
fly deploy
# After first deploy, enable PostGIS + load schema (use the printed connection URL):
fly postgres connect -a territory-run-db
\i schema.sql
```

### Render

Push this repo, then **New → Blueprint** and pick `backend/render.yaml`. Render provisions the DB + injects `DATABASE_URL`. After the first deploy, enable PostGIS once:

```bash
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql $DATABASE_URL -f backend/schema.sql
```

After backend is live, set `EXPO_PUBLIC_API_BASE` in `eas.json` for the `preview` and `production` build profiles, and `extra.apiBase` in `app.json`.

## Deploy: mobile (EAS)

```bash
npm install -g eas-cli
eas login
eas init                          # writes the projectId into app.json
eas build --profile preview --platform ios     # internal TestFlight build
eas build --profile preview --platform android # internal APK
eas build --profile production --platform all  # store-ready
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

Replace `REPLACE_WITH_EAS_PROJECT_ID` in `app.json` after `eas init`. The Apple Developer Program ($99/yr) and Google Play Console ($25 one-time) accounts are prerequisites for store submission.

## Tuning

`backend/app/config.py` — `closure_radius_m`, `min_loop_area_m2`, `simplify_tolerance_m`, `max_speed_mps`, plus the JWT and CORS settings.

## Endpoints

| Method | Path             | Auth | Notes                                                    |
|--------|------------------|------|----------------------------------------------------------|
| POST   | `/auth/signup`   | —    | create account, returns JWT                              |
| POST   | `/auth/login`    | —    | exchange credentials for a JWT                           |
| GET    | `/me`            | ✓    | current user                                             |
| PATCH  | `/me`            | ✓    | rename                                                   |
| DELETE | `/me`            | ✓    | delete account (cascades)                                |
| POST   | `/start-run`     | ✓    | begin a run, returns `run_id`                            |
| POST   | `/submit-path`   | ✓    | live preview — `closed_loop` + `preview_polygon`         |
| POST   | `/end-run`       | ✓    | final commit — returns the assigned territory            |
| GET    | `/map-polygons`  | —    | optional `min_lon/min_lat/max_lon/max_lat` bbox          |
| GET    | `/leaderboard`   | —    | top users by total area                                  |
| GET    | `/users/{id}`    | —    | public user lookup                                       |
| GET    | `/health`        | —    | liveness                                                 |

## Known gaps before App Store submission

These are out of scope for the beta cut and are not implemented yet:

- **Background GPS** (`expo-task-manager`) — runs currently pause if the app is backgrounded long enough.
- **Crash/error telemetry** (Sentry).
- **Privacy policy + Terms of Service** must be hosted on a public URL and linked from the listing and from `ProfileScreen`.
- **Store screenshots + listing copy.**
- **Offline queue** — runs that complete with no connectivity are lost.
- **Tests** beyond the manual smoke path.
