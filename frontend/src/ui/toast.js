// Tiny global toast. One subscriber (rendered at the root) listens for
// `toast.show(message, opts)` calls and animates a banner.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { NB, nbInk, radius, space, type, useTheme } from '../theme';
import HardShadow from '../components/ui/HardShadow';
import { useReduceMotion } from './motion';

const IN_MS = 240;
const OUT_MS = 200;

let listener = null;

export const toast = {
  show(message, { type = 'info', durationMs = 3200 } = {}) {
    if (listener) listener({ message, type, durationMs, id: Date.now() });
    else if (__DEV__) console.log(`[toast/${type}]`, message);
  },
  error(message, opts = {}) {
    this.show(message, { ...opts, type: 'error' });
  },
  success(message, opts = {}) {
    this.show(message, { ...opts, type: 'success' });
  },
};

export function ToastHost() {
  const [current, setCurrent] = useState(null);
  // The LIVE palette. This used to take the static `colors` export, which is
  // the dark palette whatever the scheme is — so on light mode an info toast
  // painted a near-black bubble with near-black text on it. Same bug the
  // Skeleton had, same fix.
  const { colors: themed, scheme } = useTheme();
  const reduced = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    listener = (msg) => setCurrent(msg);
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return undefined;
    // Snap to the start first: the host returns null between toasts but never
    // unmounts, so the shared value is still sitting at 1 from the last one.
    progress.value = 0;
    if (reduced) {
      progress.value = 1;
    } else {
      // A little overshoot on the way in — it drops in and settles.
      progress.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.back(1.4)) });
    }
    const outAt = setTimeout(() => {
      progress.value = reduced
        ? 0
        : withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.quad) });
    }, current.durationMs);
    const clearAt = setTimeout(
      () => setCurrent(null),
      current.durationMs + (reduced ? 0 : OUT_MS)
    );
    return () => {
      clearTimeout(outAt);
      clearTimeout(clearAt);
    };
  }, [current, reduced, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -16 }, { scale: 0.9 + progress.value * 0.1 }],
  }));

  if (!current) return null;
  const bg =
    current.type === 'error'
      ? themed.danger
      : current.type === 'success'
      ? themed.ok
      : themed.cardAlt;
  const fg =
    current.type === 'success' || current.type === 'error'
      ? '#fff'
      : themed.text;
  // A toast is the most transient thing the app draws and it was the softest:
  // a flat bubble with no edge and no depth, floating over whatever page it
  // interrupted. On a busy screen — the map, a result card — an info toast
  // tinted `cardAlt` was very nearly camouflage.
  //
  // The stroke is judged against the BUBBLE'S OWN FILL, which is the whole
  // point of doing it per surface: the three toast types are a red, a green and
  // a neutral card tint, and a stroke picked off the scheme would be the wrong
  // one for at least one of them in at least one theme.
  return (
    <Animated.View pointerEvents="none" style={[styles.host, animated]}>
      {/* HardShadow: a toast is the one piece of chrome guaranteed to appear
          over arbitrary content, so the drop is what lifts it off whatever is
          behind it, and it has to exist on Android for the same reason. */}
      {/* The width cap rides the WRAPPER. `maxWidth: '100%'` on the bubble used
          to resolve against the host, which is pinned left and right and so has
          a definite width; under a wrapper that sizes itself to its own child
          the percentage has nothing to resolve against, and a long message
          would run off both screen edges. */}
      <HardShadow offset={NB.offset} radius={radius.md} on={bg} style={styles.bubbleBox}>
        <View
          style={[
            styles.bubble,
            { backgroundColor: bg, borderWidth: NB.stroke, borderColor: nbInk(scheme, bg) },
          ]}
        >
          <Text style={[styles.text, { color: fg }]} numberOfLines={3}>
            {current.message}
          </Text>
        </View>
      </HardShadow>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 56,
    left: space.lg,
    right: space.lg,
    alignItems: 'center',
  },
  bubbleBox: { maxWidth: '100%' },
  bubble: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    minWidth: 180,
  },
  text: { ...type.bodySm, textAlign: 'center' },
});
