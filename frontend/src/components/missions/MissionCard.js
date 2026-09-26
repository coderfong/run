// One mission: what to do, how far along, and what it pays.
//
// ON THE PAPER, NOT IN A CARD ON TOP OF IT. This used to be a bordered,
// filled box that changed colour with the mission's state; the board it sits
// on is itself a drawn parchment, and stacking a second, machine-drawn
// surface over hand-drawn paper read as a settings list pinned to the wrong
// background. Now it is text, a bar, a reward chip and a hairline printed
// straight onto the paper, and the THREE STATES read through colour on the
// pieces that already have some (the progress bar's own fill, the claim tab,
// the tick) rather than through a card that goes green.
//
// PROGRESS IS STATED TWICE, ON PURPOSE: the bar is the feel and the fraction
// is the fact. "3/24" over a bar that has barely moved is honest in a way that
// either one alone is not.
//
// THE ROW NEVER MOVES; ITS PAYOUT DOES. A claimable row breathes only its
// reward chip, not the whole row, so the text you are reading stays still.
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
import { brand, fonts, radius, space, useTheme, useThemedType, withAlpha } from '../../theme';

// The parchment's own ink, the same brown MissionsScreen.js sets its title
// and purse in — fixed, not themed, because the parchment underneath is a
// drawn asset that does not change with the app's dark/light setting.
const INK = '#3A1D0A';

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
  const { colors } = useTheme();
  const type = useThemedType();

  const claimable = mission.complete && !mission.claimed;
  const done = mission.claimed;
  const justFinished = useTurnedOn(claimable);
  const justCollected = useTurnedOn(done);
  useEffect(() => {
    if (justFinished) haptic.success();
  }, [justFinished]);

  const body = (
    <View style={[styles.wrap, { opacity: done ? 0.75 : 1 }]} onLayout={onLayout}>
      <View style={styles.left}>
        <Text style={[type.bodyBold, styles.text]} numberOfLines={2}>
          {mission.text}
        </Text>
        <View style={styles.trackRow}>
          <ProgressTrack
            value={mission.progress}
            height={16}
            fill={claimable ? colors.ok : accent || brand.pink}
            style={styles.track}
          />
          <Text style={styles.pair}>{formatPair(mission)}</Text>
        </View>
      </View>

      <View style={styles.rewardWrap}>
        <ChipMotion pop={justFinished} breathe={claimable && !busy}>
          <View style={styles.reward}>
            <AppIcon name="coin" size={22} />
            <Text style={styles.rewardText}>{mission.reward}</Text>
          </View>
        </ChipMotion>
        {claimable ? (
          <View style={[styles.claimTab, { backgroundColor: '#22c55e' }]}>
            <Text style={styles.claimTabText}>Claim</Text>
          </View>
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
  // Flexbox row directly on the paper now, not a card: gap and a bottom
  // hairline instead of padding-inside-a-box do the same job of keeping one
  // mission from running into the next.
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(INK, 0.18),
  },
  left: { flex: 1, minWidth: 0 },
  // The parchment doesn't change with the app's theme (it's a drawn asset),
  // so its text can't either — `colors.text` would go pale in dark mode and
  // all but vanish against the paper. INK is the same dark brown the board's
  // own title and purse are set in (MissionsScreen.js).
  text: { color: INK },
  trackRow: { marginTop: space.sm, justifyContent: 'center' },
  track: { width: '100%' },
  pair: {
    position: 'absolute',
    alignSelf: 'center',
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.2,
    color: INK,
  },

  rewardWrap: { alignItems: 'center', minWidth: 66 },
  // A small chip round the coin count is kept — it is the reward, the one
  // thing on the row worth a bit of shape — but nothing bigger.
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: withAlpha(INK, 0.35),
    backgroundColor: withAlpha('#FFFFFF', 0.4),
  },
  rewardText: { fontFamily: fonts.bold, fontSize: 14, color: INK },
  claimTab: {
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  claimTabText: { fontFamily: fonts.bold, fontSize: 11, color: '#FFFFFF', letterSpacing: 0.3 },
  tick: { marginTop: space.xs },
});
