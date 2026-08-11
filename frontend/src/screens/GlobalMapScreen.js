import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Flame, X } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { radius, shadow, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { cityBbox } from '../config/cities';
import { NEUTRAL } from '../state/clan';
import { useAuth } from '../auth/AuthContext';
import { useAvatar } from '../state/avatar';
import { useAccent } from '../hooks/useAccent';
import { useReduceMotion } from '../ui/motion';
import { Button, Card, Pill, Sheet } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import { territoryRings } from '../components/claim/geometry';
import GameMap, { ContestedOutline, MAP_READY, TerritoryLayer, UserMarker } from '../components/GameMap';

// Area-weighted centroid (shoelace) of a territory's largest ring — where the
// owner portrait sits. Vertex-averaging drifts off-centre once a claim is
// carved into an irregular shape; the true centroid stays put.
function ringCentroid(t) {
  const ring = t.rings?.length ? t.rings[0] : t.polygon;
  if (!ring || ring.length < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate (a line) — fall back to the vertex mean.
    let lon = 0, lat = 0;
    for (const [x, y] of ring) { lon += x; lat += y; }
    return { latitude: lat / ring.length, longitude: lon / ring.length };
  }
  a *= 0.5;
  return { latitude: cy / (6 * a), longitude: cx / (6 * a) };
}

// Build the whole-board GeoJSON once per data change. Each ring is a feature
// carrying its clan colors, owning territory id, clan key, and contested flag.
function toFeatures(territories, userId) {
  const features = [];
  for (const t of territories) {
    const c = t.clan_color || NEUTRAL;
    const mine = t.user_id === userId;
    territoryRings(t).forEach((ring, ri) => {
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
          // Territory fill ~35% (own a touch higher), faded by decay so
          // land visibly weakens as it nears expiry.
          fillOpacity: (mine ? 0.45 : 0.35) * (0.35 + 0.65 * (t.freshness ?? 1)),
          contested: !!t.contested,
        },
      });
    });
  }
  return features;
}

// We fetch a REGION bigger than the screen and remember exactly what it covers.
// (The old code keyed a cache on the bbox rounded to 2dp / zoom rounded to an
// int — two genuinely different viewports collapsed to the same key, so a pan
// early-returned and the newly revealed strip, which was never fetched, drew
// empty. Land "disappearing" while panning was that.)
const VIEW_PAD = 0.6; // fetch 60% beyond each edge so small pans are pre-loaded
// Portraits help up close but cover territory silhouettes when the camera
// pulls back. Below this zoom, only a small player-location dot remains.
const PORTRAIT_MIN_ZOOM = 13.25;

function padBbox(b, f = VIEW_PAD) {
  const dLon = (b.maxLon - b.minLon) * f;
  const dLat = (b.maxLat - b.minLat) * f;
  return {
    minLon: b.minLon - dLon,
    minLat: b.minLat - dLat,
    maxLon: b.maxLon + dLon,
    maxLat: b.maxLat + dLat,
  };
}

// Is `inner` fully inside `outer`? Only then can we skip a refetch.
function bboxContains(outer, inner) {
  return (
    !!outer &&
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon &&
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat
  );
}

export default function GlobalMapScreen({ route }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { equipped } = useAvatar();
  const accent = useAccent();
  const reduce = useReduceMotion();
  const mapRef = useRef(null);
  // The padded region we've already loaded: { minLon,minLat,maxLon,maxLat, capped }.
  const coveredRef = useRef(null);
  // Latest in-flight request wins — stops a slow older response (fetched for a
  // smaller bbox) from landing last and wiping out land.
  const seqRef = useRef(0);
  // Last viewport the map settled on, so we can refetch on focus without a move.
  const lastViewRef = useRef(null);

  const [list, setList] = useState(null); // null = first load
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(12);
  const [heatOn, setHeatOn] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pulse, setPulse] = useState(0.85);
  const [myLoc, setMyLoc] = useState(null);
  // 'pending' | 'ok' | 'fail' — territory auto-fit only runs as a fallback.
  const [locState, setLocState] = useState('pending');

  // "VIEW LAND" from a rivalry / notification hands us a point to open on.
  // It wins over the my-location fly-in below: the caller is pointing at
  // something specific, and a `focus` only ever arrives on an explicit tap.
  const focus = route?.params?.focus;
  useEffect(() => {
    if (!focus?.lat) return;
    const t = setTimeout(
      () => mapRef.current?.flyTo({ latitude: focus.lat, longitude: focus.lon }, 15, 700),
      450
    );
    return () => clearTimeout(t);
  }, [focus?.lat, focus?.lon]);

  // Land on the player's dot as soon as the screen opens.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') { if (alive) setLocState('fail'); return; }
        const loc = await Location.getCurrentPositionAsync({});
        if (!alive) return;
        const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setMyLoc(p);
        setLocState('ok');
        // small delay so the camera call lands after the map is ready
        setTimeout(() => mapRef.current?.flyTo(p, 15, 700), 400);
      } catch {
        if (alive) setLocState('fail');
      }
    })();
    return () => { alive = false; };
  }, []);

  // Pulse the contested outline while heat is on (Reduce Motion → steady).
  useEffect(() => {
    if (!heatOn || reduce) return;
    const id = setInterval(() => setPulse((p) => (p > 0.6 ? 0.35 : 0.9)), 650);
    return () => clearInterval(id);
  }, [heatOn, reduce]);

  // Load land for `bbox`. Skips only when the visible viewport is genuinely
  // INSIDE what we already loaded (and the server's zoom cap band hasn't
  // changed) — never on a lossy rounded key. `force` bypasses the skip so a
  // fresh claim shows when returning to the map.
  const fetchViewport = async (bbox, z, force = false) => {
    // Mirrors the backend feature cap (map_zoom_vlow=11): crossing it changes
    // how much comes back, so re-fetch rather than reuse the capped set.
    const capped = (z ?? zoom) < 11;
    const cov = coveredRef.current;
    if (!force && cov && cov.capped === capped && bboxContains(cov, bbox)) return;

    const padded = padBbox(bbox);
    const seq = ++seqRef.current;
    try {
      const data = await api.mapPolygons(padded, z);
      if (seq !== seqRef.current) return; // superseded by a newer viewport
      coveredRef.current = { ...padded, capped };
      setList(data.territories);
      setLoadError(false);
    } catch {
      if (seq !== seqRef.current) return;
      // Leave coveredRef untouched so the next idle retries instead of
      // believing this region is loaded.
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
    lastViewRef.current = { bbox, z: z ?? zoom };
    fetchViewport(bbox, z ?? zoom);
  };

  // Coming back to the map (e.g. straight after claiming) refetches the current
  // view — otherwise no camera move means no idle, and the new land is missing.
  useFocusEffect(
    useCallback(() => {
      const v = lastViewRef.current;
      if (v) fetchViewport(v.bbox, v.z, true);
    }, [])
  );

  const locateMe = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setMyLoc(p);
      mapRef.current?.flyTo(p, 15);
    } catch {}
  };

  const rows = list || [];
  const features = useMemo(() => toFeatures(rows, user.id), [rows, user.id]);
  const contestedFC = useMemo(
    () => ({ type: 'FeatureCollection', features: features.filter((f) => f.properties.contested) }),
    [features]
  );
  const baseFC = useMemo(() => ({ type: 'FeatureCollection', features }), [features]);

  // Fallback framing — ONLY when location is unavailable (the primary
  // behaviour is landing on the player's dot). Frames own land, else board.
  const didFitRef = useRef(false);
  useEffect(() => {
    if (locState !== 'fail' || didFitRef.current || !list || list.length === 0) return;
    const mine = list.filter((t) => t.user_id === user.id);
    const focus = mine.length ? mine : list;
    const pts = [];
    focus.forEach((t) =>
      territoryRings(t).forEach((ring) =>
        ring.forEach(([lon, lat]) => pts.push({ latitude: lat, longitude: lon }))
      )
    );
    if (pts.length) {
      didFitRef.current = true;
      setTimeout(() => mapRef.current?.fitToPoints(pts, 80), 350);
    }
  }, [locState, list, user.id]);

  // Owner portraits pinned to the centre of EVERY territory in view. Others'
  // avatars come from the API; the viewer's own uses the freshest local
  // loadout. Capped + shown only when zoomed in enough to avoid clutter/perf.
  const landPortraits = useMemo(() => {
    if ((zoom || 0) < PORTRAIT_MIN_ZOOM) return [];
    return (list || [])
      .map((t) => ({
        id: t.id,
        mine: t.user_id === user.id,
        avatar: t.user_id === user.id ? equipped : t.avatar,
        ring: (t.clan_color || NEUTRAL).stroke,
        area: t.area_m2 || 0,
        at: ringCentroid(t),
      }))
      .filter((m) => m.at && m.avatar)
      .sort((a, b) => b.area - a.area)
      .slice(0, 40);
  }, [list, user.id, equipped, zoom]);
  const showPortraits = (zoom || 0) >= PORTRAIT_MIN_ZOOM;

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
      territoryRings(t).forEach((ring) =>
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
      <GameMap ref={mapRef} onIdle={onIdle} onPress={() => setSelected(null)}>
        <TerritoryLayer featureCollection={baseFC} onPress={onTerritoryPress} />
        {heatOn && <ContestedOutline featureCollection={contestedFC} opacity={reduce ? 0.8 : pulse} />}
        {/* owner portrait in the middle of every territory in view */}
        {landPortraits.map((m) => (
          <UserMarker key={m.id} point={m.at}>
            <CharacterBust equipped={m.avatar} size={m.mine ? 38 : 32} ring={m.mine ? accent : m.ring} bg={colors.card} />
          </UserMarker>
        ))}
        {/* Keep location visible when pulled back without covering the land. */}
        {myLoc && (
          <UserMarker point={myLoc}>
            {showPortraits ? (
              // The "this is you" ring has to be the opposite of the map it
              // sits on — a white ring vanished on the light style.
              <CharacterBust equipped={equipped} size={44} ring={colors.text} bg={colors.card} />
            ) : (
              <View style={[styles.locationDot, { backgroundColor: accent, borderColor: colors.card }]} />
            )}
          </UserMarker>
        )}
      </GameMap>

      {/* One map tool rail. Grouping heat, layers and recentering keeps three
          equal controls in one predictable place instead of scattering one
          button near the tab bar and two mismatched buttons at the top. */}
      <View style={[styles.topControls, { top: insets.top + space.md }]}>
        <TouchableOpacity
          style={[styles.controlButton, heatOn && { backgroundColor: colors.warn }]}
          onPress={() => setHeatOn((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Toggle contested zones"
        >
          <Flame size={20} color={heatOn ? '#fff' : colors.text} strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setLegendOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Show clubs in view"
          hitSlop={8}
        >
          <AppIcon name="layers" size={30} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={locateMe}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Center map on my location"
          hitSlop={8}
        >
          <AppIcon name="locate" size={30} />
        </TouchableOpacity>
      </View>

      {showEmpty && (
        <View style={[styles.noticePill, { top: insets.top + space.md }]}>
          <Text style={type.heading}>Unclaimed. Be first.</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>Close a loop here to claim the first land.</Text>
        </View>
      )}

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
            Captured by {selected.username}
            {selected.user_id === user.id ? ' (you)' : ''}
          </Text>
          <Text style={[type.caption, { marginTop: 2 }]}>
            {(selected.area_m2 / 1e6).toFixed(selected.area_m2 >= 1e5 ? 2 : 3)} km² ·{' '}
            strength ×{(selected.strength || 1).toFixed(1)} ·{' '}
            {selected.defenders > 1 ? `${selected.defenders} defenders · ` : ''}
            held since {new Date(selected.created_at).toLocaleDateString()}
            {selected.contested ? ' · contested' : ''}
          </Text>
          <Button
            title="View territory"
            variant="gradient"
            size="sm"
            onPress={() => {
              const pts = [];
              territoryRings(selected).forEach((ring) =>
                ring.forEach(([lon, lat]) => pts.push({ latitude: lat, longitude: lon }))
              );
              if (pts.length) mapRef.current?.fitToPoints(pts, 70);
            }}
            style={{ marginTop: space.md }}
          />
        </Card>
      )}

      {/* legend: top clubs in view */}
      <Sheet visible={legendOpen} onClose={() => setLegendOpen(false)}>
        <Text style={[type.heading, { marginBottom: space.md }]}>Clubs in view</Text>
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

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: space.xl },

  topControls: {
    position: 'absolute',
    right: space.gutter,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 4,
    gap: 2,
    ...shadow.raised,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  noticePill: {
    position: 'absolute',
    left: space.gutter,
    right: 88,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    ...shadow.raised,
  },

  locationDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: colors.card },

  card: { position: 'absolute', left: space.gutter, right: space.gutter, bottom: space.xl },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
});
