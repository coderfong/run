// The rank ladder, full screen. The authoritative ladder: where am I, what is
// next, and what tiers exist.
//
// Its own page rather than a section of the pass, because the two ladders
// answer different questions. Levels are the treadmill: XP only ever goes up.
// Rank is the competition: it moves both ways, it is what your portrait border
// shows, and it is the only number here that can fall.
//
// LAYOUT. A compact cream header (the old full width pink panel was chrome
// standing on the thing it labelled), then the summary pinned under it (tier,
// points, your percentile ONCE, what is next, and the one line about where
// rank points come from, which used to sit orphaned under the ladder), then
// the ladder itself. The summary and the post claim screen are built from the
// same RankLadderKit parts, so the two read as one system.
//
// TWO REQUESTS, AND THE PAGE DRAWS WITH EITHER. The standing comes from the
// progression payload, almost always cached. The percentiles are a slower
// request; until it lands the percentile is simply absent. Thresholds fall back
// to the mirrored floors (config/rankLadder RANK_FLOORS), so the rail is never
// drawn without numbers.

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { Screen } from '../components/ui';
import RankLadder from '../components/rank/RankLadder';
import { CurrentRankSummary, RankHeader } from '../components/rank/RankLadderKit';
import { RANK_TIERS, standingFrom } from '../config/rankLadder';
import { ScreenIn } from '../ui/motion';
import { TIP, useTutorialTip } from '../tutorial';

// Short and factual: points come from taking and holding land, and they fall
// when land is lost or when you stop (decay). No dashes, one idea per line.
export const RANK_NOTE = 'Rank points come from land you take and hold. They fall when you lose land or stop running.';

export default function RankLadderScreen({ navigation }) {
  // One card, the first time this screen is opened. See src/tutorial/tips.js.
  useTutorialTip(TIP.RANK);
  const insets = useSafeAreaInsets();
  const { equipped } = useAvatar();

  const { data: progression } = useQuery('me:progression', api.progression);
  // Cached for a long while on purpose: a percentile that changes between two
  // openings of the same screen reads as noise.
  const { data: ladder } = useQuery('leaderboard:rank-ladder', api.rankLadder, {
    staleMs: 5 * 60 * 1000,
  });

  const standing = useMemo(() => standingFrom(progression?.rank), [progression?.rank]);

  const floors = useMemo(() => (ladder?.tiers || []).map((t) => t.floor), [ladder]);
  const shares = useMemo(() => (ladder?.tiers || []).map((t) => t.top_percent), [ladder]);
  const whole = (list) => (list.length === RANK_TIERS.length ? list : []);
  const myPercent = whole(shares)[standing.tier] ?? null;

  return (
    <Screen gutter={false} edges={[]}>
      <RankHeader
        title="Rank ladder"
        top={insets.top}
        onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined}
      />

      {/* The ladder cannot be drawn honestly until the standing is in hand: a
          column that renders at Wood and then jumps to Gold is the screen
          assembling in front of you. ScreenIn's own timeout guards a slow read. */}
      <ScreenIn ready={!!progression} armed style={styles.body}>
        <CurrentRankSummary
          standing={standing}
          topPercent={myPercent}
          equipped={equipped}
          note={RANK_NOTE}
        />
        <RankLadder
          standing={standing}
          floors={whole(floors)}
          shares={whole(shares)}
          equipped={equipped}
          contentStyle={{ paddingBottom: insets.bottom + 48 }}
        />
      </ScreenIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
