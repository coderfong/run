import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { Flame, Layers, Navigation, X } from 'lucide-react-native';

import { api } from '../api/client';
import { colors, radius, shadow, space, type } from '../theme';
import { cityBbox } from '../config/cities';
import { NEUTRAL } from '../state/clan';
import { useAuth } from '../auth/AuthContext';
import { useAccent } from '../hooks/useAccent';
import { useReduceMotion } from '../ui/motion';
import { Card, Pill, Sheet } from '../components/ui';
import GameMap, { ContestedOutline, MAP_READY, TerritoryLayer } from '../components/GameMap';

// Build the whole-board GeoJSON once per data change. Each ring is a feature
// carrying its clan colors, owning territory id, clan key, and contested flag.
function toFeatures(territories, userId) {
  const features = [];
  for (const t of territories) {
    const c = t.clan_color || NEUTRAL;
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
          clanTag: t.clan_tag || 'Solo',
          fillColor: c.stroke,
          strokeColor: c.stroke,
          // Constitution: territory fill ~35%; your own a touch higher.
          fillOpacity: mine ? 0.45 : 0.35,
          contested: !!t.contested,
        },
      });
    });
  }
  return features;
}

// Tile-ish cache key so returning to a viewport is instant.
function viewportKey(bbox, zoom) {
  const r = (n) => n.toFixed(2);
  return `${Math.round(zoom)}:${r(bbox.minLon)},${r(bbox.minLat)},${r(bbox.maxLon)},${r(bbox.maxLat)}`;
}

export default function GlobalMapScreen() {
  const { user } = useAuth();
  const accent = useAccent();
  const reduce = useReduceMotion();
  const mapRef = useRef(null);
  const cacheRef = useRef(new Map());
  const lastKeyRef = useRef(null);

  const [list, setList] = useState(null); // null = first load
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(12);
  const [heatOn, setHeatOn] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pulse, setPulse] = useState(0.85);

  // Pulse the contested outline while heat is on (Reduce Motion → steady).
  useEffect(() => {
    if (!heatOn || reduce) return;
    const id = setInterval(() => setPulse((p) => (p > 0.6 ? 0.35 : 0.9)), 650);
    return () => clearInterval(id);
  }, [heatOn, reduce]);

  const fetchViewport = async (bbox, z) => {
    const key = viewportKey(bbox, z);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (cacheRef.current.has(key)) {
      setList(cacheRef.current.get(key));
      setLoadError(false);
      return;
    }
    try {
      const data = await api.mapPolygons(bbox, z);
      cacheRef.current.set(key, data.territories);
      setList(data.territories);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setList((prev) => prev || []);
    }
  };

  const onIdle = ({ bounds, zoom: z }) => {
    if (z != null) setZoom(z);
    const bbox = {
      minLon: bounds.sw[0],
      minLat: bounds.sw[1],
      maxLon: bounds.ne[0],
      maxLat: bounds.ne[1],
    };
    fetchViewport(bbox, z ?? zoom);
  };

  const locateMe = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      mapRef.current?.flyTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }, 14);
    } catch {}
  };

  const rows = list || [];
  const features = useMemo(() => toFeatures(rows, user.id), [rows, user.id]);
  const contestedFC = useMemo(
    () => ({ type: 'FeatureCollection', features: features.filter((f) => f.properties.contested) }),
    [features]
  );
  const baseFC = useMemo(() => ({ type: 'FeatureCollection', features }), [features]);

  // Top clans in the current view, by summed area (legend).
  const topTeams = useMemo(() => {
    const acc = {};
    for (const t of rows) {
      const key = t.clan_tag || 'Solo';
      const color = t.clan_color || NEUTRAL;
      acc[key] = acc[key] || { key, color, area: 0, count: 0 };
      acc[key].area += t.area_m2 || 0;
      acc[key].count += 1;
    }
    return Object.values(acc).sort((a, b) => b.area - a.area).slice(0, 5);
  }, [rows]);

  const focusTeam = (key) => {
    const pts = [];
    for (const t of rows) {
      if ((t.clan_tag || 'Solo') !== key) continue;
      (t.rings?.length ? t.rings : [t.polygon]).forEach((ring) =>
        ring.forEach(([lon, lat]) => pts.push({ latitude: lat, longitude: lon }))
      );
    }
    if (pts.length) mapRef.current?.fitToPoints(pts, 60);
    setLegendOpen(false);
  };

  const onTerritoryPress = (e) => {
    const id = e?.features?.[0]?.properties?.territoryId;
    const t = rows.find((x) => x.id === id);
    if (t) setSelected(t);
  };

  if (!MAP_READY) {
    return (
      <View style={styles.center}>
        <Text style={type.heading}>Map needs a Mapbox token</Text>
        <Text style={[type.caption, { textAlign: 'center', marginTop: space.sm }]}>
          Set EXPO_PUBLIC_MAPBOX_TOKEN and rebuild the dev client (SETUP_MAPBOX.md).
        </Text>
      </View>
    );
  }

  const selectedColor = selected ? (selected.clan_color || NEUTRAL) : null;
  const loaded = list !== null;
  const showEmpty = loaded && rows.length === 0 && !loadError;

  return (
    <View style={styles.container}>
      <GameMap ref={mapRef} theme="light" showsUserLocation onIdle={onIdle} onPress={() => setSelected(null)}>
        <TerritoryLayer featureCollection={baseFC} onPress={onTerritoryPress} />
        {heatOn && <ContestedOutline featureCollection={contestedFC} opacity={reduce ? 0.8 : pulse} />}
      </GameMap>

      {/* top controls: heat + legend */}
      <View style={styles.topControls}>
        <TouchableOpacity
          style={[styles.roundBtn, heatOn && { backgroundColor: colors.warn }]}
          onPress={() => setHeatOn((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Toggle contested zones"
        >
          <Flame size={20} color={heatOn ? '#fff' : colors.text} strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.roundBtn}
          onPress={() => setLegendOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Show clans in view"
        >
          <Layers size={20} color={colors.text} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {showEmpty && (
        <View style={styles.noticePill}>
          <Text style={type.heading}>Unclaimed. Be first.</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>Close a loop here to claim the first land.</Text>
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
        <Navigation size={20} color={accent} strokeWidth={2} fill={accent} />
      </TouchableOpacity>

      {/* tapped-territory card */}
      {selected && selectedColor && (
        <Card style={styles.card}>
          <View style={styles.cardRow}>
            <Pill label={selected.clan_tag || 'Solo'} color={selectedColor.stroke} dot />
            <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <Text style={[type.bodyBold, { marginTop: space.sm }]} numberOfLines={1}>
            {selected.username}
            {selected.user_id === user.id ? ' (you)' : ''}
          </Text>
          <Text style={[type.caption, { marginTop: 2 }]}>
            {Math.round(selected.area_m2).toLocaleString()} m² · held since{' '}
            {new Date(selected.created_at).toLocaleDateString()}
            {selected.contested ? ' · contested' : ''}
          </Text>
        </Card>
      )}

      {/* legend: top clans in view */}
      <Sheet visible={legendOpen} onClose={() => setLegendOpen(false)}>
        <Text style={[type.heading, { marginBottom: space.md }]}>Clans in view</Text>
        {topTeams.length === 0 ? (
          <Text style={[type.caption, { marginBottom: space.md }]}>No claimed land in view yet.</Text>
        ) : (
          topTeams.map(({ key, color, area, count }) => (
            <TouchableOpacity key={key} style={styles.legendRow} onPress={() => focusTeam(key)}>
              <View style={[styles.legendDot, { backgroundColor: color.stroke }]} />
              <Text style={[type.bodyBold, { flex: 1 }]}>{key}</Text>
              <Text style={type.captionMedium}>
                {(area / 1e6).toFixed(2)} km² · {count}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: space.xl },

  topControls: { position: 'absolute', top: space.xxl, right: space.gutter, gap: space.md },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },

  noticePill: {
    position: 'absolute',
    top: space.xxl,
    left: space.gutter,
    right: 76,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    ...shadow.raised,
  },

  fab: {
    position: 'absolute',
    right: space.gutter,
    bottom: 96,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },

  card: { position: 'absolute', left: space.gutter, right: space.gutter, bottom: space.xl },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
});
