# PASER on Apple Watch

Added 2026-09-11. PASER ships a companion watchOS app inside the iOS app. The
iPhone still records the run. The watch shows that run and controls it.

## What the runner gets

- **Before the run.** With Record open and in front on the iPhone, the watch
  shows **Start run**. Pressing it runs the phone's normal 3, 2, 1 countdown.
  With Record closed, the watch says to open PASER on the iPhone.
- **During the run.** Elapsed time, distance, pace, land earned, GPS signal,
  and the same "what this run still needs" line as the phone. There is a
  pause/resume button and a **hold to finish** bar, which needs a one second
  press the same way the phone's finish button needs a hold. The Always On
  display shows the numbers without the controls.
- **Taps on the wrist** mark the countdown, the start, a pause, a resume, each
  kilometre, the moment the run earns land, and the run being saved or failing
  to save. Button presses get no extra taps.
- **After the run.** "Run saved" with distance and time, then "Claim your land
  on your iPhone", because claim placement stays on the phone.

## How it fits together

```
iPhone                                              Watch
RunningScreen ── useWatchRun ── watchLink ─┐   ┌── PhoneLink ── RunScreen (SwiftUI)
  (the same pauseRun / finishRun           │   │     (publishes RunState)
   the phone's buttons call)               ▼   ▼
                          PaserWatch module ◀──▶ WatchConnectivity
                          (modules/paser-watch)
```

| Piece | Where | Job |
| --- | --- | --- |
| Protocol | `frontend/src/watch/watchState.js` | Builds each snapshot and decides which commands may act. Pure and tested |
| Link | `frontend/src/watch/watchLink.js` | Wraps the native module. Does nothing, silently, where the module is missing |
| Hook | `frontend/src/watch/useWatchRun.js` | Publishes on change plus a 10 s heartbeat while running, routes commands, sends idle on unmount |
| Native, phone | `frontend/modules/paser-watch/` | Local Expo module: WCSession, application context, live messages, replies without JS |
| Watch app | `frontend/targets/watch/` | SwiftUI, watchOS 10+, built by `@bacons/apple-targets` at prebuild |
| Pause windows | `frontend/src/run/pauseWindows.js` | Keeps fixes recorded during a pause out of the trail |

**State flows phone to watch only.** Each snapshot is fully formatted
(`"3.42"`, `"5:12"`, `·` for a value not measured yet), so the wrist can never
show a different number from the phone. It travels as the application context,
which the system keeps for the next time the watch app opens, and as a live
message while the watch app is on screen. Every snapshot has a `seq` seeded
from the clock, and the watch ignores anything older than what it holds.

**Commands flow watch to phone** (`start`, `pause`, `resume`, `finish`, each
stamped with the time it was sent). The phone never takes the watch's word.
`commandAllowed` checks each command against the Run screen's phase at the
moment it lands, and drops anything older than 30 s. Start is also refused
unless the phone has the app in front, because iOS only lets location switch on
in the foreground. With no Run screen listening, a command is dropped, never
queued.

`__tests__/watchProtocol.test.js` fails if a field, phase or command exists on
one side only, or if a watch string contains a dash.

## Decisions worth knowing before changing anything

- **The watch does no HealthKit and runs no workout session.** A watch app
  normally stays on screen through a run by running an `HKWorkoutSession`. Only
  one session can run at a time, though, so starting ours would end an Apple
  Workout the runner already had going, and it would need Health permissions
  on the watch. That breaks the write only Health rule in `src/health.js`. The
  cost is that the watch app follows the system's Return to Clock setting.
  Runners who want PASER to stay up can set Watch app > General > Return to
  Clock > PASER > After 1 hour. The watch catches up the moment it is raised
  or reopened.
- **A pause holds the background location session open when PASER is on a
  paired watch.** With the phone locked in a pocket, that session is the only
  thing keeping the app process alive. Without it, a Resume pressed on the
  wrist would reach a suspended app that iOS will not let switch location back
  on from the background. Fixes recorded during the pause are dropped by
  `pauseWindows`, so a pause still covers no ground. With no watch, pause
  behaves exactly as before.
- **Finish from the watch** requests bounded execution time using UIKit's
  background task API, then stops location before saving. The grant is released
  after saving or when iOS expires it. It does not guarantee an upload completes
  before suspension; a failed save must remain recoverable on the phone.
- **The watch app requires the iPhone app**
  (`WKRunsIndependentlyOfCompanionApp` false). It has no GPS or network code of
  its own.
- **Versions.** apple-targets syncs the watch target's marketing version to
  `app.json`, and EAS writes the build number into every target it signs, so
  the watch always matches the phone. Nothing in `targets/watch` pins a
  version.

## Before the first build with the watch app (owner only)

1. **Create the watch app's signing credentials once, interactively.** The
   watch target is a new bundle id, `com.pacerrun.app.watchkitapp`, which needs
   its own App ID and provisioning profile. The usual
   `eas build --non-interactive` stops on missing credentials, so run this once
   and sign in to Apple when it asks:

   ```bash
   cd frontend
   npx eas-cli build --platform ios --profile production
   ```

   After that, the non-interactive command works again.
2. **App Store Connect needs Apple Watch screenshots.** Once a build with a
   watch app is attached to the version, the version page gets an Apple Watch
   section, and submission is blocked until it has at least one screenshot.
   Take them from the TestFlight build on a real watch.
3. **Test on a real iPhone and watch pair.** Nothing here runs in the
   simulator from this repo, and WatchConnectivity needs both devices. See the
   checklist below.

## Device test checklist

- [ ] Installing the TestFlight build puts PASER on the watch. If Automatic App
      Install is off, install it from the Watch app.
- [ ] Record closed: the watch says to open PASER on the iPhone. Record open:
      the watch shows Start run.
- [ ] Start run on the watch counts down on both, and the phone starts
      recording.
- [ ] Lock the phone and pocket it. Pause and resume from the watch several
      times. The trail has no ground covered during the pauses and no straight
      line gaps.
- [ ] Hold to finish from the watch with the phone still locked. The run saves,
      the watch shows Run saved, and unlocking the phone shows the result.
- [ ] Lower the wrist mid run and raise it again. The numbers catch up at once.
- [ ] Walk out of Bluetooth range. The watch says the iPhone is out of reach,
      and the controls come back when it returns.
- [ ] No watch paired: pausing and resuming a run on the phone behaves exactly
      as it did before this change.
