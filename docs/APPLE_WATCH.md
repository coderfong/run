# PASER on Apple Watch

Added 2026-09-11 and upgraded 2026-09-14. PASER ships a standalone watchOS
workout app inside the iOS app. The watch records an outdoor run with its own
GPS and heart rate sensor, so the iPhone does not need to be nearby.

## What the runner gets

- **Before the run.** The watch shows GPS readiness and a large Start Run
  control. It requests Workout, Health, and Location permission on first use,
  then runs a haptic 3, 2, 1 countdown.
- **During the run.** Three swipeable pages show distance, active time, pace,
  live heart rate, and large pause, resume, and finish controls. Finish needs a
  one second hold so a wet sleeve or accidental touch cannot end a run.
- **Wrist first controls.** Start, pause, resume, and finish act immediately on
  the watch workout and never wait for phone reachability.
- **Taps on the wrist** mark the countdown, the start, a pause, a resume, each
  kilometre, the moment the run earns land, and the run being saved or failing
  to save. Button presses get no extra taps.
- **After the run.** The watch saves an Apple Health running workout and its
  GPS route, then shows an animated Paser summary with distance, time, and
  pace. Phone based territory claiming remains a separate phone run flow.

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
| Watch app | `frontend/targets/watch/` | SwiftUI, watchOS 9+, built by `@bacons/apple-targets` at prebuild |
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
in the foreground. Outside the Run screen, the app-level watch launcher handles
Start by opening Record with a short-lived command token. Other commands are
never queued.

`__tests__/watchProtocol.test.js` fails if a field, phase or command exists on
one side only, or if a watch string contains a dash.

## Standalone recording

`WorkoutManager.swift` owns an `HKWorkoutSession`, `HKLiveWorkoutBuilder`,
`HKWorkoutRouteBuilder`, and `CLLocationManager`. The workout session keeps the
app active during the run and provides live heart rate. Filtered GPS fixes feed
both the on-screen distance and the HealthKit route. Paused time and movement
are excluded. The target carries the HealthKit entitlement, workout background
mode, permission copy, and `WKRunsIndependentlyOfCompanionApp` is true.

The older phone command protocol remains in the project for compatibility with
phone initiated runs, but the primary watch UI does not depend on reachability.

## Decisions worth knowing before changing anything

- **PASER starts a real workout session on the watch.** watchOS permits one
  active workout app at a time. Starting PASER while another workout is active
  asks watchOS to resolve that conflict. The iPhone app's write only Health
  rule is unchanged; the watch requests heart rate read access only for its
  live workout screen.
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
- **The watch app runs without the iPhone**
  (`WKRunsIndependentlyOfCompanionApp` true) and records GPS locally.
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
- [ ] On Home, Map, Club and You with PASER in front: the watch shows Start
      run. With the phone app backgrounded: the watch asks to open PASER.
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
