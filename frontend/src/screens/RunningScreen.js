import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';

import { api } from '../api/client';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { darkColors, radius, space, type } from '../theme';
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

export default function RunningScreen({ navigation }) {
  const { user } = useAuth();
  const team = useMemo(() => regionForUser(user.username), [user.username]);
  const accent = team.stroke;

  const mapRef = useRef(null);
  const watchRef = useRef(null);
  const pathRef = useRef([]);
  const runRef = useRef(null);
  const loopClosedRef = useRef(false);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [path, setPath] = useState([]);
  const [polygon, setPolygon] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [loopClosed, setLoopClosed] = useState(false);
  const [nearStart, setNearStart] = useState(false);
  const [distance, setDistance] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [closedArea, setClosedArea] = useState(0);

  useEffect(() => {
    prepareLocation();
    return () => {
      stopWatchingLocation();
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

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
    mapRef.current?.animateToRegion(
      { latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
      500
    );
  }

  async function startRun() {
    try {
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
          Alert.alert(
            'Loop closed!',
            `You captured ${formatArea(polygonAreaM2(newPath))} for Team ${team.name}.`
          );
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
    try {
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

      const result = await api.endRun(run.id, toApiPoints(finalPath));
      navigation.navigate('Result', { result, run: result, loopClosed, path: finalPath, polygon });
    } catch (err) {
      toast.error(err.message || 'Could not end run');
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
  const fill = `${accent}40`; // 25% alpha — supported in maps fillColor

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

      {/* close-the-loop prompt */}
      {nearStart && (
        <View style={[styles.prompt, { borderColor: accent }]}>
          <View style={[styles.promptDot, { backgroundColor: accent }]} />
          <Text style={styles.promptText}>
            Close the loop! Head back to start to capture {formatArea(closedArea)}
          </Text>
        </View>
      )}

      <View style={styles.panel}>
        <View style={styles.metricsRow}>
          <Metric label="Distance" value={`${(distance / 1000).toFixed(2)} km`} accent={accent} />
          <Metric label="Time" value={formatDuration(elapsedMs)} accent={accent} />
          <Metric label="Pace" value={paceText} accent={accent} />
        </View>

        {/* loop vs strip — the core mechanic, live */}
        <View style={styles.preview}>
          <View style={styles.previewItem}>
            <Text style={[styles.previewVal, { color: accent }]}>{formatArea(closedArea)}</Text>
            <Text style={styles.previewLabel}>{loopClosed ? 'captured' : 'if you close the loop'}</Text>
          </View>
          <View style={styles.previewDivider} />
          <View style={styles.previewItem}>
            <Text style={styles.previewValMuted}>{formatArea(openArea)}</Text>
            <Text style={styles.previewLabel}>as an open path</Text>
          </View>
        </View>

        <View style={styles.loopRow}>
          <View style={[styles.loopDot, { backgroundColor: loopClosed ? accent : D.dim }]} />
          <Text style={styles.loopText}>
            {loopClosed ? 'Loop closed — territory captured' : `Tracking · ${path.length} points`}
          </Text>
        </View>

        {!isRunning ? (
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: accent }]} activeOpacity={0.9} onPress={startRun}>
            <Text style={styles.primaryBtnText}>Start run</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopBtn} activeOpacity={0.9} onPress={finishRun}>
            <Text style={styles.stopBtnText}>Finish run</Text>
          </TouchableOpacity>
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

  prompt: {
    position: 'absolute',
    top: space.lg,
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

  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.md },
  metric: { flex: 1 },
  metricLabel: {
    ...type.labelSm,
    color: D.muted,
    marginBottom: 4,
  },
  metricValue: { ...type.statMd },

  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  previewItem: { flex: 1, alignItems: 'center' },
  previewDivider: { width: 1, alignSelf: 'stretch', backgroundColor: D.border },
  previewVal: { ...type.statSm },
  previewValMuted: { ...type.statSm, color: D.muted },
  previewLabel: { ...type.caption, color: D.dim, marginTop: 3 },

  loopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  loopDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  loopText: { ...type.bodySm, color: D.muted },

  primaryBtn: { paddingVertical: 16, borderRadius: radius.pill, alignItems: 'center' },
  primaryBtnText: { ...type.button, color: '#fff' },

  stopBtn: { backgroundColor: D.danger, paddingVertical: 16, borderRadius: radius.pill, alignItems: 'center' },
  stopBtnText: { ...type.button, color: '#fff' },
});
