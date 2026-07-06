import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import GameMap, {
  ClosingLine,
  MapPoint,
  TerritoryFill,
  Trail,
} from '../components/GameMap';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  SlideInUp,
  SlideOutUp,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useClan } from '../state/clan';
import { useRecording } from '../state/recording';
import { darkColors, radius, runTuning as T, space, type } from '../theme';
import { haptic, PressableScale, useReduceMotion } from '../ui/motion';
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

// Shoelace area (m²) of the path treated as a closed polygon, via a local
// equirectangular projection — good enough for the live "if closed" preview.
function polygonAreaM2(points) {
  if (points.length < 3) return 0;
  const lat0 = toRad(points[0].latitude);
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos(lat0);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ax = a.longitude * mPerLon, ay = a.latitude * mPerLat;
    const bx = b.longitude * mPerLon, by = b.latitude * mPerLat;
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) / 2;
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
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`;
  return `${Math.round(m2).toLocaleString()} m²`;
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
  const { color, clan } = useClan();
  const accent = color.stroke;
  const reduceMotion = useReduceMotion();

  const mapRef = useRef(null);
  const watchRef = useRef(null);
  const pathRef = useRef([]);
  const runRef = useRef(null);
  const loopClosedRef = useRef(false);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);
  const fillAnimRef = useRef(null);
  // Adaptive-sampling bookkeeping.
  const gpsModeRef = useRef('high'); // 'high' | 'relaxed'
  const pendingModeRef = useRef({ mode: null, count: 0 });
  const recentSpeedsRef = useRef([]);
  const restartingWatchRef = useRef(false);
  // Pedometer: cumulative steps during the run, sent with /end-run so the
  // server can sanity-check stride length.
  const stepCountRef = useRef(0);
  const pedometerSubRef = useRef(null);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [path, setPath] = useState([]);
  const [polygon, setPolygon] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [loopClosed, setLoopClosed] = useState(false);
  const [nearStart, setNearStart] = useState(false);
  const [distance, setDistance] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [closedArea, setClosedArea] = useState(0);
  const [accuracyM, setAccuracyM] = useState(null);
  const [permDenied, setPermDenied] = useState(false);
  // Celebration: pill visibility + captured-polygon fill alpha (0 -> 0.25).
  const [celebration, setCelebration] = useState(null); // { areaM2 }
  const [capturedFillAlpha, setCapturedFillAlpha] = useState(0.25);

  useEffect(() => {
    (async () => {
      const granted = await prepareLocation();
      if (granted) await checkOrphanedRun();
    })();
    return () => {
      stopWatchingLocation();
      stopPedometer();
      setRecording(false);
      if (tickRef.current) clearInterval(tickRef.current);
      if (fillAnimRef.current) clearInterval(fillAnimRef.current);
    };
  }, []);

  async function startPedometer() {
    stepCountRef.current = 0;
    try {
      if (!(await Pedometer.isAvailableAsync())) return;
      pedometerSubRef.current = Pedometer.watchStepCount((result) => {
        stepCountRef.current = result.steps;
      });
    } catch {
      // No pedometer (or permission refused) — steps just stay null.
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
    loopClosedRef.current = false;
    startedAtRef.current = saved.startedAt || Date.now();
    recentSpeedsRef.current = [];
    gpsModeRef.current = 'high';

    setPath(saved.path);
    setDistance(totalDistanceMeters(saved.path));
    setClosedArea(polygonAreaM2(saved.path));
    setElapsedMs(Date.now() - startedAtRef.current);
    setIsRunning(true);
    setRecording(true);

    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    await startWatchingLocation('high');
    await startPedometer();
  }

  // The money moment: strong haptic, fill blooms in, dashed line snaps
  // solid (loopClosed flips the render below), pill drops from the top.
  // Non-blocking — the run keeps recording throughout.
  function celebrateLoopClosed(areaM2) {
    haptic.success();
    setCelebration({ areaM2 });
    setTimeout(() => setCelebration(null), 3500);

    if (reduceMotion) {
      setCapturedFillAlpha(0.25);
      return;
    }
    // Map polygons can't be driven by Reanimated, so step the fill alpha
    // with a short overshoot-and-settle ramp (spring feel, ~700ms total).
    const STEPS = [0.05, 0.11, 0.18, 0.25, 0.3, 0.27, 0.25];
    let i = 0;
    setCapturedFillAlpha(0);
    if (fillAnimRef.current) clearInterval(fillAnimRef.current);
    fillAnimRef.current = setInterval(() => {
      setCapturedFillAlpha(STEPS[i]);
      i += 1;
      if (i >= STEPS.length) {
        clearInterval(fillAnimRef.current);
        fillAnimRef.current = null;
      }
    }, 100);
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
      loopClosedRef.current = false;
      startedAtRef.current = Date.now();
      persistActiveRun([]); // a fresh snapshot replaces any stale orphan

      setPath([]);
      setPolygon([]);
      setDistance(0);
      setElapsedMs(0);
      setClosedArea(0);
      setNearStart(false);
      setLoopClosed(false);
      setIsRunning(true);
      setRecording(true);
      recentSpeedsRef.current = [];
      gpsModeRef.current = 'high';
      pendingModeRef.current = { mode: null, count: 0 };

      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);

      await startWatchingLocation('high');
      await startPedometer();
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

    const oldPath = pathRef.current;
    const previousPoint = oldPath[oldPath.length - 1];
    // Sub-2m jitter filter.
    if (previousPoint && distanceMeters(previousPoint, nextPoint) < T.minStepM) return;

    const newPath = [...oldPath, nextPoint];
    pathRef.current = newPath;
    setPath(newPath);

    const newDistance = totalDistanceMeters(newPath);
    setDistance(newDistance);
    setClosedArea(polygonAreaM2(newPath));

    // Crash snapshot every N accepted points.
    if (newPath.length % T.persistEveryNPoints === 0) persistActiveRun(newPath);

    mapRef.current?.flyTo({ latitude: nextPoint.latitude, longitude: nextPoint.longitude }, undefined, 300);

    const startPoint = newPath[0];
    const distanceToStart = distanceMeters(startPoint, nextPoint);
    const hasEnoughPoints = newPath.length >= T.minPointsForLoop;
    const hasRunEnoughDistance = newDistance >= T.minDistanceForLoopM;
    const eligible = hasEnoughPoints && hasRunEnoughDistance;

    // "Close the loop!" hint: eligible and getting close, but not yet closed.
    setNearStart(eligible && !loopClosedRef.current && distanceToStart <= T.loopCloseDistanceM * 3);

    if (!loopClosedRef.current && eligible && distanceToStart <= T.loopCloseDistanceM) {
      loopClosedRef.current = true;
      setLoopClosed(true);
      setNearStart(false);
      setPolygon(newPath);
      persistActiveRun(newPath);
      celebrateLoopClosed(polygonAreaM2(newPath));
    }

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

  async function finishRun() {
    haptic.light();
    stopWatchingLocation();
    stopPedometer();
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setIsRunning(false);
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
      const result = await api.endRun(
        run.id,
        toApiPoints(finalPath),
        stepCountRef.current > 0 ? stepCountRef.current : null
      );
      clearActiveRun();
      navigation.navigate('Result', { result, run: result, loopClosed, path: finalPath, polygon });
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

  const openArea = distance * T.openPathM2PerM;

  // Location denied: a way forward, not a dead end.
  if (permDenied) {
    return (
      <View style={[styles.container, styles.deniedWrap]}>
        <Text style={styles.deniedTitle}>Location is off</Text>
        <Text style={styles.deniedBody}>
          Territory Run records your route only during an active run — without
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
      <GameMap ref={mapRef} theme="dark" style={styles.map} showsUserLocation initialZoom={16}>
        {/* live "if closed" preview: tinted fill + dashed line back to start */}
        {!loopClosed && path.length >= 3 && (
          <>
            <TerritoryFill id="preview" points={path} fillColor={accent} strokeColor={accent} fillOpacity={0.12} />
            <ClosingLine id="closing" from={path[path.length - 1]} to={path[0]} color={accent} />
          </>
        )}

        {/* the signature: the route glows in the clan colour */}
        {path.length > 1 && <Trail id="route" points={path} color={accent} width={5} glow />}

        {/* captured territory blooms in on loop close (alpha animates 0→0.25) */}
        {polygon.length >= 3 && (
          <TerritoryFill id="captured" points={polygon} fillColor={accent} strokeColor={accent} fillOpacity={capturedFillAlpha} glow />
        )}

        {path.length > 0 && <MapPoint id="start" point={path[0]} color={accent} />}
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
              { backgroundColor: loopClosed ? accent : isRunning ? D.muted : D.dim },
            ]}
          />
          <Text style={styles.topText}>
            {loopClosed ? 'Captured' : isRunning ? `${path.length} pts` : 'Ready'}
          </Text>
        </View>
      </View>

      {/* close-the-loop prompt */}
      {nearStart && !celebration && (
        <View style={[styles.prompt, { borderColor: accent }]}>
          <View style={[styles.promptDot, { backgroundColor: accent }]} />
          <Text style={styles.promptText}>
            Close the loop! Head back to start to capture {formatArea(closedArea)}
          </Text>
        </View>
      )}

      {/* loop-closed celebration pill — drops in, run keeps going */}
      {celebration && (
        <Animated.View
          entering={reduceMotion ? undefined : SlideInUp.springify().damping(16)}
          exiting={reduceMotion ? undefined : SlideOutUp.duration(220)}
          style={[styles.prompt, styles.celebrationPill, { borderColor: accent }]}
        >
          <View style={[styles.promptDot, { backgroundColor: accent }]} />
          <Text style={[styles.promptText, { color: accent }]}>
            Loop closed · ~{formatArea(celebration.areaM2)}{clan?.tag ? ` for ${clan.tag}` : ''}
          </Text>
        </Animated.View>
      )}

      <View style={styles.panel}>
        {/* the three live stats — glow in the team colour */}
        <View style={styles.metricsRow}>
          <Metric label="Distance" value={`${(distance / 1000).toFixed(2)} km`} accent={accent} />
          <Metric label="Pace" value={paceText} accent={accent} />
          <Metric
            label={loopClosed ? 'Captured' : 'If closed'}
            value={formatArea(closedArea)}
            accent={accent}
          />
        </View>

        {/* the open-path fallback, quietly */}
        <Text style={styles.openPathLine}>
          {loopClosed
            ? 'Loop closed — keep running or hold Finish to bank it.'
            : `Open path so far converts to ${formatArea(openArea)}.`}
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
          <HoldToFinishButton onFinish={finishRun} />
        )}
      </View>
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
  celebrationPill: { borderWidth: 2 },

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
