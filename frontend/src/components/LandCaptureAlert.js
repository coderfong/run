// Urgent foreground land-loss alert.
//
// A push banner is easy to miss while the app is open, and the inbox only
// refreshed when Home regained focus. This host listens to both foreground
// pushes and a lightweight active-app poll, then plays the WHOLE capture the
// attacker's own screen played, cast from the other side: the victim's avatar
// stands in the defender's spot and the real attacker's avatar performs the
// real move. Both sides resolve the identical style because it is a pure hash
// of the territory id (see effects/captureStyles.js), carried over in the push
// payload — no extra round-trip needed to keep them in sync. The event remains
// an inbox item after this presentation is dismissed.
//
// "The whole capture" is literal, and it used not to be. This mounted
// CaptureCast + CaptureStylePlayer in a 224px letterbox inside the warning
// card and finished on a small STOLEN pill, so the two beats that ARE the
// payoff never played: TerritoryRevealCanvas, the ground turning over in the
// transition the style asked for, and TerritoryVictoryBeat, the slam. Neither
// fits in a letterbox — the reveal blows the shape up to fill its bounds, and
// the victory column is around 350px tall on its own — so playback is now the
// whole screen, laid out exactly the way ResultScreen lays the same beats out
// against its map box, over a static snapshot instead of a live Mapbox:
//
//   style cutscene → ground turns over → TERRITORY STOLEN → loss + way back
//
// The only thing reversed is who stands where.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, ShieldAlert, Swords, TriangleAlert } from 'lucide-react-native';

import { invalidateAfterLandLoss } from '../api/cache';
import { subscribeNotificationEvents } from '../notifications/events';
import { TIP, useTutorial } from '../tutorial';
import { useAvatar } from '../state/avatar';
import { brand, space, toon, toonRadius, toonType, useTheme, withAlpha } from '../theme';
import { haptic, useReduceMotion } from '../ui/motion';
import {
  landCaptureAlertKey,
  normaliseLandCaptureAlert,
} from '../utils/landCaptureAlerts';
import { fitRingToBox, staticMapUrl } from '../utils/staticMercator';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import CaptureCast, { DEFENDER_SIZE } from '../effects/CaptureCast';
import CaptureStylePlayer from '../effects/CaptureStylePlayer';
import useCaptureStage from '../effects/useCaptureStage';
import { buildTerritoryAnchorModel, layoutDefenders, resolveRevealOrigin } from '../effects/anchors';
import { CAPTURE_LAYER } from '../effects/layers';
import { pickCaptureStyle } from '../effects/captureStyles';
import { borderByKey } from '../config/progression';
import { fmtArea } from './RivalCard';
import { Framed, OutlinedText, ToonButton, ToonGhostButton } from './ui';
import RankedAvatar from './identity/RankedAvatar';
import CutsceneBackdrop from './claim/CutsceneBackdrop';
import { timingFor } from './claim/timing';
import TerritoryRevealCanvas from './claim/TerritoryRevealCanvas';
import TerritoryVictoryBeat from './claim/TerritoryVictoryBeat';
import AppIcon from './AppIcon';

const PIN_HEX = 'FF4967';

const DUPLICATE_TTL_MS = 45_000;

// The ground to turn over when the capture arrived without a ring.
//
// Older captures, and any delivery path that omits `territory_ring`, leave the
// alert with a point and nothing to trace. The defenders already stand in a
// seeded fan in that case; this is the same admission on the reveal's side —
// a stand-in footprint centred on the pin, so the sequence still plays its
// payoff instead of silently dropping the one beat it exists to deliver. It is
// deliberately soft and irregular: a perfect circle would read as a claimed
// radius, which is a claim about the shape we cannot make.
function fallbackRing(point, bounds, seedText) {
  if (!point || !bounds?.width) return [];
  let hash = 0x811c9dc5;
  const text = String(seedText || 'ring');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const random = () => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return hash / 0x100000000;
  };
  const base = Math.min(bounds.width, bounds.height) * 0.3;
  const steps = 16;
  return [
    Array.from({ length: steps }, (_, i) => {
      const angle = (i / steps) * Math.PI * 2;
      const radius = base * (0.82 + random() * 0.36);
      return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
    }),
  ];
}

let alertListener = null;

export const landCaptureAlert = {
  show(payload) {
    if (alertListener) alertListener(payload);
    else if (__DEV__) console.log('[land-capture]', payload);
  },
};

function AlarmWash({ pulse }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.22, 0.5]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.025]) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient
        colors={['rgba(255,54,89,0.72)', 'rgba(33,3,12,0.2)', 'rgba(255,54,89,0.58)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function HazardRail({ style }) {
  return (
    <View pointerEvents="none" style={[styles.hazardRail, style]}>
      {Array.from({ length: 12 }).map((_, index) => (
        <View key={index} style={[styles.hazardStripe, index % 2 ? styles.hazardDark : null]} />
      ))}
    </View>
  );
}

// A portrait that says WHO, and how far along they are.
//
// The alert used to show one unframed bust, which left the two facts the
// runner actually wants at a glance — who hit me, and are they above or below
// me — off the card entirely, even though the push payload has carried the
// attacker's tier since the alert was built (see landCaptureAlerts'
// `rankKey`). Same PortraitBorder + tier the rest of the app uses, so a tier
// reads identically here and on a rival card.
function RankedPortrait({ name, avatar, rankKey, size = 66, dim = false }) {
  const { colors } = useTheme();
  const tier = borderByKey(rankKey || 'wood');
  // A gradient tier's `ring` is an array; the first stop is the readable one
  // for a line of type this small.
  const tierColor = Array.isArray(tier.ring) ? tier.ring[0] : tier.ring;
  return (
    <View style={[styles.portrait, dim ? styles.portraitDim : null]}>
      <RankedAvatar equipped={avatar} rankKey={tier.key} size={size} bg={colors.bg} />
      <Text style={[toonType.sub, styles.portraitName, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[toonType.sub, styles.portraitRank, { color: tierColor }]} numberOfLines={1}>
        {String(tier.label || '').toUpperCase()}
      </Text>
    </View>
  );
}

export function LandCaptureAlertHost({ onViewLand }) {
  const { colors, scheme } = useTheme();
  const { equipped, rankKey } = useAvatar();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const stageWidth = Math.min(Math.max(280, width - space.lg * 2), 430);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('incoming');
  // Two stages, split on the user's ask. `alert` is the plain warning — "land
  // captured", the two runners with their ranks, and two choices. `playback` is
  // the full-screen cutscene, run ONCE, ending on TERRITORY STOLEN. Keeping the
  // choreography out of the alert is also what stops it replaying: it mounts a
  // single time, when View is pressed, rather than living behind the
  // always-open warning where every re-render could restart it.
  const [view, setView] = useState('alert');
  // What the playing style asked the ground to do — `{ transition, origin,
  // duration }`, straight off its own `territoryReveal` step. Null until it
  // cues, which is exactly when the reveal canvas is allowed to exist.
  const [revealSpec, setRevealSpec] = useState(null);
  // A NUMBER, and one per playback. The reveal canvas and the victory beat
  // both seed their randomness off it (`playToken * 2654435761`), so the
  // string ids the style player was happy with are not enough here.
  const [playToken, setPlayToken] = useState(0);
  const recent = useRef(new Map());
  const payoffTimer = useRef(null);
  const pulse = useSharedValue(0);
  // The card's own kick on arrival — separate from `pulse` (the ambient wash)
  // and from `captureStage` (which only moves the small stage once the style
  // starts playing). This is what makes the whole card feel like it landed
  // rather than faded in.
  const entrance = useSharedValue(0);
  // The choreography engine's own camera: every capture style already carries
  // zooms, punches and shakes as part of its beats, so reusing it here (the
  // same engine ResultScreen drives) is what makes this read as an impact
  // rather than a modal opening — see effects/useCaptureStage.js.
  const captureStage = useCaptureStage(reduced);
  const castRef = useRef(null);

  const enqueue = useCallback((payload) => {
    const next = normaliseLandCaptureAlert(payload);
    if (!next) return;

    const now = Date.now();
    for (const [key, shownAt] of recent.current) {
      if (now - shownAt > DUPLICATE_TTL_MS) recent.current.delete(key);
    }
    const key = landCaptureAlertKey(next);
    if (key && recent.current.has(key)) return;
    if (key) recent.current.set(key, now);

    // Stats, rivalries, rank boards and the feed all changed behind this alert.
    invalidateAfterLandLoss();
    setQueue((items) => [...items, next]);
  }, []);

  useEffect(() => {
    alertListener = enqueue;
    return () => {
      if (alertListener === enqueue) alertListener = null;
    };
  }, [enqueue]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((items) => items.slice(1));
  }, [current, queue]);

  // DEFENDING, taught the first time somebody takes ground off this runner.
  // AFTER the alert closes, never over it: that alert is a full screen
  // cutscene about losing land, and a tutorial card on top of it would be a
  // second voice talking through the moment. The tip is one line about what to
  // do next, which is the right thing to say once the bad news has landed.
  const { requestTip } = useTutorial();
  const hadAlert = useRef(false);
  useEffect(() => {
    if (current) {
      hadAlert.current = true;
      return;
    }
    if (!hadAlert.current) return;
    hadAlert.current = false;
    requestTip(TIP.DEFENSE);
  }, [current, requestTip]);

  // The root notification setup owns the one native listener + active poll;
  // this host only answers the stolen-land events it publishes.
  useEffect(() => {
    return subscribeNotificationEvents((item) => {
      if (item.category === 'stolen' || item.data?.category === 'stolen') enqueue(item);
    });
  }, [enqueue]);

  useEffect(() => {
    if (!current) return undefined;
    setPhase('incoming');
    setView('alert');
    setRevealSpec(null);
    haptic.warning();
    pulse.value = 0;
    pulse.value = reduced
      ? 1
      : withRepeat(
          withSequence(
            withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
            withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) })
          ),
          -1,
          false
        );
    // A punchy overshoot the card grows in with, so the whole thing reads as
    // having LANDED rather than faded up like an ordinary modal.
    entrance.value = 0;
    entrance.value = reduced
      ? 1
      : withSequence(
          withTiming(1.08, { duration: 110, easing: Easing.out(Easing.quad) }),
          withTiming(0.97, { duration: 90, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 130, easing: Easing.out(Easing.back(1.4)) })
        );
    captureStage.reset();
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(entrance);
    };
    // Keyed on `current` ALONE: this is the "a new event just arrived, present
    // it from scratch" setup, and setView('alert') here must fire only for a
    // genuinely new capture — never on an ordinary re-render. pulse/entrance are
    // stable shared values and captureStage is a stable ref in the runtime, but
    // depending on them let a changed reference snap the view back to 'alert'
    // mid-playback (it re-ran on every render under the reanimated test mock,
    // undoing VIEW AFFECTED LAND the instant it was pressed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Level the stage the moment playback opens, so the style plays from rest
  // rather than from wherever the previous one was parked, and hand the beats
  // a fresh token — one per playback, which is what makes a second viewing of
  // the same capture re-run rather than sit on its last frame.
  useEffect(() => {
    if (view !== 'playback') return;
    setPhase('incoming');
    setRevealSpec(null);
    setPlayToken((token) => token + 1);
    captureStage.reset();
    // Keyed on `view` ALONE, for the same reason the setup effect above is
    // keyed on `current` alone — and here it is not a nicety. `captureStage`
    // is a useMemo over `style`, and the reanimated test mock hands back a
    // fresh useAnimatedStyle object on every render, so listing it makes this
    // a per-render effect. `setPhase`/`setRevealSpec` bail out on an
    // unchanged value, but `setPlayToken` cannot: every render would bump the
    // token, restart the style player, and render again. That is an infinite
    // loop, and it ran the jest worker out of heap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // The payoff rescue. The victory beat normally reports in and the footer
  // arrives with it, but a beat that never mounts (no claim point) or a
  // runtime that never runs its timers must not leave the runner in a
  // cutscene with no way out. Derived from the beat's OWN length plus slack,
  // for the same reason useClaimSequence derives its reveal deadline from the
  // playing style: a hard-coded number is a race the day either is retuned.
  // It is not a schedule — it only fires if the beat has stopped talking.
  useEffect(() => {
    if (phase !== 'settled') return undefined;
    const beat = timingFor(reduced).victoryBeat;
    payoffTimer.current = setTimeout(() => setPhase('payoff'), beat + 900);
    return () => clearTimeout(payoffTimer.current);
  }, [phase, reduced]);

  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: entrance.value || 1 }],
  }));

  const defender = useMemo(
    () => [{ user_id: 'me', username: 'You', avatar: equipped }],
    [equipped]
  );

  // The stage the choreography plays in: the WHOLE SCREEN.
  //
  // It used to be a 224px letterbox inside the warning card, which is why the
  // alert only ever played half a capture. The sequence the attacker sees is
  // laid out against a full screen — the reveal blows the shape up to fill it,
  // and the victory beat's column (a word, a full CharacterRig, a word plus
  // the steal glyph) is around 350px tall on its own. Neither fits in a
  // letterbox, so neither used to be mounted here. Same pixel space for the
  // snapshot, the projected ring, the cast and every beat, exactly as
  // ResultScreen does it against its map box.
  const stageBox = useMemo(() => ({ width, height }), [width, height]);
  const claimPoint = useMemo(
    () => ({ x: stageBox.width / 2, y: stageBox.height / 2 }),
    [stageBox]
  );
  const characterRect = useMemo(
    () => ({ x: claimPoint.x - 30, y: claimPoint.y - 84, width: 60, height: 84 }),
    [claimPoint]
  );
  // The room the beats have to work in. The chrome above (chip + status) and
  // the payoff below are real furniture, so anchors keep clear of them the way
  // ResultScreen keeps clear of its own heading.
  const safeInsets = useMemo(() => ({
    top: insets.top + 96,
    right: 20,
    bottom: Math.max(20, insets.bottom) + 150,
    left: 20,
  }), [insets.top, insets.bottom]);
  // The territory id is a stable hash seed on the attacker's own device (see
  // pickCaptureStyle) — carrying it over in the push payload is what lets the
  // victim's phone resolve the SAME style the attacker's screen played, no
  // extra round-trip needed.
  const styleId = useMemo(() => pickCaptureStyle(current?.territoryId ?? null), [current]);
  const seed = useMemo(() => String(current?.territoryId ?? ''), [current]);
  // The real ground the rival ran, framed into the stage's own pixel space and
  // aligned to the snapshot beneath it (same centre + zoom). When present, this
  // is what boxes the EXACT area; when absent (older captures / any path that
  // omits the ring), everything below falls back to the point + seeded fan.
  const framed = useMemo(
    () => fitRingToBox(current?.territoryRing, stageBox),
    [current, stageBox]
  );
  const stageRings = framed?.rings ?? [];
  // The shape the reveal traces and the victory beat pulses. The real ring
  // whenever the capture carried one; the stand-in footprint otherwise, so
  // there is always ground for the sequence to turn over.
  const revealRings = useMemo(
    () => (stageRings.length ? stageRings : fallbackRing(claimPoint, stageBox, seed)),
    [framed, claimPoint, stageBox, seed] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // With a real ring, the defender stands inside the actual shape; without one,
  // layoutDefenders' empty-rings fallback is a seeded fan around the claim
  // point, which is exactly the shape a single defender needs anyway.
  const defenderRects = useMemo(
    () => layoutDefenders(
      1,
      { bounds: stageBox, claimPoint, territoryRings: stageRings, safeInsets },
      seed,
      DEFENDER_SIZE
    ),
    [stageBox, claimPoint, seed, framed, safeInsets] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Where this style's wipe opens from — resolved with the SAME anchor
  // resolver the effects and the cast use, against the same context, so the
  // ground cracks from the point the strike actually landed on rather than
  // always from the middle.
  const revealOrigin = useMemo(() => {
    if (!revealSpec || !revealRings.length) return null;
    return resolveRevealOrigin(
      revealSpec.origin,
      {
        bounds: stageBox,
        claimPoint,
        territoryCenter: claimPoint,
        territoryRings: revealRings,
        characterRect,
        defenderRects,
        safeInsets,
        anchorModel: buildTerritoryAnchorModel({
          rings: revealRings, bounds: stageBox, insets: safeInsets, preferred: claimPoint,
        }),
      },
      `reveal:${playToken}`
    );
  }, [revealSpec, revealRings, stageBox, claimPoint, characterRect, defenderRects, safeInsets, playToken]);
  // A still frame of exactly where this happened, not a live map: this modal
  // can pop up over any screen, and a second live Mapbox instance mounted on
  // top of whatever the screen underneath is already running is a cost with no
  // payoff here. The Static Images API is one HTTPS image — same style, same
  // token, none of the weight.
  const mapUrl = useMemo(
    () => {
      // Centre + zoom the snapshot on the ring when we have it, so the
      // projected box lines up with the streets under it; otherwise the claim
      // point at a default zoom.
      const lat = framed?.center.lat ?? current?.lat;
      const lon = framed?.center.lon ?? current?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return staticMapUrl({
        center: { lat, lon },
        zoom: framed?.zoom,
        width: stageBox.width,
        height: stageBox.height,
        scheme,
        overlay: `pin-s+${PIN_HEX}(${lon},${lat})`,
      });
    },
    [current, stageBox, scheme, framed]
  );

  // The style says HOW the ground turns over and FROM WHERE; keeping the spec
  // is what lets the canvas play that transition instead of the one generic
  // wipe. A style with no `territoryReveal` step never calls this, and the
  // ground simply does not turn over for it — the same contract ResultScreen
  // holds the styles to.
  const handleTerritoryReveal = useCallback((spec) => {
    setRevealSpec(spec || {});
    setPhase('captured');
    haptic.warning();
  }, []);
  const handleContact = useCallback(() => {
    haptic.warning();
  }, []);
  const handleStyleComplete = useCallback(() => setPhase('settled'), []);
  // The victory beat has landed its two words. Only now do the numbers and the
  // buttons arrive, so the announcement is never competing with the furniture
  // — the same order the attacker's own payoff arrives in.
  const handleVictoryComplete = useCallback(() => {
    clearTimeout(payoffTimer.current);
    setPhase('payoff');
  }, []);

  if (!current) return null;

  // `settled` = the style has finished and the victory beat owns the screen.
  // `paidOff` = the beat has landed too, and the numbers may arrive.
  const settled = phase === 'settled' || phase === 'payoff';
  const paidOff = phase === 'payoff';
  const captured = phase !== 'incoming';
  const hasFocus = Number.isFinite(current.lat) && Number.isFinite(current.lon);
  const detail = `${current.attacker.username} took ${fmtArea(current.takenM2)} from you.`;

  const closeThen = (action) => {
    const event = current;
    setCurrent(null);
    action?.(event);
  };

  // Two grounds to sit on: the card, and the map the cutscene leaves visible
  // once the scrim has lifted. The muted card colour is unreadable over live
  // streets, so the dark variant carries its own.
  const lossStrip = (onDark = false) => (
    <View
      style={[
        styles.loss,
        onDark ? styles.lossOnDark : { backgroundColor: withAlpha(brand.pink, 0.13) },
      ]}
    >
      <Text style={[toonType.sub, { color: onDark ? 'rgba(255,255,255,0.82)' : colors.textMuted }]}>
        TERRITORY LOST
      </Text>
      <OutlinedText style={styles.lossAmount} outline={toon.ink} width={2.5}>
        {`−${fmtArea(current.takenM2)}`}
      </OutlinedText>
    </View>
  );

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={() => setCurrent(null)}
    >
      {view === 'alert' ? (
        <View style={styles.root} accessibilityViewIsModal>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(toon.ink, 0.9) }]} />
          <AlarmWash pulse={pulse} />
          <HazardRail style={styles.hazardTop} />
          <HazardRail style={styles.hazardBottom} />

          <Animated.View style={[styles.card, { width: stageWidth, backgroundColor: colors.card }, entranceStyle]}>
            <Framed
              frame={frameVariant('chip', 'capture-alert')}
              fill="#D91F45"
              on="#D91F45"
              tint="#fff"
              weight={INK.thin}
              pose={framePose('capture-alert')}
              inset={3}
              style={styles.alertChip}
              contentStyle={styles.alertChipInner}
            >
              <TriangleAlert size={16} color="#fff" strokeWidth={3} />
              <Text style={[styles.alertChipText, { paddingHorizontal: space.xs }]}>LIVE TERRITORY ALERT</Text>
            </Framed>

            <OutlinedText style={styles.headline} outline={toon.ink} width={3} fit>
              LAND CAPTURED
            </OutlinedText>
            <Text style={[toonType.sub, styles.detail, { color: colors.text }]}>{detail}</Text>

            {/* Just the warning: WHO took it and WHO lost it, each in their own
                rank frame, and two choices. NO choreography here — that is
                what View plays, and keeping it out of the always-open warning
                is what stops it replaying. */}
            <View style={styles.faceOff}>
              <RankedPortrait
                name={current.attacker.username}
                avatar={current.attacker.avatar}
                rankKey={current.attacker.rankKey}
              />
              <View style={styles.faceOffSwords}>
                <Swords size={22} color={brand.pink} strokeWidth={3} />
              </View>
              {/* Dimmed: the runner is the one who just lost the ground, and
                  the rival is the subject of the sentence above. */}
              <RankedPortrait name="YOU" avatar={equipped} rankKey={rankKey} dim />
            </View>

            {lossStrip(false)}
            <ToonButton
              title={hasFocus ? 'VIEW AFFECTED LAND' : 'OPEN TERRITORY MAP'}
              onPress={() => setView('playback')}
              size="sm"
              icon={<MapPin size={18} color="#fff" strokeWidth={3} />}
              fill={{ colors: ['#FF5B73', '#E72F55', '#B9163A'], border: toon.ink }}
              style={styles.primaryAction}
            />
            <View style={styles.secondaryActions}>
              <ToonGhostButton title="DISMISS" onPress={() => setCurrent(null)} color={colors.textMuted} />
            </View>
          </Animated.View>
        </View>
      ) : (
        /* Playback: the WHOLE capture, cast from the other side.
           Every beat the attacker's own screen played is mounted here, in the
           same order and against the same full-screen pixel space
           ResultScreen lays them out in — the style's cutscene, the ground
           turning over the way that style turns it over, and the victory
           slam. The only thing reversed is who is standing where: the rival
           performs the move, the runner is the one it happens to. It plays
           once (`playToken` changes only when this view opens) and settles on
           the loss and the way back to the map. */
        <View style={styles.cutscene} accessibilityViewIsModal>
          {mapUrl ? (
            <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
              <View style={styles.mapGrid} />
            </View>
          )}

          {/* ONE stage, exactly as ResultScreen builds it: the scrim, the
              ground turning over, the people and the cutscene all inside a
              single transformed wrapper, so a style's zooms, whips and shakes
              move them together. It also has to be one wrapper for the layer
              contract to mean anything — CAPTURE_LAYER's numbers only compete
              between siblings, and the reveal (20) sitting in its own box
              outside this one would paint over the cast (30) whatever the
              contract says. The snapshot stays outside and still, the same
              way the real Mapbox camera does over there. */}
          <Animated.View
            style={[StyleSheet.absoluteFill, captureStage.style]}
            pointerEvents="none"
          >
            {/* Under the reveal, not over it: the contested streets stay
                readable while the ground changes hands on top of them. Lifts
                once the style is done and the victory beat owns the screen. */}
            <CutsceneBackdrop active={!settled} playToken={playToken} reducedMotion={reduced} />

            {/* The ground actually changing hands, in the transition the
                playing style asked for — the trace of the territory the rival
                took, and the beat this alert used to skip entirely. */}
            {revealSpec && revealRings.length > 0 && (
              <TerritoryRevealCanvas
                rings={revealRings}
                claimPoint={claimPoint}
                fillColor={brand.pink}
                strokeColor="#FF8A3D"
                bounds={stageBox}
                reduced={reduced}
                playToken={playToken}
                transition={revealSpec.transition}
                origin={revealOrigin}
                duration={revealSpec.duration}
              />
            )}

            <CaptureCast
              ref={castRef}
              attacker={current.attacker.avatar}
              attackerPoint={claimPoint}
              defenders={defender}
              defenderRects={defenderRects}
              bounds={stageBox}
              reducedMotion={reduced}
              fadeIn={reduced ? 0 : 140}
            />
            {/* Unmounted at the payoff, which is also what SKIP does: a
                cutscene the runner has stepped past must stop throwing
                sprites over the panel that replaced it. */}
            {!paidOff && (
            <CaptureStylePlayer
              key={`play:${seed}:${current.id || current.captureId || 'x'}`}
              style={styleId}
              playToken={playToken}
              bounds={stageBox}
              claimPoint={claimPoint}
              territoryRings={stageRings}
              characterRect={characterRect}
              defenderRects={defenderRects}
              defenderCount={1}
              safeInsets={safeInsets}
              reducedMotion={reduced}
              seed={seed}
              tint={brand.pink}
              ink={toon.ink}
              onTerritoryReveal={handleTerritoryReveal}
              onContact={handleContact}
              onComplete={handleStyleComplete}
              stage={captureStage}
              cast={castRef}
            />
            )}
          </Animated.View>

          {/* The payoff, with the roles the right way round: the RIVAL is the
              one standing on the ground, celebrating, and the words that slam
              down are the ones the runner is on the wrong end of. */}
          {settled && (
            <TerritoryVictoryBeat
              visible
              attacker={current.attacker.avatar}
              rings={revealRings}
              claimScreenPoint={claimPoint}
              bounds={stageBox}
              label="TERRITORY STOLEN"
              strokeColor="#FF8A3D"
              reducedMotion={reduced}
              playToken={playToken}
              onComplete={handleVictoryComplete}
            />
          )}

          {/* Chrome. Live status while it plays, the loss and the way out once
              it has. Both sit outside the stage transform so a camera shake
              never rattles the furniture. */}
          <View style={[styles.cutsceneTop, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
            <Framed
              frame={frameVariant('chip', 'capture-alert')}
              fill="#D91F45"
              on="#D91F45"
              tint="#fff"
              weight={INK.thin}
              pose={framePose('capture-alert')}
              inset={3}
              style={styles.alertChip}
              contentStyle={styles.alertChipInner}
            >
              <TriangleAlert size={16} color="#fff" strokeWidth={3} />
              <Text style={[styles.alertChipText, { paddingHorizontal: space.xs }]}>LIVE TERRITORY ALERT</Text>
            </Framed>
            {!settled && (
              <View style={styles.stageLabel}>
                <ShieldAlert size={15} color="#fff" />
                <Text style={styles.stageLabelText}>
                  {captured ? 'BORDER BREACHED' : 'CAPTURE INCOMING'}
                </Text>
              </View>
            )}
          </View>

          <View
            style={[styles.cutsceneFoot, { paddingBottom: Math.max(space.md, insets.bottom) }]}
            pointerEvents="box-none"
          >
            {/* The scrim over the cutscene has lifted by the time the numbers
                arrive, so the panel brings its own ground — muted card colours
                over live streets are unreadable. */}
            {paidOff && (
              <LinearGradient
                colors={['rgba(6,7,12,0)', 'rgba(6,7,12,0.86)', 'rgba(6,7,12,0.96)']}
                locations={[0, 0.32, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            )}
            {paidOff ? (
              <>
                <View style={styles.stolenBanner}>
                  <AppIcon name="steal" size={18} />
                  <Text style={styles.stolenBannerText}>TERRITORY STOLEN</Text>
                </View>
                <Text style={[toonType.sub, styles.cutsceneDetail]}>{detail}</Text>
                {lossStrip(true)}
                {/* The choreography's own zoom framed the land here; this takes
                    the runner to the live board. With the attacker's ring in
                    the payload it fits the map to the EXACT ground taken;
                    without one it falls back to centring on the point. */}
                <ToonButton
                  title={hasFocus ? 'ZOOM TO THE LAND' : 'OPEN TERRITORY MAP'}
                  onPress={() => closeThen(onViewLand)}
                  size="sm"
                  icon={<MapPin size={18} color="#fff" strokeWidth={3} />}
                  fill={{ colors: ['#FF5B73', '#E72F55', '#B9163A'], border: toon.ink }}
                  style={styles.primaryAction}
                />
                <View style={styles.secondaryActions}>
                  <ToonGhostButton title="DISMISS" onPress={() => setCurrent(null)} color="#fff" />
                </View>
              </>
            ) : (
              /* Never a trap: a cutscene the runner cannot leave is worse than
                 one they did not finish, so the way to the end is on screen
                 the whole time it plays. */
              <ToonGhostButton title="SKIP" onPress={handleVictoryComplete} color="#fff" />
            )}
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  hazardRail: {
    position: 'absolute',
    left: -18,
    right: -18,
    height: 18,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: '#FFB020',
    transform: [{ rotate: '-2deg' }],
  },
  hazardTop: { top: 28 },
  hazardBottom: { bottom: 28 },
  hazardStripe: {
    flex: 1,
    minWidth: 34,
    backgroundColor: '#FFB020',
    transform: [{ skewX: '-28deg' }],
  },
  hazardDark: { backgroundColor: toon.ink },
  card: {
    maxWidth: 430,
    borderRadius: toonRadius.card,
    borderWidth: 3,
    borderColor: toon.ink,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 20,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 7 },
    elevation: 18,
    overflow: 'hidden',
  },
  alertChip: { marginBottom: 8 },
  alertChipInner: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  alertChipText: { ...toonType.sub, color: '#fff', fontSize: 12 },
  headline: { ...toonType.hero, color: '#FF4967', fontSize: 34, lineHeight: 40 },
  detail: { textAlign: 'center', marginTop: 2, marginBottom: 10, paddingHorizontal: 10 },
  // The playback view is not a card. It is the whole screen, because that is
  // the pixel space every beat in the capture sequence is laid out against.
  cutscene: { flex: 1, backgroundColor: toon.ink, overflow: 'hidden' },
  cutsceneTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
    zIndex: CAPTURE_LAYER.UI,
  },
  cutsceneFoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: space.lg,
    zIndex: CAPTURE_LAYER.UI,
  },
  cutsceneDetail: { color: '#fff', textAlign: 'center', marginTop: 8 },
  mapGrid: {
    position: 'absolute',
    width: '130%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#fff',
    shadowOpacity: 0.12,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 46 },
  },
  stageLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(217,31,69,0.9)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  stageLabelText: { ...toonType.sub, color: '#fff', fontSize: 11 },
  // The alert view's two portraits: who took the ground and who lost it, each
  // wearing their own rank frame.
  faceOff: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 2,
  },
  faceOffSwords: { paddingHorizontal: 8, paddingTop: 30 },
  // Flexed rather than fixed: the frame art is wider than the portrait it
  // wraps, and two fixed columns plus the swords overflow the card on a small
  // phone (the card floors at 280).
  portrait: { alignItems: 'center', flex: 1, maxWidth: 130 },
  // The runner is the one this happened TO, not the subject of the sentence
  // above it — a touch back so the rival reads first.
  portraitDim: { opacity: 0.86 },
  portraitName: { fontSize: 13, marginTop: 6, alignSelf: 'stretch' },
  portraitRank: { fontSize: 10, marginTop: 1, letterSpacing: 0.6 },
  // The STOLEN banner that lands once the choreography settles — the
  // victim-side echo of the attacker's TERRITORY STOLEN payoff.
  stolenBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(217,31,69,0.95)',
    borderWidth: 2,
    borderColor: toon.ink,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  stolenBannerText: { ...toonType.sub, color: '#fff', fontSize: 13, letterSpacing: 0.5 },
  loss: {
    width: '100%',
    marginTop: 10,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,73,103,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lossOnDark: { backgroundColor: 'rgba(255,73,103,0.2)', borderColor: 'rgba(255,73,103,0.55)' },
  lossAmount: { ...toonType.label, color: '#FF4967', fontSize: 23 },
  primaryAction: { width: '100%', marginTop: 10 },
  secondaryActions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 2,
  },
});
