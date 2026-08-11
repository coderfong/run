// Urgent foreground land-loss alert.
//
// A push banner is easy to miss while the app is open, and the inbox only
// refreshed when Home regained focus. This host listens to both foreground
// pushes and a lightweight active-app poll, then reuses the exact
// CaptureEncounter shown to the attacker so the owner sees the moment their
// runner is knocked off the land. The event remains an inbox item after this
// presentation is dismissed.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { useAvatar } from '../state/avatar';
import { brand, space, toon, toonRadius, toonType, useTheme, withAlpha } from '../theme';
import { haptic, useReduceMotion } from '../ui/motion';
import {
  isRecentNotification,
  landCaptureAlertKey,
  normaliseLandCaptureAlert,
} from '../utils/landCaptureAlerts';
import CaptureEncounter from './claim/CaptureEncounter';
import { fmtArea } from './RivalCard';
import { OutlinedText, ToonButton, ToonGhostButton } from './ui';

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

export function LandCaptureAlertHost({ onViewLand, onOpenNotifications }) {
  const { colors } = useTheme();
  const { equipped } = useAvatar();
  const reduced = useReduceMotion();
  const { width } = useWindowDimensions();
  const stageWidth = Math.min(Math.max(280, width - space.lg * 2), 430);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('incoming');
  const recent = useRef(new Map());
  const pulse = useSharedValue(0);

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
    return () => cancelAnimation(pulse);
  }, [current, pulse, reduced]);

  const defender = useMemo(
    () => [{ user_id: 'me', username: 'You', avatar: equipped }],
    [equipped]
  );

  if (!current) return null;

  const captured = phase !== 'incoming';
  const hasFocus = Number.isFinite(current.lat) && Number.isFinite(current.lon);
  const headline = captured ? 'LAND CAPTURED' : 'LAND UNDER ATTACK';
  const detail = captured
    ? `${current.attacker.username} took ${fmtArea(current.takenM2)} from you.`
    : `${current.attacker.username} is breaking through your border.`;

  const closeThen = (action) => {
    const event = current;
    setCurrent(null);
    action?.(event);
  };

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

        <View style={[styles.card, { width: stageWidth, backgroundColor: colors.card }]}> 
          <View style={styles.alertChip}>
            <TriangleAlert size={16} color="#fff" strokeWidth={3} />
            <Text style={styles.alertChipText}>LIVE TERRITORY ALERT</Text>
          </View>

          <OutlinedText style={styles.headline} outline={toon.ink} width={3} fit>
            {headline}
          </OutlinedText>
          <Text style={[toonType.sub, styles.detail, { color: colors.text }]}>{detail}</Text>

          <View
            style={[
              styles.stage,
              {
                width: stageWidth - 24,
                height: STAGE_HEIGHT,
                backgroundColor: colors.bg,
                borderColor: captured ? brand.pink : '#FFB020',
              },
            ]}
          >
            <View style={styles.mapGrid} />
            <Animated.View style={[styles.breachRing, { borderColor: brand.pink }]} />
            <View style={styles.stageLabel}>
              <ShieldAlert size={15} color="#fff" />
              <Text style={styles.stageLabelText}>{captured ? 'BORDER BREACHED' : 'CAPTURE INCOMING'}</Text>
            </View>
            <CaptureEncounter
              visible
              variant="grin-knock"
              attacker={current.attacker.avatar}
              defenders={defender}
              claimScreenPoint={{ x: (stageWidth - 24) / 2, y: STAGE_HEIGHT / 2 + 14 }}
              bounds={{ width: stageWidth - 24, height: STAGE_HEIGHT }}
              reducedMotion={reduced}
              playToken={current.captureId || current.id || current.createdAt}
              onImpact={() => {
                setPhase('captured');
                haptic.warning();
              }}
              onComplete={() => setPhase('settled')}
            />
          </View>

          <View style={[styles.loss, { backgroundColor: withAlpha(brand.pink, 0.13) }]}> 
            <Text style={[toonType.sub, { color: colors.textMuted }]}>TERRITORY LOST</Text>
            <OutlinedText style={styles.lossAmount} outline={toon.ink} width={2.5}>
              {`−${fmtArea(current.takenM2)}`}
            </OutlinedText>
          </View>

          <ToonButton
            title={hasFocus ? 'VIEW AFFECTED LAND' : 'OPEN TERRITORY MAP'}
            onPress={() => closeThen(onViewLand)}
            size="sm"
            icon={<MapPin size={18} color="#fff" strokeWidth={3} />}
            fill={{ colors: ['#FF5B73', '#E72F55', '#B9163A'], border: toon.ink }}
            style={styles.primaryAction}
          />
          <View style={styles.secondaryActions}>
            <ToonGhostButton
              title="NOTIFICATIONS"
              onPress={() => closeThen(onOpenNotifications)}
              color={colors.textMuted}
            />
            <ToonGhostButton title="DISMISS" onPress={() => setCurrent(null)} color={colors.textMuted} />
          </View>
        </View>
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
  breachRing: {
    position: 'absolute',
    width: 176,
    height: 116,
    borderRadius: 58,
    borderWidth: 3,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,73,103,0.08)',
    transform: [{ rotate: '-8deg' }],
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
