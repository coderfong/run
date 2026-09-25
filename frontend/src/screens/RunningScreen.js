import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View, StatusBar } from 'react-native';
import GameMap, {
  MapPoint,
  TerritoryLayer,
  Trail,
  UserMarker,
} from '../components/GameMap';
import { CharacterBust } from '../components/character/CharacterRig';
import DevRunSimulator from '../components/DevRunSimulator';
import { useAvatar } from '../state/avatar';
import { tierByKey } from '../config/rankLadder';
import * as Location from 'expo-location';
import Svg, { Circle } from 'react-native-svg';
import { Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { api, warmUp } from '../api/client';
import { invalidateAfterLandLoss, invalidateAfterRun } from '../api/cache';
import { useAuth } from '../auth/AuthContext';
import { claimGateReason, entitledAreaM2, RUN_TIER, runTier } from '../config/economy';
import {
  drainBackgroundPoints,
  startBackgroundTrack,
  stopBackgroundTrack,
} from '../run/backgroundTrack';
import { createGpsFilter, DROP, haversineM, pathDistanceM, toApiPoints } from '../run/gpsFilter';
import { buildSimulatedRun, FALLBACK_ORIGIN } from '../run/simulatedRun';
import { buildTutorialResult, buildTutorialTrace } from '../run/tutorialRun';
import { createRunSessionController, SESSION_EVENT } from '../run/session/runSessionController';
import { RUN_SESSION } from '../run/session/config';
import { canStartPhoneRun } from '../run/session/runOwnership';
import RunRecoverySheet from '../components/run/RunRecoverySheet';
import { useClan } from '../state/clan';
import { landColor } from '../components/territoryBoard';
import { useRecording } from '../state/recording';
import { useSettings } from '../state/settings';
import { writeWorkout } from '../health';
import { useIsFocused } from '@react-navigation/native';
import useWatchRun from '../watch/useWatchRun';
import { watchAppInstalled, beginRunSave, endRunSave, watchWorkoutStatus } from '../watch/watchLink';
import useWatchLiveMirror from '../watch/useWatchLiveMirror';
import { commandAllowed, PHASE as WATCH_PHASE } from '../watch/watchState';
import { NB, darkColors, nbInk, radius, runTuning as T, space, toon, type, withAlpha } from '../theme';
import { ToonButton } from '../components/ui';
import { haptic, PressableScale } from '../ui/motion';
import { toast } from '../ui/toast';
import { landCaptureAlert } from '../components/LandCaptureAlert';
import { RunEventOverlay, RunStartOverlay } from '../components/run/RunGameplayFx';
import { DEMO_RUN_PHASES, SIGNAL, TARGET, useTutorial, useTutorialState, useTutorialTarget } from '../tutorial';

// In-progress run persisted here so an OS kill / crash can't lose a run.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The tutorial's demo run: how many frames the demo route is drawn in, and how
// far apart. About four seconds, which is long enough to see a route become a
// loop and short enough that nobody waits for it. Nothing about the tutorial
// advances when it ends: the Finish button appears, and waits for a press.
const DEMO_FRAMES = 20;
const DEMO_FRAME_MS = 200;

// Helper function for border color (local version since theme import may not be available)
function getNbInk() {
  return '#ffffff'; // Always use white for dark theme
}

// Night-run surface tokens.
const D = {
  bg: darkColors.bg,
  card: darkColors.card,
  border: darkColors.border,
  text: darkColors.text,
  muted: darkColors.textMuted,
  dim: darkColors.textDim,
  danger: darkColors.danger,
  // See-through steps of the same surfaces, for chrome floating over the map.
  // Derived rather than typed out: these were the old charcoal as literal
  // rgba, and would have stayed charcoal beside panels that follow the palette.
  glass: withAlpha(darkColors.card, 0.82),
  glassStrong: withAlpha(darkColors.card, 0.95),
  bust: withAlpha(darkColors.card, 0.9),
  veil: withAlpha(darkColors.bg, 0.55),
};

// The dark game-board look now comes from the Mapbox dark style URL
// (see config/map.js + SETUP_MAPBOX.md), not an inline tile-style array.

function toRad(value) {
  return (value * Math.PI) / 180;
}

// Same great-circle maths the filter measures steps with, so the screen and
// the trail can never disagree about how far apart two points are.
const distanceMeters = haversineM;
const totalDistanceMeters = pathDistanceM;

// Per-point sensor metadata rides along for server-side validation:
// mocked (Android mock-provider flag; iOS has no equivalent -> false),
// accuracy and speed when the platform reports them.
// `seg` is the accepted running segment a point belongs to (see
// run/session/finalizeSession.js). The server measures each one separately and
// never bridges two, so a gap in the run is a break, not distance.

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function paceStr(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// The elapsed clock, and nothing else.
//
// This used to be `elapsedMs` state on RunningScreen itself, set four times a
// second. The screen that state sat on is also the one holding the live map —
// the route trail, every nearby territory, a character portrait over each of
// them — so a quarter-second tick rebuilt that whole subtree 240 times a
// minute for the sake of one line of text, and the reconciliation competed
// with the GPS fixes arriving underneath it. State that drives a readout
// belongs inside the readout: this re-renders itself and nothing above it.
//
// `startedAtRef` is the screen's own reference rather than a number handed
// down. It is shifted forward across a pause (see `resumeFromPause`) so that
// elapsed time stays honest, and reading the ref is what keeps this from
// disagreeing with the value the run is submitted with.
const RunClock = React.memo(function RunClock({ getMs, running, style }) {
  const [ms, setMs] = useState(0);

  // STOPPING FREEZES, IT DOES NOT RESET. Both halves of that matter:
  //
  //   * Pausing has to hold the time it stopped at, which is what clearing the
  //     interval and touching nothing else does.
  //   * So does FINISHING. `finishRun` flips running off and then submits the
  //     run, which is a round trip — zeroing here would leave 00:00 on screen
  //     for the whole of it, and the last thing a runner sees before their
  //     result would be a clock claiming they had run for no time at all.
  //
  // A new run zeroes it on its own: `startRun` sets `startedAtRef` before it
  // flips running on, so the immediate tick below reads a few milliseconds.
  // MOVING time, from the run session: a pause, an auto-pause and a stretch
  // PASER judged to be a drive all hold it still, and a stop detected late is
  // taken back off the clock the moment it is detected.
  useEffect(() => {
    if (!running) return undefined;
    const tick = () => setMs(getMs());
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running, getMs]);

  return <Text style={style}>{formatDuration(ms)}</Text>;
});

function formatArea(m2) {
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
}

// Area-weighted centroid of a [lon,lat] ring → {latitude, longitude}. Where a
// territory's owner portrait sits on the run map.
function ringCentroidLL(ring) {
  if (!ring || ring.length < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-12) return { latitude: ring[0][1], longitude: ring[0][0] };
  a *= 0.5;
  return { latitude: cy / (6 * a), longitude: cx / (6 * a) };
}

// GPS quality chip (thresholds in theme.runTuning).
function gpsColor(accuracyM) {
  if (accuracyM == null) return darkColors.textDim;
  if (accuracyM < T.gpsGoodM) return darkColors.ok;
  if (accuracyM < T.gpsOkM) return darkColors.warn;
  return darkColors.danger;
}

// Closest distance (m) from point p to segment ab (all lat/lng points),
// via a local equirectangular projection — used for "closure near" checks.
function pointToSegmentMeters(a, b, p) {
  const lat0 = toRad(p.latitude);
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos(lat0);
  const ax = a.longitude * mPerLon, ay = a.latitude * mPerLat;
  const bx = b.longitude * mPerLon, by = b.latitude * mPerLat;
  const px = p.longitude * mPerLon, py = p.latitude * mPerLat;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Ray casting against a [lon,lat] ring. Used only to announce the moment a
// live runner crosses into somebody else's ground; Mapbox remains responsible
// for drawing the actual territory.
function pointInRing(point, ring) {
  if (!point || !ring?.length) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// -----------------------------------------------------------------------
// Press-and-hold Finish button: a radial ring fills during the hold so an
// accidental tap mid-run can't end the session.
// -----------------------------------------------------------------------

const RING_R = 12;
const RING_C = 2 * Math.PI * RING_R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function HoldToFinishButton({ onFinish }) {
  const progress = useSharedValue(0);
  const [holding, setHolding] = useState(false);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_C * (1 - progress.value),
  }));

  const start = () => {
    setHolding(true);
    progress.value = withTiming(
      1,
      { duration: T.holdToFinishMs, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(onFinish)();
      }
    );
  };

  const cancel = () => {
    setHolding(false);
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: 150 });
  };

  return (
    <Pressable
      onPressIn={start}
      onPressOut={cancel}
      accessibilityRole="button"
      accessibilityLabel="Finish run"
      accessibilityHint="Press and hold to finish the run"
    >
      <View style={styles.stopBtn}>
        <Svg width={30} height={30} viewBox="0 0 30 30">
          <Circle
            cx={15}
            cy={15}
            r={RING_R}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={3}
            fill="none"
          />
          <AnimatedCircle
            cx={15}
            cy={15}
            r={RING_R}
            stroke="#ffffff"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${RING_C} ${RING_C}`}
            animatedProps={ringProps}
            transform="rotate(-90 15 15)"
          />
        </Svg>
        <Text style={styles.stopBtnText}>
          {holding ? 'Keep holding…' : 'Hold to finish'}
        </Text>
      </View>
    </Pressable>
  );
}

export default function RunningScreen({ navigation, route }) {
  const { user } = useAuth();
  const { setRecording } = useRecording();
  const { color } = useClan();
  const { equipped, rankKey } = useAvatar();
  const { trailGlowColor } = useSettings();
  const accent = trailGlowColor || color.stroke;
  
  // Check if opened from watch notification
  const fromWatch = route.params?.source === 'watch' || route.params?.category === 'watch_run_saved';
  
  // Whether Start on the watch may begin a run here: not while Result sits on
  // top of this screen (see watchPhase below).
  const isFocused = useIsFocused();
  // Whether a standalone Apple Watch workout is live right now, mirrored —
  // see the file header on useWatchLiveMirror for why this screen only ever
  // displays it rather than tracking a second, independent run alongside it.
  const watchMirror = useWatchLiveMirror();

  const mapRef = useRef(null);
  const watchRef = useRef(null);
  const pathRef = useRef([]);
  const runRef = useRef(null);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);
  // The first-run tutorial's own run: true from the moment its Start press is
  // handled until this screen hands off to Result. Latched once, at press
  // time, so nothing mid-run can flip which branch finishRun takes.
  const tutorialSimRef = useRef(false);
  const tutorialSimTimerRef = useRef(null);
  const tutorialTraceRef = useRef(null);
  // The first-run tutorial. This screen offers two targets (Start, and the
  // demo's Finish) and reports three events (the runner pressed Start, the
  // demo route finished drawing, the runner pressed Finish). It never starts
  // or finishes anything on the tutorial's behalf.
  const { signal: tutorialSignal } = useTutorial();
  const { active: tutorialActive, phase: tutorialPhase } = useTutorialState();
  // While the tutorial is on one of its run steps, Start starts the DEMO, not
  // a real run: nothing reaches the network, the watch or HealthKit.
  const tutorialDemo = tutorialActive && DEMO_RUN_PHASES.has(tutorialPhase);
  const startTarget = useTutorialTarget(TARGET.RUN_START);
  const finishTarget = useTutorialTarget(TARGET.FINISH_RUN);
  // The demo route has finished drawing: show "Finish demo run".
  const [demoRouteDone, setDemoRouteDone] = useState(false);
  // Adaptive-sampling bookkeeping.
  const gpsModeRef = useRef('high'); // 'high' | 'relaxed'
  const pendingModeRef = useRef({ mode: null, count: 0 });
  const recentSpeedsRef = useRef([]);
  const restartingWatchRef = useRef(false);
  // Everything the watcher emits goes through here before it can touch the
  // trail: accuracy gate, Kalman smoothing, noise-scaled step gate, and the
  // trailing window the pace readout is measured over. See run/gpsFilter.js.
  const gpsFilterRef = useRef(null);
  if (!gpsFilterRef.current) {
    // The filter's own defaults cover the GPS side; the one thing it has to
    // share with this screen is where "faster than a runner" sits, so a
    // segment the vehicle gate would refuse can never reach the trail either.
    // Only a physically impossible jump is refused here. Anything a person can
    // do — a 2:30/km interval, a downhill sprint — is evidence for the run
    // session to weigh, never a point to delete (run/session/config.js).
    gpsFilterRef.current = createGpsFilter({ maxSpeedMps: RUN_SESSION.RUNNING_SPEED_HARD_IMPOSSIBLE_MPS });
  }
  // The run session (run/session/): evidence, validity, persistence, the
  // pedometer, Core Motion, reminders. It decides WHY a stretch counts or not
  // — running, stopped, a drive, a bike, a pause — and this screen only reacts.
  // It replaces the old vehicle gate (a one-shot banner) and the whole-trail
  // crash snapshot.
  const sessionRef = useRef(null);
  if (!sessionRef.current) sessionRef.current = createRunSessionController();
  // Mirrors `paused` for the same reason isRunningRef mirrors isRunning: the
  // pause/resume guards are read inside timers and location callbacks that
  // outlive the render they closed over.
  const pausedRef = useRef(false);
  // The running total, mirrored off the filter's own incremental figure. The
  // watchdog used to re-walk the whole trail with totalDistanceMeters every
  // 45s, which is a haversine per recorded point, on the JS thread, forever —
  // an O(n) sweep on a timer is exactly the kind of background work item 12
  // says must not land on the UI thread.
  const distanceMRef = useRef(0);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [path, setPath] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [distance, setDistance] = useState(0);
  // WHOLE SECONDS, not milliseconds, and not what the clock draws.
  //
  // Elapsed time is read by this screen for two things — `claimGateReason` and
  // `runTier` — and both are threshold tests that cannot tell 12.25 seconds
  // from 12. The displayed clock is a separate, finer thing that lives in
  // RunClock. Holding the integer here means a tick only re-renders the screen
  // (and the map subtree hanging off it) when the number it is used for
  // actually moves.
  const [elapsedS, setElapsedS] = useState(0);
  // Rolling pace in seconds per km, already smoothed by the filter. Held as a
  // whole number so the once-a-second refresh only re-renders when the shown
  // value actually moves.
  const [paceSPerKm, setPaceSPerKm] = useState(null);
  const [accuracyM, setAccuracyM] = useState(null);
  // What the session just did, as one line in the HUD: AUTO PAUSED, RUNNING
  // AGAIN, DRIVE DETECTED. Dismissible, never over the controls.
  const [sessionNotice, setSessionNotice] = useState(null);
  // PASER has paused the run itself (a long stop, a drive, a bike). Distinct
  // from `paused`, which only the runner sets and only the runner clears.
  const [autoPaused, setAutoPaused] = useState(false);
  // The RUN STILL OPEN sheet: { lastActiveAt, distanceM } or null.
  const [recovery, setRecovery] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const noticeTimerRef = useRef(null);
  const [permDenied, setPermDenied] = useState(false);
  // Dev harness only (see simulateRun / DevRunSimulator); false in every build
  // a player can install.
  const [simulating, setSimulating] = useState(false);
  // Claim-qualified metres already banked in today's game day. Territory comes
  // off a CUMULATIVE daily curve, so a second run of the day earns the tapered
  // slice rather than a fresh untapered first kilometre — and this readout has
  // to say so, or the result screen will look like it took something away.
  // Arrives on /submit-path; 0 until the first one lands, and while offline.
  const [dailyClaimDistanceM, setDailyClaimDistanceM] = useState(0);
  // Pause freezes the clock + GPS; lock swallows touches until long-press.
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const pausedAtRef = useRef(null);
  // True while a pause is holding the background location session open for
  // the watch (see pauseRun).
  const bgHeldRef = useRef(false);
  // What the watch shows once a run ends: { status, distanceM, elapsedMs,
  // notice }, where status is the watch phase (saving, saved, unsaved, or
  // ready with a notice after a run too short to save). Null until a run
  // ends, cleared by the next start. Nothing on the phone's screen reads it.
  const [afterRun, setAfterRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  // Phone and watch controls can land in the same event-loop turn. These
  // synchronous locks make Finish and /end-run single-flight before React's
  // phase update has time to hide either control. The server is idempotent as
  // the final backstop, but duplicate requests should not leave the phone.
  const finishingRef = useRef(false);
  const savingRef = useRef(false);
  const [startCountdown, setStartCountdown] = useState(null);
  // Camera tracking state - allows user to pan and recenter
  const [userPanned, setUserPanned] = useState(false);
  const lastCameraUpdateRef = useRef(0);

  // Small event queue: a kilometre and claim qualification can land on the
  // same GPS fix, and neither payoff should erase the other.
  const [runFxQueue, setRunFxQueue] = useState([]);
  const runFxTokenRef = useRef(0);
  const lastKmRef = useRef(0);
  const lastTierRef = useRef(RUN_TIER.UNQUALIFIED);
  const currentRivalRef = useRef(null);
  const rivalTerritoriesRef = useRef([]);
  const enqueueRunFx = useCallback((event) => {
    const token = ++runFxTokenRef.current;
    setRunFxQueue((queue) => [...queue.slice(0, 2), { ...event, token }]);
  }, []);
  const dismissRunFx = useCallback(() => {
    setRunFxQueue((queue) => queue.slice(1));
  }, []);

  // Mirrors isRunning for listeners that outlive renders.
  const isRunningRef = useRef(false);

  useEffect(() => {
    // Wake the API while the runner is still getting ready. The instance is
    // spun down between sessions and takes the better part of a minute to
    // come back, and left alone that wait lands squarely on /start-run — the
    // one moment somebody is standing outside waiting to move. Nothing here
    // depends on it; the permission prompt and the GPS lock below are what
    // fill the time either way. See warmUp in api/client.
    warmUp();
    (async () => {
      const granted = await prepareLocation();
      if (granted) {
        const foundOrphan = await restoreSession();
        const watchStartAt = Number(route?.params?.watchStartAt);
        const freshWatchStart = commandAllowed(
          { cmd: 'start', at: watchStartAt },
          WATCH_PHASE.READY
        );
        if (!foundOrphan && freshWatchStart) await startRun();
      }
    })();
    return () => {
      stopWatchingLocation();
      // Stops listening, keeps the run: a screen unmounting mid-run (the app
      // navigated away) must not throw the evidence away.
      sessionRef.current.detach();
      stopBackgroundTrack();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      setRecording(false);
      if (tickRef.current) clearInterval(tickRef.current);
      if (tutorialSimTimerRef.current) clearInterval(tutorialSimTimerRef.current);
    };
  }, []);

  // Screen off / app backgrounded: the foreground watcher dies but the
  // background task keeps recording. On return, fold its buffered points
  // into the trail so there's no straight-line gap.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (!isRunningRef.current || tutorialSimRef.current) return;
      if (s === 'active') {
        // Fold in what the pocket recorded, then let the session catch up: it
        // may have stopped, resumed, seen a drive, or gone stale meanwhile.
        mergeBackgroundPoints().then(() => onSessionTick(Date.now()));
      } else {
        sessionRef.current.persist();
      }
    });
    return () => sub.remove();
  }, []);

  // Merge buffered background fixes into the path, keeping timestamp order
  // (a foreground fix can land before the drain finishes) and the same
  // jitter filter the live watcher applies.
  async function mergeBackgroundPoints() {
    // Every background fix is evidence, pauses included: the session decides
    // which stretches count, so nothing is filtered out here.
    const pts = await drainBackgroundPoints();
    if (!pts.length || !runRef.current) return;
    sessionRef.current.addBackgroundFixes(pts);
    rebuildTrail();
  }

  // The trail and distance, redrawn from the session's accepted running
  // stretches. Called whenever a decision reaches back in time (a stop found
  // 90 s after it began, a resume confirmed a few seconds late, a drive cut
  // at the last step) or late evidence lands, so the map never shows ground
  // the run no longer counts.
  function rebuildTrail(now = Date.now()) {
    const { points, distanceM } = sessionRef.current.trail(now);
    pathRef.current = points;
    setPath(points);
    setDistance(distanceM);
    distanceMRef.current = distanceM;
    if (points.length) gpsFilterRef.current.seed(points, distanceM);
    else gpsFilterRef.current.resume();
  }

  function showNotice(title, body, ms = 4000) {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setSessionNotice({ title, body });
    noticeTimerRef.current = ms ? setTimeout(() => setSessionNotice(null), ms) : null;
  }

  // One tick of the session: advance it, and react to what it decided.
  function onSessionTick(now) {
    const out = sessionRef.current.tick(now);
    if (!out) return;
    let redraw = false;
    for (const e of out.events) {
      if (e.type === SESSION_EVENT.AUTO_PAUSED) {
        setAutoPaused(true);
        haptic.light();
        showNotice('AUTO PAUSED', "Looks like you've stopped.");
        redraw = true;
      } else if (e.type === SESSION_EVENT.AUTO_RESUMED) {
        setAutoPaused(false);
        haptic.light();
        showNotice('RUNNING AGAIN', 'Recording resumed.');
        redraw = true;
      } else if (e.type === SESSION_EVENT.VEHICLE) {
        setAutoPaused(true);
        haptic.medium();
        showNotice('DRIVE DETECTED', 'PASER paused your run.', 0);
        redraw = true;
      } else if (e.type === SESSION_EVENT.CYCLING) {
        setAutoPaused(true);
        haptic.medium();
        showNotice('LOOKS LIKE A RIDE', 'PASER paused your run. Resume if you are running.', 0);
        redraw = true;
      } else if (e.type === SESSION_EVENT.RECOVERY_REQUIRED) {
        setRecovery((r) => r || { lastActiveAt: e.at, distanceM: distanceMRef.current });
      }
    }
    if (redraw) rebuildTrail(now);
    setAutoPaused(!out.status.counting && out.status.stepState !== 'user_paused');
    const secs = Math.max(0, Math.floor(sessionRef.current.movingMs(now) / 1000));
    setElapsedS(secs);
  }

  // Nearby claimed land (others'), so a runner sees whose turf they're crossing
  // and where there's land to steal. Refetched only when they drift ~600m.
  //
  // Scoped to the runner's own rank tier, because "land to steal" is a claim
  // for the claim to make and a claim only ever fights its own band (backend
  // `_rank_scope_sql`). Drawn unscoped this map promised turf the run could
  // never take, and the promise came due on the result screen when the
  // breakdown counted a single rival under a circle covering half a dozen
  // plots. Same board the global map and the claim chooser draw.
  const [board, setBoard] = useState(null);
  const [boardPortraits, setBoardPortraits] = useState([]);
  const boardCenterRef = useRef(null);
  const boardRank = tierByKey(rankKey).tier;

  useEffect(() => {
    if (!currentLocation) return;
    const last = boardCenterRef.current;
    // A tier change is a different board, not a different place: the drift
    // gate would otherwise hold the previous band's land on screen until the
    // runner moved 600m.
    if (last?.rank === boardRank && distanceMeters(last, currentLocation) < 600) return;
    boardCenterRef.current = { ...currentLocation, rank: boardRank };
    const d = 0.02; // ~2.2km half-box around the runner
    const bbox = {
      minLon: currentLocation.longitude - d,
      minLat: currentLocation.latitude - d,
      maxLon: currentLocation.longitude + d,
      maxLat: currentLocation.latitude + d,
    };
    api
      .mapPolygons(bbox, 16, { rank: boardRank })
      .then((data) => {
        const feats = [];
        const portraits = [];
        const rivalTerritories = [];
        (data.territories || []).forEach((t) => {
          // Show ALL claimed land around the runner, including their own
          // (their earlier claims), so the board matches the global map.
          const mine = t.user_id === user.id;
          // Same colour the global map paints this plot — see landColor. Land
          // you run past should be the land you saw on the board.
          const fill = landColor(t, { mine, accent });
          const rings = t.rings?.length ? t.rings : [t.polygon];
          if (!mine) rivalTerritories.push({ id: t.id, rings: rings.filter((ring) => ring?.length >= 3) });
          rings.forEach((ring, ri) => {
            if (!ring || ring.length < 3) return;
            const coords = ring.map(([lon, lat]) => [lon, lat]);
            const f = coords[0], l = coords[coords.length - 1];
            if (f[0] !== l[0] || f[1] !== l[1]) coords.push(f);
            feats.push({
              type: 'Feature',
              id: `${t.id}-${ri}`,
              geometry: { type: 'Polygon', coordinates: [coords] },
              properties: { 
                fillColor: fill, 
                strokeColor: fill, 
                // LEVEL 3: My territory - subtle cyan fill, 8-12% opacity
                // LEVEL 4: Enemy territory - 4-6% fill, reduced border opacity
                fillOpacity: mine 
                  ? 0.10 * (0.35 + 0.65 * (t.freshness ?? 1))  // My territory: much quieter
                  : 0.05 * (0.35 + 0.65 * (t.freshness ?? 1)), // Enemy territory: very faint
              },
            });
          });
          // owner portrait at the territory centre (own uses fresh local avatar)
          const av = mine ? equipped : t.avatar;
          const at = ringCentroidLL(rings[0]);
          if (av && at) portraits.push({ id: t.id, at, avatar: av, mine, ring: fill, area: t.area_m2 || 0 });
        });
        setBoard({ type: 'FeatureCollection', features: feats });
        // During active run, show far fewer portraits to reduce visual noise
        // Only show the 3 largest territories instead of 12
        setBoardPortraits(portraits.sort((a, b) => b.area - a.area).slice(0, 3));
        rivalTerritoriesRef.current = rivalTerritories;
      })
      .catch(() => {});
  }, [currentLocation, user.id, accent, equipped, boardRank]);

  useEffect(() => {
    if (!isRunning || !currentLocation) return;
    const hit = rivalTerritoriesRef.current.find((territory) =>
      territory.rings.some((ring) => pointInRing(currentLocation, ring))
    );
    const nextId = hit?.id || null;
    if (nextId && nextId !== currentRivalRef.current) enqueueRunFx({ kind: 'rivalEntry' });
    currentRivalRef.current = nextId;
  }, [currentLocation, enqueueRunFx, isRunning]);

  // ---- crash / stale recovery --------------------------------------------
  // A run left open by a previous process is replayed from its evidence. If
  // there is background evidence of running right up to now it simply
  // carries on; otherwise the runner decides (RunRecoverySheet): finish at the
  // last running movement, resume with the gap excluded, or discard.

  async function restoreSession() {
    const bg = await drainBackgroundPoints();
    const restored = await sessionRef.current.restore({ backgroundFixes: bg });
    if (!restored) return false;
    runRef.current = { id: restored.runId };
    startedAtRef.current = restored.startedAt;
    const trail = restored.trail;
    pathRef.current = trail.points;
    setPath(trail.points);
    setDistance(trail.distanceM);
    distanceMRef.current = trail.distanceM;
    gpsFilterRef.current.seed(trail.points, trail.distanceM);
    lastKmRef.current = Math.floor(trail.distanceM / 1000);
    setIsRunning(true);
    isRunningRef.current = true;
    setRecording(true);
    setAfterRun(null);
    if (restored.decision.required) {
      setRecovery({ lastActiveAt: restored.decision.lastActiveAt, distanceM: trail.distanceM });
    } else {
      await continueAfterRecovery();
    }
    return true;
  }

  // Recording again after a restore or a RESUME from the sheet.
  async function continueAfterRecovery(gapFrom) {
    await sessionRef.current.continueRecording({ gapFrom });
    rebuildTrail();
    startClock();
    await startWatchingLocation('high');
    startBackgroundTrack();
  }

  async function resumeFromRecovery() {
    if (!recovery) return;
    setRecoveryBusy(true);
    try {
      await continueAfterRecovery(recovery.lastActiveAt);
      setRecovery(null);
      setAutoPaused(false);
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function finishFromRecovery() {
    setRecoveryBusy(true);
    try {
      setRecovery(null);
      await finishRun();
    } finally {
      setRecoveryBusy(false);
    }
  }

  function discardFromRecovery() {
    Alert.alert('Discard this run?', 'It will not be saved and cannot be recovered.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          stopWatchingLocation();
          await stopBackgroundTrack();
          await drainBackgroundPoints();
          if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
          }
          await sessionRef.current.close();
          runRef.current = null;
          pathRef.current = [];
          setPath([]);
          setDistance(0);
          distanceMRef.current = 0;
          setElapsedS(0);
          setRecovery(null);
          setAutoPaused(false);
          setSessionNotice(null);
          setIsRunning(false);
          isRunningRef.current = false;
          setRecording(false);
        },
      },
    ]);
  }

  async function prepareLocation() {
    // When In Use only. The explainer screen normally granted this already;
    // if we're still undetermined (user skipped), ask now — with context.
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setPermDenied(true);
      return false;
    }
    setPermDenied(false);
    try {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const point = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        timestamp: Date.now(),
      };
      setCurrentLocation(point);
      setAccuracyM(location.coords.accuracy ?? null);
      mapRef.current?.flyTo({ latitude: point.latitude, longitude: point.longitude }, 16, 500);
    } catch {}
    return true;
  }

  async function startRun() {
    if (startingRef.current) return;
    // One PASER run per person: a workout the watch is recording right now
    // is that run, and the phone does not start a second one beside it.
    const owner = canStartPhoneRun({ watchWorkout: watchWorkoutStatus(), now: Date.now() });
    if (!owner.allowed) {
      Alert.alert(
        'Run in progress on Apple Watch',
        'Your watch is recording a run. Finish it there before starting one here.'
      );
      return;
    }
    startingRef.current = true;
    setStarting(true);
    try {
      haptic.light();
      setAfterRun(null);
      setStartCountdown(3);
      await wait(520);
      setStartCountdown(2);
      await wait(520);
      setStartCountdown(1);
      await wait(520);

      const createdRun = await api.startRun();
      setStartCountdown('GO');
      haptic.success();
      // API returns { run_id, started_at }; older builds returned { id }.
      runRef.current = { id: createdRun.run_id || createdRun.id };
      bgHeldRef.current = false;
      pathRef.current = [];
      gpsFilterRef.current.reset();
      setPaceSPerKm(null);
      startedAtRef.current = Date.now();
      // A fresh session replaces any stale one on this device.
      await sessionRef.current.begin({ runId: runRef.current.id, startedAt: startedAtRef.current });

      setPath([]);
      setDistance(0);
      distanceMRef.current = 0;
      setElapsedS(0);
      setPaused(false);
      pausedRef.current = false;
      setLocked(false);
      // A fresh run starts with no notice or pause left over from the last one.
      setSessionNotice(null);
      setAutoPaused(false);
      setRecovery(null);
      setIsRunning(true);
      isRunningRef.current = true;
      setRecording(true);
      recentSpeedsRef.current = [];
      gpsModeRef.current = 'high';
      pendingModeRef.current = { mode: null, count: 0 };
      lastKmRef.current = 0;
      lastTierRef.current = RUN_TIER.UNQUALIFIED;
      currentRivalRef.current = null;
      setRunFxQueue([]);

      startClock();

      await startWatchingLocation('high');
      startBackgroundTrack();
    } catch (err) {
      toast.error(err.message || 'Could not start run');
    } finally {
      setTimeout(() => setStartCountdown(null), 620);
      setStarting(false);
      startingRef.current = false;
    }
  }

  // TUTORIAL ONLY, see run/tutorialRun.js. Pressed by the RUNNER, on the real
  // Start button, while the tutorial is on its run step. Plays the same
  // countdown as a real start, then draws a made up route over about four
  // seconds. Nothing here reaches the network, persists a run, or writes to
  // HealthKit: the run, the claim and everything after it are invented on the
  // device (see ResultScreen's own `tutorialSim` branches).
  //
  // When the route has drawn itself the demo does NOT finish: it shows the
  // Finish demo run button and waits for the runner to press it.
  async function startTutorialSimRun() {
    if (startingRef.current || isRunningRef.current) return;
    startingRef.current = true;
    setStarting(true);
    // The press IS the event. The countdown below is its feedback.
    tutorialSignal(SIGNAL.RUN_STARTED);
    try {
      haptic.light();
      setAfterRun(null);
      setDemoRouteDone(false);
      setStartCountdown(3);
      await wait(520);
      setStartCountdown(2);
      await wait(520);
      setStartCountdown(1);
      await wait(520);
      setStartCountdown('GO');
      haptic.success();

      tutorialSimRef.current = true;
      const trace = buildTutorialTrace({
        origin: currentLocation || pathRef.current[0] || FALLBACK_ORIGIN,
        seed: Math.floor(Math.random() * 1e9),
      });
      tutorialTraceRef.current = trace;
      // Never persisted: the demo never begins a run session, and the real
      // GPS watcher (the only thing that records evidence) never starts.
      runRef.current = { id: `tutorial-${trace.startedAtMs}` };
      bgHeldRef.current = false;
      pathRef.current = [];
      setPath([]);
      setDistance(0);
      distanceMRef.current = 0;
      setElapsedS(0);
      setPaused(false);
      pausedRef.current = false;
      setLocked(false);
      setSessionNotice(null);
      setAutoPaused(false);
      setIsRunning(true);
      isRunningRef.current = true;
      setRecording(true);
      lastTierRef.current = RUN_TIER.UNQUALIFIED;
      startedAtRef.current = Date.now();

      // Distance and elapsed time advance TOGETHER off the trace's own
      // fraction, so the pace reads correctly even though the clock races.
      const points = trace.points;
      let frame = 0;
      tutorialSimTimerRef.current = setInterval(() => {
        frame += 1;
        const upto = Math.max(2, Math.min(points.length, Math.round((frame / DEMO_FRAMES) * points.length)));
        const slice = points.slice(0, upto);
        pathRef.current = slice;
        setPath(slice);
        const coveredM = totalDistanceMeters(slice);
        setDistance(coveredM);
        distanceMRef.current = coveredM;
        const coveredS = (slice[slice.length - 1].timestamp - points[0].timestamp) / 1000;
        setElapsedS(Math.max(0, Math.round(coveredS)));
        setPaceSPerKm(Math.round(trace.durationS / (trace.distanceM / 1000)));
        if (upto >= points.length && tutorialSimTimerRef.current) {
          clearInterval(tutorialSimTimerRef.current);
          tutorialSimTimerRef.current = null;
          setDemoRouteDone(true);
          tutorialSignal(SIGNAL.DEMO_ROUTE_DONE);
        }
      }, DEMO_FRAME_MS);
    } finally {
      setTimeout(() => setStartCountdown(null), 620);
      setStarting(false);
      startingRef.current = false;
    }
  }

  // The tutorial was skipped (or ended) with a demo still on screen. Nothing
  // of it may outlive the tutorial, so it is dropped here, silently.
  useEffect(() => {
    if (tutorialDemo || !tutorialSimRef.current) return;
    if (tutorialSimTimerRef.current) {
      clearInterval(tutorialSimTimerRef.current);
      tutorialSimTimerRef.current = null;
    }
    tutorialSimRef.current = false;
    runRef.current = null;
    pathRef.current = [];
    setPath([]);
    setDistance(0);
    distanceMRef.current = 0;
    setElapsedS(0);
    setDemoRouteDone(false);
    setIsRunning(false);
    isRunningRef.current = false;
    setRecording(false);
    // setRecording is stable; the demo flag is what this is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorialDemo]);

  // ---- adaptive GPS sampling ---------------------------------------------
  // High accuracy + tight interval while pace is changing or a loop closure
  // is near; relaxed during steady straight-line running to save battery.

  function decideGpsMode(newPath, nextPoint, speedMps) {
    // Early run: always high until a loop is even possible.
    if (newPath.length < T.minPointsForLoop) return 'high';

    // Pace changing?
    const speeds = recentSpeedsRef.current;
    if (speedMps != null) {
      speeds.push(speedMps);
      if (speeds.length > 6) speeds.shift();
    }
    const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const paceChanging =
      speedMps != null && speeds.length >= 3 && Math.abs(speedMps - avg) > T.paceChangeMps;

    // Closure near? (any earlier, non-recent segment within closureNearM)
    let closureNear = false;
    for (let k = 0; k < newPath.length - 4; k++) {
      if (pointToSegmentMeters(newPath[k], newPath[k + 1], nextPoint) <= T.closureNearM) {
        closureNear = true;
        break;
      }
    }

    return paceChanging || closureNear ? 'high' : 'relaxed';
  }

  async function maybeSwitchGpsMode(desired) {
    if (desired === gpsModeRef.current) {
      pendingModeRef.current = { mode: null, count: 0 };
      return;
    }
    const pending = pendingModeRef.current;
    if (pending.mode === desired) pending.count += 1;
    else pendingModeRef.current = { mode: desired, count: 1 };

    // Only switch once the desired mode has been stable for a few points —
    // restarting the OS watcher has a cost of its own.
    if (pendingModeRef.current.count >= T.modeStablePoints && !restartingWatchRef.current) {
      restartingWatchRef.current = true;
      gpsModeRef.current = desired;
      pendingModeRef.current = { mode: null, count: 0 };
      try {
        await startWatchingLocation(desired);
      } finally {
        restartingWatchRef.current = false;
      }
    }
  }

  async function startWatchingLocation(mode = 'high') {
    stopWatchingLocation();
    const cfg =
      mode === 'high'
        ? {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: T.gpsHigh.timeIntervalMs,
            distanceInterval: T.gpsHigh.distanceIntervalM,
          }
        : {
            // Highest, not High. High is iOS's nearest-ten-metres class, and
            // dropping to it mid-run changed the noise character of the whole
            // stream: the trail visibly loosened and the pace stepped every
            // time the mode flipped. Highest keeps the same grade of fix and
            // saves battery through the sampling interval instead.
            accuracy: Location.Accuracy.Highest,
            timeInterval: T.gpsRelaxed.timeIntervalMs,
            distanceInterval: T.gpsRelaxed.distanceIntervalM,
          };
    watchRef.current = await Location.watchPositionAsync(cfg, handleLocation);
  }

  async function handleLocation(location) {
    const reportedSpeed =
      location.coords.speed != null && location.coords.speed >= 0 ? location.coords.speed : null;
    const rawFix = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      // The fix's own timestamp, not the moment JS happened to receive it.
      // iOS can hand over a small batch at once, and dating those by arrival
      // collapses their spacing to milliseconds, which made every derived
      // speed nonsense: phantom sprints for the vehicle gate to punish and a
      // pace that lurched with the delivery schedule rather than the running.
      timestamp: location.timestamp || Date.now(),
      // Android exposes the mock-provider flag as `mocked`; iOS never does.
      mocked: location.mocked ?? false,
      accuracyM: location.coords.accuracy ?? null,
      speedMps: reportedSpeed,
      // Kept client-side only (the API points carry no altitude): the result
      // screen turns the series into elevation gain. Runs recorded before this
      // simply have no elevation, and the metric hides itself.
      altitude: location.coords.altitude ?? null,
    };
    // The marker and the signal dot follow the raw stream, so the runner's
    // dot never lags even while a fix is being rejected for the trail.
    setCurrentLocation(rawFix);
    setAccuracyM(location.coords.accuracy ?? null);

    // Spoofed fixes (mock providers) never enter the trail.
    if (rawFix.mocked) return;

    // EVIDENCE FIRST. Every fix is recorded for the session whatever state the
    // run is in: a stop, a drive or a bike ride is judged from these later,
    // and an auto-pause resumes off them. Only a stretch the session is
    // currently counting extends the trail.
    sessionRef.current.recordFix(rawFix);
    if (!sessionRef.current.status()?.counting) return;

    // Accuracy gate, Kalman smoothing and the noise-scaled step gate all live
    // in the filter. A fix that is merely too small a step still updates the
    // estimate; it just does not add distance yet, and the metres it did
    // cover ride along into the next step that clears the gate.
    const res = gpsFilterRef.current.accept(rawFix);

    // A physically impossible jump. The session sees the raw fix anyway.
    if (res.reason === DROP.TELEPORT) return;
    if (!res.advanced) return;

    const nextPoint = res.point;
    const newPath = [...pathRef.current, nextPoint];
    pathRef.current = newPath;
    setPath(newPath);
    setDistance(res.distanceM);
    distanceMRef.current = res.distanceM;


    // Camera tracking: position player at 55-65% down screen instead of perfect center
    // This gives more visible map ahead of the runner
    if (!userPanned && Date.now() - lastCameraUpdateRef.current > 200) {
      // Calculate heading for camera offset
      let heading = 0;
      if (path.length >= 2) {
        const prev = path[path.length - 2];
        const dx = nextPoint.longitude - prev.longitude;
        const dy = nextPoint.latitude - prev.latitude;
        heading = Math.atan2(dy, dx) * (180 / Math.PI);
      }
      
      // Offset camera slightly in direction of heading, or just down if heading unreliable
      const offsetMeters = 50; // Approximate offset for better forward visibility
      const earthRadius = 6371000;
      const offsetLat = (offsetMeters / earthRadius) * (180 / Math.PI);
      const offsetLon = offsetLat / Math.cos(nextPoint.latitude * Math.PI / 180);
      
      const cameraLat = nextPoint.latitude - offsetLat * 0.3; // Slightly behind player
      const cameraLon = nextPoint.longitude;
      
      mapRef.current?.flyTo({ latitude: cameraLat, longitude: cameraLon }, undefined, 300);
      lastCameraUpdateRef.current = Date.now();
    }

    // Adaptive sampling decision.
    const speedMps = reportedSpeed != null ? reportedSpeed : res.speedMps;
    maybeSwitchGpsMode(decideGpsMode(newPath, nextPoint, speedMps));

    if (runRef.current && newPath.length % 5 === 0) {
      try {
        const res = await api.submitPath(runRef.current.id, toApiPoints(newPath));
        // The server's reading of the day so far. Anchoring the local
        // entitlement curve to this is what keeps the live "claim zone" honest
        // across several runs in one day, without asking for it every second.
        if (typeof res?.daily_claim_distance_m === 'number') {
          setDailyClaimDistanceM(res.daily_claim_distance_m);
        }
      } catch (err) {
        // non-fatal — GPS keeps recording; /end-run reconciles the full path
      }
    }
  }

  function stopWatchingLocation() {
    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }
  }

  // ---- run clock ----------------------------------------------------------
  // ONCE A SECOND, not four times.
  //
  // This interval used to run at 250 ms because the elapsed readout wanted it
  // that way, and it set screen-level state, so the whole screen — live map
  // included — reconciled at 4 Hz for the length of every run. The readout has
  // its own quarter-second clock now (RunClock), which redraws one line of
  // text and nothing else. What is left here is the pair of values the SCREEN
  // genuinely needs: whole elapsed seconds for the claim gate and the run
  // tier, and the smoothed pace, both of which were already once-a-second.
  //
  // Both setters are written so an unchanged value is a no-op: React bails out
  // of a re-render when the next state is identical, so a steady pace and a
  // second that has not turned cost nothing at all.

  function startClock() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const now = Date.now();
      // Moving time and every session decision (stops, resumes, drives,
      // staleness) come from the session tick.
      if (!tutorialSimRef.current) onSessionTick(now);
      const p = gpsFilterRef.current.paceSPerKm(now);
      setPaceSPerKm(p == null ? null : Math.round(p));
    }, 1000);
  }

  // ---- pause / resume -----------------------------------------------------
  // The RUNNER's pause. Stops GPS; the session records the pause window, so
  // moving time and distance exclude it, and it never ends on its own.

  function pauseRun() {
    // The ref, not the state. `paused` is whatever it was when this closure
    // was made, so two calls inside one tick both saw false and both opened a
    // pause window — a duplicate entry with `to: null` that resumeFromPause
    // closes only one of, leaving the run permanently mid-pause.
    if (pausedRef.current) return;
    pausedRef.current = true;
    const now = Date.now();
    pausedAtRef.current = now;
    // The runner's pause: never ends on its own (see run/session).
    sessionRef.current.userPause(now);
    stopWatchingLocation();
    // With PASER on a paired watch, the background location session stays up
    // through the pause. With the phone locked in a pocket it is the one thing
    // keeping this app's process alive, and without it a Resume pressed on the
    // wrist would land on a suspended app that iOS will not let switch
    // location back on from the background. Whatever it records meanwhile
    // falls inside the pause window above and never reaches the trail. No
    // watch, no change: the session stops here as it always has.
    bgHeldRef.current = watchAppInstalled();
    if (!bgHeldRef.current) stopBackgroundTrack();
    // The session tick keeps running through a pause: it is what notices a
    // pause that has been forgotten.
    setPaused(true);
  }

  async function resumeFromPause() {
    // Resume pressed while PASER itself had paused the run (a long stop, or
    // motion it took for a drive or a bike): the runner's word wins.
    if (!pausedRef.current) {
      if (sessionRef.current.forceResume(Date.now())) {
        setAutoPaused(false);
        setSessionNotice(null);
        rebuildTrail();
      }
      return;
    }
    pausedRef.current = false;
    const now = Date.now();
    await sessionRef.current.userResume(now);
    setElapsedS(Math.max(0, Math.floor(sessionRef.current.movingMs(now) / 1000)));
    // The estimate goes cold across a pause: reseeding stops the time gap
    // from reading as a teleport, and stops the stationary stretch from
    // dragging the pace window down.
    gpsFilterRef.current.resume();
    setPaceSPerKm(null);
    if (!tickRef.current) startClock();
    await startWatchingLocation(gpsModeRef.current);
    // A session held through the pause never stopped. Starting it again would
    // also empty its buffer, and with the phone in a pocket that buffer is the
    // only record of the stretch run just before the pause.
    if (bgHeldRef.current) bgHeldRef.current = false;
    else startBackgroundTrack();
    setPaused(false);
  }

  async function finishRun() {
    if (finishingRef.current || !isRunningRef.current) return;
    finishingRef.current = true;
    haptic.light();

    // TUTORIAL ONLY. The real branch below submits to /end-run; this one
    // never has a real run to submit — see startTutorialSimRun.
    if (tutorialSimRef.current) {
      if (tutorialSimTimerRef.current) {
        clearInterval(tutorialSimTimerRef.current);
        tutorialSimTimerRef.current = null;
      }
      setPaused(false);
      setLocked(false);
      setDemoRouteDone(false);
      setIsRunning(false);
      isRunningRef.current = false;
      setRecording(false);
      // Pressed within the first tick — before the trace has drawn even two
      // points of its own. Falls back to its first stretch rather than
      // handing ResultScreen a ring with nothing in it.
      const finalPath = pathRef.current.length >= 2
        ? pathRef.current
        : (tutorialTraceRef.current?.points || []).slice(0, 2);
      const result = buildTutorialResult({
        path: finalPath,
        distanceM: totalDistanceMeters(finalPath),
        startedAtMs: startedAtRef.current,
        endedAtMs: Date.now(),
      });
      tutorialSimRef.current = false;
      finishingRef.current = false;
      navigation.navigate('Result', { result, run: result, path: finalPath, tutorialSim: true });
      // Reported AFTER the claim screen has been asked for, so the tutorial's
      // claim step is never live for a moment over the run screen.
      tutorialSignal(SIGNAL.RUN_FINISHED);
      return;
    }

    // Where the run ends is the session's call: the last running movement if
    // the runner had stopped, paused, driven off or forgotten, else now.
    const finishAt = Date.now();
    pausedRef.current = false;
    setPaused(false);
    setLocked(false);
    // A REAL run never moves the tutorial: only the demo's finish does (above).
    stopWatchingLocation();
    // Request bounded save time before stopping GPS. Location must not be
    // kept running after Finish just to prevent suspension during an upload.
    await beginRunSave();
    try {
      await stopBackgroundTrack();
      // fold in anything the background task recorded before we submit
      await mergeBackgroundPoints();
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setIsRunning(false);
      isRunningRef.current = false;
      setRecording(false);

      const run = runRef.current;
      if (!run) {
        Alert.alert('No active run', 'Start a run first.');
        return;
      }
      // The run as validated: accepted running segments only, each point
      // tagged with its segment, plus the summary the server's anti-cheat
      // reads. Distance, territory and rewards all come from these points.
      const session = await sessionRef.current.finalize(finishAt);
      const finalPath = session?.points || [];
      setAutoPaused(false);
      setSessionNotice(null);
      if (finalPath.length < 2) {
        // The phone is still on this screen, so the watch goes back to Start,
        // with a word about why nothing was saved.
        await sessionRef.current.close();
        setAfterRun({ status: WATCH_PHASE.READY, notice: 'Too short to save. Move around first.' });
        Alert.alert('Too short', 'Move around first before ending the run.');
        return;
      }
      pathRef.current = finalPath;
      setPath(finalPath);
      setDistance(session.distanceM);
      setAfterRun({
        status: WATCH_PHASE.SAVING,
        distanceM: session.distanceM,
        elapsedMs: session.movingMs,
      });
      if (__DEV__) {
        // DEV ONLY: why each stretch of the run was classified as it was.
        // eslint-disable-next-line no-console
        console.log('[run-session]', JSON.stringify({ summary: session.summary, notice: session.notice, diagnostics: session.diagnostics }));
      }
      await commitRun(run, finalPath, {
        steps: session.stepsInRunning,
        sessionSummary: session.summary,
        notice: session.notice,
        workoutStartMs: session.startedAt,
        workoutEndMs: session.endedAt,
      });
    } finally {
      bgHeldRef.current = false;
      await endRunSave();
      finishingRef.current = false;
    }
  }

  // The recorded path stays in memory whatever the network does — a failed
  // /end-run is retryable, never fatal to the run data.
  async function commitRun(
    run,
    finalPath,
    {
      steps = null, simulated = false, devScenario = 'open',
      workoutStartMs = startedAtRef.current || Date.now(),
      workoutEndMs = Date.now(),
      sessionSummary = null, notice = null,
    } = {}
  ) {
    if (savingRef.current) return;
    savingRef.current = true;
    // A retry after a failed save puts the watch back on "saving". Runs that
    // never went through finishRun (an orphan submitted anyway, the dev
    // simulator) have no afterRun and leave the watch alone.
    setAfterRun((a) => (a ? { ...a, status: WATCH_PHASE.SAVING, notice: '' } : a));
    try {
      // Steps are the ones taken inside the accepted running segments, sent
      // whenever a pedometer exists — INCLUDING zero. Counting only those is
      // what keeps a stride check honest across pauses and excluded drives.
      const result = await api.endRun(
        run.id,
        toApiPoints(finalPath),
        steps,
        simulated,
        sessionSummary
      );
      if (simulated && devScenario === 'steal') {
        try {
          await api.devSeedRivalForRun(result.run_id);
        } catch (error) {
          // The run is already safely stored. Keep the result reachable and
          // say only that its optional board setup failed.
          toast.error(error.message || 'Could not place the dev rival');
        }
      }
      if (!simulated) await sessionRef.current.close();
      // A substantial stretch left out of the run is told, not hidden.
      if (notice?.message) toast.show(notice.message, { durationMs: 6500 });
      // The feed, your stats and the boards all just changed. Drop them so the
      // tabs you come back to fetch fresh numbers instead of serving the
      // pre-run cache for the length of their staleness window.
      invalidateAfterRun();
      // Optional, write-only Apple Health sync (no-op unless the runner turned
      // it on in Settings and granted write access).
      // A simulated run is skipped: the dev harness may write to the server,
      // which is its whole purpose, but it has no business putting a workout
      // nobody did into the phone's health record.
      if (!simulated) {
        writeWorkout({
          startMs: workoutStartMs,
          endMs: workoutEndMs,
          distanceM: totalDistanceMeters(finalPath),
        }).catch(() => {});
      }
      setAfterRun((a) => (a ? { ...a, status: WATCH_PHASE.SAVED } : a));
      navigation.navigate('Result', { result, run: result, path: finalPath });
    } catch (err) {
      setAfterRun((a) =>
        a ? { ...a, status: WATCH_PHASE.UNSAVED, notice: 'Open PASER on your iPhone to try again.' } : a
      );
      Alert.alert(
        "Couldn't save your run",
        `${err.message || 'Network error'}. Your route is still on this phone.`,
        [
          {
            text: 'Retry',
            onPress: () => commitRun(run, finalPath, {
              steps, simulated, devScenario, workoutStartMs, workoutEndMs, sessionSummary, notice,
            }),
          },
          { text: 'Later', style: 'cancel' },
        ]
      );
    } finally {
      savingRef.current = false;
    }
  }

  // DEV ONLY — see components/DevRunSimulator. Builds a trace, opens a run
  // backdated to when that trace started, and commits it down the ordinary
  // path, so what lands on the result screen is the server's real answer.
  async function simulateRun(preset, devScenario = 'open') {
    if (simulating || isRunning) return;
    setSimulating(true);
    try {
      haptic.light();
      const sim = buildSimulatedRun({
        origin: currentLocation || pathRef.current[0] || FALLBACK_ORIGIN,
        distanceM: preset.distanceM,
        paceSPerKm: preset.paceSPerKm,
        // A fresh shape each time — the same loop twice would claim the same
        // ground twice and the second one would look like it did nothing.
        seed: Math.floor(Math.random() * 1e9),
      });
      // The duration comes off the RUN ROW, not the trace: a run started and
      // ended in the same second is a two-second activity whatever its points
      // say, and would be gated as too short before anything else ran.
      const created = await api.startRun(sim.startedAtMs);
      const run = { id: created.run_id || created.id };
      runRef.current = run;
      pathRef.current = sim.points;
      startedAtRef.current = sim.startedAtMs;
      setPath(sim.points);
      const simDistance = totalDistanceMeters(sim.points);
      setDistance(simDistance);
      distanceMRef.current = simDistance;
      await commitRun(run, sim.points, {
        steps: sim.stepCount,
        simulated: true,
        devScenario,
      });
    } catch (err) {
      toast.error(err.message || 'Could not simulate a run');
    } finally {
      setSimulating(false);
    }
  }

  function simulateRivalTake() {
    if (simulating || isRunning) return;
    Alert.alert(
      'Let the dev rival take your land?',
      'This changes real development data: your largest live territory will be attacked and the loss will appear in your rivalry and notifications.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Take my land',
          style: 'destructive',
          onPress: async () => {
            setSimulating(true);
            try {
              const result = await api.devRivalTakesMine();
              invalidateAfterLandLoss();
              // Everything the endpoint returns, not a subset. The three
              // fields this used to drop are the three the alert's cutscene
              // is built out of: `territory_id` is the hash seed that
              // resolves the SAME capture style the attacker's screen played,
              // `territory_ring` is the ground the reveal traces (without it
              // the alert falls back to a stand-in footprint), and
              // `actor_rank_key` is the frame around the rival's portrait.
              // The real push/inbox path has always carried all three, so
              // dropping them here made the dev scenario quietly exercise a
              // weaker alert than the one runners actually get.
              landCaptureAlert.show({
                category: 'stolen',
                capture_id: result.capture_id,
                rival_id: result.rival_id,
                rival_username: result.rival_username,
                rival_avatar: result.rival_avatar,
                actor_rank_key: result.rival_rank_key,
                taken_m2: result.taken_m2,
                territory_id: result.territory_id,
                territory_ring: result.territory_ring,
                lat: result.lat,
                lon: result.lon,
                title: 'Your land was captured',
                body: `${result.rival_username} took ${((result.taken_m2 || 0) / 1e6).toFixed(3)} km² of your territory.`,
              });
            } catch (error) {
              toast.error(error.message || 'Could not run the rival capture scenario');
            } finally {
              setSimulating(false);
            }
          },
        },
      ]
    );
  }

  // Pace comes off the filter's trailing window, not off total time over total
  // distance. The cumulative reading inherited every jump the distance made
  // and then took the rest of the run to forget it; the window one is
  // measured over the last stretch actually run and smoothed on the way out.
  // Nothing is shown until there is a real measurement, so the wild first
  // hundred metres never appear.
  const paceText = (() => {
    if (paceSPerKm == null) return '·';
    const m = Math.floor(paceSPerKm / 60);
    const s = Math.round(paceSPerKm % 60);
    const carry = s === 60;
    return `${carry ? m + 1 : m}:${String(carry ? 0 : s).padStart(2, '0')} /km`;
  })();

  // The land this run has earned so far, off the SAME function the server
  // settles with (src/config/economy.js). This used to be a local
  // `(d * d) / (4 * Math.PI)` — the retired circle model — which at 5 km
  // promised 1.99 km² against the 0.375 km² actually granted.
  const claimArea = entitledAreaM2(dailyClaimDistanceM, distance);
  // Distance and duration only: distinct-ground needs the buffered-corridor
  // area, which is the server's to measure. So this is optimistic by design —
  // it says what is still MISSING, never that a run is definitely eligible.
  const claimBlocker = claimGateReason(distance, elapsedS);
  const currentTier = runTier(distance, elapsedS);
  const earningNothing = currentTier === RUN_TIER.UNQUALIFIED;

  useEffect(() => {
    if (!isRunning) return;
    const completedKm = Math.floor(distance / 1000);
    if (completedKm > lastKmRef.current) {
      lastKmRef.current = completedKm;
      enqueueRunFx({ kind: 'kilometre', value: completedKm });
    }
  }, [distance, enqueueRunFx, isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    if (currentTier === RUN_TIER.CLAIMABLE && lastTierRef.current !== RUN_TIER.CLAIMABLE) {
      enqueueRunFx({ kind: 'claimReady' });
    }
    lastTierRef.current = currentTier;
  }, [currentTier, enqueueRunFx, isRunning]);
  // Rough energy estimate: ~1.036 kcal per kg per km at a 70 kg default.
  const caloriesKcal = 1.036 * T.defaultWeightKg * (distance / 1000);

  const getMovingMs = useCallback(
    () => (startedAtRef.current ? sessionRef.current.movingMs(Date.now()) : 0),
    []
  );

  // The run as the wrist sees it (src/watch, docs/APPLE_WATCH.md). The watch's
  // buttons go through the same functions as the ones on this screen, and
  // useWatchRun lets each through only in the phase it makes sense in.
  const watchPhase = isRunning
    ? paused || autoPaused
      ? WATCH_PHASE.PAUSED
      : WATCH_PHASE.RUNNING
    : startCountdown != null
      ? WATCH_PHASE.COUNTDOWN
      : afterRun
        ? afterRun.status
        : isFocused && !permDenied && !starting && !simulating
          ? WATCH_PHASE.READY
          : WATCH_PHASE.IDLE;
  useWatchRun(
    {
      phase: watchPhase,
      // Read when a state is sent, not when the screen renders: the heartbeat
      // sends between renders. Paused, the clock stands where it stopped.
      getElapsedMs: () => (startedAtRef.current ? sessionRef.current.movingMs(Date.now()) : 0),
      distanceM: distance,
      paceSPerKm,
      landM2: earningNothing ? null : claimArea,
      accuracyM,
      hint: claimBlocker || '',
      accent,
      countdown: startCountdown,
      qualified: currentTier === RUN_TIER.CLAIMABLE,
      afterRun,
    },
    { start: startRun, pause: pauseRun, resume: resumeFromPause, finish: finishRun }
  );

  // Location denied: a way forward, not a dead end. Not for the tutorial's
  // demo, which needs no location at all: it runs a made up route.
  if (permDenied && !tutorialDemo) {
    return (
      <View style={[styles.container, styles.deniedWrap]}>
        <Text style={styles.deniedTitle}>Location is off</Text>
        <Text style={styles.deniedBody}>
          PASER records your route only during an active run. Without
          location there's nothing to trace. Enable it in Settings and come
          back.
        </Text>
        <PressableScale
          style={[styles.primaryBtn, { backgroundColor: accent, alignSelf: 'stretch' }]}
          onPress={() => Linking.openSettings().catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
        >
          <Text style={styles.primaryBtnText}>Open Settings</Text>
        </PressableScale>
        <PressableScale
          style={styles.deniedBack}
          onPress={() => prepareLocation()}
          accessibilityRole="button"
          accessibilityLabel="Check permission again"
        >
          <Text style={styles.deniedBackText}>I've enabled it, check again</Text>
        </PressableScale>
      </View>
    );
  }

  // A standalone Apple Watch workout owns this run right now. Deliberately
  // NOT the full map/stats/controls tree below — that tree is built around
  // this screen doing its own phone GPS tracking, and threading a second,
  // watch-driven data source through every one of its displays would be how
  // "one canonical owner" quietly grows a second one. This is a plain
  // mirror: the watch's own numbers, read-only, and nothing here can start,
  // pause or finish the run — that stays on the wrist, per PhoneRunView's
  // own note the other direction in targets/watch/RunScreen.swift.
  if (watchMirror.active && !isRunning) {
    const mirrorPaceText = (() => {
      if (watchMirror.paceSPerKm == null) return '·';
      const m = Math.floor(watchMirror.paceSPerKm / 60);
      const s = Math.round(watchMirror.paceSPerKm % 60);
      const carry = s === 60;
      return `${carry ? m + 1 : m}:${String(carry ? 0 : s).padStart(2, '0')} /km`;
    })();
    return (
      <View style={[styles.container, styles.watchMirrorWrap]}>
        <StatusBar hidden={true} />
        <Text style={styles.watchMirrorEyebrow}>
          {watchMirror.paused ? 'PAUSED ON APPLE WATCH' : 'RUNNING ON APPLE WATCH'}
        </Text>
        <Text style={[styles.watchMirrorDistance, { color: accent }]}>
          {(watchMirror.distanceM / 1000).toFixed(2)}
          <Text style={styles.watchMirrorUnit}> km</Text>
        </Text>
        <View style={styles.watchMirrorStatsRow}>
          <Metric label="Time" value={formatDuration(watchMirror.elapsedS * 1000)} accent={D.text} />
          <Metric label="Pace" value={mirrorPaceText} accent={D.text} />
        </View>
        <Text style={styles.watchMirrorHint}>
          {watchMirror.stale
            ? "Your watch hasn't checked in for a bit — this is its last known state."
            : 'Pause, resume and finish from your watch. PASER is just watching.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      {/* The one map that does NOT follow the app's scheme. This screen is a
          night-run surface by design (see `D` above) and its HUD is painted
          dark whatever the rest of the app is wearing, so a light map style
          here would put dark chrome on a white board. */}
      <GameMap 
        ref={mapRef} 
        theme="dark" 
        style={styles.map} 
        initialZoom={16}
        onViewportChange={() => {
          if (isRunning && !userPanned) {
            setUserPanned(true);
          }
        }}
      >
        {/* LEVEL 6: BASE MAP - rendered by Mapbox dark style */}
        
        {/* LEVEL 5: ALL OTHER TERRITORY - very faint during active run */}
        {board && <TerritoryLayer id="run-board" featureCollection={board} dark overview={true} />}

        {/* LEVEL 4: RELEVANT ENEMY TERRITORY - slightly more prominent if runner is nearby */}
        {/* LEVEL 3: MY CURRENT / NEARBY PASER TERRITORY - subtle cyan fill */}
        
        {/* No territory portraits during active run - reduces visual noise */}
        
        {/* LEVEL 2: MY ACTIVE ROUTE - dual-stroke for visibility */}
        {path.length > 1 && (
          <>
            {/* Outer casing - near-black, ~8-10px */}
            <Trail 
              id="route-casing" 
              points={path} 
              color="#0a0a0a" 
              width={10} 
            />
            {/* Inner route - bright PASER accent, ~4-6px */}
            <Trail 
              id="route-core" 
              points={path} 
              color={accent} 
              width={5} 
              glow 
              glowColor={accent}
            />
            {/* Recent route highlight - trailing segment for motion feedback */}
            {path.length > 10 && (
              <Trail 
                id="route-recent" 
                points={path.slice(-10)} 
                color={accent} 
                width={6} 
                glow 
                glowColor={accent}
              />
            )}
          </>
        )}

        {/* START POINT - small outlined marker */}
        {path.length > 0 && (
          <UserMarker point={path[0]}>
            <View style={styles.startMarker}>
              <View style={[styles.startDot, { backgroundColor: accent }]} />
            </View>
          </UserMarker>
        )}

        {/* LEVEL 1: MY CURRENT POSITION - most prominent, actual PASER character */}
        {currentLocation && (
          <UserMarker point={currentLocation}>
            <View style={styles.playerMarkerContainer}>
              {/* Outer glow ring */}
              <View style={[styles.playerMarkerGlow, { borderColor: accent }]} />
              {/* Inner white stroke */}
              <View style={[styles.playerMarkerStroke, { borderColor: '#ffffff' }]} />
              {/* PASER character portrait */}
              <CharacterBust 
                equipped={equipped} 
                size={44} 
                ring="#ffffff" 
                bg={D.bust} 
                crisp 
              />
              {/* Heading indicator if available */}
              {path.length >= 2 && (
                <View style={[
                  styles.headingIndicator,
                  { 
                    borderTopColor: accent,
                    transform: [{ 
                      rotate: `${Math.atan2(
                        currentLocation.latitude - path[path.length - 2].latitude,
                        currentLocation.longitude - path[path.length - 2].longitude
                      ) * (180 / Math.PI)}deg` 
                    }] 
                  }
                ]}>
                  <View style={styles.headingArrow} />
                </View>
              )}
            </View>
          </UserMarker>
        )}
      </GameMap>

      {/* Compact overlay - minimal information during active run */}
      <View style={styles.compactOverlay}>
        <View style={styles.compactStat}>
          <Text style={styles.compactLabel}>DISTANCE</Text>
          <Text style={styles.compactValue}>
            {(distance / 1000).toFixed(2)} KM
          </Text>
        </View>
        <View style={styles.compactDivider} />
        <View style={styles.compactStat}>
          <Text style={styles.compactLabel}>TIME</Text>
          <RunClock
            getMs={getMovingMs}
            running={isRunning}
            style={styles.compactValue}
          />
        </View>
        <View style={styles.compactDivider} />
        <View style={styles.compactStat}>
          <Text style={styles.compactLabel}>PACE</Text>
          <Text style={styles.compactValue}>
            {paceSPerKm ? paceStr(paceSPerKm) : '·'}
          </Text>
        </View>
      </View>

      {/* GPS indicator removed */}

      {/* Recenter button - appears after user manually pans */}
      {userPanned && isRunning && (
        <PressableScale
          style={styles.recenterButton}
          onPress={() => {
            haptic.light();
            setUserPanned(false);
            if (currentLocation) {
              mapRef.current?.flyTo({ 
                latitude: currentLocation.latitude - 0.0003, 
                longitude: currentLocation.longitude 
              }, undefined, 500);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Recenter on your position"
        >
          <AppIcon name="target" size={20} color={D.text} />
        </PressableScale>
      )}

      {/* What the run session just did (AUTO PAUSED, RUNNING AGAIN, DRIVE
          DETECTED). Under the status bar and over the map, never over the
          panel, so Pause and Finish stay reachable. Tapping dismisses it. */}
      {sessionNotice ? (
        <Pressable
          style={styles.vehicleNotice}
          onPress={() => setSessionNotice(null)}
          accessibilityRole="button"
          accessibilityLabel={`${sessionNotice.title}. ${sessionNotice.body} Tap to dismiss.`}
        >
          <Text style={styles.vehicleNoticeTitle}>{sessionNotice.title}</Text>
          <Text style={styles.vehicleNoticeBody}>{sessionNotice.body}</Text>
        </Pressable>
      ) : null}

      <View style={styles.panel}>
        {/* hero distance + supporting stats (PACER layout) */}
        <View style={styles.heroRow}>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={styles.heroLabel}>DISTANCE</Text>
            <View style={styles.heroValueRow}>
              <Text style={[styles.heroValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
                {(distance / 1000).toFixed(2)}
              </Text>
              <Text style={styles.heroUnit}>km</Text>
            </View>
          </View>
          <View style={styles.sideStats}>
            <Metric label="Pace" value={paceText} accent={D.text} />
            {/* "Land earned", not "claim zone": it is the ground this run has
                banked, and it stays greyed until the run is worth any. */}
            <Metric
              label="Land earned"
              value={earningNothing ? '·' : formatArea(claimArea)}
              accent={earningNothing ? D.dim : accent}
            />
            <Metric label="Calories" value={`${Math.round(caloriesKcal)} kcal`} accent={D.text} />
          </View>
        </View>

        {/* What the run still needs, or what it will do. The old line described
            the retired circle model ("your distance becomes a circle"), which
            has not been how a claim works since territory started being grown
            around the route. */}
        <Text style={styles.openPathLine}>
          {claimBlocker
            ? claimBlocker
            : 'Finish to place your territory on the route.'}
        </Text>

        {!isRunning ? (
          <>
            {/* The app's game CTA (framed, outlined label, hard drop), painted in
                the run's accent. In the tutorial this very button is the one
                the coach mark lights: pressed, it starts the demo instead of a
                real run. */}
            <View {...startTarget} collapsable={false}>
              <ToonButton
                title='Start run'
                onPress={tutorialDemo ? startTutorialSimRun : startRun}
                disabled={starting}
                accessibilityLabel={tutorialDemo ? 'Start demo run' : 'Start run'}
                fill={{ color: accent, border: toon.ink }}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
            {/* Renders nothing unless the SERVER says this account may have
                it (dev_tools on /me), or we're on a dev build. Never while the
                tutorial is running: see DevRunSimulator. */}
            {!tutorialActive ? (
              <DevRunSimulator
                onSimulate={simulateRun}
                onRivalTake={simulateRivalTake}
                busy={simulating}
              />
            ) : null}
          </>
        ) : tutorialSimRef.current ? (
          // THE DEMO'S ONE CONTROL. No pause, no lock and no hold: a tap
          // button that appears when the demo route has finished drawing, and
          // waits for the runner. It calls the same finishRun a real run does.
          demoRouteDone ? (
            <View {...finishTarget} collapsable={false}>
              <ToonButton
                title="Finish demo run"
                onPress={finishRun}
                accessibilityLabel="Finish demo run"
                fill={{ color: accent, border: toon.ink }}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
          ) : (
            <View style={styles.demoSpacer} />
          )
        ) : (
          <View style={styles.controlsRow}>
            <PressableScale
              style={[styles.roundCtl, (paused || autoPaused) && { backgroundColor: accent, borderColor: accent }]}
              onPress={() => { haptic.light(); paused || autoPaused ? resumeFromPause() : pauseRun(); }}
              accessibilityRole="button"
              accessibilityLabel={paused || autoPaused ? 'Resume run' : 'Pause run'}
            >
              {/* Sticker art, like every other action in the app. The lock
                  beside it stays lucide: there is no padlock sticker, and a
                  half-converted row would look worse than a consistent one. */}
              <AppIcon name={paused || autoPaused ? 'play' : 'pause'} size={26} />
            </PressableScale>

            <View style={{ flex: 1 }}>
              <HoldToFinishButton onFinish={finishRun} />
            </View>

            <PressableScale
              style={styles.roundCtl}
              onPress={() => { haptic.light(); setLocked(true); }}
              accessibilityRole="button"
              accessibilityLabel="Lock screen controls"
            >
              <Lock size={20} color={D.text} />
            </PressableScale>
          </View>
        )}
      </View>

      <RunEventOverlay
        event={runFxQueue[0]}
        onDone={dismissRunFx}
      />
      <RunRecoverySheet
        visible={!!recovery}
        lastActiveAt={recovery?.lastActiveAt}
        distanceM={recovery?.distanceM || 0}
        accent={accent}
        busy={recoveryBusy}
        onFinish={finishFromRecovery}
        onResume={resumeFromRecovery}
        onDiscard={discardFromRecovery}
      />
      <RunStartOverlay value={startCountdown} trigger={runFxTokenRef.current} />

      {/* lock overlay: swallow touches until a long-press unlock */}
      {locked && (
        <View style={styles.lockOverlay} pointerEvents="auto">
          <Pressable
            style={styles.unlockBtn}
            delayLongPress={700}
            onLongPress={() => { haptic.light(); setLocked(false); }}
            accessibilityRole="button"
            accessibilityLabel="Hold to unlock"
          >
            <Lock size={22} color="#fff" />
            <Text style={[type.bodySmBold, { color: '#fff' }]}>Hold to unlock</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Metric({ label, value, accent }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: D.bg },
  // Holds the controls' height while the demo route draws, so the panel does
  // not jump when Finish demo run appears.
  demoSpacer: { height: 56 },
  map: { flex: 1 },
  
  // LEVEL 1: Player marker - most prominent element
  playerMarkerContainer: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  playerMarkerGlow: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    opacity: 0.6,
  },
  playerMarkerStroke: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    backgroundColor: D.card,
  },
  
  // Start marker - small and subtle
  startMarker: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ffffff',
  },

  // Heading indicator - small directional wedge
  headingIndicator: {
    position: 'absolute',
    bottom: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#00ffff',
  },
  headingArrow: {
    position: 'absolute',
    top: -8,
    left: -2,
    width: 4,
    height: 4,
    backgroundColor: '#ffffff',
    borderRadius: 2,
  },

  // Recenter button
  recenterButton: {
    position: 'absolute',
    bottom: space.xl + 140,
    right: space.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: D.glassStrong,
    borderWidth: 1,
    borderColor: getNbInk(),
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // Compact overlay styles
  compactOverlay: {
    position: 'absolute',
    bottom: space.xl + 80, // Above the panel
    left: space.md,
    right: space.md,
    backgroundColor: D.glassStrong,
    borderWidth: 1,
    borderColor: getNbInk(),
    borderRadius: 8,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  compactStat: {
    alignItems: 'center',
    flex: 1,
  },
  compactLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: D.muted,
    marginBottom: 2,
  },
  compactValue: {
    fontSize: 14,
    fontWeight: '600',
    color: D.text,
  },
  compactDivider: {
    width: 1,
    height: 24,
    backgroundColor: D.border,
    marginHorizontal: space.sm,
  },
  
  // Minimal GPS indicator
  gpsIndicator: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    backgroundColor: D.glass,
    borderWidth: 1,
    borderColor: getNbInk(),
    borderRadius: 20,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gpsText: {
    fontSize: 11,
    fontWeight: '500',
    color: D.muted,
  },
  
  liveMarker: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },

  // Removed old topBar styles - replaced with compact overlay
  gpsDot: { width: 8, height: 8, borderRadius: 4 },

  // Docked under the status bar, wearing the same glass and ink as the rest of
  // the HUD so it reads as part of the screen rather than something thrown on
  // top of it. Deliberately NOT centred, NOT full-bleed and NOT animated: it
  // is a notice, and the thing item 12 asks for is that it stay out of the way.
  vehicleNotice: {
    position: 'absolute',
    top: space.md + 52,
    left: space.md,
    right: space.md,
    backgroundColor: D.glassStrong,
    borderWidth: NB.strokeThin,
    borderColor: nbInk('dark', D.card),
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    gap: 2,
  },
  vehicleNoticeTitle: { ...type.bodySmBold, color: D.text },
  vehicleNoticeBody: { ...type.caption, color: D.muted },

  prompt: {
    position: 'absolute',
    top: 64,
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: D.card,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  promptDot: { width: 9, height: 9, borderRadius: 5 },
  promptText: { ...type.bodySmBold, color: D.text, flex: 1 },

  panel: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.lg,
    backgroundColor: D.card,
    borderRadius: radius.lg,
    padding: space.lg,
    // Heavy cream NB stroke instead of the old hairline. The soft drop stays:
    // this panel floats over the map and a real separation from the board is
    // worth keeping, but the edge that defines it is now the neo-brutalist one.
    borderWidth: NB.stroke,
    borderColor: nbInk('dark', D.card),
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },

  heroRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  heroLabel: { ...type.labelSm, color: D.dim, letterSpacing: 1.5, marginBottom: 2 },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroValue: { ...type.statHero, fontSize: 54, lineHeight: 58 },
  heroUnit: { ...type.statSm, color: D.muted },
  sideStats: {
    width: 132,
    gap: space.md,
    paddingLeft: space.lg,
    borderLeftWidth: 1,
    borderLeftColor: D.border,
  },

  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  roundCtl: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: D.border,
    backgroundColor: D.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: D.veil,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 64,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: D.glassStrong,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: space.xl,
    paddingVertical: 14,
  },

  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.md },
  metric: { flex: 1 },
  metricLabel: {
    ...type.labelSm,
    color: D.muted,
    marginBottom: 4,
  },
  metricValue: { ...type.statMd },

  openPathLine: { ...type.caption, color: D.dim, marginBottom: space.md },

  primaryBtn: { paddingVertical: 16, borderRadius: radius.pill, alignItems: 'center' },
  primaryBtnText: { ...type.button, color: '#fff' },

  stopBtn: {
    backgroundColor: D.danger,
    paddingVertical: 13,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stopBtnText: { ...type.button, color: '#fff' },

  deniedWrap: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  deniedTitle: { ...type.title, color: D.text, marginBottom: space.md, textAlign: 'center' },
  deniedBody: {
    ...type.body,
    color: D.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: space.xl,
  },
  deniedBack: { marginTop: space.lg },
  deniedBackText: { ...type.bodyMedium, color: D.muted },

  watchMirrorWrap: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  watchMirrorEyebrow: { ...type.labelSm, color: D.muted, letterSpacing: 1 },
  watchMirrorDistance: { fontSize: 56, fontWeight: '800', marginTop: space.md },
  watchMirrorUnit: { fontSize: 22, fontWeight: '600', color: D.muted },
  watchMirrorStatsRow: { flexDirection: 'row', gap: space.xl, marginTop: space.lg },
  watchMirrorHint: {
    ...type.body,
    color: D.muted,
    textAlign: 'center',
    marginTop: space.xl,
    lineHeight: 22,
  },
});
