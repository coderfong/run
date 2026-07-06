# Territory Run — Privacy Policy (stub, v2)

_Last updated: 2026-07-06. Finalize and host at a public URL (linked from the
app's You → Settings and both store listings) before submission._

## What we collect

- **Account** — your username and a salted hash of your password. No email,
  phone, or real name.
- **Routes** — the GPS trace of each run, **only while a run is active**. Never
  in the background outside an active run.
- **Territories** — the polygons your closed loops claim, their area, and when
  they were captured.
- **Clans** — clan membership, role, and your contributions to your clan's
  weekly goal and season stats.
- **Social** — kudos you give and receive; the activity feed is assembled from
  runs (yours, your clan's, and public highlights).
- **Motion** — step counts from your device's pedometer during a run, used
  only to verify runs are on foot (anti-cheat). Raw motion data never leaves
  your device.
- **Push token** — an Expo push token so we can notify you (land attacked,
  clan goal, kudos, season, weekly recap). Each category is toggleable in
  You → Settings.
- **Diagnostics** — crash reports / performance telemetry (Sentry), only if
  enabled in the build you're running.

## Optional: Health sync (write-only)

If you enable **Sync runs to Health** in Settings, we write each finished run
(as a running workout) to Apple Health / Google Health Connect. We **never
read** your health data, and the toggle is off by default.

## What we do NOT do

- No ads, no sale of data, no third-party analytics beyond crash reporting.
- No background location outside an active run.
- No reading of health, contacts, camera, microphone, or photos.

## Who sees what

- Username, clan, territory polygons/areas, and run activity are **public**
  in-app (map, feed, leaderboards) — claiming land is the game.
- Raw GPS traces are not exposed by the public API; a run's route is visible
  on its detail screen to signed-in users (flagged/anti-cheat runs are private
  to their owner).

## Deletion

You → Settings → Delete account permanently removes your account, runs,
routes, territories, clan membership, kudos, and device tokens (hard delete
with cascades). No retention period.

## Contact

privacy@territoryrun.app _(set up before launch)_
