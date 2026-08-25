import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { ChevronDown, ChevronLeft, ChevronRight, Flame, Lock, MoreHorizontal, Users, X } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';
import { Image } from '../ui/image';
import { BORDER_TIERS } from '../config/progression';
import { BORDER_ART } from '../config/borderArt';
import { MAP_FRAME_ART, rankColor } from '../config/mapFrameArt';
import PortraitBorder from '../components/PortraitBorder';

import { api } from '../api/client';
import { NB, nbInk, nbRadius, radius, shadow, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { cityBbox } from '../config/cities';
import { NEUTRAL } from '../state/clan';
import { useAuth } from '../auth/AuthContext';
import { useAvatar } from '../state/avatar';
import { useAccent } from '../hooks/useAccent';
import { Pop, ScreenIn, useReduceMotion } from '../ui/motion';
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

// RankMark — a rank said the way the app already says it everywhere else: the
// FRAME that tier wears. The pill used to carry a colour chip and the tier's
// name in caps, which is the rank spelled out twice in a language nothing else
// on the board speaks — the portrait beside a runner's name has been the badge
// for a rank since the ladder shipped, so this is that same badge, empty.
//
// A FIXED box, not PortraitBorder's measured one. That component sizes itself
// to the ring so a bust seats exactly inside the opening, and the openings run
// from 0.62 (onyx) to 0.91 (wood) of the art — sizing off them would leave the
// pill a different width on every tier and jumping as you scout. There is no
// portrait to seat here, so the art just gets a square and is centred in it.
// Tiers with no art (the 'none' tier below wood) keep the drawn SVG ring.
const RANK_MARK = 34;

// The eleven ways to look at the board, which the arrows step through.
//
// Ten of them are RANKS, and `none` is deliberately not one: it is the tier
// below wood, the state before a first run has landed, not a way of looking at
// the board. Keeping it in also put every rank one place out from the server's
// own numbering — /map-polygons counts Wood 0 … Mythic 9 while BORDER_TIERS
// counts from `none` — so scoping the board to Wood was quietly asking for
// Bronze, and Mythic clamped back onto Prismatic.
const RANK_VIEWS = BORDER_TIERS.filter((t) => t.key !== 'none');

// The eleventh is CLUBS: no rank filter at all, the whole board coloured by
// the club holding each plot. It sits before wood because it is the wide view
// you step in from, and it is the one view that is never locked — there is no
// rank to be too low for.
const CLUB_VIEW = -1;
const TOP_VIEW = RANK_VIEWS.length - 1;

// The clubs view's stand-in for a rank colour. A constant near-white, because
// the chip it is drawn on is a constant near-black and the clubs view has no
// colour of its own to borrow — the colours on that board belong to the clubs.
const CLUB_INK = '#F4F4F7';

// How much of the board's WIDTH one of the frames spends on its own rail.
// Every tier in the pack draws its band between 5.6% and 8.5% of the frame's
// width, so a single number stands in for all ten closely enough to lay
// controls out against — and laying them out against it is the point. The
// frame is drawn on the board's EDGES now, so anything near a corner sits
// UNDER a rail unless it is pushed in past this.
const RAIL = 0.085;

// One compact menu holds every map action. It stays on the right edge where the
// old tool rail lived, but opens wide enough for labels and the rank stepper so
// the map never asks the runner to decode five unrelated floating icons.
const ACTIONS_W = 238;

function RankMark({ tier }) {
  const art = BORDER_ART[tier.key];
  if (!art) return <PortraitBorder tier={tier} size={RANK_MARK - 6} />;
  return (
    <Image
      source={art.src}
      style={{ width: RANK_MARK, height: RANK_MARK }}
      resizeMode="contain"
      fadeDuration={0}
      accessible={false}
    />
  );
}

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

// Repeat-claim saturation: each time the owner re-runs the same ground the
// territory's `reinforcements` count rises, and the fill deepens with it so
// hard-held land reads bolder than a one-off claim. Diminishing returns +
// a ceiling keep a heavily farmed block strong but never fully opaque.
const SAT_GAIN = 0.6; // most a stack of claims can deepen the fill (×1.6)
const SAT_SCALE = 2.5; // reinforcements for ~63% of the gain
const SAT_MAX = 0.92; // hard opacity ceiling (never a flat wall of colour)
function claimSaturation(reinforcements) {
  const reps = Math.max(0, reinforcements ?? 0);
  return 1 + SAT_GAIN * (1 - Math.exp(-reps / SAT_SCALE));
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
          // Then deepened by repeat claims (`reinforcements`), capped, so
          // hard-held ground reads more saturated than a single claim.
          fillOpacity: Math.min(
            SAT_MAX,
            (mine ? 0.58 : 0.48) * (0.55 + 0.45 * (t.freshness ?? 1)) * claimSaturation(t.reinforcements)
          ),
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

// The contested outline, doing its own breathing.
//
// The pulse used to be `pulse` state on GlobalMapScreen, stepped by an
// interval every 650ms. Two things were wrong with that, and both of them are
// about WHERE the state lived rather than about the effect:
//
//   * This is the largest screen in the app, and it is a tab — the navigator
//     mounts all four at launch and never unmounts them. So the interval was
//     re-rendering the entire map screen roughly twice a second for as long as
//     the process lived, including the whole time the runner was on Home.
//   * Turning heat on was therefore a permanent tax. There was no way back
//     other than toggling it off again, which nobody thinks to do.
//
// Here, the re-render is one Mapbox layer, and it stops when the tab is not
// being looked at. Mounted only while heat is on, so the timer does not exist
// the rest of the time.
function HeatOutline({ featureCollection, reduce, focused }) {
  const [pulse, setPulse] = useState(0.85);

  useEffect(() => {
    if (reduce || !focused) return undefined;
    const id = setInterval(() => setPulse((p) => (p > 0.6 ? 0.35 : 0.9)), 650);
    return () => clearInterval(id);
  }, [reduce, focused]);

  return (
    <ContestedOutline
      featureCollection={featureCollection}
      opacity={reduce ? 0.8 : pulse}
    />
  );
}

export default function GlobalMapScreen({ route, navigation }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const { user } = useAuth();
  const { equipped, rankKey } = useAvatar();
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
  const [actionsOpen, setActionsOpen] = useState(false);
  // Which intelligence overlay is drawn on top of the board. 'all' is the
  // board exactly as it has always been.
  const [layerKey, setLayerKey] = useState('all');

  // --- rank-scoped board -------------------------------------------------
  // The map shows only the land of runners in ONE rank tier: yours by default,
  // so you see the rivals you are actually racing and not the whole planet.
  // The arrows scout other tiers; tiers above your own are viewable but locked
  // until you reach them (the explainer sheet spells this out). Stepping below
  // wood lands on the clubs view, which drops the rank filter entirely.
  const ownTier = useMemo(() => {
    const i = RANK_VIEWS.findIndex((t) => t.key === rankKey);
    // Below wood (no runs yet) there is no tier of one's own; wood is the
    // first board there is anything to see on.
    return i < 0 ? 0 : i;
  }, [rankKey]);
  const [viewRankTier, setViewRankTier] = useState(ownTier);
  const [rankInfoOpen, setRankInfoOpen] = useState(false);
  // Whether the runner has taken the wheel. Until they touch the selector the
  // board follows their own tier as it loads/updates (rankKey arrives async);
  // once they scout a tier by hand, we stop yanking it back under them.
  const pickedRef = useRef(false);
  // A stable mirror of the viewed tier, read inside the [] -deps fetchViewport
  // and onIdle closures the same way zoomRef is — so those callbacks keep their
  // referential identity and Mapbox's PureComponent gate is not defeated.
  const viewRankRef = useRef(ownTier);
  // Which way the last step went, so the incoming frame can arrive from the
  // direction it was scouted in: stepping UP settles a larger frame down onto
  // the board, stepping DOWN grows a smaller one into it. Read during render
  // rather than held in state because it only ever changes in lockstep with
  // the tier it describes, and it must not cause a render of its own.
  const stepDirRef = useRef(0);
  useEffect(() => {
    if (!pickedRef.current) setViewRankTier(ownTier);
  }, [ownTier]);
  useEffect(() => {
    viewRankRef.current = viewRankTier;
  }, [viewRankTier]);

  // --- Territory Planner -------------------------------------------------
  const { isPro, openPaywall, plannerPreviewsLeft, spendPlannerPreview } = useProEntitlement();
  const [planning, setPlanning] = useState(false);
  const [planPoints, setPlanPoints] = useState([]);
  // Null until a preview has actually been RUN. Drawing points costs nothing;
  // this is the thing the free allowance pays for.
  const [planAnalysis, setPlanAnalysis] = useState(null);
  const [myLoc, setMyLoc] = useState(null);
  // 'pending' | 'ok' | 'fail' — territory auto-fit only runs as a fallback.
  const [locState, setLocState] = useState('pending');

  // "VIEW LAND" from a rivalry / notification hands us a point to open on.
  // It wins over the my-location fly-in below: the caller is pointing at
  // something specific, and a `focus` only ever arrives on an explicit tap.
  const focus = route?.params?.focus;
  // A capture can hand us the attacker's [lon, lat] ring; fitting the camera to
  // it frames the EXACT ground taken instead of a fixed-zoom drop on the point.
  const focusRing =
    Array.isArray(focus?.ring) && focus.ring.length >= 3 ? focus.ring : null;
  const hasExplicitFocus =
    (Number.isFinite(focus?.lat) && Number.isFinite(focus?.lon)) || !!focusRing;
  // A stable key so a fresh params object (React Navigation makes a new one per
  // navigation) fires the fly-in once, not on every render.
  const focusKey = focus
    ? `${focus.lat ?? ''}:${focus.lon ?? ''}:${
        focusRing ? `${focusRing.length}@${focusRing[0].join(',')}` : ''
      }`
    : '';
  useEffect(() => {
    if (!hasExplicitFocus) return;
    const t = setTimeout(() => {
      if (focusRing) {
        const pts = focusRing
          .map(([lon, lat]) => ({ latitude: lat, longitude: lon }))
          .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
        if (pts.length >= 2) {
          mapRef.current?.fitToPoints(pts, 64, 700);
          return;
        }
      }
      if (Number.isFinite(focus?.lat) && Number.isFinite(focus?.lon)) {
        mapRef.current?.flyTo({ latitude: focus.lat, longitude: focus.lon }, 15, 700);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

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
        // must not pull the runner away from the land they just asked to see —
        // whether that focus is a point or the attacker's ring.
        if (!hasExplicitFocus) {
          setTimeout(() => mapRef.current?.flyTo(p, 15, 700), 400);
        }
      } catch {
        if (alive) setLocState('fail');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

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
    // The board is scoped to one rank tier; a different tier is a different set
    // of land, so it joins the cache key. Without it, scouting another rank and
    // panning back would re-serve the previous tier's cached region.
    const rank = viewRankRef.current;
    const cov = coveredRef.current;
    if (!force && cov && cov.capped === capped && cov.rank === rank && bboxContains(cov, bbox)) return;

    const padded = padBbox(bbox);
    const seq = ++seqRef.current;
    try {
      // CLUB_VIEW sends no rank at all, which is what the endpoint reads as
      // "every rank". The cache key above still carries -1, so stepping club →
      // wood → club refetches rather than re-serving the wrong board.
      const data = await api.mapPolygons(padded, z, {
        rank: rank === CLUB_VIEW ? undefined : rank,
      });
      if (seq !== seqRef.current) return; // superseded by a newer viewport
      coveredRef.current = { ...padded, capped, rank };
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

  // Switching rank re-scopes the board in place. Force a refetch of the current
  // viewport (no camera move fires an idle on its own). The mirror ref is set
  // by its own effect above, which runs before this one on the same commit.
  useEffect(() => {
    const v = lastViewRef.current;
    if (v) fetchViewport(v.bbox, v.z, true);
  }, [viewRankTier, fetchViewport]);

  // Move the scoped tier by one step and take the wheel off the auto-follow.
  const stepRank = useCallback((dir) => {
    pickedRef.current = true;
    stepDirRef.current = dir;
    setSelected(null);
    setViewRankTier((t) => Math.max(CLUB_VIEW, Math.min(TOP_VIEW, t + dir)));
  }, []);

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

  // Rank selector view-model. The tier itself is all the pill needs now — it
  // draws that rank's frame (see RankMark). Tiers above the runner's own are
  // LOCKED — still viewable (you can scout the board ahead), just flagged as
  // not yours.
  const isClubView = viewRankTier === CLUB_VIEW;
  const viewedTier = isClubView
    ? null
    : RANK_VIEWS[Math.max(0, Math.min(TOP_VIEW, viewRankTier))];
  // The frame that holds the board, and the one colour the view is said in.
  // The clubs view has no rank, so it takes the plain NB stroke and a neutral
  // ink rather than borrowing some tier's frame and colour.
  const frameArt = viewedTier ? MAP_FRAME_ART[viewedTier.key] : null;
  // What the frame is keyed on, and so what a change of frame is. The clubs
  // view has no tier, and it still gets a key of its own so stepping onto it
  // transitions like every other step.
  const frameKey = viewedTier ? viewedTier.key : 'clubs';
  // The board is the WHOLE screen now, minus only the top inset so the top
  // rail clears the notch and the clock. It used to be inset by a gutter on
  // all four sides, which cost the map a band of itself twice over: once to
  // the gutter and again to the frame drawn inside it.
  const boardTop = insets.top;
  // Everything the frame would otherwise cover gets pushed in past the rail.
  const rail = Math.round(screenW * RAIL);
  const railTop = boardTop + rail + space.xs;
  const viewColor = (viewedTier && rankColor(viewedTier)) || CLUB_INK;
  const viewLabel = viewedTier ? viewedTier.label : 'Clubs';
  const rankLocked = !isClubView && viewRankTier > ownTier;
  const atFirstTier = viewRankTier <= CLUB_VIEW;
  const atLastTier = viewRankTier >= TOP_VIEW;
  const ownTierLabel = RANK_VIEWS[Math.max(0, Math.min(TOP_VIEW, ownTier))].label;

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
          {heatOn && (
            <HeatOutline featureCollection={contestedFC} reduce={reduce} focused={focused} />
          )}
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

        {/* LOCKED. Scouting a tier above your own covers the whole board, not
            a chip in a corner: the board is the thing that is locked, and a
            small note beside a rank arrow reads as a caption on the arrow.

            It does NOT take touches. You can still pan and pinch the land you
            are scouting, which is the entire reason the tiers above yours are
            viewable at all — the overlay says you cannot COMPETE here, and
            taking the map away as well would be saying something else.

            Drawn BEFORE the frame and before the controls, so the scrim dims
            the land and nothing else: the rank's frame stays at full strength
            on top of it, which matters because the frame is the thing saying
            which rank this is, and the rail and the rank bar stay usable. */}
        {rankLocked && !planning ? (
          <View
            pointerEvents="none"
            style={[styles.lockedWrap, { top: boardTop }]}
          >
            <View style={styles.lockedScrim} />
            <View style={styles.lockedBody}>
              <Lock size={34} color={viewColor} strokeWidth={2.75} />
              {/* `title`, and no letterSpacing of its own. This is a heading
                  like any other heading in the app: the token already carries
                  the hero face and already uppercases, so the hand-set caps
                  and the 2pt tracking it used to add were the screen speaking
                  its own dialect. The 30pt `display` it took also ran into the
                  frame on the narrow devices. */}
              <Text style={[type.title, { color: viewColor }]}>Locked</Text>
              <Text style={[type.bodySm, styles.lockedNote]}>
                Reach <Text style={{ color: viewColor }}>{viewLabel}</Text> to compete here
              </Text>
            </View>
          </View>
        ) : null}

        {/* The frame around the live board. The map read as an unbounded
            full-bleed surface with nothing holding it; this is what contains
            it. Drawn OVER the map but UNDER the controls, and never takes a
            touch.

            The frame IS the rank: each tier's own drawn frame is what holds
            the board, so scouting up the ladder visibly changes what you are
            looking through. The clubs view has no rank and falls back to the
            plain NB stroke, whose colour follows the scheme because the
            basemap does.

            Stretched, not nine-sliced — see the note in config/mapFrameArt.

            ON THE EDGES. It used to hold a gutter off every side and the art
            it drew spent 10-13% of its own width on the band, so the board
            gave up a wide margin of map before the frame had drawn anything.
            The rail sits on the screen's edge now and the art behind it is
            half the weight; the only inset left is the top one, which the
            clock and the notch require.

            The bottom is flush: this screen sits in a material top-tab
            navigator, which (unlike bottom-tabs) never re-provides
            SafeAreaInsetsContext, so `insets.bottom` here is still the raw
            device inset even though the scene already ends above the tab dock
            — and that dock has already spent the inset on its own padding.

            A CHANGE OF FRAME IS A MOMENT. Scouting the ladder is the one place
            in the app where the thing you are looking through is what changed,
            and a frame that simply blinks from wood to bronze reads as a
            re-render. The outgoing frame dissolves while the incoming one
            settles into place from the direction it was scouted in — up the
            ladder it comes down onto the board from slightly larger, down the
            ladder it grows into it. Both sit behind `reduce`. */}
        <View pointerEvents="none" style={[styles.board, { top: boardTop }]}>
          <Animated.View
            key={frameKey}
            style={StyleSheet.absoluteFill}
            entering={reduce ? undefined : FadeIn.duration(280)}
            exiting={reduce ? undefined : FadeOut.duration(220)}
          >
            {/* Pop fires on mount, and every frame here IS a mount — the key
                above is what makes the swap a swap. `from` past 1 arrives
                shrinking, under 1 arrives growing. */}
            <Pop
              trigger={frameKey}
              from={stepDirRef.current < 0 ? 0.95 : 1.05}
              style={StyleSheet.absoluteFill}
            >
              {frameArt ? (
                <Image
                  source={frameArt}
                  style={StyleSheet.absoluteFill}
                  resizeMode="stretch"
                  fadeDuration={0}
                  accessible={false}
                />
              ) : (
                <View style={[styles.mapFrameStroke, { borderColor: nbInk(scheme) }]} />
              )}
            </Pop>
          </Animated.View>
        </View>

        {/* One right-side dropdown for the whole map. Rank used to stretch
            across the board while four icon-only actions formed a second
            control system beside it. The trigger below keeps every action in
            the same predictable place, and the open panel gives each one a
            name. Rank remains a stepper rather than being buried in an
            explainer: lower and higher tiers are still one tap away. */}
        {actionsOpen ? (
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setActionsOpen(false)}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Close map actions"
          />
        ) : null}
        <View style={[styles.mapActions, { top: railTop, right: rail + space.xs }]}>
          <TouchableOpacity
            style={styles.actionsTrigger}
            onPress={() => setActionsOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Map actions"
            accessibilityState={{ expanded: actionsOpen }}
          >
            <MoreHorizontal size={23} color={colors.text} strokeWidth={2.8} />
            <ChevronDown
              size={14}
              color={colors.textMuted}
              strokeWidth={2.8}
              style={{ transform: [{ rotate: actionsOpen ? '180deg' : '0deg' }] }}
            />
          </TouchableOpacity>

          {actionsOpen ? (
            <View style={styles.actionsPanel}>
              <View style={styles.rankMenu}>
                <TouchableOpacity
                  onPress={() => stepRank(-1)}
                  disabled={atFirstTier}
                  accessibilityRole="button"
                  accessibilityLabel="Scout a lower rank"
                  style={[styles.rankStep, atFirstTier && styles.actionOff]}
                >
                  <ChevronLeft size={22} color={colors.text} strokeWidth={3} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rankChoice}
                  onPress={() => {
                    setActionsOpen(false);
                    setRankInfoOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isClubView
                      ? 'Viewing the clubs board, every rank. Learn how the ranked map works'
                      : `Viewing ${viewLabel} rank${rankLocked ? ', locked' : ''}. Learn how the ranked map works`
                  }
                >
                  {viewedTier ? (
                    <RankMark tier={viewedTier} />
                  ) : (
                    <View style={styles.clubMark}>
                      <Users size={22} color={colors.text} strokeWidth={2.6} />
                    </View>
                  )}
                  <View style={styles.rankChoiceText}>
                    <Text style={[type.labelSm, { color: colors.textMuted }]}>Rank</Text>
                    <Text style={[type.bodySmBold, { color: viewColor }]} numberOfLines={1}>
                      {viewLabel}
                    </Text>
                  </View>
                  {rankLocked ? <Lock size={15} color={colors.textMuted} strokeWidth={2.6} /> : null}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => stepRank(1)}
                  disabled={atLastTier}
                  accessibilityRole="button"
                  accessibilityLabel="Scout a higher rank"
                  style={[styles.rankStep, atLastTier && styles.actionOff]}
                >
                  <ChevronRight size={22} color={colors.text} strokeWidth={3} />
                </TouchableOpacity>
              </View>

              <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                style={[styles.actionRow, heatOn && { backgroundColor: colors.warn }]}
                onPress={() => {
                  setHeatOn((value) => !value);
                  setActionsOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Toggle contested zones"
              >
                <View style={styles.actionIcon}>
                  <Flame size={20} color={heatOn ? '#fff' : colors.text} strokeWidth={2.4} />
                </View>
                <Text style={[type.bodySmBold, { color: heatOn ? '#fff' : colors.text }]}>Contested zones</Text>
                {heatOn ? <Text style={[type.labelSm, styles.actionState, { color: '#fff' }]}>On</Text> : null}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => {
                  setActionsOpen(false);
                  setLayersOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Map layers"
              >
                <View style={styles.actionIcon}><AppIcon name="layers" size={27} /></View>
                <Text style={[type.bodySmBold, { color: colors.text }]}>Map layers</Text>
                {layerKey !== 'all' ? (
                  <View style={[styles.layerDot, { backgroundColor: activeLayer.tint || colors.text }]} />
                ) : null}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionRow, planning && { backgroundColor: GOLD }]}
                onPress={() => {
                  setActionsOpen(false);
                  if (planning) closePlanner(); else openPlanner();
                }}
                accessibilityRole="button"
                accessibilityLabel={planning ? 'Close territory planner' : 'Plan a run'}
              >
                <View style={styles.actionIcon}><AppIcon name="route" size={27} /></View>
                <Text style={[type.bodySmBold, { color: planning ? '#0B0B0F' : colors.text }]}>
                  {planning ? 'Close planner' : 'Plan a run'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => {
                  setActionsOpen(false);
                  locateMe();
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Center map on my location"
              >
                <View style={styles.actionIcon}><AppIcon name="locate" size={27} /></View>
                <Text style={[type.bodySmBold, { color: colors.text }]}>My location</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
          <View style={[styles.noticePill, { top: insets.top + space.md + 52 }]}>
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

      {/* Explainer: why the board only shows one rank at a time. */}
      <Sheet visible={rankInfoOpen} onClose={() => setRankInfoOpen(false)}>
        <View style={styles.rankInfoHead}>
          {/* The same mark the pill wears, so the explainer opens on the thing
              that was tapped rather than on a chip of its colour. */}
          {viewedTier ? (
            <RankMark tier={viewedTier} />
          ) : (
            <View style={styles.clubMark}>
              <Users size={22} color={colors.text} strokeWidth={2.5} />
            </View>
          )}
          <Text style={type.heading}>Ranked map</Text>
        </View>
        <Text style={[type.body, { color: colors.textDim, marginTop: space.sm }]}>
          The board shows land held by runners in one rank. You start on your own
          tier, {ownTierLabel}, so the map fills with the rivals you are actually
          racing rather than the whole world.
        </Text>
        <Text style={[type.body, { color: colors.textDim, marginTop: space.md }]}>
          Take ground and hold it to climb the ladder. Use the arrows to scout
          another tier: ranks above yours stay locked until you reach them, so you
          can see what waits ahead but you compete on your own.
        </Text>
        <Text style={[type.body, { color: colors.textDim, marginTop: space.md }]}>
          Step left past Wood for the clubs board. That one has no rank: it shows
          every runner, coloured by the club holding the ground.
        </Text>
        <Button
          title="Got it"
          variant="gradient"
          onPress={() => setRankInfoOpen(false)}
          style={{ marginTop: space.lg }}
        />
      </Sheet>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // THE BOARD. The rect the frame is drawn into: the screen's three hard
  // edges, with only `top` passed inline from the safe-area inset. No
  // width/height — the four edges size it, and the art is stretched into
  // whatever that comes out as.
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  // What the clubs view is held in, having no rank and so no drawn frame. It
  // fills the same rect the art would, so stepping between the two moves
  // nothing.
  mapFrameStroke: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: NB.stroke,
    borderRadius: nbRadius.lg,
  },
  // The reveal layer sits inside `container`, so the screen's background is
  // what shows through while the board is still held at zero opacity.
  fill: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: space.xl },

  mapActions: {
    position: 'absolute',
    width: ACTIONS_W,
    alignItems: 'flex-end',
  },
  actionsTrigger: {
    width: 52,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    ...shadow.raised,
  },
  actionsPanel: {
    width: ACTIONS_W,
    marginTop: space.xs,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.xs,
    ...shadow.raised,
  },
  rankMenu: { minHeight: 56, flexDirection: 'row', alignItems: 'center' },
  rankStep: { width: 36, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  rankChoice: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rankChoiceText: { flex: 1, minWidth: 0 },
  actionOff: { opacity: 0.28 },
  actionDivider: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  actionRow: {
    minHeight: 48,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  actionIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  actionState: { marginLeft: 'auto' },

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
    marginLeft: 'auto',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // The clubs glyph, in the explainer's heading. The selector says "Clubs" in
  // the same type every rank is said in and needs no mark of its own.
  clubMark: { width: RANK_MARK, height: RANK_MARK, alignItems: 'center', justifyContent: 'center' },
  rankInfoHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  // The locked board. The scrim is a separate absolutely-filled child rather
  // than a background on the wrapper so it can carry its own opacity without
  // fading the lock and the type sitting on it.
  lockedWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: nbRadius.lg,
    overflow: 'hidden',
  },
  // A CONSTANT near-black, not `colors.bg`. In dark mode the two are much the
  // same, but over the light basemap a themed scrim lands mid-grey, and the
  // darker half of the ladder (wood's brown, onyx even at its bright stop)
  // cannot be read on mid-grey. The locked board is the same "switched off"
  // state in both schemes, so it gets the same backing in both, and every rank
  // colour has one known thing to contrast against.
  lockedScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0B0B0F', opacity: 0.72 },
  // The padding has to clear the FRAME, not the wrapper. The wrapper is the
  // frame's outer box and every tier's band runs 7-8% of the board's width
  // deep, which is ~30pt on a Pro Max — so the old space.xl put the type
  // underneath the band rather than inside it. space.huge leaves a real gutter
  // on the narrowest device and a generous one on the widest.
  lockedBody: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.huge },
  lockedNote: { textAlign: 'center', color: '#F4F4F7' },

  card: { position: 'absolute', left: space.gutter, right: space.gutter, bottom: space.xl },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
});
