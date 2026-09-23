// The in-app half of "someone attacked your land and it held".
//
// The backend sends a `defended` push the moment a claim runs your border but
// fails to take ground (backend/app/routes/runs.py). While the app is shut
// that lands on the lock screen; with it open, Expo draws nothing, so the one
// beat that makes defending feel earned — you were attacked and you WON — went
// unseen unless the runner later opened the bell.
//
// This is that sentence in a banner, over whatever screen is up. It is
// deliberately NOT the LandCaptureAlert treatment: losing land is a full-screen
// cutscene, a defense that held is a line you can tap to the map or ignore.
// The event stays an inbox row either way.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { ShieldCheck } from 'lucide-react-native';

import { invalidateAfterLandLoss } from '../api/cache';
import { subscribeNotificationEvents } from '../notifications/events';
import { NB, nbInk, radius, space, useTheme, useThemedType } from '../theme';
import { PressableScale, haptic, useReduceMotion } from '../ui/motion';
import HardShadow from './ui/HardShadow';
import { useAvatar } from '../state/avatar';
import CaptureCast from '../effects/CaptureCast';
import DefenseStylePlayer from '../effects/DefenseStylePlayer';
import useCaptureStage from '../effects/useCaptureStage';
import { RunnerFigure } from './identity/PlayerIdentity';

const DWELL_MS = 6000;
// The defender's full body runner on the payoff card.
const HERO_H = 92;
const DUPLICATE_TTL_MS = 45_000;

// A hold, not an alarm — the app's own green.
const HOLD_GREEN = '#2FBF71';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function focusFrom(data) {
  const lat = finite(data?.lat);
  const lon = finite(data?.lon);
  return lat != null && lon != null ? { focus: { lat, lon } } : undefined;
}

export function DefenseHeldBanner({ onOpen }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { equipped } = useAvatar();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const [alert, setAlert] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [playToken, setPlayToken] = useState(0);
  const timer = useRef(null);
  const seen = useRef(new Map());
  const castRef = useRef(null);
  const defenseStage = useCaptureStage(reduced);
  const bounds = useMemo(() => ({ width, height }), [height, width]);
  const defenderRects = useMemo(() => [{
    x: width * 0.68 - 44,
    y: height * 0.52 - 44,
    width: 88,
    height: 88,
  }], [height, width]);
  const attackerPoint = useMemo(() => ({ x: width * 0.22, y: height * 0.52 }), [height, width]);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setAlert(null);
    setPhase('idle');
  }, []);

  const raise = useCallback((item) => {
    const now = Date.now();
    for (const [key, at] of seen.current) {
      if (now - at > DUPLICATE_TTL_MS) seen.current.delete(key);
    }
    const key = item.id || `${item.body || ''}`;
    if (seen.current.has(key)) return;
    seen.current.set(key, now);
    // Rank boards, rivalries and the feed all moved behind this fight too.
    invalidateAfterLandLoss();
    haptic.light();
    clearTimeout(timer.current);
    setAlert({
      id: item.id || now,
      body: item.body || 'A rival ran your border and your territory held.',
      focus: focusFrom(item.data),
      attacker: {
        id: item.actor_id || item.data?.attacker_id || 'attacker',
        avatar: item.actor_avatar || item.data?.attacker_avatar || {},
      },
    });
    setPhase('playback');
    setPlayToken((value) => value + 1);
  }, []);

  useEffect(
    () => subscribeNotificationEvents((item) => {
      if (item.category === 'defended' || item.data?.category === 'defended') raise(item);
    }),
    [raise]
  );

  if (!alert) return null;

  const ink = nbInk(scheme, HOLD_GREEN);

  return (
    <>
    <Modal visible={phase === 'playback'} transparent statusBarTranslucent animationType="fade">
      <View style={styles.defenseScene} pointerEvents="none">
        <Animated.View style={[StyleSheet.absoluteFill, defenseStage.style]}>
          <CaptureCast
            ref={castRef}
            attacker={alert.attacker.avatar}
            attackerPoint={attackerPoint}
            defenders={[{ id: 'local-defender', avatar: equipped }]}
            defenderRects={defenderRects}
            bounds={bounds}
            reducedMotion={reduced}
          />
          <DefenseStylePlayer
            style="seedance_shield_counter"
            playToken={playToken}
            bounds={bounds}
            claimPoint={{ x: width / 2, y: height * 0.55 }}
            territoryRings={[]}
            characterRect={{ x: attackerPoint.x - 48, y: attackerPoint.y - 48, width: 96, height: 96 }}
            defenderRects={defenderRects}
            defenderCount={1}
            reducedMotion={reduced}
            seed={String(alert.id)}
            tint="#2DD4BF"
            ink="#0C0C10"
            stage={defenseStage}
            cast={castRef}
            onComplete={() => {
              setPhase('payoff');
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setAlert(null), DWELL_MS);
            }}
          />
        </Animated.View>
      </View>
    </Modal>
    {phase === 'payoff' ? <Animated.View
      key={alert.id}
      entering={FadeInUp.duration(240)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, { top: insets.top + space.xs }]}
      pointerEvents="box-none"
    >
      <HardShadow radius={radius.card} on={HOLD_GREEN}>
        <PressableScale
          onPress={() => {
            dismiss();
            onOpen?.(alert.focus);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Your defense held. ${alert.body}`}
          style={[styles.card, { backgroundColor: HOLD_GREEN, borderColor: ink }]}
        >
          {/* The defender, whole, in the outfit they held the line in. A win is
              a flex moment, so the payoff shows the runner rather than an
              icon; the shield rides at their feet. */}
          <View style={styles.hero}>
            <RunnerFigure equipped={equipped} height={HERO_H} pose="celebrate" poseDelay={250} />
            <View style={[styles.shield, { backgroundColor: HOLD_GREEN, borderColor: ink }]}>
              <ShieldCheck size={16} color={ink} strokeWidth={3} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.labelSm, { color: ink }]}>DEFENSE HELD</Text>
            <Text style={[type.title, { color: ink }]} numberOfLines={1}>STILL YOURS</Text>
            <Text style={[type.bodySm, { color: ink }]} numberOfLines={2}>
              {alert.body}
            </Text>
          </View>
        </PressableScale>
      </HardShadow>
      <PressableScale
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dismiss}
      >
        <Text style={[type.labelSm, { color: colors.textMuted }]}>DISMISS</Text>
      </PressableScale>
    </Animated.View> : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.gutter, right: space.gutter, alignItems: 'stretch' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: NB.stroke,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  hero: { height: HERO_H, justifyContent: 'flex-end' },
  shield: {
    position: 'absolute',
    right: -8,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismiss: { alignSelf: 'center', paddingTop: space.sm, paddingHorizontal: space.md },
  defenseScene: { flex: 1, backgroundColor: 'rgba(12,12,16,0.92)', overflow: 'hidden' },
});

export default DefenseHeldBanner;
