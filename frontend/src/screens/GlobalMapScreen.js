import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { ChevronDown, ChevronLeft, ChevronRight, Lock, MoreHorizontal, Users, X } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';
import { Image } from '../ui/image';
import { BORDER_TIERS } from '../config/progression';
import { BORDER_ART } from '../config/borderArt';
import { MAP_FRAME_ART, MAP_FRAME_CREST, rankColor } from '../config/mapFrameArt';
import { RANK_RANGES } from '../config/rankLadder';
import PortraitBorder from '../components/PortraitBorder';

import { api } from '../api/client';
import { NB, nbInk, nbRadius, radius, shadow, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { cityBbox } from '../config/cities';
import { NEUTRAL } from '../state/clan';
import { useAuth } from '../auth/AuthContext';
import { useAvatar } from '../state/avatar';
import { useProfile } from '../state/profile';
import { useAccent } from '../hooks/useAccent';
import { useClan } from '../state/clan';
import { Bar, Pop, ScreenIn, useOnScreen, useReduceMotion } from '../ui/motion';
import { Button, Card, Pill, Sheet } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import { RunnerBust, RunnerFigure } from '../components/identity/PlayerIdentity';
import { landColor, ringCentroid } from '../components/territoryBoard';
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
import { TARGET, TIP, TutorialAnchor, inFirstOnboarding, useTutorial, useTutorialTip } from '../tutorial';
import { layerByKey, layerFeatureCollection } from '../map/intelligence';
import { mergeTouchingLand } from '../map/holdings';
import { boardPresentation, DETAIL_MIN_ZOOM } from '../map/presentation';
import { createViewportCache, selectPortraits } from '../map/viewportCache';
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
// The two boards. They are separate LADDERS, not two points on one scale:
// the solo board is scoped by each runner's own rating, the club board by the
// owning club's. `CLUB_VIEW` used to be a -1 sentinel on the rank stepper,
// which meant the clubs view had no tier at all and therefore no scope — every
// club in the world on one map. Both boards now step 0..9 on their own ladder.
const SOLO_BOARD = 'solo';
const CLUB_BOARD = 'club';
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

// The standalone locate button, bottom right. Centring the map on yourself is
// the one map action you reach for mid-thought and often twice in a row, so it
// is a button on the board rather than a row two taps deep in the menu, and it
// sits under the thumb, at the opposite corner from the menu it left.
const LOCATE_SIZE = 60;

// A direct view switch in the other thumb corner. Club view used to be hidden
// one step left of Wood inside the actions menu; a labelled sticker makes the
// view discoverable. It used to read back the runner's own tier ("Wood
// rank"), which put a rank on a control that does not change the rank, and
// left the two states of one switch labelled in two different languages.
//
// The label names the BOARD you are ON, not the one a tap switches to — "Club
// view" alone read as an instruction ("go to club view") when it was meant as
// a status ("you're looking at the club board"), so it now says the sentence
// out loud: "You're in club view" / "You're in solo view". The icon follows
// the same rule and shows the current board rather than the destination.
const VIEW_SWITCH_SIZE = 118;

// `m.ring` is the colour of the land under the portrait, own land included —
// landColor already spends the viewer's accent there when they have one. The
// ring used to branch on `mine` and take the accent directly, which now says a
// different colour from the ground it is standing on.
//
// ZOOM DECIDES THE MODE (components/identity/PlayerIdentity). Far out, a
// circular portrait: anything bigger is unreadable and crowds the board. Close
// in (`close`), there is room to show gear: other owners become a bust (hat to
// hips, their top readable), and YOUR marker becomes your whole runner
// standing on your plot, feet on the point. Still one rig per marker either
// way, and still capped by selectPortraits, so closer is not heavier.
const LandPortrait = React.memo(function LandPortrait({ marker: m, bg, onSelect, close = false }) {
  const onPress = useCallback(() => onSelect(m.userId), [onSelect, m.userId]);
  if (close && m.mine) {
    return (
      <UserMarker point={m.at} onPress={onPress} anchor={FEET_ANCHOR}>
        <RunnerFigure equipped={m.avatar} height={MAP_FIGURE_H} />
      </UserMarker>
    );
  }
  if (close) {
    return (
      <UserMarker point={m.at} onPress={onPress}>
        <RunnerBust equipped={m.avatar} height={MAP_BUST_H} ring={m.ring} bg={bg} />
      </UserMarker>
    );
  }
  return (
    <UserMarker point={m.at} onPress={onPress}>
      <CharacterBust equipped={m.avatar} size={m.mine ? 38 : 32} ring={m.ring} bg={bg} />
    </UserMarker>
  );
}, (a, b) => a.close === b.close && a.marker.id === b.marker.id && a.marker.avatar === b.marker.avatar
  && a.marker.userId === b.marker.userId && a.marker.mine === b.marker.mine
  && a.marker.ring === b.marker.ring && a.marker.at.latitude === b.marker.at.latitude
  && a.marker.at.longitude === b.marker.at.longitude
  && a.bg === b.bg && a.onSelect === b.onSelect);

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

// How full the tapped card's strength bar is. Strength runs from the chip
// floor (0.5) to the reinforcement ceiling (2.0), `strength_ceiling` in
// backend/app/config.py, so that ceiling is a full bar. It used to fill at
// `strength * 10`%, which put every plot on the map at 5 to 20% of the track.
const STRENGTH_CEILING = 2.0;
function strengthPct(strength) {
  const s = Number(strength) || 1;
  return Math.max(4, Math.min(100, (s / STRENGTH_CEILING) * 100));
}

// Build the whole-board GeoJSON once per data change. Each ring is a feature
// carrying its clan colors, owning territory id, clan key, and contested flag.
function toFeatures(territories, userId, playerAccent) {
  const features = [];
  for (const t of territories) {
    const mine = t.user_id === userId;
    // One colour per owner — see landColor. This used to hand the VIEWER's
    // accent to every clubless plot on the board, which painted the whole solo
    // world in one colour (the neutral slate, for a viewer without a club).
    const color = landColor(t, { mine, accent: playerAccent });
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
          fillColor: color,
          strokeColor: color,
          // Territory fill: MY territories are bold and obvious (0.75 base),
          // others' are quieter (0.40) but still plainly COLOURED LAND. They
          // used to sit at 0.25, which after decay landed near 0.19 — under a
          // 2.5px border plus a blurred glow, so a plot read as an outline
          // with nothing inside it and the board read as wire. The fill leads
          // now and the border follows it in (see TerritoryLayer).
          // Then faded by decay so land visibly weakens as it nears expiry — but never
          // down to the wash it used to fade to, which read as barely-there rather than aged.
          // Then deepened by repeat claims (`reinforcements`), capped, so hard-held ground
          // reads more saturated than a single claim.
          fillOpacity: Math.min(
            SAT_MAX,
            (mine ? 0.75 : 0.40) * (0.55 + 0.45 * (t.freshness ?? 1)) * claimSaturation(t.reinforcements)
          ),
          contested: !!t.contested,
        },
      });
    });
  }
  return features;
}

// Owner portraits are part of the close-in detail the board switches on, so
// they ride the board's own detail line rather than a second copy of the same
// number that could drift away from it.
const PORTRAIT_MIN_ZOOM = DETAIL_MIN_ZOOM;
// Street level: close enough that a bust and a small whole runner read.
const FIGURE_MIN_ZOOM = 15.5;
const MAP_FIGURE_H = 58;
const MAP_BUST_H = 42;
// The whole runner stands ON its point rather than being centred over it.
const FEET_ANCHOR = { x: 0.5, y: 1 };

// How the contested outline breathes. The band is narrow on purpose, see the
// note on HeatOutline.
const PULSE_LOW = 0.55;
const PULSE_HIGH = 0.9;
const PULSE_MS = 1100;

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
//
// A SLIGHT pulse, and a smooth one. Contested land used to be something you
// switched on to go looking for a fight, so its outline snapped between 0.35
// and 0.9 twice a second: a flash, which is right for a thing you just asked to
// be shown and wrong for a thing that is simply always on the board. It
// breathes across a narrow band now, and the step is handed to Mapbox's own
// opacity transition so the layer glides between the two instead of blinking.
function HeatOutline({ featureCollection, reduce }) {
  const [pulse, setPulse] = useState(PULSE_HIGH);
  // Breathes only while the map is the tab in front. Read HERE rather than by
  // the screen: reading it up there re-rendered the whole board, Mapbox layers
  // and all, every time any tab was entered or left.
  const onScreen = useOnScreen(!reduce);

  useEffect(() => {
    if (reduce || !onScreen) return undefined;
    const id = setInterval(
      () => setPulse((p) => (p > (PULSE_LOW + PULSE_HIGH) / 2 ? PULSE_LOW : PULSE_HIGH)),
      PULSE_MS
    );
    return () => clearInterval(id);
  }, [reduce, onScreen]);

  return (
    <ContestedOutline
      featureCollection={featureCollection}
      // Every plot claimed in the last week is in here, so it follows the
      // board's borders down as the camera pulls back.
      scaleWithZoom
      opacity={reduce ? 0.8 : pulse}
      // Matched to the interval: the layer is always mid glide, never sitting
      // at an endpoint waiting for the next step.
      transition={reduce ? 0 : PULSE_MS}
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
  const { equipped, rankKey, unlockCtx } = useAvatar();
  const { profile, loading: profileLoading, completeRankGuide } = useProfile();
  const accent = useAccent();
  const reduce = useReduceMotion();
  const mapRef = useRef(null);
  const viewportCacheRef = useRef(null);
  const [portraitBounds, setPortraitBounds] = useState(null);
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
  // Contested land is ALWAYS outlined. It used to be a menu toggle defaulting
  // to off, which meant the one thing on the board saying "there is a fight
  // here" was invisible unless you already knew to go looking for it. The pulse
  // it draws with is slight enough to live under permanently.
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
  // The club board's own tier, defaulted to the tier this runner's CLUB sits
  // in — which is a different ladder from their own, so a Gold runner in a
  // Silver club opens the club board on Silver.
  const { clan } = useClan();
  const ownClubTier = Math.max(0, Math.min(TOP_VIEW, Number(clan?.rank_tier) || 0));
  const [boardMode, setBoardMode] = useState(SOLO_BOARD);
  const [viewRankTier, setViewRankTier] = useState(ownTier);
  const [clubRankTier, setClubRankTier] = useState(ownClubTier);
  const clubPickedRef = useRef(false);
  const [rankInfoOpen, setRankInfoOpen] = useState(false);
  // Whether the runner has taken the wheel. Until they touch the selector the
  // board follows their own tier as it loads/updates (rankKey arrives async);
  // once they scout a tier by hand, we stop yanking it back under them.
  const pickedRef = useRef(false);
  // A stable mirror of the viewed tier, read inside the [] -deps fetchViewport
  // and onIdle closures the same way zoomRef is — so those callbacks keep their
  // referential identity and Mapbox's PureComponent gate is not defeated.
  const viewRankRef = useRef(ownTier);
  const clubRankRef = useRef(ownClubTier);
  const boardRef = useRef(SOLO_BOARD);
  // Which way the last step went, so the incoming frame can arrive from the
  // direction it was scouted in: stepping UP settles a larger frame down onto
  // the board, stepping DOWN grows a smaller one into it. Read during render
  // rather than held in state because it only ever changes in lockstep with
  // the tier it describes, and it must not cause a render of its own.
  const stepDirRef = useRef(0);
  useEffect(() => {
    if (!pickedRef.current) setViewRankTier(ownTier);
  }, [ownTier]);
  // Same auto-follow for the club board: it tracks the club's tier as
  // /me/clan lands, until the runner scouts one by hand.
  useEffect(() => {
    if (!clubPickedRef.current) setClubRankTier(ownClubTier);
  }, [ownClubTier]);
  useEffect(() => {
    viewRankRef.current = viewRankTier;
  }, [viewRankTier]);
  useEffect(() => {
    clubRankRef.current = clubRankTier;
  }, [clubRankTier]);
  useEffect(() => {
    boardRef.current = boardMode;
  }, [boardMode]);

  // Shared by the board presentation and the controls below. Keeping one
  // derived boolean also makes the overview/detail split explicit.
  const isClubView = boardMode === CLUB_BOARD;
  // The tier the stepper is currently moving, and the one the board is scoped
  // to. Each board remembers its own, so switching back and forth does not
  // reset where you were scouting.
  const activeTier = isClubView ? clubRankTier : viewRankTier;

  // The rank explainer used to be tap-to-open only (the little "?" by the
  // pill), which meant almost nobody who needed it ever found it — rank and
  // level are two different ladders and nothing else on this screen says so.
  // Open it once, the first time this screen is actually looked at, the same
  // way CrossroadsScreen opens its own intro: gated on the profile flag
  // having loaded, so a not-yet-hydrated `false` never flashes the sheet at
  // someone who has already read it.
  //
  // FIRST ONBOARDING ONLY. A veteran (a reinstall, a new phone, an update that
  // added this sheet) is not shown it unasked; it stays one tap away on the
  // rank pill for anybody.
  const firstOnboarding = inFirstOnboarding(profile.tutorial);
  useFocusEffect(
    useCallback(() => {
      if (!profileLoading && firstOnboarding && !profile.rankGuideSeen) setRankInfoOpen(true);
    }, [profileLoading, firstOnboarding, profile.rankGuideSeen])
  );

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

  // Find the player's dot, but leave the camera alone. The screen opens on
  // GameMap's own default camera — the whole of Singapore, city-centre and
  // overview zoom (see activeCity.center / the `initialZoom` fallback in
  // GameMap) — rather than flying in close on wherever the runner happens to
  // be standing. A street-level opening view showed one corner of the board,
  // usually with no land in the frame at all; the island-wide view is the one
  // place every runner's claims and every club's territory are actually
  // visible at once. The dot itself still lands the moment the fix is in, and
  // "locate me" (bottom-right) is the explicit way to fly in on it.
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
  useEffect(() => {
    viewportCacheRef.current = createViewportCache({
      request: (bbox, z, scope) => api.mapPolygons(bbox, z, scope),
      onData: (territories) => { setList(territories); setLoadError(false); },
      onError: () => setLoadError(true),
    });
    return () => viewportCacheRef.current?.dispose();
  }, []);

  const fetchViewport = useCallback((bbox, z, force = false) => {
    const board = boardRef.current;
    const rank = board === CLUB_BOARD ? clubRankRef.current : viewRankRef.current;
    viewportCacheRef.current?.load(bbox, z ?? zoomRef.current, { rank, board, force });
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
    setPortraitBounds(bbox);
    fetchViewport(bbox, zz);
  }, [fetchViewport]);

  // Start loading while the camera moves, before it settles on fresh ground.
  const onViewportChange = useCallback(({ bounds, zoom: z }) => {
    const bbox = { minLon: bounds.sw[0], minLat: bounds.sw[1], maxLon: bounds.ne[0], maxLat: bounds.ne[1] };
    if (z != null) {
      const crossedDetail = (zoomRef.current < PORTRAIT_MIN_ZOOM) !== (z < PORTRAIT_MIN_ZOOM)
        || (zoomRef.current < FIGURE_MIN_ZOOM) !== (z < FIGURE_MIN_ZOOM);
      zoomRef.current = z;
      // Only the visibility boundary needs a render during a pinch.
      if (crossedDetail) setZoom(z);
    }
    lastViewRef.current = { bbox, z: z ?? zoomRef.current };
    setPortraitBounds(bbox);
    fetchViewport(bbox, z);
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
  }, [viewRankTier, clubRankTier, boardMode, fetchViewport]);

  // Move the ACTIVE board's tier by one step and take the wheel off its
  // auto-follow. Stepping no longer falls off the bottom into the clubs view —
  // that is a board, not a rank below Wood, and the toggle switches it.
  const stepRank = useCallback((dir) => {
    stepDirRef.current = dir;
    setSelected(null);
    const clamp = (t) => Math.max(0, Math.min(TOP_VIEW, t + dir));
    if (boardRef.current === CLUB_BOARD) {
      clubPickedRef.current = true;
      setClubRankTier(clamp);
    } else {
      pickedRef.current = true;
      setViewRankTier(clamp);
    }
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
  // ONE RUNNER'S TOUCHING LAND IS ONE HOLDING, before anything else looks at
  // the board. A claim that overlaps ground its owner already held leaves the
  // remainder of each old plot behind as its own row, sharing an exact edge
  // with the claim that cut it — so without this the board traces that cut at
  // full stroke weight and pins a second copy of the same face beside the
  // first. Merged here, at the top, because everything below reads these rows:
  // the features, the portraits, the legend and the intelligence layers all
  // get the merge without knowing about it, and so does the tapped-territory
  // card, which reads back the holding rather than one claim inside it.
  // Own land is one colour (the accent) whatever its club badge, so it merges
  // across badges too. Not when the accent is the neutral one: landColor then
  // falls through to the club colour and the badges really do differ.
  const ownOneColour = !!accent && accent !== NEUTRAL.stroke;
  const held = useMemo(
    () => mergeTouchingLand(rows, { oneColourFor: ownOneColour ? user.id : null }),
    [rows, ownOneColour, user.id]
  );
  // Pulled back, EITHER board goes calm: muted fills, no borders, no contest
  // pulse, no layer outlines, until the camera is close enough for one plot to
  // be worth reading as a plot. Club view additionally narrows to club-held
  // ground. The planner opts out of both — hidden solo territory and hidden
  // borders each make a route quote dishonest.
  const board = useMemo(
    () => boardPresentation(held, { clubView: isClubView && !planning, zoom, planning }),
    [held, isClubView, planning, zoom]
  );
  const visibleRows = board.rows;
  const features = useMemo(
    () => toFeatures(visibleRows, user.id, accent),
    [visibleRows, user.id, accent]
  );
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

  // --- first-visit tips ----------------------------------------------------
  //
  // The map is not part of the core tutorial. The first time the runner opens
  // it themselves they get ONE card; the camera does not move, nothing is
  // selected for them. A second card waits until they tap somebody else's
  // territory themselves.
  const { requestTip } = useTutorial();
  useTutorialTip(TIP.MAP, Array.isArray(list));

  // Owner portraits pinned to the centre of EVERY territory in view. Others'
  // avatars come from the API; the viewer's own uses the freshest local
  // loadout. Capped + shown only when zoomed in enough to avoid clutter/perf.
  const landPortraits = useMemo(() => {
    if ((isClubView && !planning) || (zoom || 0) < PORTRAIT_MIN_ZOOM) return [];
    return selectPortraits(held
      .filter((t) => t.user_id === user.id ? equipped : t.avatar)
      .map((t) => ({
        id: t.id,
        userId: t.user_id,
        mine: t.user_id === user.id,
        avatar: t.user_id === user.id ? equipped : t.avatar,
        // The ring is the land's own colour, so the portrait names the plot
        // it sits in rather than floating over it in slate.
        ring: landColor(t, { mine: t.user_id === user.id, accent }),
        area: t.area_m2 || 0,
        at: ringCentroid(territoryRings(t)[0]),
      }))
      .filter((m) => m.at && m.avatar), portraitBounds);
  }, [held, user.id, equipped, accent, zoom, isClubView, planning, portraitBounds]);

  // Top clans in the current view, by summed area (legend).
  const topTeams = useMemo(() => {
    const acc = {};
    for (const t of visibleRows) {
      // This is a clubs legend. Solo land belongs on ranked boards, but it is
      // neither a club nor a useful entry in this sheet.
      if (!t.clan_tag) continue;
      const key = t.clan_tag;
      const color = t.clan_color || NEUTRAL;
      acc[key] = acc[key] || { key, color, area: 0, count: 0 };
      acc[key].area += t.area_m2 || 0;
      acc[key].count += 1;
    }
    return Object.values(acc).sort((a, b) => b.area - a.area).slice(0, 5);
  }, [visibleRows]);

  const focusTeam = (key) => {
    const pts = [];
    for (const t of visibleRows) {
      if (t.clan_tag !== key) continue;
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
    // Resolved against the MERGED rows, which is what was actually tapped: the
    // card then reads back the holding's own size and fits the camera to all
    // of it, rather than quoting the one claim inside it whose id the feature
    // happens to carry.
    const id = e?.features?.[0]?.properties?.territoryId;
    const t = held.find((x) => x.id === id);
    if (t) setSelected(t);
    // Somebody else's land, tapped by the runner: the one moment "runners can
    // take each other's land" is about what they are looking at.
    if (t && t.user_id !== user.id) requestTip(TIP.MAP_TERRITORY);
  }, [held, planning, requestTip, user.id]);

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
    return layerFeatureCollection(activeLayer, visibleRows, { userId: user.id }, territoryRings);
  }, [activeLayer, visibleRows, user.id]);

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

  // The tapped card wears the colour of the land it opened from.
  const selectedColor = selected
    ? landColor(selected, { mine: selected.user_id === user.id, accent })
    : null;
  const loaded = list !== null;
  const showEmpty = loaded && visibleRows.length === 0 && !loadError;

  // Rank selector view-model. The tier itself is all the pill needs now — it
  // draws that rank's frame (see RankMark). Tiers above the runner's own are
  // LOCKED — still viewable (you can scout the board ahead), just flagged as
  // not yours.
  // BOTH boards have a tier now, so both are said in that tier's colour and
  // held in that tier's frame. The clubs view used to be the one board with no
  // rank — and therefore no scope, which is what made it unreadable.
  const viewedTier = RANK_VIEWS[Math.max(0, Math.min(TOP_VIEW, activeTier))];
  const frameArt = MAP_FRAME_ART[viewedTier.key];
  const frameCrest = MAP_FRAME_CREST[viewedTier.key] || 0;
  // What the frame is keyed on, and so what counts as a change of frame. The
  // board is part of it, so switching boards on the same tier still transitions
  // rather than silently swapping the land underneath an identical frame.
  const frameKey = `${boardMode}:${viewedTier.key}`;
  // The board is the WHOLE screen, top edge included. It kept the safe area
  // inset off the top, which left the rank's frame floating in a band of bare
  // screen and open along its top rail, the one edge where a frame reads as
  // broken rather than as a margin. The frame runs to 0 now and holds the map
  // on all four sides. (Before that it was inset by a gutter on every side,
  // which cost the map a band of itself twice over: once to the gutter and
  // again to the frame drawn inside it.)
  // ZERO, NOT -insets.top. This screen is already full bleed — the pager's
  // scene starts at the physical top edge, which is why the clock sits over
  // live map — so pulling the board up by the inset did not tuck the frame
  // under the status bar, it pushed the whole top rail off the screen. Every
  // tier lost its top rail to that except mythic, whose rail is drawn at 7.6%
  // of the art's height against 4.0-5.9% for the rest, and so was the only one
  // thick enough to still reach back down past the notch.
  const boardTop = 0;
  // Everything the frame would otherwise cover gets pushed in past the rail.
  const rail = Math.round(screenW * RAIL);
  // The top controls clear the rail AND the notch. With the frame on the top
  // edge the rail alone no longer clears the clock, so the deeper of the two
  // wins.
  const railTop = Math.max(insets.top, rail) + space.xs;
  const viewColor = rankColor(viewedTier) || CLUB_INK;
  // The club board names the tier too, or the runner has no idea which slice
  // of the clubs they are looking at.
  const viewLabel = isClubView ? `${viewedTier.label} clubs` : viewedTier.label;
  // Locked against the ladder the board is actually on: a Wood runner in a
  // Gold club is not scouting above their station on the club board.
  const rankLocked = activeTier > (isClubView ? ownClubTier : ownTier);
  const atFirstTier = activeTier <= 0;
  const atLastTier = activeTier >= TOP_VIEW;
  const ownTierLabel = RANK_VIEWS[Math.max(0, Math.min(TOP_VIEW, ownTier))].label;
  const ownRank = RANK_VIEWS[Math.max(0, Math.min(TOP_VIEW, ownTier))];
  const rankStats = unlockCtx?.stats;
  const rankPoints = Math.max(0, Number(rankStats?.solo_elo ?? rankStats?.rank_points) || 0);
  const nextRankPoints = Number.isFinite(rankStats?.solo_elo_next ?? rankStats?.rank_next_points)
    ? (rankStats.solo_elo_next ?? rankStats.rank_next_points)
    : null;
  const rankProgress = rankStats
    ? (nextRankPoints == null
      ? 1
      : Math.max(0, Math.min(1, Number(rankStats.rank_progress) || 0)))
    : 0;
  const pointsToNext = !rankStats
    ? undefined
    : (nextRankPoints == null ? null : Math.max(0, nextRankPoints - rankPoints));
  const ownRankColor = rankColor(ownRank);
  // Switch BOARDS. Each keeps the tier it was left on, so flipping across to
  // check the clubs and back does not lose the rank you were scouting.
  const toggleClubView = () => {
    stepDirRef.current = isClubView ? 1 : -1;
    setSelected(null);
    setActionsOpen(false);
    setBoardMode((b) => (b === CLUB_BOARD ? SOLO_BOARD : CLUB_BOARD));
  };

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
      {/* The focus read lives INSIDE ScreenIn (`whenOnScreen`). This screen
          used to call useIsFocused itself, which re-rendered the whole board
          every time any tab was entered or left. */}
      <ScreenIn ready={mapLoaded && loaded} whenOnScreen style={styles.fill}>
        <GameMap
          ref={mapRef}
          onIdle={onIdle}
          onViewportChange={onViewportChange}
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
          <TerritoryLayer
            featureCollection={baseFC}
            onPress={onTerritoryPress}
            dark={scheme === 'dark'}
            overview={board.overview}
          />
          {board.showTerritoryDetail ? (
            <HeatOutline featureCollection={contestedFC} reduce={reduce} />
          ) : null}
          {/* The intelligence overlay, drawn ON TOP of the unchanged board.
              Every claim stays exactly as visible as it was — a layer adds a
              reading, it never takes the map away. */}
          {layerFC && board.showTerritoryDetail ? (
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
            <LandPortrait
              key={m.id}
              marker={m}
              bg={colors.card}
              onSelect={setProfileUserId}
              close={(zoom || 0) >= FIGURE_MIN_ZOOM}
            />
          ))}
          {/* Keep location visible when pulled back without covering the land. */}
          {myLoc && (
            <UserMarker point={myLoc} onPress={() => setProfileUserId(user.id)}>
              <View style={[styles.locationDot, { backgroundColor: accent, borderColor: colors.card }]} />
            </UserMarker>
          )}
        </GameMap>

        {/* WHAT THE TUTORIAL LIGHTS UP, declared rather than measured.
            Mapbox draws the board and the runner's dot natively, and there is
            no React view around either that could be measured — so the screen
            states the rectangle it means and a tip can measure that. It paints
            nothing and takes no touches. The camera is never moved for a tip. */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: railTop, left: rail, right: rail, bottom: rail }}
        >
          <TutorialAnchor id={TARGET.MAP_BOARD} style={StyleSheet.absoluteFill} />
        </View>

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
                  // A crested frame is lifted by its crest so the rail, not
                  // the ornament, meets the top edge (MAP_FRAME_CREST). The
                  // art grows by the same share, so the other three rails stay
                  // exactly where they were.
                  style={frameCrest
                    ? [StyleSheet.absoluteFill, { top: `${(-100 * frameCrest) / (1 - frameCrest)}%` }]
                    : StyleSheet.absoluteFill}
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
        {/* CLUB VIEW + MY LOCATION. One direct action in each thumb corner.
            The stickers carry their own outlines, so neither needs another
            heavy box around it.

            It stands down for the two things that own the bottom of the board
            outright, the planner and the tapped territory card, rather than
            floating on top of them. */}
        {!planning && !selected ? (
          <>
            <TouchableOpacity
              style={[
                styles.viewSwitchBtn,
                { bottom: rail + space.xs, left: rail + space.xs },
              ]}
              onPress={toggleClubView}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel={isClubView ? 'Switch to Solo view' : 'Switch to Club view'}
              accessibilityState={{ selected: isClubView }}
            >
              <AppIcon name={isClubView ? 'tab-club' : 'tab-you'} size={38} />
              <View style={styles.viewSwitchLabel}>
                <Text
                  style={[type.captionMedium, styles.viewSwitchLabelText, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {isClubView ? "You're in club view" : "You're in solo view"}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.locateBtn, { bottom: rail + space.xs, right: rail + space.xs }]}
              onPress={locateMe}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel="Center map on my location"
            >
              <AppIcon name="locate" size={38} />
            </TouchableOpacity>
          </>
        ) : null}

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
                  accessibilityLabel={isClubView ? 'Scout a lower club rank' : 'Scout a lower rank'}
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
                    `Viewing ${viewLabel}${rankLocked ? ', locked' : ''}. Learn how the ranked map works`
                  }
                >
                  <RankMark tier={viewedTier} />
                  <View style={styles.rankChoiceText}>
                    <Text style={[type.labelSm, { color: colors.textMuted }]}>
                      {isClubView ? 'Club rank' : 'Rank'}
                    </Text>
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
                  accessibilityLabel={isClubView ? 'Scout a higher club rank' : 'Scout a higher rank'}
                  style={[styles.rankStep, atLastTier && styles.actionOff]}
                >
                  <ChevronRight size={22} color={colors.text} strokeWidth={3} />
                </TouchableOpacity>
              </View>

              <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

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

        {/* Nothing claimed here yet. It sat at the TOP, directly under the
            actions menu, where it read as a panel the menu had opened. The
            bottom is where this screen already puts what it has to say about
            the land (the tapped territory card lives there), and it leaves the
            board itself, the empty thing being described, in full view. */}
        {showEmpty && (
          <View
            style={[
              styles.noticePill,
              {
                // Sit above the bottom controls instead of squeezing between
                // them; the message stays wide enough to read on small phones.
                bottom: rail + space.xs + LOCATE_SIZE + space.sm,
                left: rail + space.xs,
                right: rail + space.xs,
              },
            ]}
          >
            <Text style={type.heading}>
              {isClubView ? `No ${viewedTier.label} club land here yet.` : 'Unclaimed. Be first.'}
            </Text>
            <Text style={[type.caption, { marginTop: 2 }]}>
              {isClubView
                ? 'Scout another club rank, or switch back to the runners board.'
                : 'Close a loop here to claim the first land.'}
            </Text>
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
            <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <View style={styles.cardMain}>
            <View style={styles.cardHeader}>
              <Text style={[type.bodyBold, styles.cardTitle]} numberOfLines={1}>
                Captured by {selected.username}
                {selected.user_id === user.id ? ' (you)' : ''}
              </Text>
              {selected.defenders > 0 && (
                <View style={[styles.defendersBadge, { backgroundColor: selected.defenders > 3 ? '#22C55E' : '#EF4444' }]}>
                  <Text style={styles.defendersText}>{selected.defenders}</Text>
                </View>
              )}
            </View>
            <Text style={[type.caption, { marginTop: 2 }]}>
              {(selected.area_m2 / 1e6).toFixed(selected.area_m2 >= 1e5 ? 2 : 3)} km², held since {shortDate(selected.created_at)}
              {selected.contested ? ', contested' : ''}
            </Text>
            {/* Its own row, the card's full width. It used to sit beside the
                title with `flex: 1` inside a row that had no width of its own,
                so the track ran off the card's right edge. */}
            <View style={styles.strengthRow}>
              <Text style={[type.labelSm, { color: colors.textDim }]}>STRENGTH</Text>
              <View style={styles.strengthBarContainer}>
                <View style={[styles.strengthBar, { width: `${strengthPct(selected.strength)}%`, backgroundColor: selectedColor }]} />
              </View>
            </View>
          </View>
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
                {(area / 1e6).toFixed(2)} km² in {count} {count === 1 ? 'plot' : 'plots'}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </Sheet>

      {/* A short, scannable first-use guide. It opens itself once (see the
          effect near `rankInfoOpen` above), then stays available from Rank in
          the actions menu. */}
      <Sheet
        visible={rankInfoOpen}
        onClose={() => {
          setRankInfoOpen(false);
          completeRankGuide();
        }}
      >
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
          <Text style={type.heading}>How the map works</Text>
        </View>
        <View style={styles.rankInfoList}>
          <View style={[styles.currentRankCard, { borderColor: ownRankColor }]}>
            <View style={styles.currentRankHead}>
              <RankMark tier={ownRank} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.labelSm, { color: colors.textMuted }]}>Your rank</Text>
                <Text style={[type.heading, { color: ownRankColor }]}>{ownTierLabel}</Text>
              </View>
              <Text style={[type.bodySmBold, { color: colors.text }]}>{rankPoints.toLocaleString()} pts</Text>
            </View>
            <View style={[styles.rankProgressTrack, { borderColor: nbInk(scheme, colors.cardAlt) }]}>
              <Bar
                pct={rankProgress}
                trackStyle={StyleSheet.absoluteFill}
                fillStyle={[styles.rankProgressFill, { backgroundColor: ownRankColor }]}
              />
            </View>
            {/* The bar's label, and nothing else. It used to carry a second
                sentence of encouragement at the top rank, which is the kind of
                line a first-run sheet can least afford. */}
            <Text style={type.caption}>
              {pointsToNext === undefined
                ? 'Loading…'
                : pointsToNext == null
                ? 'Top rank.'
                : `${pointsToNext.toLocaleString()} pts to ${RANK_VIEWS[Math.min(TOP_VIEW, ownTier + 1)].label}`}
            </Text>
            {/* The one sentence that has to be here: what this map is showing. */}
            <Text style={[type.body, { color: colors.textMuted }]}>
              You see {ownTierLabel} runners only. Take their land, they take yours.
            </Text>
          </View>

          {/* THE RULES, one to a line, each with the points it is worth.
              Direction, outcome, price, read straight down.

              The rows say the OUTCOME and nothing more ("Lose land", not "A
              runner takes your land"): who did it to whom is already in the
              UP/DOWN column, and the long forms turned a table you scan into
              six sentences you read. The scale note that sat above them (area,
              opponent rank, the floor of 100) is true but is detail for the
              standings screen, not for the sheet that opens on first use.

              Ranges show the solo outcome caps. */}
          <View style={styles.rankInfoSection}>
            <Text style={[type.bodySmBold, { color: colors.text }]}>What moves your rank</Text>
            <View style={styles.rankRules}>
              {[
                { key: 'take', badge: 'UP', fill: colors.ok, text: 'Take land', pts: RANK_RANGES.take },
                { key: 'hold', badge: 'UP', fill: colors.ok, text: 'Defend your land', pts: RANK_RANGES.hold },
                { key: 'open', badge: 'UP', fill: colors.ok, text: 'Claim empty land', pts: RANK_RANGES.open },
                { key: 'lose', badge: 'DOWN', fill: colors.danger, text: 'Lose land', pts: RANK_RANGES.lose },
                { key: 'decay', badge: 'DOWN', fill: colors.danger, text: 'Land decays', pts: RANK_RANGES.decay },
                { key: 'failed', badge: 'DOWN', fill: colors.danger, text: 'Failed attack', pts: RANK_RANGES.failed },
              ].map(({ key, badge, fill, text, pts }) => (
                <View key={key} style={styles.rankRule}>
                  <View style={[styles.ruleBadge, { backgroundColor: fill, borderColor: nbInk(scheme, fill) }]}>
                    <Text style={[type.labelSm, styles.ruleBadgeText, { color: nbInk(scheme, fill) }]}>{badge}</Text>
                  </View>
                  <Text style={[type.body, styles.ruleText]}>{text}</Text>
                  <Text style={[type.bodySmBold, styles.rulePts]}>{pts}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* The one thing about the club board nobody can work out by looking
              at it. Club land is won TOGETHER (see backend club_runs.py), so a
              runner in a club who never runs with anyone sees an empty board
              and no reason for it. It is a footnote now, not a boxed section
              of its own: the rule is one clause long and it was carrying a
              heading and a second sentence telling the runner to tap a tab
              that is already on screen.

              "Look at other ranks: use the arrows" went with it. The arrows
              are visible, labelled with the rank they step to, and were the
              third box in a sheet whose problem was boxes. */}
          <Text style={[type.caption, styles.rankInfoNote]}>
            Club land needs two clubmates on one run.
          </Text>
        </View>
        <View style={styles.rankInfoActions}>
          <Button
            title="Rank standings"
            variant="secondary"
            onPress={() => {
              setRankInfoOpen(false);
              completeRankGuide();
              navigation.getParent()?.navigate('Home', { screen: 'Leaderboard' });
            }}
            style={{ flex: 1 }}
          />
          <Button
            title="Done"
            variant="gradient"
            onPress={() => {
              setRankInfoOpen(false);
              completeRankGuide();
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // THE BOARD. The rect the frame is drawn into: all four of the screen's hard
  // edges, `top` passed inline (see boardTop). No width/height — the edges size
  // it, and the art is stretched into whatever that comes out as.
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
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
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.card),
    ...shadow.raised,
  },
  actionsPanel: {
    width: ACTIONS_W,
    marginTop: space.xs,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.xs,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.card),
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
    borderRadius: nbRadius.sm,
    paddingHorizontal: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  actionIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },

  locateBtn: {
    position: 'absolute',
    width: LOCATE_SIZE,
    height: LOCATE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  viewSwitchBtn: {
    position: 'absolute',
    width: VIEW_SWITCH_SIZE,
    minHeight: LOCATE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewSwitchLabel: {
    marginTop: -2,
    minWidth: 88,
    maxWidth: VIEW_SWITCH_SIZE,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 3,
  },
  viewSwitchLabelText: {
    fontSize: 11,
    lineHeight: 13,
    textAlign: 'center',
  },

  // Placed inline (bottom/left/right), because every edge of it is measured
  // off the frame's rail.
  noticePill: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.card),
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
  rankInfoList: { gap: space.sm, marginTop: space.md },
  currentRankCard: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    borderWidth: NB.strokeThin,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: space.sm,
  },
  currentRankHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rankProgressTrack: {
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  rankProgressFill: { height: '100%', borderRadius: 5 },
  rankInfoActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  // The box needs its own EDGE, not just a fill. On light the section sits on
  // a white sheet and the cream fill is the boundary; on dark the sheet is
  // `raised` and the fill is `high`, two steps that are four points of
  // lightness apart, so unbordered these read as one undivided grey wall and
  // the sheet loses its structure exactly where it is hardest to read.
  rankInfoSection: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 2,
  },
  // A footnote, not a section: no fill and no border, so the sheet reads as one
  // card and one table with a line under them rather than a stack of boxes.
  rankInfoNote: { paddingHorizontal: space.xs, marginTop: 2 },
  // One rule to a row. The badge column is a FIXED width so the four sentences
  // start on the same left edge and the eye can run straight down them; the
  // badges themselves are the app's ordinary block-with-a-stroke, not tinted
  // type, because green or red at 12pt on a cream card is barely a colour.
  rankRules: { gap: space.xs, marginTop: space.xs, marginBottom: space.xs },
  rankRule: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ruleBadge: {
    width: 62,
    paddingVertical: 3,
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleBadgeText: { letterSpacing: 0.4 },
  ruleText: { flex: 1, minWidth: 0, color: colors.text },
  // Right-aligned and tabular so the four prices stack into a column the eye
  // can compare without reading them.
  rulePts: { color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] },

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
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  cardMain: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  cardTitle: { flexShrink: 1 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  strengthBarContainer: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  strengthBar: { height: '100%', borderRadius: 3 },
  defendersBadge: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  defendersText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  cardActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, justifyContent: 'center' },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
});
