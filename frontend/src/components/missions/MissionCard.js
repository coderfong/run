// One mission: what to do, how far along, and what it pays.
//
// THREE STATES, AND THE CARD IS A DIFFERENT COLOUR IN EACH. Running, finished
// and waiting to be collected, and collected. The middle one is the whole
// reason this screen gets opened, so it is the loudest thing on the page: the
// card goes green, the reward chip grows a Claim tab, and the row is the only
// one on screen that can be pressed.
//
// PROGRESS IS STATED TWICE, ON PURPOSE: the bar is the feel and the fraction
// is the fact. "3/24" over a bar that has barely moved is honest in a way that
// either one alone is not.

//
// THE CARD NEVER MOVES; ITS PAYOUT DOES. A claimable card breathes only its
// reward chip, not the whole card, so the text you are reading stays still.
// Finishing a mission while the screen is open pops the chip once (with a
// success tap), and collecting it pops the tick once. Neither replays when the
// screen is re-entered on a mission that was already in that state.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import AppIcon from '../AppIcon';
import { ProgressTrack } from '../ui/toon';
import { PressableScale, haptic, useOnScreen, useReduceMotion } from '../../ui/motion';
import { brand, fonts, nbInk, nbRadius, radius, space, useTheme, useThemedType, withAlpha } from '../../theme';

// The metric a goal is counted in decides how it is written. A distance
// mission counting "1847/5000" would be technically right and unreadable.
function formatPair(mission) {
  const { metric, value, goal } = mission;
  if (metric === 'distance') {
    return `${(value / 1000).toFixed(1)} / ${(goal / 1000).toFixed(0)} km`;
  }
  if (metric === 'duration') {
    return `${Math.floor(value / 60)} / ${Math.round(goal / 60)} min`;
  }
  if (metric === 'steal_area') {
    return `${Math.round(value).toLocaleString()} / ${goal.toLocaleString()} m2`;
  }
  return `${Math.floor(value)} / ${goal}`;
}

// True once `flag` has turned on AFTER the first render: a change witnessed,
// not a state arrived in.
function useTurnedOn(flag) {
  const initial = useRef(flag);
  return !initial.current && flag;
}

// The reward chip's (and the tick's) motion, on ONE view: a single pop
// (0.8 → 1.1 → 1) when `pop` turns on, and a slow breath while `breathe`.
// One view rather than Pop wrapped around Pulse: the product of two scales is
// one scale, and the nested pair also wedged the jest Reanimated runtime.
function ChipMotion({ pop = false, breathe = false, style, children }) {
  const reduced = useReduceMotion();
  const onScreen = useOnScreen(breathe && !reduced);
  const hop = useSharedValue(1);
  const breath = useSharedValue(1);

  useEffect(() => {
    if (!pop || reduced) return undefined;
    hop.value = withSequence(
      withTiming(0.8, { duration: 0 }),
      withTiming(1.1, { duration: 170, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 190, easing: Easing.inOut(Easing.quad) })
    );
    return () => {
      cancelAnimation(hop);
      hop.value = 1;
    };
  }, [pop, reduced, hop]);

  useEffect(() => {
    if (!breathe || reduced || !onScreen) {
      cancelAnimation(breath);
      breath.value = 1;
      return undefined;
    }
    breath.value = withRepeat(withTiming(1.06, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(breath);
  }, [breathe, reduced, onScreen, breath]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: hop.value * breath.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

function MissionCard({ mission, accent, onClaim, busy, onLayout }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();

  const claimable = mission.complete && !mission.claimed;
  const done = mission.claimed;
  const justFinished = useTurnedOn(claimable);
  const justCollected = useTurnedOn(done);
  useEffect(() => {
    if (justFinished) haptic.success();
  }, [justFinished]);

  // Green is reserved for success everywhere else in the app (see the note on
  // NB_DECK in theme/nb.js), which is exactly what a finished mission is.
  const fill = claimable
    ? withAlpha('#22c55e', 0.25)
    : done
      ? withAlpha(colors.text, 0.04)
      : colors.card;
  const edge = claimable ? '#22c55e' : nbInk(scheme, fill);

  const body = (
    <View style={[styles.wrap, { opacity: done ? 0.75 : 1 }]} onLayout={onLayout}>
      <View style={[styles.card, { backgroundColor: fill, borderColor: edge }]}>
        <View style={styles.left}>
          <Text style={[type.bodyBold, { color: colors.text }]} numberOfLines={2}>
            {mission.text}
          </Text>
          <View style={styles.trackRow}>
            <ProgressTrack
              value={mission.progress}
              height={16}
              fill={claimable ? colors.ok : accent || brand.pink}
              on={fill}
              style={styles.track}
            />
            <Text style={[styles.pair, { color: colors.text }]}>{formatPair(mission)}</Text>
          </View>
        </View>

        <View style={styles.rewardWrap}>
          <ChipMotion pop={justFinished} breathe={claimable && !busy}>
              <View
                style={[
                  styles.reward,
                  { backgroundColor: colors.cardAlt, borderColor: nbInk(scheme, colors.cardAlt) },
                ]}
              >
                <AppIcon name="coin" size={22} />
                <Text style={[styles.rewardText, { color: colors.text }]}>{mission.reward}</Text>
              </View>
          </ChipMotion>
          {claimable ? (
            <View style={[styles.claimTab, { backgroundColor: '#22c55e' }]} />
          ) : null}
          {done ? (
            <ChipMotion pop={justCollected} style={styles.tick}>
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path
                  d="M5 13 L10 18 L19 6"
                  stroke={colors.ok}
                  strokeWidth={3.2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </ChipMotion>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (!claimable) return body;

  return (
    <PressableScale
      onPress={busy ? undefined : onClaim}
      accessibilityRole="button"
      accessibilityLabel={`${mission.text}. Finished. Collect ${mission.reward} coins.`}
    >
      {body}
    </PressableScale>
  );
}

export default React.memo(MissionCard);

const styles = StyleSheet.create({
  wrap: { marginTop: space.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    minHeight: 96,
    borderRadius: nbRadius.sm,
    borderWidth: 2,
  },
  left: { flex: 1, minWidth: 0 },
  trackRow: { marginTop: space.sm, justifyContent: 'center' },
  track: { width: '100%' },
  pair: {
    position: 'absolute',
    alignSelf: 'center',
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  rewardWrap: { alignItems: 'center', minWidth: 66 },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 2,
  },
  rewardText: { fontFamily: fonts.bold, fontSize: 14 },
  claimTab: {
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  tick: { marginTop: space.xs },
});
