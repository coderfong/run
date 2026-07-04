import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';
import * as Location from 'expo-location';

import { api } from '../api/client';
import { colors, radius, space, type } from '../theme';
import { SG_REGIONS, SG_VIEW_REGION, regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../ui/toast';

// Stable color per user — same player's territories share a hue.
function colorForUser(userId) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    fill: `hsla(${hue}, 70%, 50%, 0.35)`,
    stroke: `hsl(${hue}, 70%, 60%)`,
  };
}

// '#2563eb' -> 'rgba(37,99,235,a)' for map fill colours.
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function GlobalMapScreen() {
  const { user } = useAuth();
  const myTeam = regionForUser(user.username);
  const [region, setRegion] = useState(null);
  const [territories, setTerritories] = useState([]);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      } else {
        setRegion(SG_VIEW_REGION);
      }
    })();
  }, []);

  const onRegionChangeComplete = async (r) => {
    const now = Date.now();
    if (now - lastFetchRef.current < 500) return;
    lastFetchRef.current = now;
    const half_lon = r.longitudeDelta / 2;
    const half_lat = r.latitudeDelta / 2;
    try {
      const data = await api.mapPolygons({
        minLon: r.longitude - half_lon,
        minLat: r.latitude - half_lat,
        maxLon: r.longitude + half_lon,
        maxLat: r.latitude + half_lat,
      });
      setTerritories(data.territories);
    } catch (e) {
      toast.error(e.message || 'Could not load map');
    }
  };

  if (!region) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={region}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation
      >
        {/* Faint region tint underneath so the 5-team map style is consistent. */}
        {SG_REGIONS.flatMap((r) =>
          r.polygons.map((coords, i) => (
            <Polygon
              key={`region-${r.key}-${i}`}
              coordinates={coords}
              strokeColor={`${r.color}66`}
              strokeWidth={1}
              fillColor={`${r.color}1a`}
            />
          )),
        )}

        {territories.map((t) => {
          const c = colorForUser(t.user_id);
          const coords = t.polygon.map(([lon, lat]) => ({
            latitude: lat,
            longitude: lon,
          }));
          return (
            <Polygon
              key={t.id}
              coordinates={coords}
              strokeColor={t.user_id === user.id ? myTeam.stroke : c.stroke}
              strokeWidth={t.user_id === user.id ? 2.5 : 1.5}
              fillColor={
                t.user_id === user.id ? hexToRgba(myTeam.stroke, 0.45) : c.fill
              }
            />
          );
        })}
      </MapView>

      <View style={styles.legend}>
        {SG_REGIONS.map((r) => (
          <View key={r.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: r.color }]} />
            <Text style={styles.legendLabel}>{r.name}</Text>
          </View>
        ))}
      </View>
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
  },
  map: { flex: 1 },

  legend: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendLabel: { ...type.captionMedium, color: colors.text },
});
