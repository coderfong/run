import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import GameMap, {
  MapPoint,
  TerritoryLayer,
  Trail,
  UserMarker,
} from '../components/GameMap';
import { CharacterBust } from '../components/character/CharacterRig';
import DevRunSimulator from '../components/DevRunSimulator';
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
import { invalidateAfterLandLoss, invalidateAfterRun } from '../api/cache';
import { useAuth } from '../auth/AuthContext';
import { claimGateReason, entitledAreaM2, RUN_TIER, runTier } from '../config/economy';
import {
  drainBackgroundPoints,
  startBackgroundTrack,
  stopBackgroundTrack,
} from '../run/backgroundTrack';
import { buildSimulatedRun, FALLBACK_ORIGIN } from '../run/simulatedRun';
import { useClan, NEUTRAL } from '../state/clan';
import { useRecording } from '../state/recording';
import { useSettings } from '../state/settings';
import { writeWorkout } from '../health';
import { darkColors, radius, runTuning as T, space, type } from '../theme';
import { haptic, PressableScale, Pulse } from '../ui/motion';
import { toast } from '../ui/toast';
import { landCaptureAlert } from '../components/LandCaptureAlert';
import GameLottie from '../components/GameLottie';
import { RunEventOverlay, RunStartOverlay } from '../components/run/RunGameplayFx';

// In-progress run persisted here so an OS kill / crash can't lose a run.
const ACTIVE_RUN_KEY = 'tr.activeRun';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

export default function RunningScreen({ navigation }) {
  const { user } = useAuth();
  const { setRecording } = useRecording();
  const { color } = useClan();
  const { equipped } = useAvatar();
  const { trailGlowColor } = useSettings();
  const accent = trailGlowColor || color.stroke;

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
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startCountdown, setStartCountdown] = useState(null);

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
  const [boardPortraits, setBoardPortraits] = useState([]);
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
        const portraits = [];
        const rivalTerritories = [];
        (data.territories || []).forEach((t) => {
          // Show ALL claimed land around the runner, including their own
          // (their earlier claims), so the board matches the global map.
          const mine = t.user_id === user.id;
          const col = t.clan_color || NEUTRAL;
          const fill = mine ? accent : col.stroke;
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
              properties: { fillColor: fill, strokeColor: fill, fillOpacity: (mine ? 0.45 : 0.3) * (0.35 + 0.65 * (t.freshness ?? 1)) },
            });
          });
          // owner portrait at the territory centre (own uses fresh local avatar)
          const av = mine ? equipped : t.avatar;
          const at = ringCentroidLL(rings[0]);
          if (av && at) portraits.push({ id: t.id, at, avatar: av, mine, ring: fill, area: t.area_m2 || 0 });
        });
        setBoard({ type: 'FeatureCollection', features: feats });
        setBoardPortraits(portraits.sort((a, b) => b.area - a.area).slice(0, 24));
        rivalTerritoriesRef.current = rivalTerritories;
      })
      .catch(() => {});
  }, [currentLocation, user.id, accent, equipped]);

  useEffect(() => {
    if (!isRunning || !currentLocation) return;
    const hit = rivalTerritoriesRef.current.find((territory) =>
      territory.rings.some((ring) => pointInRing(currentLocation, ring))
    );
    const nextId = hit?.id || null;
    if (nextId && nextId !== currentRivalRef.current) enqueueRunFx({ kind: 'rivalEntry' });
    currentRivalRef.current = nextId;
  }, [currentLocation, enqueueRunFx, isRunning]);

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
      "Recording paused. PASER only logs runs on foot, so hit play when you're back on your feet."
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
          text: 'Submit anyway',
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

    const resumedDistance = totalDistanceMeters(saved.path);
    const resumedElapsed = Date.now() - startedAtRef.current;
    lastKmRef.current = Math.floor(resumedDistance / 1000);
    lastTierRef.current = runTier(resumedDistance, resumedElapsed / 1000);
    setPath(saved.path);
    setDistance(resumedDistance);
    setElapsedMs(resumedElapsed);
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
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      haptic.light();
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
      lastKmRef.current = 0;
      lastTierRef.current = RUN_TIER.UNQUALIFIED;
      currentRivalRef.current = null;
      setRunFxQueue([]);

      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);

      await startWatchingLocation('high');
      await startPedometer();
      startBackgroundTrack();
      startVehicleWatch();
    } catch (err) {
      toast.error(err.message || 'Could not start run');
    } finally {
      setTimeout(() => setStartCountdown(null), 620);
      setStarting(false);
      startingRef.current = false;
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
      // Kept client-side only (the API points carry no altitude): the result
      // screen turns the series into elevation gain. Runs recorded before this
      // simply have no elevation, and the metric hides itself.
      altitude: location.coords.altitude ?? null,
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
  async function commitRun(
    run,
    finalPath,
    { steps = null, simulated = false, devScenario = 'open' } = {}
  ) {
    try {
      // Steps are sent whenever a pedometer exists — INCLUDING zero, which is
      // exactly the signature of covering distance in a vehicle.
      const result = await api.endRun(
        run.id,
        toApiPoints(finalPath),
        steps ?? (pedometerOkRef.current ? stepCountRef.current : null),
        simulated
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
      clearActiveRun();
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
          startMs: startedAtRef.current || Date.now(),
          endMs: Date.now(),
          distanceM: totalDistanceMeters(finalPath),
        }).catch(() => {});
      }
      navigation.navigate('Result', { result, run: result, path: finalPath });
    } catch (err) {
      Alert.alert(
        "Couldn't save your run",
        `${err.message || 'Network error'}. Your route is still on this phone.`,
        [
          {
            text: 'Retry',
            onPress: () => commitRun(run, finalPath, { steps, simulated, devScenario }),
          },
          { text: 'Later', style: 'cancel' },
        ]
      );
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
      setDistance(totalDistanceMeters(sim.points));
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
              landCaptureAlert.show({
                category: 'stolen',
                capture_id: result.capture_id,
                rival_id: result.rival_id,
                rival_username: result.rival_username,
                rival_avatar: result.rival_avatar,
                taken_m2: result.taken_m2,
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

  const paceText =
    distance > 50 && elapsedMs > 1000
      ? (() => {
          const minPerKm = elapsedMs / 1000 / 60 / (distance / 1000);
          const m = Math.floor(minPerKm);
          const s = Math.round((minPerKm - m) * 60);
          return `${m}:${String(s).padStart(2, '0')} /km`;
        })()
      : '·';

  // The land this run has earned so far, off the SAME function the server
  // settles with (src/config/economy.js). This used to be a local
  // `(d * d) / (4 * Math.PI)` — the retired circle model — which at 5 km
  // promised 1.99 km² against the 0.375 km² actually granted.
  const elapsedS = elapsedMs / 1000;
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

  // Location denied: a way forward, not a dead end.
  if (permDenied) {
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

  return (
    <View style={styles.container}>
      {/* The one map that does NOT follow the app's scheme. This screen is a
          night-run surface by design (see `D` above) and its HUD is painted
          dark whatever the rest of the app is wearing, so a light map style
          here would put dark chrome on a white board. */}
      <GameMap ref={mapRef} theme="dark" style={styles.map} initialZoom={16}>
        {/* others' claimed land around you — the turf you're running through */}
        {board && <TerritoryLayer id="run-board" featureCollection={board} dark />}

        {/* owner portrait in the middle of each nearby territory */}
        {boardPortraits.map((m) => (
          <UserMarker key={m.id} point={m.at}>
            <CharacterBust equipped={m.avatar} size={m.mine ? 34 : 30} ring={m.mine ? accent : m.ring} bg="rgba(21,24,29,0.9)" />
          </UserMarker>
        ))}

        {/* the signature: the route glows in the colour picked in Settings
            (defaults to the club colour) — no start↔runner preview line */}
        {path.length > 1 && (
          <Trail id="route" points={path} color={accent} width={5} glow />
        )}

        {path.length > 0 && <MapPoint id="start" point={path[0]} color={accent} />}

        {/* The runner is their character portrait, not a dot. It breathes, so
            that among a screenful of other people's portraits the live one is
            obviously the one that is you. Slow and shallow on purpose — this
            sits on screen for the length of a run. Holds still under Reduce
            Motion, like everything else in ui/motion. */}
        {currentLocation && (
          <UserMarker point={currentLocation}>
            <View style={styles.liveMarker}>
              {isRunning ? <GameLottie name="routeHead" size={62} style={styles.routeHeadFx} /> : null}
              <Pulse min={1} max={1.06} durationMs={1400}>
                <CharacterBust equipped={equipped} size={40} ring="#ffffff" bg="rgba(21,24,29,0.9)" />
              </Pulse>
            </View>
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
            : 'Your route grows into territory. After your run, choose where along it to secure the ground.'}
        </Text>

        {!isRunning ? (
          <>
            <PressableScale
              style={[styles.primaryBtn, { backgroundColor: accent, opacity: starting ? 0.72 : 1 }]}
              onPress={startRun}
              disabled={starting}
              accessibilityRole="button"
              accessibilityLabel="Start run"
            >
              <Text style={styles.primaryBtnText}>{starting ? 'Get ready…' : 'Start run'}</Text>
            </PressableScale>
            {/* Renders nothing unless the SERVER says this account may have
                it (dev_tools on /me), or we're on a dev build. */}
            <DevRunSimulator
              onSimulate={simulateRun}
              onRivalTake={simulateRivalTake}
              busy={simulating}
            />
          </>
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

      <RunEventOverlay
        event={runFxQueue[0]}
        onDone={dismissRunFx}
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
  map: { flex: 1 },
  liveMarker: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  routeHeadFx: { position: 'absolute' },

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
