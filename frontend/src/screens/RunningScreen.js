import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import GameMap, {
  MapPoint,
  TerritoryLayer,
  Trail,
  UserMarker,
} from '../components/GameMap';
import { CharacterBust } from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import { Lock, Pause, Play } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  drainBackgroundPoints,
  startBackgroundTrack,
  stopBackgroundTrack,
} from '../run/backgroundTrack';
import { useClan, NEUTRAL } from '../state/clan';
import { useRecording } from '../state/recording';
import { useSettings } from '../state/settings';
import { writeWorkout } from '../health';
import { darkColors, radius, runTuning as T, space, type } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { toast } from '../ui/toast';

// In-progress run persisted here so an OS kill / crash can't lose a run.
const ACTIVE_RUN_KEY = 'tr.activeRun';

// Night-run surface tokens.
const D = {
  bg: darkColors.bg,
  card: darkColors.card,
  border: darkColors.border,
  text: darkColors.text,
  muted: darkColors.textMuted,
  dim: darkColors.textDim,
  danger: darkColors.danger,
};

// The dark game-board look now comes from the Mapbox dark style URL
// (see config/map.js + SETUP_MAPBOX.md), not an inline tile-style array.

function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function totalDistanceMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

// Circle-claim model: the distance run becomes the CIRCUMFERENCE of the
// claim circle, so area = d²/4π. Placement happens on the Result screen.
function claimAreaM2(distanceM) {
  return (distanceM * distanceM) / (4 * Math.PI);
}

// Per-point sensor metadata rides along for server-side validation:
// mocked (Android mock-provider flag; iOS has no equivalent -> false),
// accuracy and speed when the platform reports them.
function toApiPoints(points) {
  return points.map((p) => ({
    lat: p.latitude,
    lon: p.longitude,
    t: new Date(p.timestamp).toISOString(),
    mocked: p.mocked ?? false,
    accuracy_m: p.accuracyM ?? null,
    speed_mps: p.speedMps ?? null,
  }));
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatArea(m2) {
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
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

export default function RunningScreen({ navigation }) {
  const { user } = useAuth();
  const { setRecording } = useRecording();
  const { color } = useClan();
  const { equipped } = useAvatar();
  const { trailGlowColor } = useSettings();
  const accent = color.stroke;

  const mapRef = useRef(null);
  const watchRef = useRef(null);
  const pathRef = useRef([]);
  const runRef = useRef(null);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);
  // Adaptive-sampling bookkeeping.
  const gpsModeRef = useRef('high'); // 'high' | 'relaxed'
  const pendingModeRef = useRef({ mode: null, count: 0 });
  const recentSpeedsRef = useRef([]);
  const restartingWatchRef = useRef(false);
  // Pedometer: cumulative steps during the run, sent with /end-run so the
  // server can sanity-check stride length.
  const stepCountRef = useRef(0);
  const pedometerSubRef = useRef(null);
  const pedometerOkRef = useRef(false);
  // Vehicle/spoof gate: consecutive too-fast fixes + a distance-vs-steps
  // watchdog. Either tripping auto-pauses the run.
  const fastPointsRef = useRef(0);
  const vehicleTimerRef = useRef(null);
  const vehicleWindowRef = useRef({ dist: 0, steps: 0 });

  const [currentLocation, setCurrentLocation] = useState(null);
  const [path, setPath] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [distance, setDistance] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [accuracyM, setAccuracyM] = useState(null);
  const [permDenied, setPermDenied] = useState(false);
  // Pause freezes the clock + GPS; lock swallows touches until long-press.
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const pausedAtRef = useRef(null);

  // Mirrors isRunning for listeners that outlive renders.
  const isRunningRef = useRef(false);

  useEffect(() => {
    (async () => {
      const granted = await prepareLocation();
      if (granted) await checkOrphanedRun();
    })();
    return () => {
      stopWatchingLocation();
      stopPedometer();
      stopBackgroundTrack();
      stopVehicleWatch();
      setRecording(false);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Screen off / app backgrounded: the foreground watcher dies but the
  // background task keeps recording. On return, fold its buffered points
  // into the trail so there's no straight-line gap.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && isRunningRef.current) mergeBackgroundPoints();
    });
    return () => sub.remove();
  }, []);

  // Merge buffered background fixes into the path, keeping timestamp order
  // (a foreground fix can land before the drain finishes) and the same
  // jitter filter the live watcher applies.
  async function mergeBackgroundPoints() {
    const pts = await drainBackgroundPoints();
    if (!pts.length || !runRef.current) return;
    const merged = [...pathRef.current, ...pts].sort((a, b) => a.timestamp - b.timestamp);
    const out = [];
    for (const p of merged) {
      if (p.mocked) continue;
      const prev = out[out.length - 1];
      if (prev && (p.timestamp === prev.timestamp || distanceMeters(prev, p) < T.minStepM)) continue;
      // Same vehicle gate as the live watcher: drop segments no runner covers.
      if (prev) {
        const v = distanceMeters(prev, p) / Math.max((p.timestamp - prev.timestamp) / 1000, 0.001);
        if (v > T.vehicleSpeedMps) continue;
      }
      out.push(p);
    }
    if (out.length > pathRef.current.length) {
      pathRef.current = out;
      setPath(out);
      setDistance(totalDistanceMeters(out));
      persistActiveRun(out);
    }
  }

  // Nearby claimed land (others'), so a runner sees whose turf they're crossing
  // and where there's land to steal. Refetched only when they drift ~600m.
  const [board, setBoard] = useState(null);
  const boardCenterRef = useRef(null);

  useEffect(() => {
    if (!currentLocation) return;
    const last = boardCenterRef.current;
    if (last && distanceMeters(last, currentLocation) < 600) return;
    boardCenterRef.current = currentLocation;
    const d = 0.02; // ~2.2km half-box around the runner
    const bbox = {
      minLon: currentLocation.longitude - d,
      minLat: currentLocation.latitude - d,
      maxLon: currentLocation.longitude + d,
      maxLat: currentLocation.latitude + d,
    };
    api
      .mapPolygons(bbox, 16)
      .then((data) => {
        const feats = [];
        (data.territories || []).forEach((t) => {
          // Show ALL claimed land around the runner, including their own
          // (their earlier claims), so the board matches the global map.
          const mine = t.user_id === user.id;
          const col = t.clan_color || NEUTRAL;
          const fill = mine ? accent : col.stroke;
          (t.rings?.length ? t.rings : [t.polygon]).forEach((ring, ri) => {
            if (!ring || ring.length < 3) return;
            const coords = ring.map(([lon, lat]) => [lon, lat]);
            const f = coords[0], l = coords[coords.length - 1];
            if (f[0] !== l[0] || f[1] !== l[1]) coords.push(f);
            feats.push({
              type: 'Feature',
              id: `${t.id}-${ri}`,
              geometry: { type: 'Polygon', coordinates: [coords] },
              properties: { fillColor: fill, strokeColor: fill, fillOpacity: mine ? 0.45 : 0.3 },
            });
          });
        });
        setBoard({ type: 'FeatureCollection', features: feats });
      })
      .catch(() => {});
  }, [currentLocation, user.id, accent]);

  async function startPedometer() {
    stepCountRef.current = 0;
    try {
      // Only trust the pedometer when it's present AND permitted — a denied
      // motion permission must not make real runs look like bus rides.
      const perm = await Pedometer.requestPermissionsAsync?.();
      if (perm && !perm.granted) return;
      if (!(await Pedometer.isAvailableAsync())) return;
      pedometerOkRef.current = true;
      pedometerSubRef.current = Pedometer.watchStepCount((result) => {
        stepCountRef.current = result.steps;
      });
    } catch {
      // No pedometer (or permission refused) — steps just stay null.
    }
  }

  // ---- vehicle / spoof gate ----------------------------------------------
  // Buses and trains produce medium speeds the GPS filters won't reject, but
  // (a) sustained > vehicleSpeedMps is never on foot, and (b) ground covered
  // with no steps means wheels. Either auto-pauses the run.

  function vehiclePause() {
    if (!isRunningRef.current) return;
    pauseRun();
    haptic.light();
    Alert.alert(
      'Vehicle detected',
      "Recording paused — PACER only logs runs on foot. Hit play when you're back on your feet."
    );
  }

  function startVehicleWatch() {
    stopVehicleWatch();
    vehicleWindowRef.current = {
      dist: totalDistanceMeters(pathRef.current),
      steps: stepCountRef.current,
    };
    vehicleTimerRef.current = setInterval(() => {
      const dist = totalDistanceMeters(pathRef.current);
      const steps = stepCountRef.current;
      const dDist = dist - vehicleWindowRef.current.dist;
      const dSteps = steps - vehicleWindowRef.current.steps;
      vehicleWindowRef.current = { dist, steps };
      if (pedometerOkRef.current && dDist > T.vehicleWindowDistanceM && dSteps < T.vehicleMinStepsPerWindow) {
        vehiclePause();
      }
    }, T.vehicleCheckMs);
  }

  function stopVehicleWatch() {
    if (vehicleTimerRef.current) {
      clearInterval(vehicleTimerRef.current);
      vehicleTimerRef.current = null;
    }
  }

  function stopPedometer() {
    pedometerSubRef.current?.remove?.();
    pedometerSubRef.current = null;
  }

  // ---- crash resilience -------------------------------------------------
  // The in-progress run is snapshotted every ~N points; if the OS killed
  // the app mid-run, offer to resume or submit what was recorded.

  function persistActiveRun(path) {
    const run = runRef.current;
    if (!run) return;
    AsyncStorage.setItem(
      ACTIVE_RUN_KEY,
      JSON.stringify({ runId: run.id, startedAt: startedAtRef.current, path })
    ).catch(() => {});
  }

  function clearActiveRun() {
    AsyncStorage.removeItem(ACTIVE_RUN_KEY).catch(() => {});
  }

  async function checkOrphanedRun() {
    let saved = null;
    try {
      saved = JSON.parse(await AsyncStorage.getItem(ACTIVE_RUN_KEY));
    } catch {}
    if (!saved || !saved.runId || !Array.isArray(saved.path) || saved.path.length < 2) {
      clearActiveRun();
      return;
    }
    Alert.alert(
      'Unfinished run found',
      `A run with ${saved.path.length} recorded points didn't finish. Resume it, or submit what was recorded?`,
      [
        { text: 'Resume run', onPress: () => resumeRun(saved) },
        {
          text: 'Submit as-is',
          onPress: () => commitRun({ id: saved.runId }, saved.path),
        },
        { text: 'Discard', style: 'destructive', onPress: clearActiveRun },
      ]
    );
  }

  async function resumeRun(saved) {
    runRef.current = { id: saved.runId };
    pathRef.current = saved.path;
    startedAtRef.current = saved.startedAt || Date.now();
    recentSpeedsRef.current = [];
    gpsModeRef.current = 'high';

    setPath(saved.path);
    setDistance(totalDistanceMeters(saved.path));
    setElapsedMs(Date.now() - startedAtRef.current);
    setIsRunning(true);
    isRunningRef.current = true;
    setRecording(true);

    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    await startWatchingLocation('high');
    await startPedometer();
    startBackgroundTrack();
    startVehicleWatch();
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
    try {
      haptic.light();
      const createdRun = await api.startRun();
      // API returns { run_id, started_at }; older builds returned { id }.
      runRef.current = { id: createdRun.run_id || createdRun.id };
      pathRef.current = [];
      startedAtRef.current = Date.now();
      persistActiveRun([]); // a fresh snapshot replaces any stale orphan

      setPath([]);
      setDistance(0);
      setElapsedMs(0);
      setPaused(false);
      setLocked(false);
      setIsRunning(true);
      isRunningRef.current = true;
      setRecording(true);
      recentSpeedsRef.current = [];
      gpsModeRef.current = 'high';
      pendingModeRef.current = { mode: null, count: 0 };

      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);

      await startWatchingLocation('high');
      await startPedometer();
      startBackgroundTrack();
      startVehicleWatch();
    } catch (err) {
      toast.error(err.message || 'Could not start run');
    }
  }

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
            accuracy: Location.Accuracy.High,
            timeInterval: T.gpsRelaxed.timeIntervalMs,
            distanceInterval: T.gpsRelaxed.distanceIntervalM,
          };
    watchRef.current = await Location.watchPositionAsync(cfg, handleLocation);
  }

  async function handleLocation(location) {
    const nextPoint = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: Date.now(),
      // Android exposes the mock-provider flag as `mocked`; iOS never does.
      mocked: location.mocked ?? false,
      accuracyM: location.coords.accuracy ?? null,
      speedMps:
        location.coords.speed != null && location.coords.speed >= 0
          ? location.coords.speed
          : null,
    };
    setCurrentLocation(nextPoint);
    setAccuracyM(location.coords.accuracy ?? null);

    // Spoofed fixes (mock providers) never enter the trail.
    if (nextPoint.mocked) return;

    const oldPath = pathRef.current;
    const previousPoint = oldPath[oldPath.length - 1];

    // Vehicle gate: a fix faster than any runner is dropped; a streak of
    // them means transport — auto-pause instead of logging the ride.
    const gateSpeed =
      nextPoint.speedMps != null
        ? nextPoint.speedMps
        : previousPoint
        ? distanceMeters(previousPoint, nextPoint) /
          Math.max((nextPoint.timestamp - previousPoint.timestamp) / 1000, 0.001)
        : 0;
    if (gateSpeed > T.vehicleSpeedMps) {
      fastPointsRef.current += 1;
      if (fastPointsRef.current >= T.vehicleFastPoints) vehiclePause();
      return;
    }
    fastPointsRef.current = 0;

    // Sub-2m jitter filter.
    if (previousPoint && distanceMeters(previousPoint, nextPoint) < T.minStepM) return;

    const newPath = [...oldPath, nextPoint];
    pathRef.current = newPath;
    setPath(newPath);

    const newDistance = totalDistanceMeters(newPath);
    setDistance(newDistance);

    // Crash snapshot every N accepted points.
    if (newPath.length % T.persistEveryNPoints === 0) persistActiveRun(newPath);

    mapRef.current?.flyTo({ latitude: nextPoint.latitude, longitude: nextPoint.longitude }, undefined, 300);

    // Adaptive sampling decision.
    const speedMps =
      location.coords.speed != null && location.coords.speed >= 0
        ? location.coords.speed
        : previousPoint
        ? distanceMeters(previousPoint, nextPoint) /
          Math.max((nextPoint.timestamp - previousPoint.timestamp) / 1000, 0.001)
        : null;
    maybeSwitchGpsMode(decideGpsMode(newPath, nextPoint, speedMps));

    if (runRef.current && newPath.length % 5 === 0) {
      try {
        await api.submitPath(runRef.current.id, toApiPoints(newPath));
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

  // ---- pause / resume -----------------------------------------------------
  // Pausing stops GPS + pedometer and freezes the elapsed clock; resuming
  // shifts the start reference by the paused duration so time stays honest.

  function pauseRun() {
    if (paused) return;
    pausedAtRef.current = Date.now();
    stopWatchingLocation();
    stopPedometer();
    stopBackgroundTrack();
    stopVehicleWatch();
    fastPointsRef.current = 0;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setPaused(true);
  }

  async function resumeFromPause() {
    if (!paused) return;
    const pausedFor = Date.now() - (pausedAtRef.current || Date.now());
    startedAtRef.current += pausedFor;
    setElapsedMs(Date.now() - startedAtRef.current);
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    await startWatchingLocation(gpsModeRef.current);
    await startPedometer();
    startBackgroundTrack();
    startVehicleWatch();
    setPaused(false);
  }

  async function finishRun() {
    haptic.light();
    setPaused(false);
    setLocked(false);
    stopWatchingLocation();
    stopPedometer();
    stopVehicleWatch();
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
    const finalPath = pathRef.current;
    if (!run) {
      Alert.alert('No active run', 'Start a run first.');
      return;
    }
    if (finalPath.length < 2) {
      Alert.alert('Too short', 'Move around first before ending the run.');
      return;
    }
    await commitRun(run, finalPath);
  }

  // The recorded path stays in memory whatever the network does — a failed
  // /end-run is retryable, never fatal to the run data.
  async function commitRun(run, finalPath) {
    try {
      // Steps are sent whenever a pedometer exists — INCLUDING zero, which is
      // exactly the signature of covering distance in a vehicle.
      const result = await api.endRun(
        run.id,
        toApiPoints(finalPath),
        pedometerOkRef.current ? stepCountRef.current : null
      );
      clearActiveRun();
      // Optional, write-only health sync (no-op unless enabled + module present).
      writeWorkout({
        startMs: startedAtRef.current || Date.now(),
        endMs: Date.now(),
        distanceM: totalDistanceMeters(finalPath),
      }).catch(() => {});
      navigation.navigate('Result', { result, run: result, path: finalPath });
    } catch (err) {
      Alert.alert(
        "Couldn't save your run",
        `${err.message || 'Network error'}. Your route is still on this phone.`,
        [
          { text: 'Retry', onPress: () => commitRun(run, finalPath) },
          { text: 'Later', style: 'cancel' },
        ]
      );
    }
  }

  const paceText =
    distance > 50 && elapsedMs > 1000
      ? (() => {
          const minPerKm = elapsedMs / 1000 / 60 / (distance / 1000);
          const m = Math.floor(minPerKm);
          const s = Math.round((minPerKm - m) * 60);
          return `${m}:${String(s).padStart(2, '0')} /km`;
        })()
      : '—';

  // The circular claim zone this distance has earned so far.
  const claimArea = claimAreaM2(distance);
  // Rough energy estimate: ~1.036 kcal per kg per km at a 70 kg default.
  const caloriesKcal = 1.036 * T.defaultWeightKg * (distance / 1000);

  // Location denied: a way forward, not a dead end.
  if (permDenied) {
    return (
      <View style={[styles.container, styles.deniedWrap]}>
        <Text style={styles.deniedTitle}>Location is off</Text>
        <Text style={styles.deniedBody}>
          PACER records your route only during an active run — without
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
          <Text style={styles.deniedBackText}>I've enabled it — check again</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GameMap ref={mapRef} theme="dark" style={styles.map} initialZoom={16}>
        {/* others' claimed land around you — the turf you're running through */}
        {board && <TerritoryLayer id="run-board" featureCollection={board} dark />}

        {/* the signature: the route glows in the colour picked in Settings
            (defaults to the club colour) — no start↔runner preview line */}
        {path.length > 1 && (
          <Trail id="route" points={path} color={trailGlowColor || accent} width={5} glow />
        )}

        {path.length > 0 && <MapPoint id="start" point={path[0]} color={accent} />}

        {/* the runner is their character portrait, not a dot */}
        {currentLocation && (
          <UserMarker point={currentLocation}>
            <CharacterBust equipped={equipped} size={40} ring="#ffffff" bg="rgba(21,24,29,0.9)" />
          </UserMarker>
        )}
      </GameMap>

      {/* slim glass status bar: GPS quality, elapsed time, tracking state */}
      <View style={styles.topBar}>
        <View style={styles.topItem}>
          <View style={[styles.gpsDot, { backgroundColor: gpsColor(accuracyM) }]} />
          <Text style={styles.topText}>
            {accuracyM == null ? 'GPS' : `±${Math.round(accuracyM)}m`}
          </Text>
        </View>
        <Text style={[styles.topTime, isRunning && { color: D.text }]}>
          {formatDuration(elapsedMs)}
        </Text>
        <View style={styles.topItem}>
          <View
            style={[
              styles.gpsDot,
              { backgroundColor: isRunning ? D.muted : D.dim },
            ]}
          />
          <Text style={styles.topText}>
            {isRunning ? `${path.length} pts` : 'Ready'}
          </Text>
        </View>
      </View>

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
            <Metric label="Claim zone" value={formatArea(claimArea)} accent={accent} />
            <Metric label="Calories" value={`${Math.round(caloriesKcal)} kcal`} accent={D.text} />
          </View>
        </View>

        {/* the claim explainer, quietly */}
        <Text style={styles.openPathLine}>
          Your distance becomes a circle — place it anywhere on your route after you finish.
        </Text>

        {!isRunning ? (
          <PressableScale
            style={[styles.primaryBtn, { backgroundColor: accent }]}
            onPress={startRun}
            accessibilityRole="button"
            accessibilityLabel="Start run"
          >
            <Text style={styles.primaryBtnText}>Start run</Text>
          </PressableScale>
        ) : (
          <View style={styles.controlsRow}>
            <PressableScale
              style={[styles.roundCtl, paused && { backgroundColor: accent, borderColor: accent }]}
              onPress={() => { haptic.light(); paused ? resumeFromPause() : pauseRun(); }}
              accessibilityRole="button"
              accessibilityLabel={paused ? 'Resume run' : 'Pause run'}
            >
              {paused ? <Play size={22} color="#fff" fill="#fff" /> : <Pause size={22} color={D.text} fill={D.text} />}
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
  map: { flex: 1 },

  topBar: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(21,24,29,0.82)',
    borderWidth: 1,
    borderColor: D.border,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 92 },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  topText: { ...type.caption, color: D.muted },
  topTime: { ...type.statSm, color: D.muted },

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
    borderWidth: 1,
    borderColor: D.border,
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
    backgroundColor: 'rgba(11,13,16,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 64,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(21,24,29,0.95)',
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
});
