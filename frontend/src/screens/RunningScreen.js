import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';

import { api } from '../api/client';
import { colors, font, radius, space } from '../theme';
import { toast } from '../ui/toast';

const LOOP_CLOSE_DISTANCE_M = 25;
const MIN_POINTS_FOR_LOOP = 15;
const MIN_DISTANCE_FOR_LOOP_M = 80;

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
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * c;
}

function totalDistanceMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

function toApiPoints(points) {
  // Backend accepts either `t` or `timestamp`; we send ISO `t` for cleanliness.
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

export default function RunningScreen({ navigation }) {
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
  const [distance, setDistance] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

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

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const point = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: Date.now(),
    };

    setCurrentLocation(point);

    mapRef.current?.animateToRegion(
      {
        latitude: point.latitude,
        longitude: point.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
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
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 3,
      },
      async (location) => {
        const nextPoint = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: Date.now(),
        };

        setCurrentLocation(nextPoint);

        const oldPath = pathRef.current;
        const previousPoint = oldPath[oldPath.length - 1];

        if (previousPoint && distanceMeters(previousPoint, nextPoint) < 2) {
          return;
        }

        const newPath = [...oldPath, nextPoint];
        pathRef.current = newPath;

        setPath(newPath);
        setDistance(totalDistanceMeters(newPath));

        mapRef.current?.animateToRegion(
          {
            latitude: nextPoint.latitude,
            longitude: nextPoint.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          },
          300
        );

        const startPoint = newPath[0];
        const distanceToStart = distanceMeters(startPoint, nextPoint);
        const newDistance = totalDistanceMeters(newPath);

        const hasEnoughPoints = newPath.length >= MIN_POINTS_FOR_LOOP;
        const hasRunEnoughDistance = newDistance >= MIN_DISTANCE_FOR_LOOP_M;
        const isNearStart = distanceToStart <= LOOP_CLOSE_DISTANCE_M;

        if (
          !loopClosedRef.current &&
          hasEnoughPoints &&
          hasRunEnoughDistance &&
          isNearStart
        ) {
          loopClosedRef.current = true;
          setLoopClosed(true);
          setPolygon(newPath);

          Alert.alert(
            'Loop detected',
            'You returned near your starting point — the enclosed area is now shaded.'
          );
        }

        if (runRef.current && newPath.length % 5 === 0) {
          try {
            await api.submitPath(runRef.current.id, toApiPoints(newPath));
          } catch (err) {
            // non-fatal, the final commit on /end-run is what matters
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

      navigation.navigate('Result', {
        result,
        run: result,
        loopClosed,
        path: finalPath,
        polygon,
      });
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
    : {
        latitude: 1.3521,
        longitude: 103.8198,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };

  const paceText =
    distance > 50 && elapsedMs > 1000
      ? (() => {
          const minPerKm = elapsedMs / 1000 / 60 / (distance / 1000);
          const m = Math.floor(minPerKm);
          const s = Math.round((minPerKm - m) * 60);
          return `${m}:${String(s).padStart(2, '0')} /km`;
        })()
      : '—';

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {path.length > 1 && (
          <Polyline
            coordinates={path}
            strokeWidth={5}
            strokeColor={colors.primary}
          />
        )}

        {polygon.length >= 3 && (
          <Polygon
            coordinates={polygon}
            strokeWidth={3}
            strokeColor={colors.primary}
            fillColor="rgba(197, 252, 75, 0.25)"
          />
        )}

        {path.length > 0 && (
          <Marker coordinate={path[0]} title="Start" />
        )}
      </MapView>

      <View style={styles.panel}>
        <View style={styles.metricsRow}>
          <Metric label="Distance" value={`${(distance / 1000).toFixed(2)} km`} />
          <Metric label="Time" value={formatDuration(elapsedMs)} />
          <Metric label="Pace" value={paceText} />
        </View>

        <View style={styles.loopRow}>
          <View
            style={[
              styles.loopDot,
              { backgroundColor: loopClosed ? colors.primary : colors.textDim },
            ]}
          />
          <Text style={styles.loopText}>
            {loopClosed
              ? 'Loop closed — territory captured'
              : `Loop: not yet (${path.length} pts)`}
          </Text>
        </View>

        {!isRunning ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={startRun}
          >
            <Text style={styles.primaryBtnText}>Start Run</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.stopBtn}
            activeOpacity={0.85}
            onPress={finishRun}
          >
            <Text style={styles.stopBtnText}>Finish Run</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },

  panel: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },

  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  metric: { flex: 1 },
  metricLabel: { ...font.muted, marginBottom: 4 },
  metricValue: { color: colors.primary, fontSize: 22, fontWeight: '800' },

  loopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.md,
  },
  loopDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  loopText: { color: colors.textMuted, fontSize: 13 },

  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.primaryInk, fontWeight: '800', fontSize: 16 },

  stopBtn: {
    backgroundColor: colors.danger,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  stopBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
