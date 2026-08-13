// The last beat: the runner dashes off the map and drags the standings in
// behind them.
//
// The wipe is character-led on purpose — this is meant to feel like the same
// person who just took the ground carrying you to the board, not a route
// change. Under Reduce Motion it becomes a plain crossfade with every piece of
// information intact.
//
// Rows are the app's real LeaderboardRow, not a lookalike. Rank movement is
// only ever animated when leaderboardData found a genuine previous rank; with
// nothing trustworthy to show, the row simply states where the runner is now.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { brand, space, toon, toonType, useTheme, useThemedType } from '../../theme';
import { CharacterBust } from '../character/CharacterRig';
import { LeaderboardRow } from '../LeaderboardView';
import { OutlinedText, ToonButton } from '../ui';
import { timingFor } from './timing';

const DASH_SIZE = 56;

// Counts from one rank to another over ~450ms. Small deltas only ever need a
// few steps, so this stays a handful of state updates rather than a per-frame
// animation.
function useRankCounter(from, to, enabled) {
  const [value, setValue] = useState(to);
  const timers = useRef(new Set());

  useEffect(() => {
    const set = timers.current;
    set.forEach(clearTimeout);
    set.clear();

    if (!enabled || from == null || to == null || from === to) {
      setValue(to);
      return () => {
        set.forEach(clearTimeout);
        set.clear();
      };
    }

    const steps = Math.min(Math.abs(from - to), 12);
    const step = (to - from) / steps;
    setValue(from);
    for (let i = 1; i <= steps; i++) {
      const id = setTimeout(() => {
        setValue(i === steps ? to : Math.round(from + step * i));
      }, 320 + i * 45);
      set.add(id);
    }

    return () => {
      set.forEach(clearTimeout);
      set.clear();
    };
  }, [from, to, enabled]);

  return value;
}

function PlayerSummary({ data, reducedMotion }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const hasMovement = data?.rankDelta != null && data.rankDelta !== 0;
  const rank = useRankCounter(data?.previousRank, data?.newRank, hasMovement && !reducedMotion);

  if (!data?.newRank) return null;

  return (
    <View style={styles.summary}>
      <OutlinedText style={[toonType.hero, styles.summaryRank]} outline={toon.ink} width={3}>
        {`#${rank}`}
      </OutlinedText>
      {hasMovement ? (
        <OutlinedText
          style={[
            toonType.sub,
            { color: data.rankDelta > 0 ? brand.teal : colors.textMuted },
          ]}
          outline={toon.ink}
          width={2}
        >
          {data.rankDelta > 0
            ? `UP ${data.rankDelta} RANK${data.rankDelta === 1 ? '' : 'S'}`
            : `DOWN ${Math.abs(data.rankDelta)}`}
        </OutlinedText>
      ) : (
        // No snapshot to compare against — state the position, claim nothing.
        <Text style={[type.caption, { color: colors.textMuted }]}>worldwide by land held</Text>
      )}
    </View>
  );
}

export default function LeaderboardTransition({
  visible,
  data,
  attacker,
  reducedMotion = false,
  playToken = 0,
  onDone,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const T = timingFor(reducedMotion);

  const wipe = useSharedValue(0);
  const dashX = useSharedValue(-160);
  const dashOpacity = useSharedValue(0);
  const content = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;

    wipe.value = 0;
    content.value = 0;
    dashOpacity.value = 0;
    dashX.value = -160;

    if (reducedMotion) {
      // Straight crossfade — same phases, no travel.
      wipe.value = withTiming(1, { duration: T.leaderboardWipe });
      content.value = withDelay(T.leaderboardWipe, withTiming(1, { duration: 180 }));
      return;
    }

    // 2 + 3. the character dashes across, streaks trailing
    dashOpacity.value = withSequence(
      withTiming(1, { duration: 90 }),
      withDelay(T.leaderboardWipe - 60, withTiming(0, { duration: 140 }))
    );
    dashX.value = withTiming(screenW + 120, {
      duration: T.leaderboardWipe + 120,
      easing: Easing.inOut(Easing.cubic),
    });

    // 4. the wipe follows the dash across
    wipe.value = withDelay(
      110,
      withTiming(1, { duration: T.leaderboardWipe, easing: Easing.out(Easing.cubic) })
    );

    // 5 + 6. board arrives behind the wipe
    content.value = withDelay(
      T.leaderboardWipe + 140,
      withSpring(1, { damping: 15, stiffness: 180, mass: 0.6 })
    );
  }, [visible, playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const wipeStyle = useAnimatedStyle(() =>
    reducedMotion
      ? { opacity: wipe.value }
      : { opacity: 1, transform: [{ translateX: -screenW + wipe.value * screenW }] }
  );

  const dashStyle = useAnimatedStyle(() => ({
    opacity: dashOpacity.value,
    transform: [{ translateX: dashX.value }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    transform: [{ translateY: (1 - content.value) * 18 }],
  }));

  const rows = useMemo(() => data?.nearbyRows || [], [data]);
  const playerId = data?.playerRow?.user_id;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDone}>
      <View style={styles.root} pointerEvents="box-none">
        {/* the wipe itself — app background, travelling in behind the dash */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, wipeStyle]}
          pointerEvents="none"
        />

        {/* the runner, leading it */}
        {!reducedMotion && (
          <Animated.View style={[styles.dash, dashStyle]} pointerEvents="none">
            <View style={styles.streaks}>
              <View style={[styles.streak, { top: 14, width: 30 }]} />
              <View style={[styles.streak, { top: 26, width: 46 }]} />
              <View style={[styles.streak, { top: 38, width: 24 }]} />
            </View>
            <CharacterBust equipped={attacker || {}} size={DASH_SIZE} bg="transparent" />
          </Animated.View>
        )}

        <Animated.View
          style={[
            styles.content,
            { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg },
            contentStyle,
          ]}
        >
          <OutlinedText style={[toonType.headline, styles.title]} outline={toon.ink} width={2.5}>
            STANDINGS
          </OutlinedText>

          <PlayerSummary data={data} reducedMotion={reducedMotion} />

          {/* 9. the score that just moved */}
          {data?.playerRow ? (
            <Text style={[type.caption, styles.scoreLine, { color: brand.teal }]}>
              {`${((data.playerRow.total_area_m2 || 0) / 1e6).toFixed(3)} km² held · ${data.playerRow.territory_count} territories`}
            </Text>
          ) : null}

          <View style={styles.rows}>
            {rows.map((row, index) => (
              <StaggeredRow
                key={row.user_id}
                row={row}
                index={index}
                isMe={row.user_id === playerId}
                // 7. the player's row lands after the others, with its own pop
                delay={
                  row.user_id === playerId
                    ? rows.length * T.rowStagger + 120
                    : index * T.rowStagger
                }
                reducedMotion={reducedMotion}
                playToken={playToken}
              />
            ))}
          </View>

          {!data && (
            // A standings fetch that failed must never trap the runner here.
            <Text style={[type.caption, styles.fallback, { color: colors.textMuted }]}>
              Standings are unavailable right now. Your territory is safely claimed.
            </Text>
          )}

          <View style={styles.actions}>
            <ToonButton title="Done" variant="teal" onPress={onDone} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function StaggeredRow({ row, index, isMe, delay, reducedMotion, playToken }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      delay,
      reducedMotion
        ? withTiming(1, { duration: 140 })
        : withSpring(1, { damping: 15, stiffness: 220, mass: 0.55 })
    );
  }, [delay, playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 16 },
      // The player's row gets the extra emphasis, not the whole list.
      { scale: isMe ? 0.96 + progress.value * 0.04 : 1 },
    ],
  }));

  return (
    <Animated.View style={style}>
      <LeaderboardRow item={row} isMe={isMe} board="land" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: space.gutter },
  title: { color: '#fff', textAlign: 'center' },
  summary: { alignItems: 'center', marginTop: space.md },
  summaryRank: { color: '#fff', fontSize: 46, lineHeight: 54 },
  scoreLine: { textAlign: 'center', marginTop: 4 },
  rows: { marginTop: space.xl },
  fallback: { textAlign: 'center', marginTop: space.xl },
  actions: { marginTop: 'auto', paddingTop: space.lg },

  dash: {
    position: 'absolute',
    top: '46%',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  streaks: { width: 52, height: DASH_SIZE, marginRight: 2 },
  streak: {
    position: 'absolute',
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    opacity: 0.7,
  },
});
