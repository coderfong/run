import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';

import { colors, font, radius, space } from '../theme';

export default function ResultScreen({ navigation, route }) {
  const { result } = route.params;
  const t = result.territory;

  if (!t) {
    return (
      <View style={styles.center}>
        <Text style={styles.headline}>No loop detected</Text>
        <Text style={styles.body}>
          Distance: {Math.round(result.distance_m)} m
        </Text>
        <Text style={styles.body}>
          Duration: {Math.round(result.duration_s)} s
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.primaryBtnText}>Back</Text>
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
          strokeColor={colors.primary}
          strokeWidth={2.5}
          fillColor="rgba(197, 252, 75, 0.30)"
        />
      </MapView>

      <View style={styles.summary}>
        <Text style={styles.headline}>Loop captured!</Text>

        <View style={styles.metricsRow}>
          <Metric
            label="Area"
            value={`${Math.round(t.area_m2).toLocaleString()} m²`}
          />
          <Metric
            label="Distance"
            value={`${Math.round(result.distance_m)} m`}
          />
          <Metric
            label="Time"
            value={`${Math.round(result.duration_s)} s`}
          />
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
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
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  map: { flex: 1 },

  summary: {
    position: 'absolute',
    bottom: space.lg,
    left: space.md,
    right: space.md,
    backgroundColor: colors.card,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },

  headline: { ...font.title, marginBottom: space.md },
  body: { ...font.body, marginVertical: 2 },

  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  metric: { flex: 1 },
  metricLabel: { ...font.muted, marginBottom: 4 },
  metricValue: { color: colors.primary, fontSize: 18, fontWeight: '800' },

  primaryBtn: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.primaryInk, fontWeight: '800', fontSize: 16 },
});
