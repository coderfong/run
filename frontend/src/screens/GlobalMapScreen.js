import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import Svg, { Circle, Path } from 'react-native-svg';

import { api } from '../api/client';
import { colors, radius, shadow, space, type, withAlpha } from '../theme';
import { cityBbox } from '../config/cities';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { PressableScale, Skeleton } from '../ui/motion';
import GameMap, { MAP_READY, TerritoryLayer } from '../components/GameMap';

// Build one GeoJSON FeatureCollection for the whole board — every ring is a
// feature carrying its own colors + the owning territory id (for taps).
function toFeatureCollection(territories, userId) {
  const features = [];
  for (const t of territories) {
    const team = regionForUser(t.username);
    const mine = t.user_id === userId;
    const rings = t.rings?.length ? t.rings : [t.polygon];
    rings.forEach((ring, ri) => {
      if (!ring || ring.length < 3) return;
      const coords = ring.map(([lon, lat]) => [lon, lat]);
      if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0]);
      }
      features.push({
        type: 'Feature',
        id: `${t.id}-${ri}`,
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {
          territoryId: t.id,
          fillColor: team.stroke,
          strokeColor: team.stroke,
          fillOpacity: mine ? 0.4 : 0.2,
        },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

export default function GlobalMapScreen() {
  const { user } = useAuth();
  const myTeam = regionForUser(user.username);
  const mapRef = useRef(null);
  const [territories, setTerritories] = useState(null); // null = first load
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      const data = await api.mapPolygons(cityBbox());
      setTerritories(data.territories);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
      setTerritories((prev) => prev || []);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const locateMe = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      mapRef.current?.flyTo(
        { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
        14
      );
    } catch {}
  };

  const list = territories || [];
  const featureCollection = useMemo(
    () => toFeatureCollection(list, user.id),
    [list, user.id]
  );
  const selectedTeam = selected ? regionForUser(selected.username) : null;
  const loaded = territories !== null;

  const onTerritoryPress = (e) => {
    const id = e?.features?.[0]?.properties?.territoryId;
    const t = list.find((x) => x.id === id);
    if (t) setSelected(t);
  };

  if (!MAP_READY) {
    // Dev builds without a Mapbox token yet — explain rather than show blank.
    return (
      <View style={styles.center}>
        <Text style={styles.noticeTitle}>Map needs a Mapbox token</Text>
        <Text style={[styles.noticeBody, { textAlign: 'center', marginTop: space.sm }]}>
          Set EXPO_PUBLIC_MAPBOX_TOKEN and rebuild the dev client.{'\n'}See
          SETUP_MAPBOX.md.
        </Text>
      </View>
    );
  }

  if (!loaded) {
    return (
      <View style={styles.center}>
        <Skeleton width="88%" height={300} style={{ borderRadius: radius.lg }} />
        <Skeleton width="60%" height={16} style={{ marginTop: space.lg }} />
        <Skeleton width="42%" height={12} style={{ marginTop: space.sm }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GameMap
        ref={mapRef}
        theme="light"
        showsUserLocation
        onPress={() => setSelected(null)}
      >
        <TerritoryLayer
          featureCollection={featureCollection}
          onPress={onTerritoryPress}
        />
      </GameMap>

      {loaded && list.length === 0 && !loadError && (
        <View style={styles.noticePill}>
          <Text style={styles.noticeTitle}>Unclaimed. Be first.</Text>
          <Text style={styles.noticeBody}>Close a loop to claim the first land here.</Text>
        </View>
      )}

      {loadError && (
        <View style={styles.noticePill}>
          <Text style={styles.noticeTitle}>Couldn't load territories.</Text>
          <PressableScale
            style={styles.retryBtn}
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Retry loading territories"
          >
            <Text style={styles.retryText}>Retry</Text>
          </PressableScale>
        </View>
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={locateMe}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Center map on my location"
      >
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={3.2} fill={myTeam.stroke} />
          <Circle cx={12} cy={12} r={7} stroke={myTeam.stroke} strokeWidth={1.8} />
          <Path
            d="M12 2v3M12 19v3M2 12h3M19 12h3"
            stroke={myTeam.stroke}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </Svg>
      </TouchableOpacity>

      {selected && selectedTeam && (
        <View style={styles.card}>
          <View style={[styles.cardChip, { backgroundColor: selectedTeam.fill }]}>
            <View style={[styles.cardDot, { backgroundColor: selectedTeam.stroke }]} />
            <Text style={[styles.cardChipText, { color: selectedTeam.text }]}>
              {selectedTeam.name}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardName} numberOfLines={1}>
              {selected.username}
              {selected.user_id === user.id ? ' (you)' : ''}
            </Text>
            <Text style={styles.cardMeta}>
              {Math.round(selected.area_m2).toLocaleString()} m² · captured{' '}
              {new Date(selected.created_at).toLocaleDateString()}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setSelected(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close territory details"
          >
            <Text style={styles.cardClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
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

  noticePill: {
    position: 'absolute',
    top: space.lg,
    left: space.xl,
    right: space.xl,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: colors.border,
    padding: space.lg,
    alignItems: 'center',
    ...shadow.raised,
  },
  noticeTitle: { ...type.heading },
  noticeBody: { ...type.caption, marginTop: 2 },
  retryBtn: {
    marginTop: space.md,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },
  retryText: { ...type.buttonSm },

  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: 76,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: colors.border,
    ...shadow.raised,
  },

  card: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: colors.border,
    padding: space.lg,
    ...shadow.raised,
  },
  cardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  cardDot: { width: 8, height: 8, borderRadius: 4 },
  cardChipText: { ...type.bodySmBold },
  cardName: { ...type.bodyBold },
  cardMeta: { ...type.caption, marginTop: 2 },
  cardClose: { ...type.heading, color: colors.textDim },
});
