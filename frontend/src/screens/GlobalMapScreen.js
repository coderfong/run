import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';
import * as Location from 'expo-location';
import Svg, { Circle, Path } from 'react-native-svg';

import { api } from '../api/client';
import { colors, radius, shadow, space, type, withAlpha } from '../theme';
import { SG_REGIONS, SG_VIEW_REGION, regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { PressableScale, Skeleton } from '../ui/motion';

export default function GlobalMapScreen() {
  const { user } = useAuth();
  const myTeam = regionForUser(user.username);
  const mapRef = useRef(null);
  const [region, setRegion] = useState(null);
  const [territories, setTerritories] = useState(null); // null = first load
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null); // tapped territory
  const lastFetchRef = useRef(0);
  const lastRegionRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({});
          setRegion({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
          return;
        } catch {}
      }
      setRegion(SG_VIEW_REGION);
    })();
  }, []);

  const fetchForRegion = async (r) => {
    lastRegionRef.current = r;
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
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    }
  };

  const onRegionChangeComplete = (r) => {
    const now = Date.now();
    if (now - lastFetchRef.current < 500) return;
    lastFetchRef.current = now;
    fetchForRegion(r);
  };

  const locateMe = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion(
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        400
      );
    } catch {}
  };

  if (!region) {
    // Map-shaped skeleton while we resolve the start viewport.
    return (
      <View style={styles.center}>
        <Skeleton width="88%" height={300} style={{ borderRadius: radius.lg }} />
        <Skeleton width="60%" height={16} style={{ marginTop: space.lg }} />
        <Skeleton width="42%" height={12} style={{ marginTop: space.sm }} />
      </View>
    );
  }

  const loaded = territories !== null;
  const list = territories || [];
  const selectedTeam = selected ? regionForUser(selected.username) : null;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={() => setSelected(null)}
        showsUserLocation
        showsMyLocationButton={false}
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

        {/* Player territories in their team colours; yours pops a little. */}
        {list.map((t) => {
          const team = regionForUser(t.username);
          const mine = t.user_id === user.id;
          const isSel = selected?.id === t.id;
          return (
            <Polygon
              key={t.id}
              coordinates={t.polygon.map(([lon, lat]) => ({
                latitude: lat,
                longitude: lon,
              }))}
              strokeColor={team.stroke}
              strokeWidth={isSel ? 3.5 : mine ? 2.5 : 1.5}
              fillColor={withAlpha(team.stroke, mine ? 0.4 : 0.2)}
              tappable
              onPress={(e) => {
                e.stopPropagation?.();
                setSelected(t);
              }}
            />
          );
        })}
      </MapView>

      {/* empty state — no claimed land in this view yet */}
      {loaded && list.length === 0 && !loadError && (
        <View style={styles.noticePill}>
          <Text style={styles.noticeTitle}>No territory here yet.</Text>
          <Text style={styles.noticeBody}>Close a loop to claim the first.</Text>
        </View>
      )}

      {/* load error + retry */}
      {loadError && (
        <View style={styles.noticePill}>
          <Text style={styles.noticeTitle}>Couldn't load territories.</Text>
          <PressableScale
            style={styles.retryBtn}
            onPress={() => lastRegionRef.current && fetchForRegion(lastRegionRef.current)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading territories"
          >
            <Text style={styles.retryText}>Retry</Text>
          </PressableScale>
        </View>
      )}

      {/* locate-me FAB */}
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

      {/* tapped-territory card */}
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

      {!selected && (
        <View style={styles.legend}>
          {SG_REGIONS.map((r) => (
            <View key={r.key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: r.color }]} />
              <Text style={styles.legendLabel}>{r.name}</Text>
            </View>
          ))}
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
    ...shadow.card,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendLabel: { ...type.captionMedium, color: colors.text },

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
