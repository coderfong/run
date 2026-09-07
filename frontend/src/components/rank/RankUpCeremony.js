// Promotion. The one moment the ladder exists to produce.
//
// FOUR BEATS, ONE TIMELINE:
//
//   1. FLOOD     the screen goes to a column of the new tier's light, the old
//                badge standing in it. Everything else is gone: no card, no
//                header, no tab bar. For a second and a half the app is a
//                colour and a silhouette.
//   2. TURN      the badge changes tier INSIDE the light, at the brightest
//                frame, so the swap is never actually seen — you look away
//                into the glare and look back at something better. Crossfading
//                two badges in plain view reads as a loading state.
//   3. LAND      the light falls away, the new badge settles, and the plaque
//                and the percentile arrive under it.
//   4. HOLD      "Tap to continue". Nothing auto dismisses. A promotion that
//                takes itself off screen is a notification.
//
// THE LIGHT IS A COLUMN, NOT A GLOW. A radial burst behind a badge reads as a
// highlight on a badge. A vertical shaft with the badge inside it reads as the
// badge being lifted through something, which is the whole metaphor of a rank
// going up, and it is what the reference does.
//
// REDUCE MOTION shows beat 3 immediately: the new badge, the new plaque, the
// same "Tap to continue". It is a promotion, so it still gets a screen of its
// own; it just does not perform.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import RankBadge, { RankPlaque } from './RankBadge';
import { tierAt } from '../../config/rankLadder';
import { Confetti, haptic, useReduceMotion } from '../../ui/motion';
import { fonts, space, withAlpha } from '../../theme';

// Beat boundaries, in ms from the start.
const FLOOD_MS = 620;      // the light rushing in
const TURN_AT = 900;       // the badge changes at the brightest point
const LAND_AT = 1500;      // the light begins to fall away
const LAND_MS = 620;

/** The shaft of light. Bright core, tier coloured shoulders, hard top and bottom. */
function LightColumn({ width, height, tint, glow }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="shaft" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={tint} stopOpacity="0" />
          <Stop offset="0.18" stopColor={tint} stopOpacity="0.85" />
          <Stop offset="0.42" stopColor={glow} stopOpacity="1" />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity="1" />
          <Stop offset="0.58" stopColor={glow} stopOpacity="1" />
          <Stop offset="0.82" stopColor={tint} stopOpacity="0.85" />
          <Stop offset="1" stopColor={tint} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill="url(#shaft)" />
    </Svg>
  );
}

/**
 * @param {boolean} visible
 * @param {object}  from      the standing before the promotion (for the badge that goes in)
 * @param {object}  to        the standing after it (what comes out)
 * @param {number}  topPercent  the measured share at the new tier, or null
 * @param {object}  equipped  the avatar to wear
 * @param {Function} onDone   dismissed
 */
export default function RankUpCeremony({ visible, from, to, topPercent, equipped, onDone }) {
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const timers = useRef([]);

  // Which badge is standing in the light. Flips once, at the brightest frame.
  const [turned, setTurned] = useState(false);
  const [landed, setLanded] = useState(false);

  const flood = useSharedValue(0);
  const badge = useSharedValue(0);
  const settle = useSharedValue(0);

  // Keyed on `visible` and Reduce Motion only. The shared values are left out
  // deliberately: this effect drives the four beats AND the two pieces of
  // state they are read through, so a dependency that changes identity on
  // every render (which animation handles do under the reanimated jest mock)
  // would restart the ceremony from beat one, forever. They are stable refs at
  // runtime and read through `.value`, so nothing is stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return undefined;
    timers.current.forEach(clearTimeout);
    timers.current = [];

    if (reduced) {
      setTurned(true);
      setLanded(true);
      flood.value = 0;
      badge.value = 0;
      settle.value = 1;
      haptic.success();
      return undefined;
    }

    setTurned(false);
    setLanded(false);
    settle.value = 0;

    // 1. FLOOD
    flood.value = withSequence(
      withTiming(1, { duration: FLOOD_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(LAND_AT - FLOOD_MS, withTiming(0, { duration: LAND_MS, easing: Easing.in(Easing.quad) }))
    );
    // The badge rides up through the shaft and settles back.
    badge.value = withSequence(
      withTiming(1, { duration: FLOOD_MS, easing: Easing.out(Easing.quad) }),
      withDelay(LAND_AT - FLOOD_MS, withSpring(0, { damping: 12, stiffness: 150 }))
    );
    haptic.medium();

    // 2. TURN
    timers.current.push(setTimeout(() => {
      setTurned(true);
      haptic.heavy();
    }, TURN_AT));

    // 3. LAND
    timers.current.push(setTimeout(() => {
      setLanded(true);
      settle.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
      haptic.success();
    }, LAND_AT + LAND_MS * 0.5));

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      cancelAnimation(flood);
      cancelAnimation(badge);
      cancelAnimation(settle);
    };
  }, [visible, reduced]);

  const shaftStyle = useAnimatedStyle(() => ({
    opacity: flood.value,
    transform: [{ scaleX: 0.35 + flood.value * 0.65 }],
  }));
  const washStyle = useAnimatedStyle(() => ({ opacity: flood.value * 0.9 }));
  const badgeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -26 * badge.value },
      { scale: 1 + 0.18 * badge.value },
    ],
  }));
  const settleStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ translateY: 14 * (1 - settle.value) }],
  }));

  if (!visible || !to) return null;

  const shown = turned ? to : (from || to);
  const shownTier = tierAt(shown.tier);
  const newTier = tierAt(to.tier);

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <Pressable
        style={[styles.page, { backgroundColor: withAlpha(newTier.ink, 1) }]}
        onPress={landed ? onDone : undefined}
        accessibilityRole="button"
        accessibilityLabel={`Promoted to ${to.name}. Tap to continue.`}
      >
        {/* The tier's colour washing the whole page under the shaft. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: newTier.color }, washStyle]}
        />

        <View style={styles.stage}>
          <Animated.View style={[styles.shaft, { width: width * 0.72, height }, shaftStyle]} pointerEvents="none">
            <LightColumn width={width * 0.72} height={height} tint={newTier.color} glow={newTier.glow} />
          </Animated.View>

          <Animated.View style={badgeStyle}>
            <RankBadge
              tierKey={shownTier.key}
              equipped={equipped}
              size={150}
              division={shown.division}
              color={shownTier.color}
              showStars={landed || reduced}
            />
          </Animated.View>

          {/* Everything under the badge arrives only once the light is gone —
              a plaque legible through the glare would mean the glare was not
              bright enough. */}
          <Animated.View style={[styles.settled, settleStyle]} pointerEvents="none">
            <RankPlaque
              name={to.name}
              color={newTier.color}
              ink={newTier.ink}
              width={228}
              height={46}
            />
            {topPercent != null ? (
              <Text style={styles.percentile}>
                <Text style={styles.percentileValue}>{`TOP ${topPercent}% `}</Text>
                OF RUNNERS
              </Text>
            ) : null}
          </Animated.View>
        </View>

        {landed ? (
          <>
            {!reduced ? <Confetti count={22} /> : null}
            <Text style={styles.continue}>Tap to continue</Text>
          </>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  shaft: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },

  settled: { alignItems: 'center', marginTop: space.xl },
  percentile: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.8)',
    marginTop: space.sm,
  },
  percentileValue: { fontFamily: fonts.bold, color: '#ffffff' },

  continue: {
    position: 'absolute',
    bottom: space.huge,
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.9)',
  },
});
