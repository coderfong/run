import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';

import { colors, radius, space, type } from '../theme';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';

// Open-path conversion (brief §6): distance (km) × 0.05 km² — roughly a
// 50m-wide strip painted along the route. Closing a loop always beats this,
// but a partial run still earns land.
const OPEN_PATH_RATE = 0.05;

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function ResultScreen({ navigation, route }) {
  const { result } = route.params;
  const { user } = useAuth();
  const team = regionForUser(user?.username || '');
  const accent = team.stroke;
  const t = result.territory;

  if (!t) {
    const openKm = (result.distance_m / 1000) * OPEN_PATH_RATE;
    return (
      <View style={styles.center}>
        <View style={[styles.eyebrow, { backgroundColor: team.fill }]}>
          <Text style={[styles.eyebrowText, { color: team.text }]}>Distance converted</Text>
        </View>
        <Text style={styles.bigArea}>
          {openKm.toFixed(2)}
          <Text style={styles.bigUnit}> km²</Text>
        </Text>
        <Text style={styles.body}>
          No closed loop this time — your {(result.distance_m / 1000).toFixed(2)} km converts to an open-path
          strip for Team {team.name}. Close the loop next time to claim far more.
        </Text>

        <View style={styles.metricsRow}>
          <Metric label="Distance" value={`${Math.round(result.distance_m)} m`} accent={accent} />
          <Metric label="Time" value={`${Math.round(result.duration_s)} s`} accent={accent} />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: accent }]}
          activeOpacity={0.9}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.primaryBtnText}>Back to map</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const coords = t.polygon.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const lats = coords.map((c) => c.latitude);
  const lons = coords.map((c) => c.longitude);
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
    latitudeDelta: (Math.max(...lats) - Math.min(...lats)) * 1.6 + 0.001,
    longitudeDelta: (Math.max(...lons) - Math.min(...lons)) * 1.6 + 0.001,
  };

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={region}>
        <Polygon
          coordinates={coords}
          strokeColor={accent}
          strokeWidth={2.5}
          fillColor={hexToRgba(accent, 0.32)}
        />
      </MapView>

      <View style={styles.summary}>
        <View style={[styles.eyebrow, { backgroundColor: team.fill, alignSelf: 'flex-start' }]}>
          <Text style={[styles.eyebrowText, { color: team.text }]}>Loop captured · Team {team.name}</Text>
        </View>
        <Text style={styles.headline}>Land claimed!</Text>

        <View style={styles.metricsRow}>
          <Metric label="Area" value={`${Math.round(t.area_m2).toLocaleString()} m²`} accent={accent} />
          <Metric label="Distance" value={`${Math.round(result.distance_m)} m`} accent={accent} />
          <Metric label="Time" value={`${Math.round(result.duration_s)} s`} accent={accent} />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: accent }]}
          activeOpacity={0.9}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
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
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  map: { flex: 1 },

  eyebrow: {
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    marginBottom: space.md,
  },
  eyebrowText: { ...type.labelSm },

  bigArea: { ...type.statHero },
  bigUnit: { ...type.statMd, color: colors.textMuted },

  summary: {
    position: 'absolute',
    bottom: space.lg,
    left: space.md,
    right: space.md,
    backgroundColor: colors.card,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.border,
    shadowColor: '#0d1117',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  headline: { ...type.title, marginBottom: space.md },
  body: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: space.sm,
    marginBottom: space.lg,
  },

  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.lg,
    gap: space.md,
  },
  metric: { flex: 1 },
  metricLabel: {
    ...type.labelSm,
    marginBottom: 4,
  },
  metricValue: { ...type.statSm },

  primaryBtn: {
    paddingVertical: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  primaryBtnText: { ...type.button, color: '#fff' },
});
