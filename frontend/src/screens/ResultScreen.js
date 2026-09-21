// Post-run result, in three stages: CLAIM, then SUMMARY, then SHARE.
//
// They are separate because they are separate jobs and they want opposite
// layouts. Claiming is a map decision — the runner needs to look around the
// neighbourhood, see whose border is where, and place their ground — so it
// gets the whole screen with the map behind it and nothing to scroll past.
// The summary is a recap, so it scrolls. Sharing is outward-facing and comes
// LAST, the final thing before Home, rather than being a button half way down
// a page nobody reaches.
//
// Distance decides how much land the run earned; the ROUTE decides its shape.
// The territory is one grown polygon — the run's own silhouette — and the move
// the runner makes is rigid: slide it anywhere along the route, turn it to any
// heading. The shape never changes as it moves, which is what makes it worth
// aiming. Geometry for the live preview is done locally (claim/placement.js,
// mirroring the server's `ClaimStamp`); the server is asked only for the
// numbers, debounced.
//
// Sharing does NOT screenshot the recap card — a screen-shaped slab posts
// badly. `RunShareSheet` renders a purpose-built 9:16 card and hands it to
// Instagram Stories or the system sheet.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, withSpring, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import GameMap, { MAP_READY, TerritoryFill, TerritoryLayer, Trail, UserMarker } from '../components/GameMap';
import { CharacterBust } from '../components/character/CharacterRig';
import { buildBoardFeatures, buildLandPortraits, estimateClaimsInRing } from '../components/territoryBoard';
import { mergeTouchingLand } from '../map/holdings';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import ClaimPayoff from '../components/ClaimPayoff';
import GameAnimation from '../components/GameAnimation';
import RouteThumb, { hasRouteData } from '../components/RouteThumb';
import CaptureEncounter from '../components/claim/CaptureEncounter';
import CaptureStylePlayer, { captureStyleImageSources } from '../effects/CaptureStylePlayer';
import CaptureCast, { DEFENDER_SIZE } from '../effects/CaptureCast';
import { ROLE, isExitAction } from '../effects/choreography';
import useCaptureStage from '../effects/useCaptureStage';
import { buildTerritoryAnchorModel, layoutDefenders, resolveRevealOrigin } from '../effects/anchors';
import { CAPTURE_LAYER } from '../effects/layers';
import ChooseAttack, { ChooseAttackPending } from '../components/claim/ChooseAttack';
import TwoStepClaimFlow, { CLAIM_STEPS } from '../components/claim/TwoStepClaimFlow';
import { SIGNAL, TARGET, useTutorial, useTutorialTarget } from '../tutorial';
import CutsceneBackdrop from '../components/claim/CutsceneBackdrop';
import { CLAIM_PHASE, atOrAfter } from '../components/claim/phases';
import { makePlacer, normaliseDeg } from '../components/claim/placement';
import LeaderboardTransition from '../components/claim/LeaderboardTransition';
import TerritoryRevealCanvas from '../components/claim/TerritoryRevealCanvas';
import TerritoryVictoryBeat, { victoryLabel } from '../components/claim/TerritoryVictoryBeat';
import useClaimSequence from '../components/claim/useClaimSequence';
import PaserbyReveal from '../components/paserby/PaserbyReveal';
import RunShareSheet from '../components/share/RunShareSheet';
import TerritoryInsights from '../components/TerritoryInsights';
import { ProFrosted, ProLockedSection, ProInlineLock } from '../components/ProLock';
import { useProEntitlement } from '../pro/ProProvider';
import XpProgress from '../components/XpProgress';
import LevelUpCelebration from '../components/LevelUpCelebration';
import RankUpCeremony from '../components/rank/RankUpCeremony';
import RankDownCeremony from '../components/rank/RankDownCeremony';
import { writeSeenRank } from '../rank/rankSeen';
import { standingFrom, tierByKey } from '../config/rankLadder';
import { Image } from '../ui/image';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { useAvatar } from '../state/avatar';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { fetchAndCache, invalidate, invalidateAfterClaim } from '../api/cache';
import { shouldReveal } from '../config/paserby';
import { preloadScreenImages } from '../config/screenAssets';
import { preloadImages } from '../utils/imagePreload';
import { RUN_TIER } from '../config/economy';
import { claimTimeLeft } from '../utils/claimWindow';
import { NB, brand, nbAccents, nbInk, nbRadius, nbTextOn, radius, runTuning, shadow, space, toon, toonType, useTheme, useThemedStyles, useThemedType, withAlpha } from '../theme';
import { Framed, HardShadow, OutlinedText, ToonButton } from '../components/ui';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { useClan } from '../state/clan';
import { useSettings } from '../state/settings';
import { Confetti, CountUpText, Pop, Reveal, haptic, PressableScale } from '../ui/motion';
import PaserMark from '../components/PaserMark';
import AppIcon from '../components/AppIcon';
import { toast } from '../ui/toast';
import { rivalPopup } from '../components/RivalPopup';

const DevSequenceControls = __DEV__
  ? require('../components/claim/DevSequenceControls').default
  : null;

// The three jobs this screen does, in order. Claiming is a map decision and
// takes the whole screen; the recap scrolls; sharing is outward-facing and
// comes last, immediately before Home.
const STAGE = { CLAIM: 'claim', SUMMARY: 'summary', SHARE: 'share' };

export function mapRootResetState(center) {
  const focus = center
    ? { focus: { lat: center.latitude, lon: center.longitude } }
    : undefined;
  return {
    index: 0,
    routes: [{
      name: 'Tabs',
      params: {
        screen: 'Map',
        params: { screen: 'MapMain', params: focus },
      },
    }],
  };
}

// --- geometry / splits -----------------------------------------------------

function haversine(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLon = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude), la2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatArea(m2) {
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
}

// worklet-safe km² formatter for the animated hero number.
function km2(n) {
  'worklet';
  const v = n / 1e6;
  return v >= 0.1 ? v.toFixed(2) : v.toFixed(3);
}

// The number only. "coins" used to be part of the counting string, which meant
// the word was redrawn on every tick of the count — and next to a spinning coin
// it is the coin that says what the number is, so the word became a static
// label beside it instead.
function fmtCoins(n) {
  'worklet';
  return `+${Math.round(n)}`;
}

// When the payout lands, measured from the card arriving. After the XP bar has
// finished travelling (XpProgress starts at 420 and runs for ~900), so the two
// rewards are read one after the other rather than competing.
const COINS_DELAY = 1180;

// How long the first-run tutorial will wait for the claim chooser before it
// decides this run cannot teach the claim. The options request is one round
// trip against a backend that can be cold (see the note on warmUp in App.js),
// so this is generous — it is the point at which the sheet has given up too.
const CLAIM_TEACHABLE_MS = 20000;

// Total climb, from the altitude stored on each fix. GPS altitude is noisy by
// several metres even standing still, so only rises past a threshold count —
// without that a flat run "climbs" a hundred metres of jitter. Runs recorded
// before altitude was captured have none, and the metric hides itself rather
// than showing a confident zero.
const ELEVATION_NOISE_M = 1.5;

// Both directions in one pass over the same noise-filtered reference walk —
// gain and loss are the same climb, read two ways, and computing them
// separately would mean deciding "did this GPS jitter count" twice and risking
// the two answers disagreeing.
function elevationChangeM(path) {
  const alts = path.map((p) => p.altitude).filter((a) => typeof a === 'number' && isFinite(a));
  if (alts.length < 3) return { gain: null, loss: null };
  let gain = 0;
  let loss = 0;
  let reference = alts[0];
  for (const a of alts) {
    const delta = a - reference;
    if (delta > ELEVATION_NOISE_M) {
      gain += delta;
      reference = a;
    } else if (delta < -ELEVATION_NOISE_M) {
      loss += -delta;
      reference = a;
    }
  }
  return { gain, loss };
}

// Which sticker belongs to a personal record. The labels come from the server
// (backend/app/fitness.py RECORDS), so match on shape rather than on the exact
// string — "Fastest 5K" must not fall back to the generic trophy just because
// only 1K was listed here.
function recordIcon(label) {
  const l = String(label).toLowerCase();
  if (l.includes('fastest')) return 'timer';
  if (l.includes('longest')) return 'route';
  if (l.includes('claim')) return 'claim';
  if (l.includes('streak')) return 'streak';
  return 'trophy';
}

// --- claim helpers ----------------------------------------------------------

// Where the claim sits, for the camera flight and the reveal's origin: the
// centroid of the ground the run is about to take. There is no chosen point
// any more — the territory is grown around the route, so the shape decides
// where it is rather than the runner.
function ringCentroid(ring) {
  if (!ring || ring.length < 3) return null;
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const f = xj * yi - xi * yj;
    twiceArea += f;
    x += (xj + xi) * f;
    y += (yj + yi) * f;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    // Degenerate ring — fall back to the mean vertex.
    const n = ring.length;
    return {
      longitude: ring.reduce((a, p) => a + p[0], 0) / n,
      latitude: ring.reduce((a, p) => a + p[1], 0) / n,
    };
  }
  return { longitude: x / (3 * twiceArea), latitude: y / (3 * twiceArea) };
}

export function payoffMapCenter(payoff) {
  const direct = payoff?.center;
  if (Number.isFinite(direct?.latitude) && Number.isFinite(direct?.longitude)) return direct;
  const territory = payoff?.territory || {};
  const ring = territory.rings?.[0]
    || territory.polygon
    || territory.geometry?.coordinates?.[0]
    || territory.coordinates?.[0];
  return ringCentroid(ring);
}

// Per-km splits from the recorded path (client-side; Phase 6 makes these
// server-authoritative alongside PRs).
function computeSplits(path) {
  if (!path || path.length < 2) return [];
  const splits = [];
  let kmDist = 0, kmTime = 0, kmIndex = 1;
  for (let i = 1; i < path.length; i++) {
    let segD = haversine(path[i - 1], path[i]);
    let segT = (path[i].timestamp - path[i - 1].timestamp) / 1000;
    // `!(segT > 0)` rather than `segT <= 0`: a point with no timestamp is NaN,
    // and has to be skipped too rather than poison every split after it.
    if (!(segT > 0) || !isFinite(segD)) continue;
    while (kmDist + segD >= 1000) {
      const need = 1000 - kmDist;
      const frac = need / segD;
      splits.push({ km: kmIndex, seconds: kmTime + segT * frac });
      kmIndex += 1;
      segD -= need;
      segT -= segT * frac;
      kmDist = 0;
      kmTime = 0;
    }
    kmDist += segD;
    kmTime += segT;
  }
  return splits;
}

function paceStr(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Standard deviation across completed kilometre splits. Average speed is just
// pace with the units inverted; this says something the headline pace cannot:
// how evenly the runner held it. One split is not a pattern, so short runs do
// not get a made-up consistency score.
function paceConsistencySeconds(splits) {
  if (!splits || splits.length < 2) return null;
  const mean = splits.reduce((sum, split) => sum + split.seconds, 0) / splits.length;
  const variance = splits.reduce(
    (sum, split) => sum + (split.seconds - mean) ** 2,
    0
  ) / splits.length;
  return Math.round(Math.sqrt(variance));
}

function formatPace(distanceM, durationS) {
  if (!distanceM || distanceM < 1 || !durationS) return '·';
  return `${paceStr((durationS / (distanceM / 1000)))} /km`;
}

function formatDuration(durationS) {
  const total = Math.max(0, Math.round(durationS));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function QuietStat({ label, value, unit, accent }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.quietStat}>
      <Text style={styles.quietLabel}>{label}</Text>
      <View style={styles.quietValueRow}>
        <Text style={[styles.quietValue, accent && { color: accent }]}>{value}</Text>
        {!!unit && <Text style={styles.quietUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

/**
 * `bare`     drop the section heading and its top margin. For the locked peek,
 *            where the lock card already carries the title.
 * `frosted`  render the paces as unreadable smears. The rows, the kilometre
 *            numbers and the bar shapes stay sharp, so a locked runner can see
 *            exactly what the table IS — a pace per kilometre, longest bar
 *            slowest — without being handed a single one of the times.
 */
function Splits({ splits, accent, bare, frosted }) {
  const styles = useThemedStyles(makeStyles);
  if (!splits.length) return null;
  const slowest = Math.max(...splits.map((s) => s.seconds));
  const Pace = frosted ? ProFrosted : Text;
  return (
    <View style={bare ? undefined : styles.section}>
      {!bare && <Text style={styles.sectionTitle}>Splits</Text>}
      {splits.map((s) => (
        <View key={s.km} style={styles.splitRow}>
          <Text style={styles.splitKm}>{s.km} km</Text>
          <View style={styles.splitBarTrack}>
            <View style={[styles.splitBar, { width: `${Math.max(12, (s.seconds / slowest) * 100)}%`, backgroundColor: accent }]} />
          </View>
          <Pace style={styles.splitPace}>{paceStr(s.seconds)}</Pace>
        </View>
      ))}
    </View>
  );
}

export default function ResultScreen({ navigation, route }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { result } = route.params;
  // Reopened from Home or the run's own page to place land the runner chose
  // to plan later (PlanAttackScreen). The claim is identical; what differs is
  // everything that belonged to the moment the run finished, which was shown
  // then and must not be celebrated or paid out a second time.
  const deferred = !!route.params.deferred;
  const { color, clan } = useClan();
  const { equipped, rankKey } = useAvatar();
  const { user } = useAuth();
  const { trailGlowColor } = useSettings();
  // PRO gate for the secondary stat row (best km, climbing, consistency).
  // Read here without side effects — the impression fires from ProInlineLock,
  // the one surface that actually renders when this is true. `canShowPro &&
  // !isPro` is exactly "locked": a build that cannot sell PRO leaves the row
  // free for everyone, and a subscriber sees their own numbers. These are a
  // richer READ of the run, never a lever on it, so gating them stays inside
  // the depth-not-power line in config/pro.js.
  const { isPro: hasPro, canShowPro } = useProEntitlement();
  const advancedStatsLocked = canShowPro && !hasPro;
  const team = trailGlowColor
    ? { fill: withAlpha(trailGlowColor, 0.2), stroke: trailGlowColor, glow: trailGlowColor }
    : color;
  const label = clan?.tag || 'Solo';
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();

  // --- the first-run tutorial ---------------------------------------------
  //
  // Declared up here, above everything that uses it, because a dependency
  // array is evaluated in the component body and a const read before its own
  // declaration throws (see scripts/check-tdz.mjs for the time that shipped).
  //
  // The claim steps sit ON TOP of the real claim system: they light the real
  // dial and the real button, they end when those are really used, and there
  // is no tutorial-only claim anywhere in this file.
  const {
    setFacts: setTutorialFacts,
    signal: tutorialSignal,
    remeasure: remeasureTutorial,
  } = useTutorial();
  const claimSheetTarget = useTutorialTarget(TARGET.CLAIM_SHEET);
  const claimButtonTarget = useTutorialTarget(TARGET.CLAIM_BUTTON);

  const path = route.params.path || [];

  // Which of the three stages is on screen. A run with no claim to place skips
  // straight to the recap — an empty map with a dead button is not a step.
  // Decided once, from what /end-run said, so the stage cannot change under
  // the runner when the options land a moment later.
  const [stage, setStage] = useState(() =>
    !result.territory && (result.claim_area_m2 || 0) > 0 && result.claim_ring?.length >= 3
      ? STAGE.CLAIM
      : STAGE.SUMMARY
  );

  // Claim placement: the run earned a circle (circumference = distance);
  // it becomes territory only once the runner places it on their trail.
  // `gained_m2` is null rather than 0 until a claim lands: nothing has been
  // won yet, and 0 would read as "this run won nothing".
  const [claim, setClaim] = useState({
    territory: result.territory || null,
    stolen_m2: result.stolen_m2 || 0,
    stolen_from: result.stolen_from || null,
    xp_gained: 0,
    gained_m2: null,
    reinforced_m2: 0,
    claim_rings: null,
  });
  // Where the run's earned land goes. The run decides how MUCH ground and what
  // SHAPE it takes; the move the runner still has to make is the POSE — where
  // along their route its centre sits, and which way it faces. Both continuous.
  //
  // `options` carries the shape itself (`base_ring`), its pivot, the route and
  // a coarse sample of the space; `placer` redoes the server's rigid move
  // locally so dragging never waits on a request; `preview` is the server's
  // answer for what the current pose would take.
  const [options, setOptions] = useState(null);
  const [pose, setPose] = useState(null);
  const [preview, setPreview] = useState(null);
  // The pose `preview` actually describes. Compared against `pose` to know
  // whether the numbers on screen are still the right ones.
  const previewPose = useRef(null);
  const [previewing, setPreviewing] = useState(false);

  const placer = useMemo(() => makePlacer(options), [options]);

  // The ground this run takes: the posed shape once the runner has something
  // to pose, and the server's resting placement (the run exactly as it was
  // run, sent by /end-run) until then or if the options never land.
  const claimRing = useMemo(() => {
    if (placer && pose) {
      const ring = placer.ringAt(pose.t, pose.deg);
      if (ring?.length >= 3) return ring;
    }
    return result.claim_ring?.length >= 3 ? result.claim_ring : null;
  }, [placer, pose, result.claim_ring]);
  const claimPoints = useMemo(
    () => (claimRing ? claimRing.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) : null),
    [claimRing]
  );
  const center = useMemo(
    () => ringCentroid(claimRing) || (path.length ? path[Math.floor(path.length / 2)] : null),
    [claimRing, path]
  );
  const [claiming, setClaiming] = useState(false);
  // The full claim response, held for the payoff overlay (victims + level).
  // Visibility is owned by the sequence phase, not by this — so a dev replay
  // resets the payoff along with everything else.
  const [payoff, setPayoff] = useState(null);
  // Energy gates claiming (not running). Declared HERE, above every derived
  // value, because `claimCost` below reads it: a `const` is in its temporal
  // dead zone until its own declaration runs, and optional chaining does not
  // save you — `energyStatus?.x` still touches the binding. Sitting below the
  // derived block, this threw ReferenceError on the first render of every
  // finished run, before `options` had arrived to short-circuit the `??`.
  const [energyStatus, setEnergyStatus] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);
  
  // Track claim step and pose for map visualization
  const [claimStep, setClaimStep] = useState(CLAIM_STEPS.PLACE);
  const [claimPoseForMap, setClaimPoseForMap] = useState(pose);
  
  // Animation for placement handle on first appearance
  const handleAnimOffset = useSharedValue(0);
  const handleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: handleAnimOffset.value }],
  }));
  
  // Animate handle when step changes to PLACE
  useEffect(() => {
    if (claimStep === CLAIM_STEPS.PLACE) {
      handleAnimOffset.value = withSpring(15, { damping: 15 }, () => {
        handleAnimOffset.value = withSpring(0, { damping: 15 });
      });
    }
  }, [claimStep]);

  // The claim lands on the map before it lands in a card: camera flight,
  // capture encounter, the polygon wiping outward from the middle of the
  // ground taken, the victory beat, then the payoff and standings.
  const mapRef = useRef(null);
  const seq = useClaimSequence({ mapRef, userId: user.id });
  // The capture's sprite sheets, decoded while the run replay is still flying.
  // The style is picked the moment the sequence starts, seconds before its
  // first beat, and a sheet decoded as its step fires lands a beat late (see
  // captureStyleImageSources).
  useEffect(() => {
    if (seq.captureStyle) preloadImages(captureStyleImageSources(seq.captureStyle));
  }, [seq.captureStyle]);

  // The palette the CAPTURE draws in: the reveal, the glow seams, every tinted
  // primitive and the victory beat. Identical to `team` in every real claim —
  // `tintOverride` is set only by the dev sequence panel, so a capture can be
  // inspected against a colour that is not the signed-in player's own. Derived
  // here rather than folded into `team` because `team` is declared well before
  // this hook runs and cannot read from it.
  const captureTeam = useMemo(() => {
    const override = seq.options?.tintOverride;
    return override
      ? { fill: withAlpha(override, 0.2), stroke: override, glow: override }
      : team;
  }, [seq.options?.tintOverride, team]);
  const captureCharacterRect = useMemo(() => {
    const point = seq.projection?.claimPoint;
    return point ? { x: point.x - 30, y: point.y - 84, width: 60, height: 84 } : null;
  }, [seq.projection?.claimPoint?.x, seq.projection?.claimPoint?.y]);
  const captureSafeInsets = useMemo(() => ({
    top: insets.top + 116,
    right: 20,
    bottom: Math.max(20, insets.bottom),
    left: 20,
  }), [insets.bottom, insets.top]);
  const reducedMotion = seq.reducedMotion;
  // The scene the whole claim overlay lives on, and the one body on it.
  //
  // NOT `stage`. This screen already has one: the CLAIM / SUMMARY / SHARE
  // step machine declared above. Two `const stage` in one component body is
  // a parse error, so the camera's stage carries the longer name.
  const captureStage = useCaptureStage(reducedMotion);
  const castRef = useRef(null);

  // Whether any defender has started leaving. Nothing gates the map scrim on
  // this any more — see the scrim's own note — but the flag is still how the
  // screen knows the reaction beat has begun, and it is cheap to keep correct.
  const [defendersExiting, setDefendersExiting] = useState(false);
  useEffect(() => { setDefendersExiting(false); }, [seq.playToken]);
  const handleCharacterAction = useCallback((name, role) => {
    if (role === ROLE.DEFENDER && isExitAction(name)) setDefendersExiting(true);
  }, []);
  // The encounter and victory beats are laid out in the map's own pixel space,
  // so they need its box to keep characters inside the card.
  //
  // SEEDED FROM THE WINDOW rather than starting null. The claim stage is
  // full-bleed, so the window is very close to the right answer and `onLayout`
  // corrects it within the first frame either way. Starting at null meant the
  // first resolve of every anchor ran against a box of zero size, and a zero
  // box makes the safe rect zero, which used to send the entire cutscene to
  // the top-left corner (see the note in effects/anchors.js). That resolver
  // now defends itself, but handing it a real box is the other half: the
  // fallback should be insurance, not the normal path.
  const [mapBox, setMapBox] = useState(() => {
    const { width, height } = Dimensions.get('window');
    return width > 0 && height > 0 ? { width, height } : null;
  });

  // Where the rivals are standing.
  //
  // Laid out ONCE, here, and handed to three places that must agree: the rigs
  // that are drawn, the anchor context the choreography resolves against, and
  // the reveal origin. Computing it in more than one place is how an event
  // ends up aimed at where somebody nearly is — and every defender anchor in
  // the vocabulary (`defender[1].head`, `defenderGroupCenter`, nearest,
  // furthest) reads from this array.
  //
  // Seeded off the claim, so a replay stands the same people in the same spots.
  const defenderRects = useMemo(() => {
    const rings = seq.projection?.rings;
    const claimPoint = seq.projection?.claimPoint;
    if (!rings || !claimPoint || !seq.defenderCount) return [];
    return layoutDefenders(
      seq.defenderCount,
      {
        bounds: mapBox,
        claimPoint,
        territoryRings: rings,
        safeInsets: captureSafeInsets,
      },
      `cast:${seq.castSeed}:${seq.captureStyle}`,
      DEFENDER_SIZE
    );
  }, [
    captureSafeInsets, mapBox, seq.captureStyle, seq.castSeed,
    seq.defenderCount, seq.projection,
  ]);

  // Memoized so CaptureEncounter (now React.memo'd) sees a stable object
  // instead of a fresh one on every ResultScreen render — an inline literal
  // here would defeat that memo for the whole duration of an encounter.
  const contactPoint = useMemo(
    () => (defenderRects[0]
      ? { x: defenderRects[0].x + defenderRects[0].width / 2, y: defenderRects[0].y + defenderRects[0].height / 2 }
      : null),
    [defenderRects]
  );

  // Where this style's wipe opens from.
  //
  // Resolved with the SAME anchor resolver the effects and the cast use,
  // against the same context, so "the ground cracks from the crater that
  // formed" is literally the same point the impact sprite was drawn on and the
  // same point everybody was blown away from.
  const revealOrigin = useMemo(() => {
    const rings = seq.reveal?.rings;
    const claimPoint = seq.reveal?.claimPoint;
    if (!rings || !claimPoint) return null;
    const context = {
      bounds: mapBox,
      claimPoint,
      territoryCenter: claimPoint,
      territoryRings: rings,
      characterRect: captureCharacterRect,
      defenderRects,
      safeInsets: captureSafeInsets,
      anchorModel: buildTerritoryAnchorModel({
        rings, bounds: mapBox, insets: captureSafeInsets, preferred: claimPoint,
      }),
    };
    return resolveRevealOrigin(seq.revealSpec?.origin, context, `reveal:${seq.playToken}`);
  }, [
    captureCharacterRect, captureSafeInsets, defenderRects, mapBox,
    seq.playToken, seq.reveal, seq.revealSpec?.origin,
  ]);
  // The rail and dial live inside a vertically scrolling sheet. Freeze their
  // parent while either control owns the gesture so turning the claim cannot
  // drag the whole screen under the runner's finger.
  const [claimControlActive, setClaimControlActive] = useState(false);

  // While the attack is being chosen the camera opens on the NEIGHBOURHOOD,
  // not on the run. Framing the trail tightly was the wrong default for the
  // job this screen is doing: the runner is deciding where to put their land,
  // and every rival border worth aiming at is off the edge of a shot cropped
  // to their own route. So the run's bbox is blown out and the whole thing is
  // fitted, which leaves the trail in the middle with its surroundings around
  // it — and the map is free to pan and zoom from there.
  //
  // Zooming IN is the sequence's job, after "Claim here". Fired off the map's
  // first idle (a fitBounds issued before Mapbox has settled is dropped) and
  // only once, or the fit would re-trigger itself on the idle it causes.
  const fitted = useRef(false);
  // useCallback so this stays referentially stable across ResultScreen's own
  // re-renders — it's passed straight through to GameMap as `onIdle`, and
  // GameMap/ShapeSource are PureComponents that treat a changed callback
  // reference as "re-render me," forcing a full re-stringify of this screen's
  // map GeoJSON on every unrelated state change (same issue as GlobalMapScreen).
  const fitToNeighbourhood = useCallback(() => {
    if (fitted.current || seq.isRunning || path.length < 2) return;
    fitted.current = true;
    
    // Start with route bbox
    const lats = path.map((p) => p.latitude);
    const lons = path.map((p) => p.longitude);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLon = Math.min(...lons), maxLon = Math.max(...lons);
    
    // If claim preview exists, include it in the fit for better context
    if (claimPoints && claimPoints.length >= 3) {
      const claimLats = claimPoints.map((p) => p.latitude);
      const claimLons = claimPoints.map((p) => p.longitude);
      minLat = Math.min(minLat, ...claimLats);
      maxLat = Math.max(maxLat, ...claimLats);
      minLon = Math.min(minLon, ...claimLons);
      maxLon = Math.max(maxLon, ...claimLons);
    }
    
    // Grow the box around its own centre. The floor matters more than the
    // factor: a lap of one block is a tiny bbox, and 2.2x of almost nothing is
    // still almost nothing, so short runs would open zoomed to the pavement.
    const padLat = Math.max((maxLat - minLat) * 0.6, 0.006);
    const padLon = Math.max((maxLon - minLon) * 0.6, 0.006);
    mapRef.current?.fitToPoints(
      [
        { latitude: minLat - padLat, longitude: minLon - padLon },
        { latitude: maxLat + padLat, longitude: maxLon + padLon },
      ],
      24,
      700
    );
  }, [seq.isRunning, path, claimPoints]);

  // The trail as far as the 3D replay has flown. `replayProgress` is 1 unless
  // a flyover is actually running, so this is the whole path at every other
  // moment — including before a claim, and for every run that skips the
  // replay (Reduce Motion, or no usable route).
  //
  // Never shorter than two points: a one-point LineString is not a line, and
  // Trail would drop the layer entirely for the first frame of the flyover.
  const replayTrail = useMemo(() => {
    const p = seq.replayProgress;
    if (p == null || p >= 1 || path.length < 2) return path;
    return path.slice(0, Math.max(2, Math.ceil(path.length * p)));
  }, [path, seq.replayProgress]);

  const t = claim.territory;
  const captured = !!t;
  const claimArea = result.claim_area_m2 || 0;
  // `qualification_reason` is the field name; `gate_reason` is the same value
  // under the old name, kept on the wire for clients that shipped before the
  // rename. Read the new one first and fall back, so this screen is correct
  // against either backend.
  const qualificationReason = result.qualification_reason ?? result.gate_reason ?? null;
  const canPlace = !captured && claimArea > 0 && !!claimRing;
  // The claim can be MOVED once the server has sent the shape and the route it
  // slides along. Until then the map is already showing the real ground (the
  // resting placement from /end-run) and the button already works — the claim
  // must never be blocked on the chooser arriving.
  const canChoose = canPlace && !!placer && !!pose;
  // The server closes individual moves (today's neutral expansions used up,
  // not enough energy). The button follows it rather than letting the runner
  // press something that will only be refused. No heading is ever closed any
  // more: a rigid stamp turns about its own centre, so every pose is on the
  // run by construction.
  const moveBlocked = preview?.available === false;
  // `captured` flips the instant the claim returns, which would tear the map
  // out from under the animation — so the CLAIM STAGE is what stays mounted
  // through the sequence, and only `endCelebration` moves off it. There is no
  // longer a card to keep alive: the stage is the map.

  // THE BOARD UNDER THE CLAIM IS THE BOARD THE CLAIM FIGHTS.
  //
  // Claim combat is scoped to one rank tier: a claim only ever meets holders
  // in the runner's own band, and land in any other tier is not in the fight
  // at all (backend `_rank_scope_sql`). This map used to be fetched with no
  // rank, which drew every tier at once — so a claim sitting on six painted
  // plots would report "1 runner lose ground here", and the runner read the
  // breakdown as broken rather than as the truth about a different board.
  //
  // The tier comes from the server with the claim options (`rank_tier`), so
  // it is literally the number the breakdown was computed against. Until
  // those land — and if they never do — the runner's own tier stands in,
  // which is the same reading the global map opens on. Gating the map on the
  // options instead would leave the neighbourhood blank for the second or so
  // the grid takes to build, and blank forever if that request fails.
  const boardRank = options?.rank_tier ?? tierByKey(rankKey).tier;
  const [board, setBoard] = useState([]);
  useEffect(() => {
    if (!MAP_READY || path.length < 2) return;
    const lats = path.map((p) => p.latitude);
    const lons = path.map((p) => p.longitude);
    const m = 0.012; // pad the run's bbox so surrounding turf is included
    const bbox = {
      minLon: Math.min(...lons) - m, minLat: Math.min(...lats) - m,
      maxLon: Math.max(...lons) + m, maxLat: Math.max(...lats) + m,
    };
    let alive = true;
    api.mapPolygons(bbox, 15, { rank: boardRank })
      .then((d) => { if (alive) setBoard(d.territories || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [path, boardRank]);

  const attackedUserIds = useMemo(
    () => (preview?.rivals || []).map((r) => r.user_id).filter(Boolean),
    [preview?.rivals]
  );
  // The DRAWN board merges one runner's touching land into one holding, the
  // same as the big map, so the ground behind the claim reads the same on both
  // screens. Only what is drawn: `localEstimate` below still works the raw
  // claims, because the payoff is counted per claim taken and a merged holding
  // is not one of those.
  const heldBoard = useMemo(() => mergeTouchingLand(board), [board]);
  const boardFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: buildBoardFeatures(heldBoard, {
        userId: user.id,
        accent: team.stroke,
        highlightedUserIds: attackedUserIds,
      }),
    }),
    [heldBoard, user.id, team.stroke, attackedUserIds]
  );
  const boardPortraits = useMemo(
    () => buildLandPortraits(heldBoard, { userId: user.id, accent: team.stroke, equipped, cap: 24 }),
    [heldBoard, user.id, team.stroke, equipped]
  );
  // Who — and how much — this claim takes, worked out from the board the map
  // already has. This is the FALLBACK reading, used before the server's own
  // answer arrives and if it never does; `preview` above is the authoritative
  // one and is what the chooser shows whenever it exists.
  const localEstimate = useMemo(
    () => (claimRing ? estimateClaimsInRing(board, claimRing, { userId: user.id }) : { rivals: [], sampleArea: 0 }),
    [board, claimRing, user.id]
  );
  const claimingFrom = localEstimate.rivals;
  const takingTotal = claimingFrom.reduce((s, r) => s + r.area, 0);

  // Fetch the meter so the claim card can show it and redirect to the shop
  // when it's too low. (The state itself is declared above the derived block.)
  useEffect(() => {
    if (!canPlace) return;
    let alive = true;
    api.energyStatus().then((s) => { if (alive) setEnergyStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [canPlace]);
  const refreshEnergy = () => api.energyStatus().then(setEnergyStatus).catch(() => {});

  // The attack choice. Fetched once per run: the shape and the sampled grid
  // are deterministic from the stored route, so re-asking would only ever
  // return the same answer. A failure here is not fatal — `claimRing` falls
  // back to the server's resting placement and the claim button still works,
  // just without the move.
  useEffect(() => {
    if (captured || claimArea <= 0) return;
    let alive = true;
    api.claimOptions(result.run_id)
      .then((o) => {
        if (!alive || !o?.placements?.length) return;
        setOptions(o);
        // Open on the server's own recommendation, which is where the runner
        // would land if they tapped nothing.
        const seed =
          o.placements[Math.min(Math.max(o.default_index || 0, 0), o.placements.length - 1)];
        const start = { t: seed?.t ?? o.base_t ?? 0.5, deg: normaliseDeg(seed?.rotation_deg) };
        setPose(start);
        previewPose.current = start;
        setPreview(seed || null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [result.run_id, captured, claimArea]);

  // What the current pose would take. The SHAPE is already on the map — drawn
  // locally, exactly where the claim will land — so this is only ever chasing
  // the numbers, and it is asked for on release rather than on every frame:
  // one request per gesture instead of one per pixel.
  //
  // Guarded by a token rather than by an abort: two previews can be in flight
  // after a fast drag, and the one that matters is the one for the pose the
  // finger ended on, not whichever the network happens to answer last.
  const previewToken = useRef(0);
  const requestPreview = useCallback(
    (next) => {
      if (!result.run_id || captured) return;
      const token = (previewToken.current += 1);
      setPreviewing(true);
      api
        .claimPreview(result.run_id, next.t, next.deg)
        .then((p) => {
          if (token !== previewToken.current) return;
          previewPose.current = next;
          setPreview(p);
        })
        // Silent: the last good breakdown stays on screen. A pose that could
        // not be priced is still a pose that can be claimed, and the claim
        // itself re-derives everything server-side anyway.
        .catch(() => {})
        .finally(() => {
          if (token === previewToken.current) setPreviewing(false);
        });
    },
    [result.run_id, captured]
  );

  // Are the numbers on screen the ones for the shape on screen? Anything that
  // moved since the last priced pose counts as stale, including a drag still
  // in progress.
  const previewStale =
    previewing ||
    !previewPose.current ||
    !pose ||
    Math.abs(previewPose.current.t - pose.t) > 1e-6 ||
    normaliseDeg(previewPose.current.deg) !== normaliseDeg(pose.deg);

  const onPose = useCallback(
    (next, { commit } = {}) => {
      setPose(next);
      // The runner has USED the chooser. That is what ends the tutorial's
      // "choose where you want to claim" step: not a Next button, the real
      // dial. Only on commit, so a drag reports once rather than per frame.
      if (commit) {
        tutorialSignal(SIGNAL.CLAIM_ADJUSTED);
        requestPreview(next);
      }
    },
    [requestPreview, tutorialSignal]
  );

  // THIS RUN'S claim, which is not the same shape as the runner's territory:
  // a claim landing on ground they already hold is merged into it, and
  // `territory.rings` is then the whole merged holding — every block they have
  // taken around there, going back weeks. Anything on this screen that is
  // about the RUN outlines `claim_rings` instead, so what is drawn after the
  // claim is the same shape that was drawn while it was still being placed.
  const rings = captured
    ? (claim.claim_rings?.length
        ? claim.claim_rings
        : (t.rings?.length ? t.rings : [t.polygon]))
    : [path.map((p) => [p.longitude, p.latitude])];

  // The runner's territory, on the other hand, IS the merged shape — that is
  // what the permanent map fill under the reveal hands off to.
  const heldRings = captured ? (t.rings?.length ? t.rings : [t.polygon]) : [];

  // The held ground as map points — the permanent Mapbox fill the reveal hands
  // off to. Outer ring only; a claim shape never has holes.
  const claimedPoints = useMemo(
    () =>
      captured && heldRings[0]?.length >= 3
        ? heldRings[0].map(([lon, lat]) => ({ latitude: lat, longitude: lon }))
        : null,
    [captured, heldRings]
  );

  // What the share card outlines: the claim, before and after it lands. It is
  // the same shape either way now — a card about one run should not silently
  // become a picture of everything the runner owns the moment they press the
  // button. Never `rings` alone, which falls back to the route itself — that
  // would draw the trail twice.
  const shareRings = useMemo(() => {
    if (captured && rings[0]?.length >= 3) return rings;
    return claimRing ? [claimRing] : null;
  }, [captured, rings, claimRing]);

  // What this run WON. Not `territory.area_m2`: that is the merged holding, so
  // a lap around a block the runner already owns would report their whole
  // estate as this morning's take. `gained_m2` is the part of the claim that
  // was not already theirs — the borders that actually moved — and
  // `reinforced_m2` is the rest, which is a real move (it stacks strength and
  // buys lifetime) but wins no ground. The fallback is for a backend too old
  // to send either.
  const gainedM2 = claim.gained_m2 != null ? claim.gained_m2 : (captured ? t.area_m2 : 0);
  const reinforcedM2 = claim.reinforced_m2 || 0;
  const heroAreaM2 = captured ? gainedM2 : claimArea;
  // A run reopened later brings the server's own splits: its stored route has
  // no timestamps to work them out from again.
  const splits = useMemo(
    () => (result.splits?.length ? result.splits : computeSplits(path)),
    [result.splits, path]
  );
  // RouteThumb (and `rings`) speak the feed's convention — [lon, lat] pairs.
  // The recorder's `path` is `{latitude, longitude}` objects instead, same
  // conversion RunShareCard already does for its own route drawing.
  const routeLonLat = useMemo(
    () => path
      .map((p) => [Number(p?.longitude), Number(p?.latitude)])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    [path]
  );
  const stolen = claim.stolen_m2 || 0;
  // Reopened later, the run's own payouts were banked and shown when it
  // finished. Only what the claim adds is new on this visit.
  const achievements = deferred ? [] : result.achievements || [];
  const xpGained = deferred ? 0 : result.xp_gained || 0;
  const coinsGained = deferred ? 0 : result.coins_gained || 0;
  const totalXp = xpGained + (claim.xp_gained || 0);

  // Where the run left this runner on the ladder. /end-run banks its XP before
  // it answers, so the total that comes back is the AFTER figure and the bar
  // works out where the run started by subtracting what it paid. Fetched
  // through the cache the finished run just invalidated, so the You tab gets
  // this for free. A failure only costs the bar its numbers — it draws the
  // empty track and the "+N XP" either way.
  const [xpTotal, setXpTotal] = useState(null);
  // What the claim had already paid by the time that total was read. Normally
  // nothing — the request goes out on mount, long before the claim button is
  // even enabled — but if the two ever cross, the server's total already holds
  // the claim's XP and adding it again below would count it twice.
  const claimRef = useRef(claim);
  claimRef.current = claim;
  useEffect(() => {
    let alive = true;
    fetchAndCache('me:progression', api.progression)
      .then((p) => {
        if (!alive || typeof p?.xp !== 'number') return;
        setXpTotal(p.xp);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // The claim does NOT pay again (XP moved to separate screen).
  const xpTotalNow = xpTotal;

  // The rest of the run, beyond the three numbers this screen always had.
  const elevation = useMemo(() => elevationChangeM(path), [path]);
  const elevationM = elevation.gain;
  const bestKmSeconds = useMemo(
    () => (splits.length ? Math.min(...splits.map((s) => s.seconds)) : null),
    [splits]
  );
  const consistencySeconds = useMemo(() => paceConsistencySeconds(splits), [splits]);
  const climbPerKm =
    elevationM != null && result.distance_m > 0
      ? elevationM / (result.distance_m / 1000)
      : null;
  // The second stat row, as data rather than as four hand-written JSX blocks.
  // Both branches of the PRO gate read this: unlocked it becomes QuietStats,
  // locked it becomes the frosted preview inside the lock, and they cannot
  // drift apart into a lock that advertises stats the feature does not have.
  const advancedStats = useMemo(
    () => [
      {
        label: 'Best km',
        value: bestKmSeconds ? paceStr(bestKmSeconds) : '·',
        unit: bestKmSeconds ? '/km' : undefined,
      },
      {
        label: 'Elev gain',
        value: elevationM == null ? '·' : String(Math.round(elevationM)),
        unit: elevationM == null ? undefined : 'm',
      },
      {
        label: 'Climb / km',
        value: climbPerKm == null ? '·' : String(Math.round(climbPerKm)),
        unit: climbPerKm == null ? undefined : 'm/km',
      },
      {
        label: 'Consistency',
        value: consistencySeconds == null ? '·' : `±${paceStr(consistencySeconds)}`,
        unit: consistencySeconds == null ? undefined : '/km',
      },
    ],
    [bestKmSeconds, elevationM, climbPerKm, consistencySeconds]
  );
  // Same formula RunningScreen shows live (defaultWeightKg — no per-runner
  // weight is collected), so the number a runner sees mid-run and the one on
  // this recap always agree.
  const caloriesKcal = Math.round(1.036 * runTuning.defaultWeightKg * (result.distance_m / 1000));

  // Everything the share card COULD show. Which of it actually appears is the
  // runner's own choice in the sheet, so a metric missing here is one they
  // cannot switch on at all. Memoised because the sheet derives its stat chips
  // from this object.
  const shareRun = useMemo(
    () => ({
      runId: result.run_id,
      distanceM: result.distance_m,
      durationS: result.duration_s,
      areaM2: heroAreaM2,
      elevationM,
      climbPerKm,
      bestKmSeconds,
      consistencySeconds,
      claimed: captured,
    }),
    [
      result.run_id,
      result.distance_m,
      result.duration_s,
      heroAreaM2,
      elevationM,
      climbPerKm,
      bestKmSeconds,
      consistencySeconds,
      captured,
    ]
  );

  // What the hero number means. The old copy assumed the only reason a claim
  // could be missing was a short run, so a 2.28 km run whose SHAPE the server
  // never sent was told to "run a little further" — which is both wrong and
  // unactionable. Each state now says the true thing.
  //
  // "new ground" and not "claimed" once a claim has landed, because the number
  // above it is now what the run WON: a claim dropped on land the runner
  // already held wins nothing, and calling that "claimed" was the whole
  // misreading — it invited the merged holding to be the number.
  // Under a square metre is a rounding artefact, not a border that moved.
  const wonGround = gainedM2 >= 1;
  // How long the land waits if the runner puts the attack off. Also how the
  // recap tells land that lapsed from land the server never shaped.
  const claimExpiry = claimTimeLeft(result.claim_expires_at);
  const heroCaption = captured
    ? (wonGround ? 'new ground' : 'no new ground, this one reinforced')
    : canPlace
    ? 'ground waiting to be claimed'
    : claimArea > 0 && claimExpiry.expired
    ? 'the land from this run expired'
    : claimArea > 0
    ? 'this run earned ground, but the server sent no shape for it'
    : 'run a little further to earn a claim';
  // Celebrate the finish once, on mount. Not on a later visit to place the
  // land: nothing has just finished, and the claim has its own celebration.
  const [showConfetti, setShowConfetti] = useState(!deferred);
  useEffect(() => {
    if (deferred) return undefined;
    haptic.success();
    const id = setTimeout(() => setShowConfetti(false), 2800);
    return () => clearTimeout(id);
  }, [deferred]);

  // --- PASERBY ---------------------------------------------------------
  // Who this run crossed. Asked for on mount and left to land while the claim
  // sequence plays, so the beat at the end of it opens on data it already has.
  // The request also forces the match server-side if the background task
  // hasn't got there yet, which is why it is worth making early rather than at
  // the moment it is needed.
  const [crossed, setCrossed] = useState(null);
  const [crossedOpen, setCrossedOpen] = useState(false);
  // THE LEVEL A RUN CROSSED, held until there is room to celebrate it.
  //
  // The XP bar is the only thing that knows a boundary was crossed — it is
  // handed totals, and the crossing is a fact about the JOURNEY between them —
  // so it announces and this screen decides when the moment plays. That
  // separation is the whole reason the celebration can wait: this screen has a
  // queue of overlays (the payoff, the standings wipe, crossed paths) and two
  // celebrations on screen at once is a mess rather than a bigger party.
  //
  // ONE moment per run, at the level actually landed on. A run that crosses two
  // levels fires this twice within the bar's ~900ms travel, and the second
  // arrives while the first is still queued: `Math.max` keeps the one that
  // means something. `celebratedLevel` is what stops a dismissed celebration
  // from being re-armed by a late gain (the claim's XP lands after the run's).
  //
  // Held as `{ level, from }`. `from` is where the runner stood before the
  // first boundary this moment covers, and it is kept when a later crossing
  // raises the level, so a run that crosses two levels counts up from the
  // number it really started at rather than from the one below the last.
  const [levelUp, setLevelUp] = useState(null);
  const celebratedLevel = useRef(0);
  const onLevelUp = useCallback((reached, left) => {
    if (!(reached > celebratedLevel.current)) return;
    celebratedLevel.current = reached;
    setLevelUp((prev) => (
      prev == null
        ? { level: reached, from: left ?? reached - 1 }
        : { level: Math.max(prev.level, reached), from: prev.from }
    ));
  }, []);
  // Stable while the modal is open. LevelUpCelebration owns a timer and an
  // animation effect; an inline lambda here changed identity on every result
  // screen render and restarted both (including its haptic) mid-celebration.
  const closeLevelUp = useCallback(() => setLevelUp(null), []);

  // PROMOTION. The server decides whether the claim crossed a tier (see
  // `rank_up` on ClaimResult) — the client never compares thresholds itself,
  // because two copies of the ladder is how an app celebrates a promotion that
  // did not happen.
  //
  // Held in state rather than read straight off `claim` so dismissing it
  // sticks: the claim object is still there afterwards, and gating on it alone
  // would put the ceremony back on screen at the next render.
  const [rankUp, setRankUp] = useState(null);
  const rankUpShown = useRef(false);
  useEffect(() => {
    if (rankUpShown.current || !claim?.rank_up) return;
    rankUpShown.current = true;
    setRankUp({
      from: standingFrom({ key: claim.rank_key_before }),
      to: standingFrom({
        key: claim.rank_key_after,
        points: claim.solo_elo,
      }),
    });
  }, [claim?.rank_up, claim?.rank_key_before, claim?.rank_key_after, claim?.solo_elo]);
  const closeRankUp = useCallback(() => setRankUp(null), []);

  // --- what the tutorial is allowed to say, and when ----------------------
  //
  // `claimReady`      there are real controls on screen to be taught. Not the
  //                   moment the screen opens: the shape has to have arrived.
  // `claimCelebrated` the WHOLE celebration is over — flyover, encounter,
  //                   reveal, victory, payoff, standings — and the recap is
  //                   what is on screen. The "it's yours" card waits for this
  //                   so it can never land on top of the cutscene, and waits
  //                   for crossed paths to close too, for the same reason.
  useEffect(() => {
    setTutorialFacts({
      claimReady: canPlace && !!options && !!pose,
      claimCelebrated: captured && stage === STAGE.SUMMARY && !crossedOpen,
    });
  }, [setTutorialFacts, canPlace, options, pose, captured, stage, crossedOpen]);

  // NOTHING TO CLAIM, or the shape never arrived. Either way this run cannot
  // teach the claim, so the tutorial rewinds to "start a run" and waits for
  // one that can. It never gets stuck pointing at a sheet that is not there.
  useEffect(() => {
    if (captured || deferred) return undefined;
    if (claimArea <= 0) {
      tutorialSignal(SIGNAL.CLAIM_UNAVAILABLE);
      return undefined;
    }
    // A slow options request is not a failure. This is the outside edge of
    // "it is coming": past it, the sheet is showing its fallback and there is
    // no chooser to teach.
    if (options) return undefined;
    const timer = setTimeout(() => tutorialSignal(SIGNAL.CLAIM_UNAVAILABLE), CLAIM_TEACHABLE_MS);
    return () => clearTimeout(timer);
  }, [captured, deferred, claimArea, options, tutorialSignal]);

  // DEMOTION, the other way round: a failed claim that costs enough points to
  // cross a floor. Same server flag, same reasoning as `rank_up` above.
  const [rankDown, setRankDown] = useState(null);
  const rankDownShown = useRef(false);
  useEffect(() => {
    if (rankDownShown.current || !claim?.rank_down) return;
    rankDownShown.current = true;
    setRankDown({
      from: standingFrom({ key: claim.rank_key_before }),
      to: standingFrom({ key: claim.rank_key_after, points: claim.solo_elo }),
    });
  }, [claim?.rank_down, claim?.rank_key_before, claim?.rank_key_after, claim?.solo_elo]);
  const closeRankDown = useCallback(() => setRankDown(null), []);

  // Either way, THIS screen is where the runner saw the tier change, so the
  // return-to-app check (RankDropWatcher) must not tell them about it again.
  useEffect(() => {
    if (claim?.rank_key_after && (claim.rank_up || claim.rank_down)) {
      writeSeenRank(user?.id, claim.rank_key_after);
    }
  }, [claim?.rank_up, claim?.rank_down, claim?.rank_key_after, user?.id]);
  const [crossedDone, setCrossedDone] = useState(false);
  const [highFiving, setHighFiving] = useState(false);
  const [highFivedAll, setHighFivedAll] = useState(false);
  useEffect(() => {
    // Crossed paths belong to the moment the run finished, and were shown
    // then. A later visit to place the land does not replay them.
    if (!result.run_id || deferred) return undefined;
    let alive = true;
    api
      .paserbyReveal(result.run_id)
      .then((d) => {
        if (!alive) return;
        setCrossed(d);
        // Warm the plaza only if it is going to be shown. The backdrop is a
        // full-window image and the beat fades straight into it, so decoding
        // it while the claim sequence is still playing is the difference
        // between a scene and a flash of blue.
        if ((d?.encounters || []).length) preloadScreenImages('Crossroads');
      })
      // Silent: nobody to cross paths with is the normal case, and a failure
      // here must never disturb the run's own result.
      .catch(() => {});
    return () => { alive = false; };
  }, [result.run_id, deferred]);

  const placeClaim = async () => {
    if (!center || claiming || !canPlace) return;
    setClaiming(true);
    try {
      haptic.medium(); // Stronger haptic for claim submission
      // Only the POSE travels — where along the route the claim's centre sits
      // and which way it faces. The server regrows the same shape from the
      // stored route and moves it rigidly to that pose, so the ground claimed
      // is always built from the run that earned it, at the size it earned.
      const out = await api.claimTerritory(
        result.run_id,
        pose ? pose.t : null,
        pose ? pose.deg : null
      );
      setClaim({
        territory: out.territory,
        stolen_m2: out.stolen_m2 || 0,
        stolen_from: out.stolen_from || null,
        xp_gained: out.xp_gained || 0,
        // What the claim DID, as against what the runner now holds: the ground
        // it won, the ground it only reinforced, and its own footprint.
        gained_m2: out.gained_m2 ?? null,
        reinforced_m2: out.reinforced_m2 || 0,
        claim_rings: out.claim_rings?.length ? out.claim_rings : null,
      });
      // The claim landed. The tutorial's payoff waits on the celebration
      // below finishing, not on this line — see `claimCelebrated`.
      tutorialSignal(SIGNAL.CLAIM_PLACED);
      if (out.energy_max) setEnergyStatus((s) => ({ ...(s || {}), energy: out.energy, energy_max: out.energy_max }));
      // Land changed hands: territory, energy, rivalries, club totals and every
      // board are now wrong in the cache. Drop them so the tabs behind this
      // screen rebuild from the server rather than from before the claim.
      invalidateAfterClaim();
      // ...and this run's own page, which offers the claim while it waits.
      invalidate(`run:${result.run_id}`);
      // The payoff carries the celebration now — no toast on top of it. It is
      // held here but only shown when the sequence reaches its payoff phase.
      setPayoff({ ...out, center });
      // Watch the run play back in 3D, then the ground change hands: flyover,
      // camera flight, capture encounter, radial reveal, victory beat. `path`
      // is what the flyover follows — without it the replay is skipped and the
      // sequence opens on the focus flight as it used to.
      await seq.start(out, center, { path });
    } catch (e) {
      if (e.status === 402) {
        // Out of energy — send them straight to the refill shop.
        refreshEnergy();
        toast.error(e.message || 'Not enough energy to claim.');
        if (IAP_ENABLED) setShopOpen(true);
      } else {
        // Unmissable — a silent failure here looks like a dead button.
        Alert.alert('Could not place your claim', e.message || 'Check your connection and try again.');
      }
    } finally {
      setClaiming(false);
    }
  };

  // The celebration ends here, however it ends. The rivalry banner is fired on
  // the way out rather than during the sequence: the payoff already owns the
  // whole screen, and a notification stacked on top of a full-screen
  // celebration is noise. By the time this runs the runner is back on a normal
  // screen, which is exactly when a "tap to see the rivalry" prompt can be
  // acted on.
  const endCelebration = () => {
    seq.complete();
    // The claim is over, so the claim stage is over: the recap is what should
    // be underneath whatever overlay closes last. Set before those overlays
    // are opened, not after, so dismissing one lands on the summary rather
    // than back on a spent map.
    setStage(STAGE.SUMMARY);
    // PASERBY goes LAST, and only if this run actually crossed somebody. It is
    // a separate overlay rather than a phase of the claim sequence on purpose:
    // a run that met nobody must end exactly the way it always did, and the
    // territory / payoff / standings beats above are untouched either way.
    if (!crossedDone && shouldReveal(crossed)) {
      setCrossedOpen(true);
      return;
    }
    rivalPopup.show({ victims: payoff?.victims, myAvatar: equipped });
  };

  const goToRankProgression = () => {
    navigation.navigate('Tabs', {
      screen: 'Home',
      params: {
        screen: 'RankProgression',
        params: { 
          claim: payoff,
          runXpTotal: xpTotal,
          runXpGained: xpGained,
        },
      },
    });
  };

  const closeCrossed = ({ silent = false } = {}) => {
    setCrossedOpen(false);
    setCrossedDone(true);
    // Looking at them IS seeing them — clear the Home badge for exactly the
    // ones that were on screen.
    const ids = (crossed?.encounters || []).map((e) => e.id);
    if (ids.length) api.markPaserbySeen(ids).catch(() => {});
    invalidate('me:paserby');
    // The rivalry prompt was waiting behind this; fire it now, unless we're
    // leaving for another screen.
    if (!silent && payoff) rivalPopup.show({ victims: payoff?.victims, myAvatar: equipped });
  };

  const highFiveAll = async () => {
    setHighFiving(true);
    try {
      // One request each, and a failure on one must not lose the others — the
      // server rejects a duplicate anyway, so the worst case is a no-op.
      await Promise.all(
        (crossed?.encounters || []).map((e) => api.highFive(e.id).catch(() => {}))
      );
      haptic.success();
      setHighFivedAll(true);
    } finally {
      setHighFiving(false);
    }
  };

  // Where leaving goes. After a run this screen sits inside the Record modal,
  // and leaving closes the whole modal; reopened later it is a screen of its
  // own at the root (PlanAttackScreen), and leaving is just going back.
  const closeScreen = () => {
    if (deferred) navigation.goBack();
    else navigation.getParent()?.goBack();
  };

  // Leaving the result screen: the crossed-paths beat is owed to the runner
  // even when they never claimed, so it plays before the screen closes.
  //
  // ONE OVERLAY AT A TIME. This used to open the plaza while leaving `stage` on
  // SHARE, so the crossed-paths modal was presented on top of the share modal —
  // and the share sheet is the one opaque, full-screen Modal in the app, which
  // makes that stack a native present-on-a-presenting-controller rather than
  // two views. Dropping back to the recap first means the plaza always has the
  // screen to itself.
  const leaveResult = () => {
    if (!crossedDone && shouldReveal(crossed)) {
      setStage(STAGE.SUMMARY);
      setCrossedOpen(true);
      return;
    }
    closeScreen();
  };

  // --- stages ---------------------------------------------------------
  //
  // CLAIM owns the whole screen because it is a map decision and needs the
  // map; SUMMARY scrolls; SHARE is last, the final beat before Home. The
  // stage is state rather than three navigator screens because every one of
  // them reads the same claim, sequence, payoff and crossed-paths state, and
  // routing that between screens would mean either duplicating it or
  // threading it through params.
  // "Plan later": leave the land unplaced. It waits (the server holds it for
  // `claim_defer_hours` after the run) and Home offers it back. After a run
  // that means carrying on to the recap, which offers a way back in too; on a
  // visit made only to place it there is nothing else here, so it closes.
  const planLater = () => {
    haptic.light();
    if (deferred) closeScreen();
    else setStage(STAGE.SUMMARY);
  };
  // From the recap back to the map (ToonButton does its own haptic). The map
  // mounts afresh, so the camera has to be framed on the neighbourhood again
  // rather than left wherever it happens to open.
  const backToPlanning = () => {
    fitted.current = false;
    setStage(STAGE.CLAIM);
  };
  const goToShare = () => {
    haptic.light();
    // DIAGNOSTIC — the claim sequence just behind this transition is the
    // heaviest thing in the app (map, capture-style effects, every cosmetic
    // layer on every character in the scene), and expo-image's memory cache
    // is deliberately built to keep all of it decoded and resident after
    // those views unmount — see ui/image.js. The share screen crashes on
    // open with a native OOM-shaped signature (EXC_BAD_ACCESS, ~150MB free
    // at the time) that survived removing the share card's own character
    // preview, so the next thing to rule out is that residual cache rather
    // than anything the share screen renders itself.
    Image.clearMemoryCache?.();
    setStage(STAGE.SHARE);
  };


  // ---------------------------------------------------------------------
  // STAGE 1 — the claim.
  //
  // Full screen, map behind, controls in a sheet under it. The map is NOT in a
  // scroll view: this is a step where the runner has to look around, and a map
  // that hands its vertical drags to a parent scroller cannot be looked around
  // in. That is also why the recap is a separate stage rather than living
  // below this one on the same page.
  // ---------------------------------------------------------------------
  if (stage === STAGE.CLAIM) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{ flex: 1 }}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setMapBox((b) =>
              b && b.width === width && b.height === height ? b : { width, height }
            );
          }}
        >
          {MAP_READY ? (
            <GameMap
              ref={mapRef}
              initialCenter={center || path[0]}
              initialZoom={13}
              locked={seq.mapLocked}
              onIdle={fitToNeighbourhood}
            >
              {/* BOTTOM: BASE MAP - rendered by Mapbox */}
              
              {/* LEVEL 5: ALL OTHER TERRITORIES - de-emphasized during claim planning */}
              <TerritoryLayer id="r-board" featureCollection={boardFC} dark={scheme === 'dark'} overview={true} />
              
              {/* LEVEL 4: RELEVANT ENEMY TERRITORY */}
              {/* LEVEL 3: MY EXISTING TERRITORY */}
              
              {/* LEVEL 2: CANDIDATE CLAIM FILL + OUTLINE */}
              {claimPoints && canPlace && (
                <TerritoryFill
                  id="r-claim"
                  points={claimPoints}
                  fillColor={team.stroke}
                  strokeColor={team.glow}
                  fillOpacity={0.22}
                  glow
                />
              )}
              
              {/* LEVEL 1: ROUTE - dual-stroke for visibility */}
              {/* Route casing - near-black */}
              <Trail
                id="r-trail-casing"
                points={replayTrail}
                color="#0a0a0a"
                width={8}
              />
              {/* Route bright line */}
              <Trail
                id="r-trail"
                points={replayTrail}
                color={trailGlowColor || team.stroke}
                width={4}
                glow
                glowColor={trailGlowColor || team.stroke}
              />
              
              {/* Placement handle visualization for Step 1 */}
              {claimStep === CLAIM_STEPS.PLACE && canPlace && replayTrail.length > 0 && (
                <UserMarker 
                  point={replayTrail[Math.floor((claimPoseForMap?.t || 0.5) * (replayTrail.length - 1))]}
                >
                  <Animated.View style={[styles.placementHandle, handleAnimatedStyle]}>
                    <View style={[styles.handleOuter, { borderColor: team.glow }]} />
                    <View style={[styles.handleInner, { backgroundColor: team.glow }]} />
                    <Text style={styles.handleIcon}>↔</Text>
                  </Animated.View>
                </UserMarker>
              )}
              
              {/* Rotation ring visualization for Step 2 */}
              {claimStep === CLAIM_STEPS.ROTATE && center && (
                <UserMarker point={center}>
                  <View style={styles.rotationRing}>
                    <View style={[styles.rotationCircle, { borderColor: team.glow }]} />
                    <View style={[
                      styles.rotationIndicator,
                      { 
                        borderColor: team.glow,
                        transform: [{ rotate: `${claimPoseForMap?.deg || 0}deg` }]
                      }
                    ]}>
                      <View style={styles.rotationArrow} />
                    </View>
                    <Text style={styles.rotationIcon}>↻</Text>
                  </View>
                </UserMarker>
              )}
              {/* The permanent territory, switched on as the reveal lands.
                  DO NOT fade this in. It appears UNDER the reveal canvas,
                  which is drawing the same polygon at the same 0.42 fill, and
                  the handoff is invisible precisely because both are at full
                  strength when the overlay is pulled 260ms later. Easing this
                  one up makes the territory dip as the overlay clears. */}
              {seq.showPermanentTerritory && claimedPoints && (
                <TerritoryFill
                  id="r-final"
                  points={claimedPoints}
                  fillColor={team.stroke}
                  strokeColor={team.glow}
                  fillOpacity={0.42}
                  glow
                />
              )}
              {/* owner portrait on every plot — stays on the land they still
                  hold even after a slice is taken (largest-ring centroid) */}
              {boardPortraits.map((m) => (
                <UserMarker key={m.id} point={m.at}>
                  <CharacterBust equipped={m.avatar} size={28} ring={m.ring} bg={colors.cardAlt} />
                </UserMarker>
              ))}
              {/* your portrait marks the centre of the claim */}
              {center && (
                <UserMarker point={center}>
                  <CharacterBust equipped={equipped} size={36} ring={team.glow} bg={colors.cardAlt} />
                </UserMarker>
              )}
            </GameMap>
          ) : (
            <View style={styles.mapMissing}>
              <Text style={styles.mapMissingText}>
                The live map needs a development build. Your claim still works.
              </Text>
            </View>
          )}

          {/* Everything below is screen-space, pinned exactly over the map it
              was projected against, and all of it is pointerEvents none — the
              map must never gain an invisible lid.

              It is also all inside ONE stage. A capture style's camera cues
              (zoom, whip, tilt) and its shakes transform this wrapper, so the
              reveal, the actor and the sprites move together. When the shake
              lived inside the effects player instead, an impact rattled the
              art while the ground it was standing on held perfectly still.

              The real Mapbox camera is deliberately NOT what moves: the reveal
              is screen-space, projected once from a levelled, stopped camera,
              and moving the camera after that invalidates every pixel of it —
              see useCaptureStage for the full note. */}
          <Animated.View
            style={[StyleSheet.absoluteFill, captureStage.style]}
            pointerEvents="none"
          >
            {/* Direct contact, and ONLY when the playing style asked for it.
                This used to run in front of every claim, which is why a meteor
                opened with a shoulder-check. Sword Slash and Angel vs Demon
                emit a `contact` step; nothing else can, and validation
                rejects one outside a duel. */}
            {seq.showEncounter && (
              <CaptureEncounter
                visible
                variant={seq.variant}
                claimScreenPoint={seq.projection?.claimPoint}
                contactPoint={contactPoint}
                bounds={mapBox}
                onImpact={seq.onImpact}
                onComplete={seq.onEncounterComplete}
                reducedMotion={reducedMotion}
                playToken={seq.playToken}
              />
            )}

            {/* the ground turning over, however this style turns it over */}
            {seq.reveal && (
              <TerritoryRevealCanvas
                rings={seq.reveal.rings}
                claimPoint={seq.reveal.claimPoint}
                fillColor={captureTeam.stroke}
                strokeColor={captureTeam.glow}
                // The map's own box, so the reveal can blow the shape up to
                // fill it and centre it — the same pixel space the capture
                // encounter and the victory beat are laid out in.
                bounds={mapBox}
                reduced={reducedMotion}
                playToken={seq.playToken}
                transition={seq.revealSpec?.transition}
                origin={revealOrigin}
                duration={seq.revealSpec?.duration}
              />
            )}

            {/* A black stage behind the cast, up until the defenders actually
                START LEAVING (`defendersExiting`, set from the style's own
                `onCharacterAction` callback below) — not the reveal phase
                transition, which fires earlier. The ground changing colour
                and the rival fleeing it are meant to read as one payoff
                uncovered together, not the black lifting before either has
                happened. `showCaptureStyle` already exactly brackets when
                this cutscene is mounted (POST_REVEAL_BUDGET guarantees every
                style's exit beat fires before it goes false), so that alone
                is the "on" condition. See CutsceneBackdrop's own header for
                why this is a real sibling of CaptureCast rather than another
                environment primitive inside CaptureStylePlayer.

                RETUNED: it is no longer a black stage and no longer gated on
                the exit. It is a scrim UNDER the territory reveal that leaves
                the contested map readable at about a third of its normal
                presence, and it lifts at the HANDOFF — once the wipe has
                finished and the permanent fill has taken over. The old version
                was opaque and sat ABOVE the reveal, so the ground changing
                hands happened behind a curtain that only rose afterwards. */}
            {seq.showCaptureStyle && (
              <CutsceneBackdrop
                active={!atOrAfter(seq.phase, CLAIM_PHASE.TERRITORY_HANDOFF)}
                playToken={seq.playToken}
                reducedMotion={reducedMotion}
              />
            )}

            {/* EVERYBODY in this claim: the runner, and every rival the claim
                returned. Mounted for the whole cutscene and never removed by
                the screen — each one leaves when their own choreography says
                they leave. Owned here rather than inside the player so the
                cast can sit between the reveal and the foreground art: the
                effect a character causes should read as being in front of
                them, and the ground under both. */}
            {seq.showCast && seq.projection?.claimPoint && (
              <CaptureCast
                ref={castRef}
                attacker={equipped}
                attackerPoint={seq.projection.claimPoint}
                defenders={seq.defenders}
                defenderRects={defenderRects}
                bounds={mapBox}
                reducedMotion={reducedMotion}
                fadeIn={reducedMotion ? 0 : 140}
              />
            )}

            {/* The cutscene itself. Every visual step is optional: capture
                success and the SVG territory reveal do not depend on this
                layer, and an asset failure removes only its own step. */}
            {seq.showCaptureStyle && (
              <CaptureStylePlayer
                style={seq.captureStyle}
                playToken={seq.playToken}
                bounds={mapBox}
                claimPoint={seq.projection?.claimPoint}
                territoryRings={seq.projection?.rings}
                characterRect={captureCharacterRect}
                defenderRects={defenderRects}
                defenderCount={seq.defenderCount}
                safeInsets={captureSafeInsets}
                reducedMotion={seq.reducedMotion}
                seed={seq.castSeed}
                timeScale={seq.timeScale}
                // The claim's own colours, so a crack glowing through the
                // ground glows in the colour it is about to become.
                tint={captureTeam.stroke}
                ink={captureTeam.glow}
                onTerritoryReveal={seq.onCaptureRevealCue}
                onCharacterAction={handleCharacterAction}
                onContact={seq.onContact}
                stage={captureStage}
                cast={castRef}
              />
            )}
          </Animated.View>

          {/* standing on the ground they just took */}
          {seq.showVictory && (
            <TerritoryVictoryBeat
              visible
              attacker={equipped}
              rings={seq.projection?.rings}
              claimScreenPoint={seq.projection?.claimPoint}
              bounds={mapBox}
              label={victoryLabel(payoff)}
              victims={payoff?.victims || []}
              strokeColor={captureTeam.glow}
              reducedMotion={reducedMotion}
              playToken={seq.playToken}
            />
          )}

          {/* The heading, floating over the map rather than pushing it down —
              box-none so the map keeps every touch that is not on the text. */}
          <View
            style={[styles.claimHead, { paddingTop: insets.top + space.sm }]}
            pointerEvents="box-none"
          >
            <LinearGradient
              colors={[scheme === 'dark' ? withAlpha(colors.bg, 0.92) : 'rgba(255,255,255,0.94)', 'transparent']}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.claimHeadRow} pointerEvents="box-none">
              <View pointerEvents="none" style={{ flex: 1 }}>
                <Framed
                  frame={frameVariant('heading', 'place-your-territory')}
                  tint={team.stroke}
                  fill={withAlpha(colors.card, 0.96)}
                  weight={INK.thin}
                  pose={framePose('place-your-territory')}
                  inset={false}
                  style={styles.stepFrame}
                  contentStyle={styles.stepChip}
                >
                  <View style={[styles.stepDot, { backgroundColor: team.stroke }]} />
                  <Text style={[styles.stepChipText, { color: team.stroke }]}>
                    {!canPlace ? 'GROUND TAKEN' : 'PICK A SPOT'}
                  </Text>
                </Framed>
                <OutlinedText
                  style={[toonType.headline, styles.placeTitle]}
                  outline={toon.ink}
                  width={2.5}
                  align="left"
                  containerStyle={{ alignSelf: 'flex-start' }}
                >
                  {!canPlace ? 'Territory claimed' : 'Drop your land!'}
                </OutlinedText>
              </View>
              {/* The way out, for a runner who does not want to plan right
                  now. It was a muted "Later" in body text, floating over a
                  busy map, which read as a caption rather than a control, so
                  it wears the chip every other tap target here wears. Gone
                  while a claim is in flight or playing: that land is already
                  on its way. */}
              {canPlace && !seq.isRunning && !claiming && (
                <PressableScale
                  onPress={planLater}
                  accessibilityRole="button"
                  accessibilityLabel="Plan your attack later"
                  hitSlop={10}
                >
                  <Framed
                    frame={frameVariant('chip', 'plan-later')}
                    tint={toon.ink}
                    fill="#ffffff"
                    weight={INK.thin}
                    pose={framePose('plan-later')}
                    inset={false}
                    contentStyle={styles.laterChip}
                  >
                    <Text style={styles.laterText}>Plan later</Text>
                  </Framed>
                </PressableScale>
              )}
            </View>
            {canPlace && (
              // Just the conversion, in one weight and one colour. The
              // instructions that used to follow it said what the controls
              // below already say by being there, and the two coloured numbers
              // made a short line read as three different things.
              <Text style={styles.placeHint} pointerEvents="none">
                {(result.distance_m / 1000).toFixed(2)} km  →  {formatArea(claimArea)} of land
              </Text>
            )}
          </View>
        </View>

        {/* the controls, in their own sheet under the map */}
        {/* A cap, not a fixed height: the sheet wraps its content and only
            starts to scroll past this. Generous enough for the recommendation
            cards + rail + breakdown on a small phone; the map keeps the rest. */}
        {/* The tutorial lights this whole sheet for "choose where you want to
            claim": the dial AND the button, so a runner happy with where the
            land fell can simply claim it rather than being made to drag
            something first. */}
        <View
          style={[styles.claimSheet, { maxHeight: winHeight * 0.56 }]}
          {...claimSheetTarget}
          collapsable={false}
        >
          <ScrollView
            scrollEnabled={!claimControlActive}
            contentContainerStyle={[
              styles.claimSheetInner,
              { paddingBottom: insets.bottom + space.lg },
            ]}
            showsVerticalScrollIndicator={false}
            // The claim button is INSIDE this list, and onLayout does not fire
            // when a list scrolls under a view. This is the one target in the
            // app that has to be re-measured by hand.
            onScroll={remeasureTutorial}
            scrollEventThrottle={64}
          >
            {__DEV__ && payoff && (
              <DevSequenceControls sequence={seq} fallbackAvatar={equipped} />
            )}

            {/* Claim controls retire the moment the claim is away, and never
                come back — `canPlace` is false for good once the run is
                claimed, so the button cannot reappear behind the sequence. */}
            {canPlace && (
              <>
                {/* The shape takes a moment to grow. The map is already
                    showing the run and the exact ground a claim would take, so
                    this waits out loud instead of blanking the sheet. */}
                {!options && <ChooseAttackPending team={team} />}

                {canChoose && (
                  <TwoStepClaimFlow
                    options={options}
                    pose={pose}
                    onPose={onPose}
                    placement={preview}
                    stale={previewStale}
                    team={team}
                    onInteractionChange={setClaimControlActive}
                    disabled={claiming || seq.isRunning}
                    onStepChange={(step, currentPose) => {
                      setClaimStep(step);
                      setClaimPoseForMap(currentPose);
                    }}
                  />
                )}

                {/* Fallback while the options are still in flight, or if they
                    never landed: the client's own estimate of who is under the
                    resting placement. */}
                {!canChoose && claimingFrom.length > 0 && (
                  <View style={[styles.takeCard, { borderLeftColor: team.glow }]}>
                    <Text style={styles.takeEyebrow}>UNDER YOUR TERRITORY</Text>
                    <Text style={styles.takeTitle}>
                      Taking <Text style={{ color: team.glow }}>{formatArea(takingTotal)}</Text> from{' '}
                      {claimingFrom.length} runner{claimingFrom.length === 1 ? '' : 's'}
                    </Text>
                    {claimingFrom.slice(0, 4).map((r) => (
                      <View key={r.id} style={styles.takeRow}>
                        <CharacterBust equipped={r.avatar} size={26} ring={r.ring} bg={colors.cardAlt} />
                        <Text style={styles.takeName} numberOfLines={1}>
                          {r.clanTag ? `[${r.clanTag}] ` : ''}{r.username}
                        </Text>
                        <Text style={[styles.takeArea, { color: team.glow }]}>{formatArea(r.area)}</Text>
                      </View>
                    ))}
                    {claimingFrom.length > 4 && (
                      <Text style={[type.caption, { color: colors.textDim, marginTop: 4 }]}>
                        +{claimingFrom.length - 4} more
                      </Text>
                    )}
                  </View>
                )}

                {/* Energy gates claiming — tap the meter to refill. It is the
                    ONLY place the price appears now. It used to be on the
                    button as well, which made every decision on this screen
                    read as a purchase; the decision is about ground, and what
                    it costs is a fact about the account, not about the move. */}
                <View style={styles.claimFooter}>
                  <View style={styles.claimCost}>
                    <Text style={type.caption}>
                      {preview?.energy_cost ? `Costs ${preview.energy_cost} energy` : ''}
                    </Text>
                  </View>
                  {energyStatus && (
                    <EnergyMeter
                      compact
                      style={styles.claimEnergy}
                      status={energyStatus}
                      onPress={IAP_ENABLED ? () => setShopOpen(true) : undefined}
                    />
                  )}

                {/* "Looks good? Claim it." lights THIS button and lets the
                    press through to it. */}
                <View {...claimButtonTarget} collapsable={false}>
                  <ToonButton
                    title={claiming ? 'Claiming…' : 'CLAIM HERE'}
                    onPress={placeClaim}
                    loading={claiming}
                    disabled={claiming || seq.isRunning || moveBlocked}
                    size="sm"
                    containerStyle={styles.claimButtonWrap}
                    style={styles.claimButton}
                    fill={{ color: team.glow, colors: [team.glow, team.glow, team.glow], border: toon.ink }}
                  />
                </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>

        {IAP_ENABLED ? (
          <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={refreshEnergy} />
        ) : null}

        {/* the payoff: who you took it from, the XP, the level bar. Opens on
            the sequence's payoff phase — after the victory beat, not straight
            off the territory handoff. Its one action carries on INTO the
            standings (continueToLeaderboard), which is where the celebration
            ends; `onClose` is left for the Android back gesture. */}
        <ClaimPayoff
          visible={seq.showPayoff}
          claim={payoff}
          myAvatar={equipped}
          onClose={endCelebration}
          onViewLeaderboard={seq.continueToLeaderboard}
          onViewRankProgression={goToRankProgression}
        />

        {/* the standings, arriving behind a character-led wipe */}
        <LeaderboardTransition
          visible={seq.showLeaderboard}
          data={seq.leaderboard}
          attacker={equipped}
          reducedMotion={reducedMotion}
          playToken={seq.playToken}
          onDone={endCelebration}
        />

        <PaserbyReveal
          visible={crossedOpen}
          reveal={crossed}
          path={path}
          myAvatar={equipped}
          highFiving={highFiving}
          highFivedAll={highFivedAll}
          onHighFiveAll={highFiveAll}
          onViewCrossroads={() => {
            closeCrossed({ silent: true });
            navigation.navigate('Tabs', {
              screen: 'You',
              params: { screen: 'Crossroads', initial: false },
            });
          }}
          onContinue={closeCrossed}
        />

        {showConfetti && <Confetti />}
      </View>
    );
  }

  // ---------------------------------------------------------------------
  // STAGE 2 — the recap, and STAGE 3 — sharing, which is rendered over it as
  // a full-screen sheet so the last thing before Home is the share card.
  // ---------------------------------------------------------------------
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xxl }]}
    >

      {/* An activity that earned nothing has to SAY so — a result screen that
          silently pays zero reads as a bug, not as a rule. */}
      {qualificationReason ? (
        <Reveal from="up" style={styles.gateCard}>
          <Text style={styles.gateTitle}>
            {/* The tier is a full string — `unqualified_for_rewards`, not
                `unqualified`. Comparing against the short form meant this
                heading was ALWAYS "Too short to claim", including for the 20 m
                walk that in fact earned nothing at all. */}
            {result.tier === RUN_TIER.UNQUALIFIED
              ? 'No rewards for this one'
              : 'Too short to claim'}
          </Text>
          <Text style={styles.gateText}>{qualificationReason}</Text>
        </Reveal>
      ) : null}

      {/* A run whose public contribution is being withheld has to SAY something
          neutral. Reporting full success while the territory quietly reaches
          nobody reads as a broken server. This names no detector, no threshold
          and no evidence — the server deliberately sends only a state. */}
      {result.verification_state === 'pending' ? (
        <Reveal from="up" style={styles.gateCard}>
          <Text style={styles.gateTitle}>Run recorded</Text>
          <Text style={styles.gateText}>
            Competitive rewards for this one are still being verified.
          </Text>
        </Reveal>
      ) : null}

      {/* The land this run earned and the runner chose not to place yet. It
          waits, and this is the way back to the map; Home offers it too once
          the recap is closed. Only ever here after "Plan later": a claim that
          landed, or a run that earned nothing, has no land waiting. */}
      {canPlace && (
        <Reveal from="up" style={styles.waitingWrap}>
          <HardShadow radius={nbRadius.sm} accent={team.glow} style={styles.cardShadow}>
            <View style={styles.waitingCard}>
              <View style={styles.waitingText}>
                <Text style={[styles.waitingEyebrow, { color: team.glow }]}>LAND WAITING</Text>
                <Text style={styles.waitingTitle}>Plan your attack</Text>
                <Text style={styles.waitingNote}>
                  {claimExpiry.label ? `${claimExpiry.label} left, also on Home` : 'Waiting for you on Home'}
                </Text>
              </View>
              <ToonButton
                title="PLAN NOW"
                onPress={backToPlanning}
                size="sm"
                accessibilityLabel="Plan your attack now"
                containerStyle={styles.waitingButtonWrap}
                style={styles.claimButton}
                fill={{ color: team.glow, colors: [team.glow, team.glow, team.glow], border: toon.ink }}
              />
            </View>
          </HardShadow>
        </Reveal>
      )}

      {/* the shareable card */}
      <Reveal delay={canPlace ? 140 : 0}>
      {/* Accent on the clan's own colour, per the rule in theme/nb.js: on dark
          the drop is the one place the palette shouts, and if a clan colour
          and an accent ever meet, the clan wins. */}
      <HardShadow radius={nbRadius.sm} accent={team.glow} style={styles.cardShadow}>
      <View style={styles.card}>
        {hasRouteData({ rings, path: routeLonLat }) && (
          <View style={styles.polyWrapLarge}>
            <RouteThumb id={result.run_id} rings={rings} path={routeLonLat} color={team.glow} large />
          </View>
        )}

        <View style={styles.heroRow}>
          <CountUpText value={heroAreaM2} format={km2} style={[styles.heroArea, { color: team.glow }]} />
          <Text style={styles.heroUnit}> km²</Text>
        </View>
        <Text style={[styles.heroCaption, captured && wonGround && styles.heroCaptionStrong]}>
          {heroCaption}
        </Text>
        {/* The other half of the claim, said out loud rather than folded into
            the number above it. Ground the runner already held does not move a
            border, but it is not nothing either: it stacks the strength of
            that land and buys it more time before it decays. */}
        {captured && reinforcedM2 >= 1 && (
          <Text style={styles.heroSub}>
            plus {formatArea(reinforcedM2)} of your own land reinforced
          </Text>
        )}

        <View style={styles.quietRow}>
          <QuietStat label="Distance" value={(result.distance_m / 1000).toFixed(2)} unit="km" />
          <QuietStat label="Pace" value={formatPace(result.distance_m, result.duration_s)} />
          <QuietStat label="Duration" value={formatDuration(result.duration_s)} />
          <QuietStat label="Calories" value={String(caloriesKcal)} unit="kcal" />
        </View>

        {/* XP progression moved to dedicated RankProgressionScreen */}
        {/* Coins and other rewards can stay here */}

        {/* What the run paid, under the bar it just moved — coins used to sit
            above the whole card as a receipt with nothing to attach to. */}
        {coinsGained > 0 && (
          <Reveal from="up" delay={COINS_DELAY} style={styles.earnRow}>
            {/* THE PAYOUT, as a coin arriving rather than a line of text.
                This was a bare "+47 coins" that faded up with everything else
                on the card, which is the wrong shape for the one number on
                this screen that is spendable — a reward that reads exactly
                like a statistic is not a reward. It is a struck block now: a
                spinning coin, the number counting into it, and the whole thing
                popping in on a spring once the XP bar has come to rest. */}
            <Pop trigger={result.run_id} delay={COINS_DELAY}>
              <HardShadow
                offset={NB.offset}
                accent={nbAccents.yellow}
                radius={nbRadius.sm}
                style={styles.earnDrop}
              >
                <View style={styles.earnChip}>
                  {/* THE COIN, ON INK. It was a gold coin spinning directly on
                      the block's gold fill, which is the one background it
                      cannot be seen against — at 26pt it read as a pale dot
                      and the payout looked like a plain yellow label. The well
                      is the darkest thing on the card, so the coin is now the
                      first thing the eye lands on. */}
                  <View style={styles.earnCoin}>
                    <GameAnimation name="coinSpin" size={34} trigger={result.run_id} />
                  </View>
                  <View style={styles.earnAmount}>
                    <CountUpText
                      value={coinsGained}
                      from={0}
                      delay={COINS_DELAY}
                      format={fmtCoins}
                      style={styles.earnItem}
                    />
                    <Text style={styles.earnUnit}>coins</Text>
                  </View>
                </View>
              </HardShadow>
            </Pop>
            {(result.coins_capped || result.energy_capped) && (
              <Text style={styles.earnCapped}>daily cap reached</Text>
            )}
          </Reveal>
        )}

        {(captured || stolen > 0) && (
          <View style={styles.deltaRow}>
            {stolen > 0 ? (
              <Text style={[styles.deltaText, { color: team.glow }]}>
                Stole {formatArea(stolen)}{claim.stolen_from ? ` from ${claim.stolen_from}` : ''}
              </Text>
            ) : (
              <Text style={[styles.deltaText, { color: team.glow }]}>
                +{formatArea(heroAreaM2)}, now {label} holds more
              </Text>
            )}
          </View>
        )}

        <View style={styles.watermark}>
          <PaserMark size={18} color={colors.textDim} />
          <Text style={styles.watermarkText}>PASER</Text>
        </View>
      </View>
      </HardShadow>
      </Reveal>

      {/* PRs (Phase 6 fills achievements) */}
      {achievements.length > 0 && (
        <Reveal delay={220} style={styles.section}>
          <View style={styles.prHead}>
            <GameAnimation name="achievementBadge" size={62} trigger={result.run_id} />
            <Text style={styles.sectionTitle}>Personal records</Text>
          </View>
          <View style={styles.prWrap}>
            {achievements.map((a) => (
              // FLAT. The diagonal wash that used to sit behind each record is
              // the one device this style has no room for — "no gradient
              // anywhere" is a third of what makes it the style — and it was
              // also doing the work a stroke should: saying where the card
              // ends. The tint is now one solid step of the clan colour, and
              // the edge is a real line at full strength rather than a border
              // faded to 55%.
              <View key={a} style={[styles.prCard, { borderColor: nbInk(scheme, colors.cardAlt) }]}>
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(team.glow, 0.14) }]}
                />
                <View
                  style={[
                    styles.prIconWrap,
                    {
                      backgroundColor: withAlpha(team.glow, 0.3),
                      borderColor: nbInk(scheme, colors.cardAlt),
                    },
                  ]}
                >
                  <AppIcon name={recordIcon(a)} size={26} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prKicker}>NEW RECORD</Text>
                  <Text style={[styles.prText, { color: colors.text }]} numberOfLines={1}>
                    {a}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Reveal>
      )}

      {/* What the claim actually achieved, and where it leaves you on the
          board. Above the splits because it is about the GAME; the splits are
          about the run. Renders nothing when no ground was claimed. */}
      <Reveal delay={270}>
        {/* The only place the automatic PRO prompt is armed. See the prop's
            own note in TerritoryInsights — and it still has to get past the
            notable-run test and the exposure rules before anything opens. */}
        <TerritoryInsights
          runId={result.run_id}
          allowAutoPrompt
          hideClaimSummary
          style={styles.territoryReport}
        />
      </Reveal>

      {/* Combined PRO section for all advanced insights - splits and other stats */}
      {(splits.length > 0 || advancedStats.length > 0) && (
        <Reveal delay={300}>
          <ProLockedSection
            context="run_insights"
            feature="run_advanced"
            title="Advanced run insights"
            blurb="Splits, climbing data and pace analysis"
            peek={
              <View>
                {splits.length > 0 && (
                  <Splits splits={splits.slice(0, 4)} accent={team.glow} bare frosted />
                )}
                {advancedStats.length > 0 && (
                  <View style={[styles.quietRow, styles.quietRowTight]}>
                    {advancedStats.map((s) => (
                      <View key={s.label} style={styles.quietStat}>
                        <Text style={styles.quietLabel}>{s.label}</Text>
                        <View style={styles.quietValueRow}>
                          <ProFrosted style={styles.quietValue}>
                            {s.unit ? `${s.value} ${s.unit}` : s.value}
                          </ProFrosted>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            }
            style={{ marginTop: space.xl }}
          >
            <View>
              {splits.length > 0 && (
                <Splits splits={splits} accent={team.glow} />
              )}
              {advancedStats.length > 0 && (
                <View style={[styles.quietRow, styles.quietRowTight]}>
                  {advancedStats.map((s) => (
                    <QuietStat key={s.label} label={s.label} value={s.value} unit={s.unit} />
                  ))}
                </View>
              )}
            </View>
          </ProLockedSection>
        </Reveal>
      )}

      {/* One way on, because sharing is the NEXT STAGE rather than a button
          half way down this page. The escape hatch is on the share screen
          itself, which goes straight Home — so nobody is trapped into
          posting, but everybody is offered it once. */}
      {/* The same button the claim stage ends on, rather than a second CTA
          shape. It was a pink GRADIENT pill with a soft glow behind it — a
          gradient and a blur, which are the two devices this style has none
          of, on the last thing the runner touches before their card goes out.
          ToonButton is the flat fill, ink frame and hard drop everything else
          on the page now wears. */}
      <Reveal delay={380} style={styles.actions}>
        <ToonButton
          title="Continue"
          onPress={goToShare}
          disabled={claiming}
          accessibilityLabel="Continue to sharing"
        />
      </Reveal>

    </ScrollView>

    {/* STAGE 3 — the outward-facing card, story shaped and built for Instagram
        rather than cropped out of this screen. The last thing before Home: its
        Done goes back, sharing or not. */}
    <RunShareSheet
      // `&& !crossedOpen` for the same reason `leaveResult` drops the stage:
      // the plaza and the share card must never both be presented. The
      // condition is stated at BOTH ends because they are reached by different
      // routes — Done on the share card goes through leaveResult, but the
      // celebration can also finish straight into the plaza.
      visible={stage === STAGE.SHARE && !crossedOpen}
      onClose={leaveResult}
      closeLabel="Done"
      team={team}
      path={path}
      rings={shareRings}
      run={shareRun}
      // The runner's own avatar, to stand at the end of their route.
      equipped={equipped}
    />

    {/* CROSSED PATHS — the last beat, after the standings have been dismissed
        and only when this run turned somebody up. */}
    <PaserbyReveal
      visible={crossedOpen}
      reveal={crossed}
      path={path}
      myAvatar={equipped}
      highFiving={highFiving}
      highFivedAll={highFivedAll}
      onHighFiveAll={highFiveAll}
      onViewCrossroads={() => {
        closeCrossed({ silent: true });
        navigation.navigate('Tabs', {
          screen: 'You',
          // initial:false keeps the profile underneath, so Crossroads' back
          // button works and the You tab isn't stranded on a detail screen.
          params: { screen: 'Crossroads', initial: false },
        });
      }}
      onContinue={closeCrossed}
    />

    {/* THE LEVEL, once nothing else is celebrating. Gated on the other three
        overlays rather than racing them: the bar under the payoff can cross a
        boundary while the payoff itself is still on screen, and this must
        arrive after it rather than on top of it. */}
    <LevelUpCelebration
      visible={levelUp != null && !seq.showPayoff && !seq.showLeaderboard && !crossedOpen}
      level={levelUp?.level ?? null}
      from={levelUp?.from}
      equipped={equipped}
      accent={team.glow}
      onClose={closeLevelUp}
    />

    {/* THE RANK, last of all. It is the biggest of these moments and it takes
        the whole screen, so it queues behind every other overlay INCLUDING the
        level — two full screen celebrations racing is not a bigger party. */}
    <RankUpCeremony
      visible={
        rankUp != null && levelUp == null
        && !seq.showPayoff && !seq.showLeaderboard && !crossedOpen
      }
      from={rankUp?.from}
      to={rankUp?.to}
      equipped={equipped}
      onDone={closeRankUp}
    />

    {/* A claim can only move the tier one way, so this never races the
        promotion; it queues behind the same overlays for the same reason. */}
    <RankDownCeremony
      visible={
        rankDown != null && rankUp == null && levelUp == null
        && !seq.showPayoff && !seq.showLeaderboard && !crossedOpen
      }
      from={rankDown?.from}
      to={rankDown?.to}
      equipped={equipped}
      onDone={closeRankDown}
    />

    {showConfetti && <Confetti />}
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  territoryReport: { marginTop: space.xl, marginRight: NB.offset },

  // A notice, not a card: the stroke goes all the way round at the thin
  // weight, so it reads as a boxed aside rather than as another panel
  // competing with the claim. The left rule alone was the web-form idiom this
  // style replaces.
  gateCard: {
    backgroundColor: colors.cardAlt,
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.cardAlt),
    padding: space.md,
    marginBottom: space.md,
  },
  gateTitle: { ...type.bodySmBold, color: colors.text, marginBottom: 2 },
  gateText: { ...type.bodySm, color: colors.textMuted },

  // Was a standalone row above the card; now sits inside it, under the XP
  // bar it's the other half of the payoff for — centred like the rest of the
  // card's content instead of left-aligned like a floating receipt.
  earnRow: {
    flexDirection: 'row',
    // Stretched, or the card's own centring shrinks this to its content and
    // `flexWrap` has no width to wrap against.
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    // The block got wider, and the cap note sits beside it. On a narrow phone
    // the two together are wider than the card, so let the note drop under
    // rather than squeezing the payout.
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.lg,
  },
  // A struck block of coin gold: flat fill, heavy stroke, hard drop. The one
  // saturated non-clan colour on the card, and it is spending the deck's
  // yellow the way theme/nb.js says chrome may — this is currency, not
  // territory, so it does not have to be the runner's clan colour.
  //
  // Sized like a reward rather than like a chip. At 17pt beside a 44pt hero
  // area the payout was the smallest number in the card it was supposed to be
  // the payoff of; it is the second-largest now, and it is the only one on an
  // inverted ground.
  earnChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: nbAccents.yellow,
    borderWidth: NB.stroke,
    borderColor: NB.ink,
    borderRadius: nbRadius.sm,
    paddingLeft: 7,
    paddingRight: space.lg,
    paddingVertical: 7,
  },
  // Reserve for the drop, symmetric so the block stays optically centred in a
  // card that centres its contents.
  earnDrop: { marginBottom: NB.offset, marginLeft: NB.offset, marginRight: NB.offset },
  // The dark well the coin spins in. A circle, because a coin in a rounded
  // rectangle reads as a token in a slot.
  earnCoin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NB.ink,
    overflow: 'hidden',
  },
  // Number over unit, so the unit does not push the amount off centre and the
  // amount gets the full height of the block.
  earnAmount: { alignItems: 'flex-start' },
  earnItem: { ...type.stat, color: nbTextOn(nbAccents.yellow) },
  earnUnit: {
    ...type.labelSm,
    color: nbTextOn(nbAccents.yellow),
    letterSpacing: 1.2,
    opacity: 0.8,
    marginTop: -2,
  },
  earnCapped: { ...type.caption, color: colors.textDim },

  // The claim card is the centrepiece of the whole post-run screen, so it wears
  // the game's own surface (ink outline, hard shadow, outlined display type)
  // instead of the plain settings-style card it used to be.
  // --- the claim stage ---------------------------------------------------
  // The map is the screen here, so the heading floats over it behind a
  // gradient rather than taking a band of its own. `box-none` on the container
  // and `none` on the text keeps every touch that is not the Later button
  // going to the map underneath, which is the whole point of this stage.
  claimHead: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: CAPTURE_LAYER.UI,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  claimHeadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  // "Plan later": the chip every tap target in this style wears, white with
  // an ink edge, so it reads as a control over any map, not as a caption.
  laterChip: { paddingHorizontal: space.md, paddingVertical: 7 },
  laterText: { ...type.buttonSm, color: '#141414' },
  // ...and the way back, on the recap: the land still waiting, and a button
  // to the map. A full stroke like the recap card under it, because it is a
  // thing to act on rather than an aside.
  waitingWrap: { marginBottom: space.md },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: nbRadius.sm,
    borderWidth: NB.stroke,
    borderColor: nbInk(scheme, colors.card),
    padding: space.md,
  },
  waitingText: { flex: 1, minWidth: 0 },
  waitingEyebrow: { ...type.captionMedium, letterSpacing: 1 },
  waitingTitle: { ...type.bodySmBold, fontSize: 18, color: colors.text, marginTop: 2 },
  waitingNote: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  waitingButtonWrap: { width: 120, flexShrink: 0 },
  claimSheet: {
    backgroundColor: colors.card,
    borderTopWidth: 2.5,
    borderTopColor: toon.ink,
  },
  claimSheetInner: { paddingHorizontal: space.lg, paddingTop: space.sm },
  claimFooter: { flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 1 },
  claimCost: { alignSelf: 'flex-start', width: '100%' },
  claimEnergy: { flex: 1, minWidth: 0 },
  claimButtonWrap: { width: 132, flexShrink: 0 },
  claimButton: { width: '100%' },
  mapMissing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.cardAlt,
  },
  mapMissingText: { ...type.bodySm, color: colors.textMuted, textAlign: 'center' },
  stepFrame: { alignSelf: 'flex-start', marginBottom: space.sm },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  stepDot: { width: 7, height: 7, borderRadius: 4 },
  stepChipText: { ...type.captionMedium, letterSpacing: 0.8 },
  // White fill plus the fixed ink outline remains readable over both the light
  // street map and the dark map. Theme text in light mode was black-on-black
  // once OutlinedText added its ink stroke, which produced the blob seen on
  // the claim-complete screen.
  placeTitle: { color: '#FFFFFF', marginBottom: 4 },
  // One weight, one colour, no accents: the theme's plain text ink, which is
  // black on the light gradient this sits on. NOT a fixed '#000' — the same
  // gradient goes near-black in dark mode and black on black is nothing.
  placeHint: { ...type.bodySmBold, color: colors.text, marginBottom: space.md },

  // Same notice idiom as `gateCard`: a full thin NB stroke, with the team's
  // glow kept as the left accent (set inline) so the box still says WHOSE
  // ground this is at a glance.
  takeCard: {
    backgroundColor: colors.cardAlt,
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.cardAlt),
    borderLeftWidth: 4,
    padding: space.md,
    marginBottom: space.md,
  },
  takeEyebrow: {
    ...type.captionMedium,
    color: colors.textDim,
    letterSpacing: 1,
    marginBottom: 3,
  },
  takeTitle: { ...type.bodySmBold, color: colors.text, marginBottom: space.sm },
  takeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 6 },
  takeName: { ...type.bodySm, color: colors.textMuted, flex: 1 },
  takeArea: { ...type.bodySmBold },

  // THE CENTREPIECE, and now built like one. A 1pt hairline round a 24pt
  // radius is the settings-panel recipe, and it was carrying the biggest
  // number on the screen — beside a claim CTA with a 3pt stroke and a hard
  // drop it read as the disabled version of a card. Heavy stroke, limited
  // radius, flat fill: the three decisions in theme/nb.js, applied to the
  // surface that most needed them. The drop is a real offset block behind it,
  // painted by HardShadow at the call site so Android gets it too.
  card: {
    backgroundColor: colors.card,
    borderRadius: nbRadius.sm,
    borderWidth: NB.stroke,
    borderColor: nbInk(scheme, colors.card),
    padding: space.lg,
    alignItems: 'center',
  },
  // Room for the block to fall into. The shadow is inset out of the wrapper by
  // its own offset, so without this it lands under whatever is below it.
  cardShadow: { marginBottom: NB.offset, marginRight: NB.offset },
  polyWrap: { alignSelf: 'stretch', marginBottom: space.sm },
  polyWrapLarge: { alignSelf: 'stretch', marginBottom: space.md, minHeight: 180 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.sm },
  heroArea: { ...type.statHero },
  heroUnit: { ...type.statMd, color: colors.textMuted, marginBottom: 6 },
  heroCaption: { ...type.caption, color: colors.textDim, marginTop: 2, textAlign: 'center' },
  // "new ground" specifically — the other captions are full sentences, where
  // this weight would read as shouting.
  heroCaptionStrong: { ...type.bodySmBold, color: colors.text },
  // The reinforcement line under it: a footnote to the headline, never a
  // second headline.
  heroSub: { ...type.caption, color: colors.textDim, marginTop: 3, textAlign: 'center' },
  // The rule between the headline and the numbers is a real line now. A
  // hairline inside a 3pt box is the one weight that reads as an accident.
  quietRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch',
    rowGap: space.md,
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: NB.strokeThin,
    borderTopColor: nbInk(scheme, colors.card),
  },
  // Keep the advanced metrics on the same two-column grid and row rhythm.
  quietRowTight: { marginTop: space.md, paddingTop: 0, borderTopWidth: 0 },
  quietStat: { width: '50%', minWidth: 0, paddingHorizontal: space.xs, alignItems: 'flex-start' },
  quietLabel: { ...type.labelSm, color: colors.textDim, marginBottom: 4 },
  quietValueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', maxWidth: '100%' },
  quietValue: { ...type.statSm, color: colors.text, flexShrink: 1 },
  quietUnit: { ...type.caption, color: colors.textDim, marginLeft: 2, marginBottom: 1 },
  deltaRow: { marginTop: space.md },
  deltaText: { ...type.bodySmBold, textAlign: 'center' },
  watermark: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: space.md },
  watermarkText: { ...type.labelSm, color: colors.textDim, letterSpacing: 2 },

  section: { marginTop: space.xl },
  sectionTitle: { ...type.label, color: colors.textMuted, marginBottom: space.md },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  splitKm: { ...type.statSm, color: colors.text, width: 52 },
  splitBarTrack: {
    flex: 1,
    height: 12,
    borderRadius: nbRadius.pill,
    backgroundColor: colors.cardAlt,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.cardAlt),
    overflow: 'hidden',
  },
  splitBar: { height: '100%' },
  splitPace: { ...type.statSm, color: colors.textMuted, width: 52, textAlign: 'right' },

  prWrap: { gap: space.sm },
  prHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  // A record is the best thing that happened on this run — a bare outlined
  // pill made it look like a filter chip.
  prCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: NB.strokeThin,
    borderRadius: nbRadius.sm,
    backgroundColor: colors.cardAlt,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  prIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: NB.strokeThin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prKicker: { ...type.labelSm, fontSize: 10, color: colors.textDim, letterSpacing: 1.1, marginBottom: 1 },
  prText: { ...type.bodyBold },

  // `shareBtn` / `shareBtnText` were here — the gradient pill's own padding
  // and label colour. ToonButton brings both, so they went with it.
  actions: { marginTop: space.xl, gap: space.md },

  // Claim step visualization styles
  placementHandle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  handleOuter: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    opacity: 0.8,
  },
  handleInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  handleIcon: {
    position: 'absolute',
    bottom: -8,
    fontSize: 10,
    fontWeight: '500',
    color: colors.textMuted,
  },
  
  rotationRing: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  rotationCircle: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    opacity: 0.6,
  },
  rotationIndicator: {
    position: 'absolute',
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotationArrow: {
    position: 'absolute',
    top: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
  },
  rotationIcon: {
    position: 'absolute',
    right: -10,
    top: '50%',
    marginTop: -12,
    fontSize: 20,
    color: colors.textMuted,
  },
});
