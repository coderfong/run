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

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import AppIcon from '../AppIcon';
import { ProgressTrack } from '../ui/toon';
import { PressableScale, Pulse } from '../../ui/motion';
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

export default function MissionCard({ mission, accent, onClaim, busy, onLayout }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();

  const claimable = mission.complete && !mission.claimed;
  const done = mission.claimed;

  // Green is reserved for success everywhere else in the app (see the note on
  // NB_DECK in theme/nb.js), which is exactly what a finished mission is.
  const fill = claimable
    ? withAlpha(colors.ok, 0.18)
    : done
      ? withAlpha(colors.text, 0.04)
      : colors.card;
  const edge = claimable ? colors.ok : nbInk(scheme, fill);

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
          <View
            style={[
              styles.reward,
              { backgroundColor: colors.cardAlt, borderColor: nbInk(scheme, colors.cardAlt) },
            ]}
          >
            <AppIcon name="coin" size={22} />
            <Text style={[styles.rewardText, { color: colors.text }]}>{mission.reward}</Text>
          </View>
          {claimable ? (
            <View style={[styles.claimTab, { backgroundColor: colors.ok }]}>
              <Text style={styles.claimText}>Claim</Text>
            </View>
          ) : null}
          {done ? (
            <View style={styles.tick}>
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
            </View>
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
      {/* The breath is what says "this one" across a screen of four. */}
      <Pulse active={!busy} min={1} max={1.015} durationMs={1400}>
        {body}
      </Pulse>
    </PressableScale>
  );
}

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
  claimText: { fontFamily: fonts.bold, fontSize: 11, color: '#08130c', letterSpacing: 0.3 },
  tick: { marginTop: space.xs },
});
