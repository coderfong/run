// Urgent foreground land-loss alert.
//
// A push banner is easy to miss while the app is open, and the inbox only
// refreshed when Home regained focus. This host listens to both foreground
// pushes and a lightweight active-app poll, then plays the SAME capture-style
// choreography engine the attacker's own screen played (CaptureCast +
// CaptureStylePlayer, ResultScreen's own cast — see AnimationGalleryScreen's
// CaptureStyleLab for the pattern this borrows: a mapless mount with
// synthetic geometry), cast from the other side: the victim's own avatar
// stands in the defender's spot, and the real attacker's avatar performs the
// real move. Both sides resolve the identical style because it is a pure
// hash of the territory id (see effects/captureStyles.js), carried over in
// the push payload — no extra round-trip needed to keep them in sync. The
// event remains an inbox item after this presentation is dismissed.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import * as Notifications from 'expo-notifications';
import { MapPin, ShieldAlert, TriangleAlert } from 'lucide-react-native';

import { api } from '../api/client';
import {
  fetchAndCache,
  getCached,
  invalidateAfterLandLoss,
} from '../api/cache';
import { MAPBOX_PUBLIC_TOKEN, MAP_READY, styleForTheme } from '../config/map';
import { useAvatar } from '../state/avatar';
import { brand, space, toon, toonRadius, toonType, useTheme, withAlpha } from '../theme';
import { haptic, useReduceMotion } from '../ui/motion';
import {
  isRecentNotification,
  landCaptureAlertKey,
  normaliseLandCaptureAlert,
} from '../utils/landCaptureAlerts';
import { fitRingToBox } from '../utils/staticMercator';
import CaptureCast, { DEFENDER_SIZE } from '../effects/CaptureCast';
import CaptureStylePlayer from '../effects/CaptureStylePlayer';
import useCaptureStage from '../effects/useCaptureStage';
import { layoutDefenders } from '../effects/anchors';
import { pickCaptureStyle } from '../effects/captureStyles';
import { fmtArea } from './RivalCard';
import { OutlinedText, ToonButton, ToonGhostButton } from './ui';
import { CharacterBust } from './character/CharacterRig';
import AppIcon from './AppIcon';

// A still frame of exactly where this happened, not a live map: this modal
// can pop up over any screen, and a second live Mapbox instance mounted on
// top of whatever the screen underneath is already running is a cost with no
// payoff here. The Static Images API is one HTTPS image — same style, same
// token, none of the weight.
function staticMapUrl({ lat, lon, width, height, scheme, pinHex, zoom = 15 }) {
  if (!MAP_READY || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const style = styleForTheme(scheme).replace('mapbox://styles/', '');
  const w = Math.max(64, Math.min(640, Math.round(width)));
  const h = Math.max(64, Math.min(640, Math.round(height)));
  const z = Math.max(1, Math.min(20, Number(zoom) || 15));
  const pin = `pin-s+${pinHex}(${lon},${lat})`;
  return `https://api.mapbox.com/styles/v1/${style}/static/${pin}/${lon},${lat},${z},0/${w}x${h}@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`;
}

const POLL_MS = 10_000;
const FIRST_FETCH_GRACE_MS = 3_000;
const DUPLICATE_TTL_MS = 45_000;
const STAGE_HEIGHT = 224;

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

export function LandCaptureAlertHost({ onViewLand }) {
  const { colors, scheme } = useTheme();
  const { equipped } = useAvatar();
  const reduced = useReduceMotion();
  const { width } = useWindowDimensions();
  const stageWidth = Math.min(Math.max(280, width - space.lg * 2), 430);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('incoming');
  // Two stages, split on the user's ask. `alert` is the plain warning — "land
  // captured", the runner's own character, and two choices. `playback` is where
  // the capture choreography actually runs, ONCE, ending on TERRITORY STOLEN.
  // Keeping the choreography out of the alert is also what stops it replaying:
  // it now mounts a single time, when View is pressed, rather than living behind
  // the always-open warning where every re-render could restart it.
  const [view, setView] = useState('alert');
  const recent = useRef(new Map());
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

  // The foreground path is intentionally redundant. Push is immediate when a
  // token is healthy; polling also covers simulators, denied push permission,
  // Expo delivery issues, and the development capture harness.
  useEffect(() => {
    const cached = getCached('notifications');
    const known = new Set((cached?.items || []).map((item) => item.id));
    const mountedAt = Date.now();
    let alive = true;
    let firstCheck = true;
    let active = AppState.currentState === 'active';

    const check = async () => {
      if (!alive || !active) return;
      try {
        const response = await fetchAndCache('notifications', api.notifications);
        if (!alive) return;
        const fresh = [];
        for (const item of response?.items || []) {
          if (!item?.id || known.has(item.id)) continue;
          known.add(item.id);
          if (
            item.category === 'stolen' &&
            (!firstCheck || isRecentNotification(item, mountedAt - FIRST_FETCH_GRACE_MS))
          ) {
            fresh.push(item);
          }
        }
        // The API is newest-first; queue oldest-first so two simultaneous
        // captures are replayed in the order they happened.
        fresh.reverse().forEach(enqueue);
        firstCheck = false;
      } catch {
        // The next interval or foreground push gets another chance. Alerts are
        // additive and must never destabilise the rest of the app.
      }
    };

    check();
    const timer = setInterval(check, POLL_MS);
    const appStateSub = AppState.addEventListener('change', (state) => {
      active = state === 'active';
      if (active) check();
    });
    let pushSub = { remove() {} };
    try {
      pushSub = Notifications.addNotificationReceivedListener((notification) => {
        const content = notification?.request?.content || {};
        const data = content.data || {};
        if (data.category === 'stolen') {
          enqueue({
            ...data,
            data,
            category: 'stolen',
            title: content.title,
            body: content.body,
            created_at: new Date().toISOString(),
          });
        }
        // The background task writes the inbox row at roughly the same time as
        // the push. A short follow-up keeps the bell/inbox cache current too.
        setTimeout(check, 500);
      });
    } catch {
      // Expo web and a few development runtimes do not implement foreground
      // push listeners. Active polling remains the complete fallback.
    }

    return () => {
      alive = false;
      clearInterval(timer);
      appStateSub.remove();
      pushSub.remove();
    };
  }, [enqueue]);

  useEffect(() => {
    if (!current) return undefined;
    setPhase('incoming');
    setView('alert');
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
  // rather than from wherever the previous one was parked.
  useEffect(() => {
    if (view === 'playback') {
      setPhase('incoming');
      captureStage.reset();
    }
  }, [view, captureStage]);

  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: entrance.value || 1 }],
  }));

  const defender = useMemo(
    () => [{ user_id: 'me', username: 'You', avatar: equipped }],
    [equipped]
  );

  // The stage the choreography plays in — the same box that used to hold a
  // static ring decoration. Sized once from stageWidth so a claim point
  // computed against it and defender layout computed against it agree.
  const stageBox = useMemo(
    () => ({ width: stageWidth - 24, height: STAGE_HEIGHT }),
    [stageWidth]
  );
  const claimPoint = useMemo(
    () => ({ x: stageBox.width / 2, y: stageBox.height / 2 }),
    [stageBox]
  );
  const characterRect = useMemo(
    () => ({ x: claimPoint.x - 29, y: claimPoint.y - 29, width: 58, height: 58 }),
    [claimPoint]
  );
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
  // With a real ring, the defender stands inside the actual shape; without one,
  // layoutDefenders' empty-rings fallback is a seeded fan around the claim
  // point, which is exactly the shape a single defender needs anyway.
  const defenderRects = useMemo(
    () => layoutDefenders(1, { bounds: stageBox, claimPoint, territoryRings: stageRings }, seed, DEFENDER_SIZE),
    [stageBox, claimPoint, seed, framed]
  );
  const mapUrl = useMemo(
    () => staticMapUrl({
      // Centre + zoom the snapshot on the ring when we have it, so the projected
      // box lines up with the streets under it; otherwise the claim point at a
      // default zoom.
      lat: framed?.center.lat ?? current?.lat,
      lon: framed?.center.lon ?? current?.lon,
      zoom: framed?.zoom,
      width: stageBox.width,
      height: stageBox.height,
      scheme,
      pinHex: 'FF4967',
    }),
    [current, stageBox, scheme, framed]
  );

  const handleTerritoryReveal = useCallback(() => {
    setPhase('captured');
    haptic.warning();
  }, []);
  const handleContact = useCallback(() => {
    haptic.warning();
  }, []);
  const handleStyleComplete = useCallback(() => setPhase('settled'), []);

  if (!current) return null;

  const settled = phase === 'settled';
  const captured = phase !== 'incoming';
  const hasFocus = Number.isFinite(current.lat) && Number.isFinite(current.lon);
  // The alert opens post-capture ("land captured"); the choreography flips it to
  // "territory stolen" once it has played out under View.
  const headline = view === 'playback' && settled ? 'TERRITORY STOLEN' : 'LAND CAPTURED';
  const detail = `${current.attacker.username} took ${fmtArea(current.takenM2)} from you.`;

  const closeThen = (action) => {
    const event = current;
    setCurrent(null);
    action?.(event);
  };

  const lossStrip = (
    <View style={[styles.loss, { backgroundColor: withAlpha(brand.pink, 0.13) }]}>
      <Text style={[toonType.sub, { color: colors.textMuted }]}>TERRITORY LOST</Text>
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
      <View style={styles.root} accessibilityViewIsModal>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(toon.ink, 0.9) }]} />
        <AlarmWash pulse={pulse} />
        <HazardRail style={styles.hazardTop} />
        <HazardRail style={styles.hazardBottom} />

        <Animated.View style={[styles.card, { width: stageWidth, backgroundColor: colors.card }, entranceStyle]}>
          <View style={styles.alertChip}>
            <TriangleAlert size={16} color="#fff" strokeWidth={3} />
            <Text style={styles.alertChipText}>LIVE TERRITORY ALERT</Text>
          </View>

          <OutlinedText style={styles.headline} outline={toon.ink} width={3} fit>
            {headline}
          </OutlinedText>
          <Text style={[toonType.sub, styles.detail, { color: colors.text }]}>{detail}</Text>

          {view === 'alert' ? (
            <>
              {/* Just the warning: the runner's own character standing on the
                  ground that was taken, and two choices. NO choreography here —
                  that is what View plays, and keeping it out of the always-open
                  warning is what stops it replaying. */}
              <View style={styles.you}>
                <CharacterBust equipped={equipped} size={96} bg={colors.bg} />
              </View>
              {lossStrip}
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
            </>
          ) : (
            <>
              {/* Playback: the real capture-style choreography, cast from the
                  victim's side and played ONCE (keyed so it mounts a single
                  time), ending on the STOLEN banner — the mirror of the
                  attacker's own payoff. `stage` is the shared camera transform,
                  so the style's zooms and shakes move the map snapshot with the
                  cast. */}
              <View
                style={[
                  styles.stage,
                  {
                    width: stageBox.width,
                    height: stageBox.height,
                    backgroundColor: colors.bg,
                    borderColor: settled ? brand.pink : '#FFB020',
                  },
                ]}
              >
                {mapUrl ? (
                  <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <View style={styles.mapGrid} />
                )}
                <View pointerEvents="none" style={styles.stageScrim} />

                <Animated.View
                  style={[StyleSheet.absoluteFill, captureStage.style]}
                  pointerEvents="none"
                >
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
                  <CaptureStylePlayer
                    key={`play:${seed}:${current.id || current.captureId || 'x'}`}
                    style={styleId}
                    playToken={current.captureId || current.id || current.createdAt || 'play'}
                    bounds={stageBox}
                    claimPoint={claimPoint}
                    territoryRings={stageRings}
                    characterRect={characterRect}
                    defenderRects={defenderRects}
                    defenderCount={1}
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
                </Animated.View>

                {settled ? (
                  <View style={styles.stolenBanner}>
                    <AppIcon name="steal" size={18} />
                    <Text style={styles.stolenBannerText}>TERRITORY STOLEN</Text>
                  </View>
                ) : (
                  <View style={styles.stageLabel}>
                    <ShieldAlert size={15} color="#fff" />
                    <Text style={styles.stageLabelText}>{captured ? 'BORDER BREACHED' : 'CAPTURE INCOMING'}</Text>
                  </View>
                )}
              </View>

              {lossStrip}

              {/* The choreography's own zoom framed the land here; this takes the
                  runner to the live board. With the attacker's ring in the
                  payload it fits the map to the EXACT ground taken; without one
                  it falls back to centring on the point. */}
              <ToonButton
                title={hasFocus ? 'ZOOM TO THE LAND' : 'OPEN TERRITORY MAP'}
                onPress={() => closeThen(onViewLand)}
                size="sm"
                icon={<MapPin size={18} color="#fff" strokeWidth={3} />}
                fill={{ colors: ['#FF5B73', '#E72F55', '#B9163A'], border: toon.ink }}
                style={styles.primaryAction}
              />
              <View style={styles.secondaryActions}>
                <ToonGhostButton title="DISMISS" onPress={() => setCurrent(null)} color={colors.textMuted} />
              </View>
            </>
          )}
        </Animated.View>
      </View>
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
  alertChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#D91F45',
    borderWidth: 2,
    borderColor: toon.ink,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },
  alertChipText: { ...toonType.sub, color: '#fff', fontSize: 12 },
  headline: { ...toonType.hero, color: '#FF4967', fontSize: 34, lineHeight: 40 },
  detail: { textAlign: 'center', marginTop: 2, marginBottom: 10, paddingHorizontal: 10 },
  stage: {
    position: 'relative',
    borderRadius: 16,
    borderWidth: 2.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // Keeps the cast and the impact art legible over a real map photo —
  // without it a bright street or a light-mode style washes out the fx.
  stageScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,4,10,0.34)',
  },
  stageLabel: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(217,31,69,0.9)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  stageLabelText: { ...toonType.sub, color: '#fff', fontSize: 11 },
  // The alert view's character — the runner shown standing on the ground taken.
  you: { marginTop: 8, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  // The STOLEN banner that lands once the choreography settles, bottom-centre of
  // the stage — the victim-side echo of the attacker's TERRITORY STOLEN payoff.
  stolenBanner: {
    position: 'absolute',
    bottom: 12,
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
