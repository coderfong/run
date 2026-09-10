// Demotion. The rank up ceremony played the other way, and quieter.
//
// THREE BEATS, ONE TIMELINE:
//
//   1. SLIP   the badge you had stands on its own tier's colour, shudders once
//             and sinks, while the page drains from that tier's colour into
//             the one below.
//   2. TURN   at the bottom of the sink, small and dim, the badge changes to
//             the lower tier. The swap happens where you are not looking, for
//             the same reason the promotion hides its swap in the glare.
//   3. LAND   it rises back into place, the plaque names where you stand now,
//             and one line says how to get back. "Tap to continue".
//
// NO LIGHT AND NO CONFETTI. A demotion that celebrates reads as a bug. It still
// takes the whole screen, though: finding out from a smaller badge on the You
// page a week later is worse than being told once, plainly.
//
// REDUCE MOTION shows beat 3 at once, the same way the promotion does.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import RankBadge, { RankPlaque } from './RankBadge';
import { tierAt } from '../../config/rankLadder';
import { haptic, useReduceMotion } from '../../ui/motion';
import { fonts, space } from '../../theme';

// Beat boundaries, in ms from the start.
const SHAKE_MS = 360;
const SINK_AT = 420;        // the shudder is over and the badge lets go
const SINK_MS = 560;
const TURN_AT = SINK_AT + SINK_MS;  // the bottom of the sink
const RISE_MS = 520;
const LAND_AT = TURN_AT + RISE_MS * 0.6;

const BADGE = 150;

/**
 * @param {boolean}  visible
 * @param {object}   from      the standing before the drop (the badge that sinks)
 * @param {object}   to        the standing after it (the badge that rises)
 * @param {object}   equipped  the avatar to wear
 * @param {Function} onDone    dismissed
 */
export default function RankDownCeremony({ visible, from, to, equipped, onDone }) {
  const reduced = useReduceMotion();
  const timers = useRef([]);

  const [turned, setTurned] = useState(false);
  const [landed, setLanded] = useState(false);

  const shake = useSharedValue(0);
  const sink = useSharedValue(0);
  const drain = useSharedValue(0);
  const settle = useSharedValue(0);

  // Keyed on `visible` and Reduce Motion only, like RankUpCeremony: the shared
  // values change identity on every render under the reanimated jest mock, and
  // listing them would restart the drop from beat one forever.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return undefined;
    timers.current.forEach(clearTimeout);
    timers.current = [];

    if (reduced) {
      setTurned(true);
      setLanded(true);
      shake.value = 0;
      sink.value = 0;
      drain.value = 1;
      settle.value = 1;
      haptic.medium();
      return undefined;
    }

    setTurned(false);
    setLanded(false);
    sink.value = 0;
    drain.value = 0;
    settle.value = 0;

    // 1. SLIP. One shudder, then the badge lets go.
    shake.value = withSequence(
      withTiming(1, { duration: SHAKE_MS / 6 }),
      withTiming(-1, { duration: SHAKE_MS / 3 }),
      withTiming(0.5, { duration: SHAKE_MS / 4 }),
      withTiming(0, { duration: SHAKE_MS / 4 })
    );
    sink.value = withDelay(
      SINK_AT,
      withSequence(
        withTiming(1, { duration: SINK_MS, easing: Easing.in(Easing.quad) }),
        withSpring(0, { damping: 15, stiffness: 140 })
      )
    );
    drain.value = withDelay(
      SINK_AT,
      withTiming(1, { duration: SINK_MS + RISE_MS, easing: Easing.inOut(Easing.quad) })
    );
    haptic.light();

    // 2. TURN
    timers.current.push(setTimeout(() => {
      setTurned(true);
      haptic.heavy();
    }, TURN_AT));

    // 3. LAND
    timers.current.push(setTimeout(() => {
      setLanded(true);
      settle.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
    }, LAND_AT));

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      cancelAnimation(shake);
      cancelAnimation(sink);
      cancelAnimation(drain);
      cancelAnimation(settle);
    };
  }, [visible, reduced]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.6 * sink.value,
    transform: [
      { translateX: 9 * shake.value },
      { translateY: 64 * sink.value },
      { scale: 1 - 0.24 * sink.value },
    ],
  }));
  // The lower tier's ink and colour coming up over the old ones.
  const drainStyle = useAnimatedStyle(() => ({ opacity: drain.value }));
  const oldWashStyle = useAnimatedStyle(() => ({ opacity: 0.3 * (1 - drain.value) }));
  const newWashStyle = useAnimatedStyle(() => ({ opacity: 0.22 * drain.value }));
  const settleStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ translateY: 14 * (1 - settle.value) }],
  }));

  if (!visible || !to) return null;

  const was = from || to;
  const shown = turned ? to : was;
  const oldTier = tierAt(was.tier);
  const newTier = tierAt(to.tier);
  const shownTier = tierAt(shown.tier);

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <Pressable
        style={[styles.page, { backgroundColor: oldTier.ink }]}
        onPress={landed ? onDone : undefined}
        accessibilityRole="button"
        accessibilityLabel={`Dropped to ${to.name}. Tap to continue.`}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: oldTier.color }, oldWashStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: newTier.ink }, drainStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: newTier.color }, newWashStyle]}
        />

        <View style={styles.stage}>
          <Animated.View style={badgeStyle}>
            <RankBadge
              tierKey={shownTier.key}
              equipped={equipped}
              size={BADGE}
              division={shown.division}
              color={shownTier.color}
              showStars={landed || reduced}
            />
          </Animated.View>

          <Animated.View style={[styles.settled, settleStyle]} pointerEvents="none">
            <RankPlaque name={to.name} color={newTier.color} ink={newTier.ink} width={228} height={46} />
            <Text style={styles.line}>Take land back to climb.</Text>
          </Animated.View>
        </View>

        {landed ? <Text style={styles.continue}>Tap to continue</Text> : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  settled: { alignItems: 'center', marginTop: space.xl },
  line: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginTop: space.md,
  },
  continue: {
    position: 'absolute',
    bottom: space.huge,
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.9)',
  },
});
