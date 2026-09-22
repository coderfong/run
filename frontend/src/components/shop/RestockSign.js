// RestockSign — the rotation countdown, drawn as a little board hanging off
// the awning instead of a generic "New items in 8h 11m" chip.
//
// STILL THE ONLY THING ON THE SCREEN THAT TICKS EVERY SECOND, and still
// isolated the same way the old RefreshBar was: the interval lives entirely
// in `useCountdown`, memoised into its own leaf component, so a clock
// running sixty times a minute re-renders one small board rather than the
// illustrated scene around it.
//
// TAPPABLE, per the brief's small-touches list ("tap sign: small wobble"):
// a press gives it a quick physical nudge and a small water-droplet flourish
// off its lower corner — a decorative aside, not a control, so it carries no
// buy/select semantics and never competes with a product tap (nothing else
// occupies this patch of canopy; see shopStageLayout.js's RESTOCK_SIGN note).

import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import GameAnimation from '../GameAnimation';
import { haptic, useReduceMotion } from '../../ui/motion';
import { nbInk, useTheme, useThemedType } from '../../theme';

function useCountdown(expiresAt) {
  const remaining = (expiry) => (expiry ? Math.max(0, expiry * 1000 - Date.now()) : 0);
  const [clock, setClock] = useState(() => ({ expiresAt, left: remaining(expiresAt) }));
  useEffect(() => {
    if (!expiresAt) {
      setClock({ expiresAt, left: 0 });
      return undefined;
    }
    const tick = () => setClock({ expiresAt, left: remaining(expiresAt) });
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const ready = clock.expiresAt === expiresAt;
  const left = ready ? clock.left : null;
  if (left == null) return { left, text: null };
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, text: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` };
}

function sceneLayer(f, scale, cropTop) {
  return {
    position: 'absolute',
    left: f.x * scale,
    top: (f.y - cropTop) * scale,
    width: f.width * scale,
    height: f.height * scale,
  };
}

// The board's resting angle — see the styles comment below for why it hangs
// a hair askew even at rest.
const REST_DEG = -1.4;
const SPLASH_MS = 3000; // matches seedanceWaterSplash's real encoded duration

const RestockSign = memo(function RestockSign({ frame, scale, cropTop, expiresAt, onExpire }) {
  const { scheme } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const { left, text } = useCountdown(expiresAt);
  const fired = useRef(null);
  const [splashing, setSplashing] = useState(false);
  const wobble = useSharedValue(REST_DEG);

  useEffect(() => {
    if (!expiresAt || left == null || left !== 0) return;
    if (fired.current === expiresAt) return;
    fired.current = expiresAt;
    onExpire?.();
  }, [left, expiresAt, onExpire]);

  const ink = nbInk(scheme, '#3B2A1E');

  const onPress = () => {
    haptic.light();
    if (!reduced) {
      wobble.value = withSequence(
        withTiming(REST_DEG + 9, { duration: 70, easing: Easing.out(Easing.quad) }),
        withTiming(REST_DEG - 6, { duration: 110, easing: Easing.inOut(Easing.quad) }),
        withTiming(REST_DEG + 3, { duration: 110, easing: Easing.inOut(Easing.quad) }),
        withTiming(REST_DEG, { duration: 140, easing: Easing.out(Easing.quad) })
      );
      setSplashing(true);
      setTimeout(() => setSplashing(false), SPLASH_MS);
    }
  };

  const wobbleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wobble.value}deg` }] }));

  return (
    <View style={sceneLayer(frame, scale, cropTop)}>
      {/* A short rope, then the board — hung off the canopy rail like the
          medal and bottle beside it. */}
      <View style={[styles.rope, { backgroundColor: ink }]} />
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={expiresAt && text ? `Next drop in ${text}` : 'Next drop soon'}
        style={styles.touch}
      >
        <Animated.View style={[styles.board, { borderColor: ink }, wobbleStyle]}>
          <Text style={[type.caption, { fontSize: 10, color: '#F4E9D8', letterSpacing: 1 }]}>NEXT DROP</Text>
          <Text style={[type.bodyBold, { fontSize: 15, color: '#FFF4E0', letterSpacing: 0.5 }]}>
            {expiresAt && text ? text : 'soon'}
          </Text>
        </Animated.View>
      </TouchableOpacity>
      {splashing ? (
        <View style={styles.splashAnchor} pointerEvents="none">
          <GameAnimation name="seedanceWaterSplash" size={54} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  rope: { alignSelf: 'center', width: 3, height: 14 },
  touch: { flex: 1 },
  board: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 3,
    backgroundColor: '#5A3D26',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  // Off the board's lower-right corner, like a drip shaken loose by the
  // wobble rather than something the board itself is doing.
  splashAnchor: { position: 'absolute', right: -14, bottom: -18 },
});

export default RestockSign;
