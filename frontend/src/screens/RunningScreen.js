import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
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
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { darkColors, radius, space, type, withAlpha } from '../theme';
import { haptic, PressableScale, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';

const LOOP_CLOSE_DISTANCE_M = 25;
const MIN_POINTS_FOR_LOOP = 15;
const MIN_DISTANCE_FOR_LOOP_M = 80;
// Distance (m) → open-path area (m²): 0.05 km² per km == 50 m² per metre,
// i.e. a ~50m-wide strip painted along the route (brief §6).
const OPEN_PATH_M2_PER_M = 50;

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

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: darkColors.bg }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: darkColors.bg }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7177' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: darkColors.cardAlt }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1622' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

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

function toApiPoints(points) {
  return points.map((p) => ({
    lat: p.latitude,
    lon: p.longitude,
    t: new Date(p.timestamp).toISOString(),
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

// GPS quality: green under 10m, amber under 25m, red beyond.
const GPS_GOOD_M = 10;
const GPS_OK_M = 25;

function gpsColor(accuracyM) {
  if (accuracyM == null) return darkColors.textDim;
  if (accuracyM < GPS_GOOD_M) return darkColors.ok;
  if (accuracyM < GPS_OK_M) return darkColors.warn;
  return darkColors.danger;
}

// -----------------------------------------------------------------------
// Press-and-hold Finish button: a radial ring fills during the hold so an
// accidental tap mid-run can't end the session.
// -----------------------------------------------------------------------

const HOLD_TO_FINISH_MS = 1200;
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
      { duration: HOLD_TO_FINISH_MS, easing: Easing.linear },
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
  const team = useMemo(() => regionForUser(user.username), [user.username]);
  const accent = team.stroke;
  const reduceMotion = useReduceMotion();

  const mapRef = useRef(null);
  const watchRef = useRef(null);
  const pathRef = useRef([]);
  const runRef = useRef(null);
  const loopClosedRef = useRef(false);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);
  const fillAnimRef = useRef(null);

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
  // Celebration: pill visibility + captured-polygon fill alpha (0 -> 0.25).
  const [celebration, setCelebration] = useState(null); // { areaM2 }
  const [capturedFillAlpha, setCapturedFillAlpha] = useState(0.25);

  useEffect(() => {
    prepareLocation();
    return () => {
      stopWatchingLocation();
      if (tickRef.current) clearInterval(tickRef.current);
      if (fillAnimRef.current) clearInterval(fillAnimRef.current);
    };
  }, []);

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
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location permission needed',
        'Please allow location access so the app can track your run.'
      );
      return;
    }
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const point = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: Date.now(),
    };
    setCurrentLocation(point);
    setAccuracyM(location.coords.accuracy ?? null);
    mapRef.current?.animateToRegion(
      { latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
      500
    );
  }

  async function startRun() {
    try {
      haptic.light();
      const createdRun = await api.startRun();
      runRef.current = createdRun;
      pathRef.current = [];
      loopClosedRef.current = false;
      startedAtRef.current = Date.now();

      setPath([]);
      setPolygon([]);
      setDistance(0);
      setElapsedMs(0);
      setClosedArea(0);
      setNearStart(false);
      setLoopClosed(false);
      setIsRunning(true);

      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);

      await startWatchingLocation();
    } catch (err) {
      toast.error(err.message || 'Could not start run');
    }
  }

  async function startWatchingLocation() {
    stopWatchingLocation();
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 },
      async (location) => {
        const nextPoint = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: Date.now(),
        };
        setCurrentLocation(nextPoint);
        setAccuracyM(location.coords.accuracy ?? null);

        const oldPath = pathRef.current;
        const previousPoint = oldPath[oldPath.length - 1];
        if (previousPoint && distanceMeters(previousPoint, nextPoint) < 2) return;

        const newPath = [...oldPath, nextPoint];
        pathRef.current = newPath;
        setPath(newPath);

        const newDistance = totalDistanceMeters(newPath);
        setDistance(newDistance);
        setClosedArea(polygonAreaM2(newPath));

        mapRef.current?.animateToRegion(
          { latitude: nextPoint.latitude, longitude: nextPoint.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
          300
        );

        const startPoint = newPath[0];
        const distanceToStart = distanceMeters(startPoint, nextPoint);
        const hasEnoughPoints = newPath.length >= MIN_POINTS_FOR_LOOP;
        const hasRunEnoughDistance = newDistance >= MIN_DISTANCE_FOR_LOOP_M;
        const eligible = hasEnoughPoints && hasRunEnoughDistance;

        // "Close the loop!" hint: eligible and getting close, but not yet closed.
        setNearStart(eligible && !loopClosedRef.current && distanceToStart <= LOOP_CLOSE_DISTANCE_M * 3);

        if (!loopClosedRef.current && eligible && distanceToStart <= LOOP_CLOSE_DISTANCE_M) {
          loopClosedRef.current = true;
          setLoopClosed(true);
          setNearStart(false);
          setPolygon(newPath);
          celebrateLoopClosed(polygonAreaM2(newPath));
        }

        if (runRef.current && newPath.length % 5 === 0) {
          try {
            await api.submitPath(runRef.current.id, toApiPoints(newPath));
          } catch (err) {
            // non-fatal — the final commit on /end-run is what matters
          }
        }
      }
    );
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
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setIsRunning(false);

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
      const result = await api.endRun(run.id, toApiPoints(finalPath));
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

  const initialRegion = currentLocation
    ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }
    : { latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  const paceText =
    distance > 50 && elapsedMs > 1000
      ? (() => {
          const minPerKm = elapsedMs / 1000 / 60 / (distance / 1000);
          const m = Math.floor(minPerKm);
          const s = Math.round((minPerKm - m) * 60);
          return `${m}:${String(s).padStart(2, '0')} /km`;
        })()
      : '—';

  const openArea = distance * OPEN_PATH_M2_PER_M;
  const fill = withAlpha(accent, capturedFillAlpha); // blooms in on loop close

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        customMapStyle={DARK_MAP_STYLE}
        userInterfaceStyle="dark"
      >
        {path.length > 1 && <Polyline coordinates={path} strokeWidth={5} strokeColor={accent} />}

        {/* live "if closed" preview: dashed line back to start + tinted fill */}
        {!loopClosed && path.length >= 3 && (
          <>
            <Polygon
              coordinates={path}
              strokeWidth={0}
              fillColor={`${accent}1f`}
            />
            <Polyline
              coordinates={[path[path.length - 1], path[0]]}
              strokeWidth={2.5}
              strokeColor={accent}
              lineDashPattern={[6, 8]}
            />
          </>
        )}

        {polygon.length >= 3 && (
          <Polygon coordinates={polygon} strokeWidth={3} strokeColor={accent} fillColor={fill} />
        )}

        {path.length > 0 && <Marker coordinate={path[0]} title="Start" pinColor={accent} />}
      </MapView>

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
            Loop closed · ~{formatArea(celebration.areaM2)} for Team {team.name}
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
});
