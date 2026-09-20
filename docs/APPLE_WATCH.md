# PASER on Apple Watch

Added 2026-09-11, upgraded 2026-09-14, and given the runner's own portrait
and a screen aware layout on 2026-09-20. PASER ships a standalone watchOS
workout app inside the iOS app. The watch records an outdoor run with its own
GPS and heart rate sensor, so the iPhone does not need to be nearby.

## What the runner gets

- **Before the run.** The watch shows the runner's own PASER character, GPS
  readiness and a large Start Run control. It requests Workout, Health, and
  Location permission on first use, then runs a haptic 3, 2, 1 countdown.
- **During the run.** Three swipeable pages show distance, active time and
  pace, then the run stats, then a single control: a dial that ends the run on
  a deliberate hold, so a wet sleeve or an accidental touch cannot. There is no
  Pause on the wrist (removed 2026-09-20): it was the loudest thing one swipe
  from a live run, and it made the destructive control the quiet one.
- **Wrist first controls.** Start and finish act immediately on the watch
  workout and never wait for phone reachability.
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
| Portrait | `frontend/src/watch/watchAvatar.js` | Rasterises the character on the phone and sends it over as a file |
| Portrait key | `frontend/src/watch/avatarKey.js` | Names a look. Pure, so the rule for when to send one needs no art |

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

## The runner's portrait

The watch does not draw the character. The rig is a stack of a dozen PNGs
chosen from a catalogue of nearly three hundred, so shipping it into a watch
target would be a second copy of the whole paper doll to keep in step.
Instead the phone rasterises the portrait it already draws everywhere else
(the same head and shoulders framing as `CharacterBust`) and sends the picture.

It travels **on its own, as a file transfer**, not inside the run state. The
state is re-sent on a ten second heartbeat for the length of every run and goes
out over a size limited live message, so a base64 portrait riding along with it
would be tens of kilobytes on the wire per beat. A file transfer is queued by
the system and delivered even when neither app is running, which is what a
standalone recorder needs: the wrist may see the portrait before it next sees
the phone.

It is sent once per LOOK, never per launch. `avatarKey` hashes the slots that
actually draw, the watch keeps the key it was last given, and the phone keeps
the key it last sent (in `UserDefaults`, so it can answer a watch while
JavaScript is not running at all). On launch and on every foreground the watch
sends `{ cmd: "avatar", have: <its key> }`; the phone answers only when that is
out of date. `WatchAvatarSync`, mounted at the app root rather than on the Run
screen, watches `equipped` and captures a new one when it changes.

A watch that has never been handed a portrait draws a runner glyph in the
accent, not a face: a stand in face reads as the character being WRONG rather
than as the picture being on its way.

## Screen layout

Watch screens run from 136 points wide (38mm) to 208 (46mm), and a layout
written in fixed points fits exactly one of them. Every size, gap and type
size goes through `WatchLayout` (`targets/watch/ResponsiveDesign.swift`), which
measures the screen the app is actually on, and every screen sits inside
`WatchScreen`, which scrolls.

Both rules exist because of the same bug: a fixed `VStack` with a `Spacer` at
each end centres content that fits and silently cuts off content that does not,
and on a 40mm the Ready screen's own Start button ended up under the curve of
the glass with no way to reach it.

`WatchScreen` also reserves two strips the system owns:

- **The clock.** watchOS draws the time over the app, and PASER is not in a
  `NavigationStack`, so nothing is inset for it. Anything laid out at the top
  of a screen is drawn UNDERNEATH it, which is how the GPS pill and RUN STATS
  ended up on top of 1:20. Old screens only escaped it where a `Spacer`
  happened to push content into the middle. Content that reaches the top right
  is also kept out of that corner: the run page's status row is left aligned.
- **The pager dots**, which a `TabView` draws over its pages rather than beside
  them. A page says `inPager: true` and gets the room.

`watchProtocol.test.js` fails if a screen is not in a `WatchScreen`, if a page
of a pager does not declare itself one, if the clock strip stops being
reserved, or if any Swift source writes a font size as a number.

The portrait is **animated**, from one still picture: a wall clock driven bob
with a footfall, a squash on the landing and a lean that alternates every step
(`PortraitMotion` in `WatchAvatar.swift`). The stride rate follows the run's own
speed. It pauses for Reduce Motion and in Always On, where the screen only
redraws about once a minute.

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
   its own App ID, HealthKit on that App ID, and a provisioning profile that
   includes `com.apple.developer.healthkit`. The usual
   `eas build --non-interactive` stops on missing credentials, so run this once
   and sign in to Apple when it asks:

   ```bash
   cd frontend
   npx eas-cli build --platform ios --profile production
   ```

   After that, the non-interactive command works again.

   **Whenever the watch target's entitlements change, remake its profile by
   hand.** A profile only carries the capabilities its App ID had when it was
   generated, and non-interactive builds skip checking stored profiles with
   Apple (the log says so), so they keep reusing the old one. That is what
   failed builds 72 to 76 on 2026-09-14: the watch gained HealthKit, and its
   2026-09-11 profile had none. The fix: enable the capability on the
   `com.pacerrun.app.watchkitapp` App ID, run
   `npx eas-cli credentials --platform ios`, choose production, then
   Build Credentials, then Provisioning Profile: Delete one from your project,
   then PaserWatch, and finish with the interactive build above, which makes a
   fresh profile. Never drop the entitlement to get past the error instead: the
   watch's workout session and the phone's Health sync both need it.
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
- [ ] Lock the phone and pocket it. The watch keeps recording on its own: the
      distance keeps moving and the trail has no straight line gaps. (This
      item used to be a pause and resume test. Pause left the wrist on
      2026-09-20; the phone still has it, and `pauseWindows` still keeps
      fixes recorded during a phone pause out of the trail.)
- [ ] Hold to finish from the watch with the phone still locked. The run saves,
      the watch shows Run saved, and unlocking the phone shows the result.
- [ ] There is no Pause anywhere on the wrist. `WorkoutManager.pause()` and
      `PausedView` are still there on purpose (the paused time bookkeeping is
      what keeps elapsed time honest) but nothing reaches them.
- [ ] Lower the wrist mid run and raise it again. The numbers catch up at once.
- [ ] Walk out of Bluetooth range. The watch says the iPhone is out of reach,
      and the controls come back when it returns.
- [ ] No watch paired: pausing and resuming a run on the phone behaves exactly
      as it did before this change.
- [ ] The Ready screen shows YOUR character, not a glyph, and the whole screen
      fits: Start Run is fully on the glass and nothing is under the corners.
      Check on the smallest watch available.
- [ ] Change a hat in the studio on the phone. The wrist has the new look the
      next time the watch app is opened, without reinstalling anything.
- [ ] Turn on Reduce Motion: the portrait stops moving and is still drawn.
- [ ] On every screen, nothing sits under the system clock and nothing sits
      under the pager dots. Swipe all three run pages and all three post run
      pages.
