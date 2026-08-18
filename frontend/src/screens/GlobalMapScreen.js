import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
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
import { ScreenIn, useReduceMotion } from '../ui/motion';
import { Button, Card, Pill, Sheet } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import { territoryRings } from '../components/claim/geometry';
import GameMap, {
  ContestedOutline,
  MapPoint,
  MAP_READY,
  TerritoryLayer,
  Trail,
  UserMarker,
} from '../components/GameMap';
import { GOLD } from '../config/pro';
import MapProfileSheet from '../components/MapProfileSheet';
import MapLayersSheet from '../components/map/MapLayersSheet';
import TerritoryPlanner from '../components/map/TerritoryPlanner';
import { EVENTS, track } from '../analytics';
import { layerByKey, layerFeatureCollection } from '../map/intelligence';
import { analyseRoute } from '../map/planner';
import { isDrag, shouldSample, strokeToRoute } from '../map/freehand';
import { useProEntitlement } from '../pro/ProProvider';
import { shortDate } from '../utils/time';

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
function toFeatures(territories, userId, playerAccent) {
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
          fillColor: mine && playerAccent ? playerAccent : c.stroke,
          strokeColor: mine && playerAccent ? playerAccent : c.stroke,
          // Territory fill ~48% (own a touch higher), faded by decay so land
          // visibly weakens as it nears expiry — but never down to the wash
          // it used to fade to, which read as barely-there rather than aged.
          fillOpacity: (mine ? 0.58 : 0.48) * (0.55 + 0.45 * (t.freshness ?? 1)),
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

export default function GlobalMapScreen({ route, navigation }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { equipped } = useAvatar();
  const accent = useAccent();
  const reduce = useReduceMotion();
  // The board's entrance is keyed to arriving on the tab, not to mounting:
  // this screen mounts at launch behind Home (App.js preloads every tab), so
  // a mount-time reveal would have finished long before anyone looked at it.
  const focused = useIsFocused();
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
  // Tapped territory/avatar's owner — drives the quick-look profile popup.
  const [profileUserId, setProfileUserId] = useState(null);
  const [zoom, setZoom] = useState(12);
  // Mirrors `zoom` so onIdle can read a fallback value without depending on
  // the `zoom` state itself — see the note on onIdle below.
  const zoomRef = useRef(12);
  const [heatOn, setHeatOn] = useState(false);
  // Mapbox has parsed the style and drawn a frame. Half of the board's
  // entrance (see the ScreenIn below); the other half is the land itself.
  const [mapLoaded, setMapLoaded] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  // Which intelligence overlay is drawn on top of the board. 'all' is the
  // board exactly as it has always been.
  const [layerKey, setLayerKey] = useState('all');

  // --- Territory Planner -------------------------------------------------
  const { isPro, openPaywall, plannerPreviewsLeft, spendPlannerPreview } = useProEntitlement();
  const [planning, setPlanning] = useState(false);
  const [planPoints, setPlanPoints] = useState([]);
  // Null until a preview has actually been RUN. Drawing points costs nothing;
  // this is the thing the free allowance pays for.
  const [planAnalysis, setPlanAnalysis] = useState(null);
  const [pulse, setPulse] = useState(0.85);
  const [myLoc, setMyLoc] = useState(null);
  // 'pending' | 'ok' | 'fail' — territory auto-fit only runs as a fallback.
  const [locState, setLocState] = useState('pending');

  // "VIEW LAND" from a rivalry / notification hands us a point to open on.
  // It wins over the my-location fly-in below: the caller is pointing at
  // something specific, and a `focus` only ever arrives on an explicit tap.
  const focus = route?.params?.focus;
  useEffect(() => {
    if (!Number.isFinite(focus?.lat) || !Number.isFinite(focus?.lon)) return;
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
        // Explicit "See the map" focus owns the camera. A late location fix
        // must not pull the runner away from the land they just asked to see.
        if (!Number.isFinite(focus?.lat) || !Number.isFinite(focus?.lon)) {
          setTimeout(() => mapRef.current?.flyTo(p, 15, 700), 400);
        }
      } catch {
        if (alive) setLocState('fail');
      }
    })();
    return () => { alive = false; };
  }, [focus?.lat, focus?.lon]);

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
  //
  // useCallback with a stable identity (`zoomRef` instead of the `zoom` state
  // for the fallback) — onIdle below closes over this function, and a plain
  // per-render redefinition here would have made that closure stale.
  const fetchViewport = useCallback(async (bbox, z, force = false) => {
    // Mirrors the backend feature cap (map_zoom_vlow=11): crossing it changes
    // how much comes back, so re-fetch rather than reuse the capped set.
    const capped = (z ?? zoomRef.current) < 11;
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
  }, []);

  // useCallback with a stable identity (no `zoom` in deps — `zoomRef` covers
  // the fallback read instead) so this survives GlobalMapScreen's own
  // re-renders unchanged. GameMap/ShapeSource are PureComponents: an onIdle
  // prop that changed reference every render defeated that gate, forcing a
  // full re-render (and a JSON.stringify of the whole board's GeoJSON) on
  // every single pan/zoom settle, whether or not the viewport actually moved
  // enough to need new data.
  const onIdle = useCallback(({ bounds, zoom: z }) => {
    if (z != null) {
      zoomRef.current = z;
      setZoom(z);
    }
    const bbox = {
      minLon: bounds.sw[0],
      minLat: bounds.sw[1],
      maxLon: bounds.ne[0],
      maxLat: bounds.ne[1],
    };
    const zz = z ?? zoomRef.current;
    lastViewRef.current = { bbox, z: zz };
    fetchViewport(bbox, zz);
  }, [fetchViewport]);

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
  const features = useMemo(() => toFeatures(rows, user.id, accent), [rows, user.id, accent]);
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
        userId: t.user_id,
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

  // useCallback so TerritoryLayer/ShapeSource (a PureComponent) doesn't see a
  // changed onPress — and re-stringify the whole board's GeoJSON — on every
  // GlobalMapScreen render that isn't actually about a new tap.
  const onTerritoryPress = useCallback((e) => {
    // While planning, a tap ON a polygon has to drop a point like any other
    // tap. Mapbox gives the ShapeSource's own onPress precedence over the
    // map's, so without this the planner went dead over exactly the ground it
    // exists to plan around — you could draw across open land and nowhere
    // else, which reads as the feature being broken.
    if (planning) {
      const coords = e?.coordinates
        ? [e.coordinates.longitude, e.coordinates.latitude]
        : e?.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2 && Number.isFinite(coords[0])) {
        setPlanPoints((prev) => [...prev, { latitude: coords[1], longitude: coords[0] }]);
        setPlanAnalysis(null);
      }
      return;
    }
    const id = e?.features?.[0]?.properties?.territoryId;
    const t = rows.find((x) => x.id === id);
    if (t) setSelected(t);
  }, [rows, planning]);

  // Same reasoning: GameMap's onPress prop must stay referentially stable.
  // In planning mode a tap DROPS A POINT instead of dismissing the card —
  // dismissing was the only meaning it had, and the planner needs the whole
  // map surface to draw on.
  const onMapPress = useCallback((e) => {
    if (!planning) {
      setSelected(null);
      return;
    }
    const coords = e?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;
    setPlanPoints((prev) => [...prev, { latitude: coords[1], longitude: coords[0] }]);
    // The reading is stale the moment the route changes. Clearing it is
    // honest; leaving last route's numbers under a new line is not.
    setPlanAnalysis(null);
  }, [planning]);

  const onMapReady = useCallback(() => setMapLoaded(true), []);

  // --- planner -----------------------------------------------------------

  // --- free drawing -------------------------------------------------------
  //
  // Tap mode drops one point per tap and is what the planner has always done.
  // Draw mode traces the route under your finger, which is the gesture the
  // feature actually wants: a loop round a park is a stroke, not fourteen taps.
  //
  // The live stroke is kept in a REF and mirrored into state only for the
  // overlay that draws it. A gesture handler that setStates on every touch
  // move re-renders the whole map screen ~60 times a second, and this screen
  // carries a Mapbox tree that is expensive to reconcile — the ref is what the
  // gesture reads and writes, the state is only ever what gets painted.
  const [drawMode, setDrawMode] = useState(false);
  const strokeRef = useRef([]);
  const [stroke, setStroke] = useState([]);
  const [converting, setConverting] = useState(false);

  // Screen pixels become coordinates ONCE, on release — see
  // `unprojectPoints` on the map ref for why this cannot be done per sample.
  const commitStroke = useCallback(async (raw) => {
    const route = strokeToRoute(raw);
    if (route.length < 2) return;
    setConverting(true);
    try {
      const points = await mapRef.current?.unprojectPoints?.(route);
      if (points?.length >= 2) {
        // Replaces rather than appends. A second stroke is a redrawn route,
        // not a continuation of the first — appending would join the end of
        // the old line to the start of the new one across the whole map.
        setPlanPoints(points);
        setPlanAnalysis(null);
      }
    } catch {
      // The map went away mid-gesture. The old route is still on screen and
      // still correct; losing a stroke is recoverable, a crash is not.
    } finally {
      setConverting(false);
      strokeRef.current = [];
      setStroke([]);
    }
  }, []);

  // Rebuilt only when the mode or the commit function changes — a PanResponder
  // recreated every render loses the gesture that is currently in flight.
  const drawResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawMode,
        onMoveShouldSetPanResponder: () => drawMode,
        // Claim the gesture outright: the native map is underneath and would
        // otherwise pan the camera while the finger is drawing on it.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const { locationX: x, locationY: y } = event.nativeEvent;
          strokeRef.current = [{ x, y }];
          setStroke(strokeRef.current);
        },
        onPanResponderMove: (event) => {
          const { locationX: x, locationY: y } = event.nativeEvent;
          const last = strokeRef.current[strokeRef.current.length - 1];
          if (!shouldSample({ x, y }, last)) return;
          strokeRef.current = [...strokeRef.current, { x, y }];
          setStroke(strokeRef.current);
        },
        onPanResponderRelease: async () => {
          const raw = strokeRef.current;
          // A tap in draw mode still drops a single point, because a route of
          // two deliberate ends is a legitimate thing to want and scribbling a
          // straight line to get one would be absurd.
          if (!isDrag(raw)) {
            const [point] = raw;
            strokeRef.current = [];
            setStroke([]);
            if (point) {
              const converted = await mapRef.current?.unprojectPoints?.([point]);
              if (converted?.[0]) {
                setPlanPoints((prev) => [...prev, converted[0]]);
                setPlanAnalysis(null);
              }
            }
            return;
          }
          commitStroke(raw);
        },
        onPanResponderTerminate: () => {
          strokeRef.current = [];
          setStroke([]);
        },
      }),
    [drawMode, commitStroke]
  );

  const openPlanner = useCallback(() => {
    setPlanning(true);
    setSelected(null);
    track(EVENTS.FEATURE_PREVIEW, {
      source: 'map_planner',
      feature: 'territory_planner',
      previews_left: Number.isFinite(plannerPreviewsLeft) ? plannerPreviewsLeft : -1,
    });
  }, [plannerPreviewsLeft]);

  const closePlanner = useCallback(() => {
    setPlanning(false);
    setPlanPoints([]);
    setPlanAnalysis(null);
    setDrawMode(false);
    strokeRef.current = [];
    setStroke([]);
  }, []);

  const runPreview = useCallback(() => {
    if (planPoints.length < 2) return;
    // The gate is checked HERE, at the moment a preview would actually be
    // spent, rather than when the planner opens. Opening it, drawing and
    // changing your mind must always be free.
    if (!isPro && plannerPreviewsLeft <= 0) {
      track(EVENTS.FEATURE_BLOCKED, {
        source: 'map_planner',
        feature: 'territory_planner',
        reason: 'allowance_spent',
      });
      openPaywall('territory_planner');
      return;
    }
    // Synchronous: the analysis is local geometry over polygons already in
    // hand, so there is nothing to await and no spinner to justify.
    const result = analyseRoute({
      points: planPoints,
      territories: rows,
      userId: user.id,
    });
    setPlanAnalysis(result);
    spendPlannerPreview();
  }, [planPoints, rows, user.id, isPro, plannerPreviewsLeft, openPaywall, spendPlannerPreview]);

  const undoPoint = useCallback(() => {
    setPlanPoints((prev) => prev.slice(0, -1));
    setPlanAnalysis(null);
  }, []);

  const clearPoints = useCallback(() => {
    setPlanPoints([]);
    setPlanAnalysis(null);
  }, []);

  // --- intelligence layers ----------------------------------------------

  const activeLayer = layerByKey(layerKey);
  // Only built for a layer that actually draws something. 'all' is the base
  // board, which TerritoryLayer already renders.
  const layerFC = useMemo(() => {
    if (!activeLayer || activeLayer.key === 'all') return null;
    return layerFeatureCollection(activeLayer, rows, { userId: user.id }, territoryRings);
  }, [activeLayer, rows, user.id]);

  const selectLayer = useCallback((key) => {
    setLayerKey(key);
    const layer = layerByKey(key);
    if (layer.pro) {
      track(EVENTS.FEATURE_PREVIEW, { source: 'map_intelligence', feature: `layer_${key}` });
    }
  }, []);

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
      {/* The board arrives as one move. A map builds itself in visible stages
          — grey tile grid, then roads, then labels, then our land a round trip
          later — and watching that assemble is the difference between a screen
          loading and a game world appearing. Everything is drawn behind a held
          opacity and fades up together once the style has rendered AND the
          first territories are in hand. Both are normally true well before the
          tab is opened (it loads at launch, in the background), so what this
          usually costs is nothing and what it buys is the board washing in
          under the tab transition instead of being there already. ScreenIn's
          guard, armed on focus, shows the screen anyway if either is slow —
          a stalled fetch can never leave the map blank. */}
      <ScreenIn ready={focused && mapLoaded && loaded} armed={focused} style={styles.fill}>
        <GameMap
          ref={mapRef}
          onIdle={onIdle}
          onPress={onMapPress}
          onReady={onMapReady}
          // A stroke must not also pan the camera. `locked` is the same freeze
          // the claim reveal uses, and it has to be the MAP that stops rather
          // than the overlay merely swallowing touches: Mapbox handles pan
          // natively, so a JS responder above it does not reliably prevent the
          // camera moving under the line being drawn.
          locked={planning && drawMode}
        >
          {/* The glow line was built in but never switched on, which is a lot
              of why the board read pastel — the plain 2px stroke alone. Dark
              mode is where a blurred neon outline actually reads as vivid
              rather than muddy against a light basemap. */}
          <TerritoryLayer featureCollection={baseFC} onPress={onTerritoryPress} dark={scheme === 'dark'} />
          {heatOn && <ContestedOutline featureCollection={contestedFC} opacity={reduce ? 0.8 : pulse} />}
          {/* The intelligence overlay, drawn ON TOP of the unchanged board.
              Every claim stays exactly as visible as it was — a layer adds a
              reading, it never takes the map away. */}
          {layerFC ? (
            <ContestedOutline id={`layer-${activeLayer.key}`} featureCollection={layerFC} opacity={0.95} />
          ) : null}
          {/* The planned route. Drawn in the PRO gold rather than the player
              accent so it can never be mistaken for a recorded run. */}
          {planning && planPoints.length >= 2 ? (
            <Trail id="plan" points={planPoints} color={GOLD} width={5} glow glowColor={GOLD} />
          ) : null}
          {planning
            ? planPoints.map((p, i) => (
                <MapPoint key={`plan-${i}`} id={`plan-pt-${i}`} point={p} color={GOLD} radius={6} />
              ))
            : null}
          {/* owner portrait in the middle of every territory in view */}
          {landPortraits.map((m) => (
            <UserMarker key={m.id} point={m.at} onPress={() => setProfileUserId(m.userId)}>
              <CharacterBust equipped={m.avatar} size={m.mine ? 38 : 32} ring={m.mine ? accent : m.ring} bg={colors.card} />
            </UserMarker>
          ))}
          {/* Keep location visible when pulled back without covering the land. */}
          {myLoc && (
            <UserMarker point={myLoc} onPress={() => setProfileUserId(user.id)}>
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
            onPress={() => setLayersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Map layers"
            hitSlop={8}
          >
            <AppIcon name="layers" size={30} />
            {/* A dot rather than a badge: the rail is 48pt of icon and a
                number on it would be unreadable. It only says "this is not
                showing the plain board", which is the thing worth knowing. */}
            {layerKey !== 'all' ? (
              <View style={[styles.layerDot, { backgroundColor: activeLayer.tint || colors.text }]} />
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlButton, planning && { backgroundColor: GOLD }]}
            onPress={() => (planning ? closePlanner() : openPlanner())}
            accessibilityRole="button"
            accessibilityLabel={planning ? 'Close territory planner' : 'Plan a run'}
            hitSlop={8}
          >
            <AppIcon name="route" size={30} />
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

        {/* THE DRAWING SURFACE. Absolutely filled over the map, mounted only
            while draw mode is on, so nothing intercepts a tap on a territory
            the rest of the time.

            The live line is drawn HERE in screen space rather than as a map
            Trail, because the points are still pixels — they do not become
            coordinates until the finger lifts. It is also why the line keeps
            up with the finger: nothing crosses the bridge until release. */}
        {planning && drawMode ? (
          <View
            style={StyleSheet.absoluteFill}
            {...drawResponder.panHandlers}
            accessibilityRole="none"
            // The gesture is a drawing surface with no discrete action to
            // announce; the planner panel below carries the instructions and
            // the buttons that do the same job without a drag.
            importantForAccessibility="no-hide-descendants"
          >
            {stroke.length >= 2 ? (
              <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                <Polyline
                  points={stroke.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={GOLD}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
          </View>
        ) : null}

        {showEmpty && (
          <View style={[styles.noticePill, { top: insets.top + space.md }]}>
            <Text style={type.heading}>Unclaimed. Be first.</Text>
            <Text style={[type.caption, { marginTop: 2 }]}>Close a loop here to claim the first land.</Text>
          </View>
        )}
      </ScreenIn>

      {/* The planner owns the bottom of the screen while it is open, so the
          tapped-territory card is suppressed underneath it rather than the two
          fighting for the same 200pt. */}
      {planning ? (
        <TerritoryPlanner
          points={planPoints}
          analysis={planAnalysis}
          previewsLeft={plannerPreviewsLeft}
          isPro={isPro}
          busy={converting}
          drawMode={drawMode}
          onToggleDrawMode={() => setDrawMode((on) => !on)}
          onPreview={runPreview}
          onUndo={undoPoint}
          onClear={clearPoints}
          onClose={closePlanner}
          onUnlock={() => openPaywall('territory_planner')}
        />
      ) : null}

      {/* tapped-territory card */}
      {!planning && selected && selectedColor && (
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
            held since {shortDate(selected.created_at)}
            {selected.contested ? ' · contested' : ''}
          </Text>
          <View style={styles.cardActions}>
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
              style={{ flex: 1 }}
            />
            <Button
              title="View profile"
              variant="secondary"
              size="sm"
              onPress={() => setProfileUserId(selected.user_id)}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      )}

      <MapProfileSheet
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        navigation={navigation}
      />

      <MapLayersSheet
        visible={layersOpen}
        onClose={() => setLayersOpen(false)}
        active={layerKey}
        onSelect={selectLayer}
        territories={rows}
        userId={user.id}
        isPro={isPro}
        onPreviewLayer={(layer, count) =>
          track(EVENTS.FEATURE_PREVIEW, {
            source: 'map_intelligence',
            feature: `layer_${layer.key}`,
            // The real count the runner was just shown, so the funnel can tell
            // "nobody wanted it" apart from "it was empty when they looked".
            in_view: count,
            available: layer.available,
          })
        }
        onUnlock={() => openPaywall('territory_intelligence')}
        onShowClubs={() => setLegendOpen(true)}
      />

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
  // The reveal layer sits inside `container`, so the screen's background is
  // what shows through while the board is still held at zero opacity.
  fill: { flex: 1 },
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
  layerDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  card: { position: 'absolute', left: space.gutter, right: space.gutter, bottom: space.xl },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
});
