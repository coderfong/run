# Run session validity

How PASER decides what a recorded run actually was: running, stopped, a
drive, a bike ride, paused, or unknown. Code: `frontend/src/run/session/`.

> **Status: not yet committed.** This must be field-tested on iPhone and Apple
> Watch (matrix below) before it ships. Thresholds are starting points.

## Principles

1. **Recording, validation and anti-cheat are separate.** Every fix, step
   sample and Core Motion reading is recorded and persisted as it arrives,
   whatever state the run is in. Validation decides afterwards, from that
   evidence, which stretches count. Anti-cheat stays on the server and is
   only given a summary.
2. **No single number is a verdict.** Duration never invalidates a run: a
   24 h run with running evidence throughout is a 24 h run. Speed is never a
   verdict: a 2:27/km interval is running. Everything is weighed over
   windows (10–20 s to resume, 60 s to label, 60–120 s to call a drive or a
   ride, 90 s to auto-pause) with hysteresis.
3. **Unknown is a valid state.** No pedometer, no motion permission, poor GPS:
   the stretch keeps its evidence and counts as running if the GPS moves at
   foot speed, unless something contradicts it.
4. **Prefer pausing to ending.** PASER pauses automatically; it never ends a
   run on its own. Stale runs ask the runner.
5. **One list of points.** Distance, territory, missions, XP and coins all
   come from the same submitted points, which are only the accepted running
   segments. They cannot disagree.

## Architecture

| File | Role |
|------|------|
| `config.js` | Every threshold, documented. Change them here only. |
| `activityClassifier.js` | Weighted rules: a window of evidence → running / stationary / cycling / vehicle / unknown, with the rules that fired. |
| `sessionEngine.js` | The state machine, stepped every 5 s over all evidence. Replays from the start when late evidence (a background batch, step history) arrives, so live and final decisions cannot drift. |
| `finalizeSession.js` | Closes the run: accepted segments → filtered points tagged `seg`, distance, moving time, the server summary, the runner-facing notice. |
| `recovery.js` | When a reopened run needs the runner to decide. |
| `runOwnership.js` | One active PASER run per person (phone vs watch). |
| `sessionStore.js` | Chunked, append-only persistence (no O(n²) rewrites; safe for 24 h). |
| `stepHistory.js` | Fills pedometer gaps from CMPedometer history (background, crash). |
| `runReminders.js` | "Still running?", forgotten-pause and long-run checkpoint notifications. |
| `runSessionController.js` | What `RunningScreen` talks to: engine + store + pedometer epochs + motion + reminders. |
| `../motionActivity.js` + `modules/paser-motion` | Core Motion activity history (native, iOS). |
| `../backgroundTrack.js` | Background fixes, now chunked (no 6 h cap), plus the dead man's switch. |
| `components/run/RunRecoverySheet.js` | RUN STILL OPEN. |

### States

`IDLE → STARTING → ACTIVE_RUNNING ⇄ POSSIBLY_STATIONARY → AUTO_PAUSED`,
`ACTIVE_RUNNING → SUSPICIOUS_MOTION` (cycling or vehicle),
`any → USER_PAUSED` (runner only), `→ ENDING → COMPLETED`.
`RECOVERY_REQUIRED` is derived by `status(now)`: no running evidence for
`STALE_RUN_S`, or a user pause left for `STALE_USER_PAUSE_S`.

Counting states (distance and moving time accrue): `ACTIVE_RUNNING`,
`POSSIBLY_STATIONARY`.

### Auto-pause

Stationary label (displacement inside the drift radius, no cadence, Core
Motion stationary; any running cadence vetoes it) held for
`STATIONARY_CANDIDATE_S` (45 s) → POSSIBLY_STATIONARY (UI unchanged); held for
`AUTO_PAUSE_S` (90 s) → AUTO_PAUSED, **backdated to when the runner last
moved**, so the whole stop leaves moving time and the trail is trimmed of the
drift recorded while deciding.

### Auto-resume

While auto-paused, a 20 s window is judged every 5 s. On-foot evidence
(running label, or foot-speed GPS movement with no contradiction) **and**
leaving the drift circle by `RESUME_DISPLACEMENT_M` (30 m), held for
`AUTO_RESUME_CONFIRM_S` (10 s; 30 s after a cycling or vehicle suspicion) →
ACTIVE, backdated to the first moving step, so no distance is lost. Jogging on
the spot at a light does not resume (it never leaves the circle). A user pause
never auto-resumes. Resume pressed during an auto-pause always wins: the
automatic pause is recorded as the runner's own, ended at the tap.

### Forgotten runs

* The "Still running?" notification is **scheduled** for last movement +
  `FORGOTTEN_RUN_NOTIFICATION_S` (15 min) and pushed back whenever movement is
  seen — by the Run screen, and from the pocket by the background location
  task (a dead man's switch; JS timers do not run in the background). One
  notification per stop.
* A user pause left for `FORGOTTEN_PAUSE_NOTIFICATION_S` (20 min): one
  "Your run is paused".
* Checkpoints at 4/8/12/16/20/24 h: "PASER is still recording", non-blocking.
* No running evidence for `STALE_RUN_S` (45 min) → RUN STILL OPEN.

### Recovery (stale run, crash, reboot)

On reopening, the session is replayed from disk plus background fixes plus
step and motion history. If there is evidence of running up to now it simply
continues. Otherwise the sheet shows the last running movement:

* **Finish run** ends the run at the last confirmed running movement, not now.
* **Resume run** continues; the gap is recorded as a pause and never counted.
* **Discard** throws it away (confirmed).

### Cycling

Weighted evidence, never speed alone: Core Motion cycling (+2.5), distance with
near-zero cadence (+2), stride over 3.2 m sustained over ≥ 120 m (+1.5),
bike-range speed (+0.5, deliberately weak). Running cadence (−3) and on-foot
Core Motion (−2) veto it. Needs confidence ≥ 0.6 held for 120 s, backdated to
the last stepping.

### Driving

Core Motion automotive (+3), median speed > 8.5 m/s (+2.5), p90 > 12 m/s
sustained (+1), long distance with no steps (+1.5); running cadence and on-foot
motion veto it. Confidence ≥ 0.6 held for 60 s → SUSPICIOUS_MOTION (auto
pause) and "DRIVE DETECTED · PASER paused your run", backdated to the last
stepping or first faster-than-foot fix. The run before the drive is kept.

### Fast runners

The live filter only refuses physically impossible jumps (> 12 m/s between
consecutive estimates). 6.5 m/s is "soft max" evidence, weighed against
cadence. On the server, faster than 2:50/km sustained over 1.5 km is a hard
flag (bikes and cars); a faster 500 m burst is only the soft
`pace_fast_burst`.

### Ultras

Nothing caps duration. Long runs get checkpoints, chunked persistence (the
background buffer used to keep only the last ~6 h), step history for pocketed
stretches, and aid-station stops handled as ordinary auto-pauses.

### GPS gaps and teleports

Single impossible fixes are rejected immediately. A gap longer than 60 s, or
one implying more than foot speed or 300 m, breaks the route segment unless
steps across the gap support the distance. The server never bridges segments.

## Server

* `GpsPoint.seg` and `EndRunIn.session` (optional; older clients unchanged).
* Distance = sum of segments. Territory, splits and crossings use the longest
  chain of segments that meet within 150 m.
* `duration_s` is now **moving time from the points**, never longer than the
  wall clock. It used to be end − start, so a forgotten run paid as hours of
  running to reward gates and duration missions.
* Segment boundaries are neither teleports nor sprints.
* Soft review reasons from the summary: `session_vehicle_excluded`,
  `session_cycling_excluded`, `session_mostly_unknown`.
* Hard `overlapping_run`: another finished, verified run of the same account
  covering ≥ 50% of this one's time (phone + watch recording the same run).
* `runs.session_summary` JSONB (migration 0046), server-side only.

### Distance authority policy

PASER's segmented distance is canonical for territory, missions, XP and coins.
When a watch/HealthKit workout is imported (not built yet), its distance is
the authority unless PASER's classification excluded a substantial stretch
(`EXCLUSION_NOTICE_M` / `EXCLUSION_NOTICE_SHARE`), in which case the segmented
distance wins and the runner is told.

## Watch / phone

* The watch reports its own workout (running / paused / ended, 30 s
  heartbeat). The phone refuses to start a run while one is live:
  "Run in progress on Apple Watch".
* With a phone run live (heard within 60 s; the phone heartbeats while running
  **and** paused), the watch shows RUN IN PROGRESS · Recording on your iPhone
  with Pause/Resume/Finish, and its own Start is refused.
* Watch standalone workouts are still HealthKit-only and never reach PASER's
  server, so they cannot claim territory yet; `overlapping_run` covers that
  once transfer exists.
* `HKWorkoutConfiguration.activityType = .running` is intent, not proof. Watch
  motion validation belongs with watch-to-PASER transfer (not built).

## Diagnostics (dev only)

On finish in `__DEV__`, `[run-session]` logs the summary, the notice and:
time in each segment kind, every transition (with reason), per-minute samples
(label, confidence, cadence, speed, stride, motion shares, and the rules that
fired), speed percentiles, evidence counts and the last confirmed running time.

## Constants

See `frontend/src/run/session/config.js`; each carries its reasoning. Headline
values: step 5 s · lookback 60 s · resume lookback 20 s · drift radius 25 m ·
candidate 45 s · auto-pause 90 s · resume 10 s / 30 m · forgotten 15 min ·
paused reminder 20 min · stale 45 min (60 min for a user pause) · recovery gap
120 s · soft max 6.5 m/s · impossible 12 m/s · vehicle 8.5 m/s · running
cadence 120 spm · walking 60 · no steps 20 · stride 0.3–2.6 m (wheels > 3.2 m
over ≥ 120 m) · cycling 0.6 conf / 120 s · vehicle 0.6 / 60 s · GPS gap break
60 s or 300 m · exclusion notice 300 m or 10%.

## Field-test matrix

For every run capture: PASER distance · Apple distance · moving time ·
elapsed time · pace · auto-pauses (count, total) · excluded segments (kind,
distance) · classification per minute (dev log `[run-session]`).

| # | Scenario | Device | Expect |
|---|----------|--------|--------|
| A | Easy run, 5 km | Phone | One segment; within ±2% of Apple; no notices |
| B | Intervals (6 × 400 m hard) | Phone | No cycling/vehicle; reps keep their distance; server `pace_fast_burst` at most |
| C | Run with 5+ traffic lights (15–60 s) | Phone | No auto-pause under ~90 s; no flapping |
| D | Run + 15 min cafe stop | Phone | AUTO PAUSED ~90 s in, RUNNING AGAIN within ~25 s of leaving; stop excluded; no drift distance |
| E | Run, then drive home without stopping | Phone | DRIVE DETECTED; run kept; drive excluded; result notice |
| F | Cycle with PASER set to run | Phone | Paused as a ride within ~2–3 min; little or no distance |
| G | Walk 3 km | Phone | Counts as on foot; no false stops at slow pace |
| H | 2–4 h long run, phone pocketed | Phone | Continuous; no stale prompt; checkpoint at 4 h if reached |
| I | Watch only run | Watch | Phone Start refused while live; watch saves as before |
| J | Phone only run, watch open | Phone + Watch | Watch shows RUN IN PROGRESS on iPhone; its Start refused |
| K | Forget to stop: leave phone on a table 1 h | Phone | "Still running?" at ~15 min; RUN STILL OPEN; Finish ends at last movement |
| L | Force-quit mid run, reopen after 10 min | Phone | RUN STILL OPEN; no invented time or distance |
| M | Pedometer / Motion permission denied | Phone | Runs still count (GPS only); no stale prompts while moving |

### Needs real-device calibration

Drift radius and auto-pause timing under trees and tall buildings; cadence
bands for slow joggers and hikers; cycling confirmation time against slow
cyclists; Core Motion lag at activity changes; background fix cadence while
pocketed (iOS `distanceInterval` 8 m) versus the stationary label; step history
availability after force-quit; notification delivery while pocketed; watch
heartbeat freshness windows (60 s watch side, 2 min phone side).
