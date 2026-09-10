// The rank ladder, full screen.
//
// Its own page rather than a section of the pass, because the two ladders
// answer different questions and putting them on one screen is what made the
// old progression page a wall. Levels are the treadmill: XP only ever goes up,
// and the pass pays you for distance. Rank is the competition: it moves both
// ways, it is what your portrait border shows, and it is the only number here
// that can fall. See backend/app/ranks.py for why they are separate systems.
//
// TWO REQUESTS, AND THE PAGE DRAWS WITH EITHER. The standing comes from the
// progression payload, which is almost always already cached, so the ladder
// renders on the first frame. The percentiles are a second, slower request
// (it counts every rated player), and until it lands the plaques simply have
// no percentile line rather than a spinner or a placeholder number.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { Screen, ToonHeader } from '../components/ui';
import RankLadder from '../components/rank/RankLadder';
import { RANK_TIERS, standingFrom } from '../config/rankLadder';
import { brand, space, useTheme, useThemedType } from '../theme';
import { ScreenIn } from '../ui/motion';

export default function RankLadderScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { equipped } = useAvatar();

  const { data: progression } = useQuery('me:progression', api.progression);
  // Cached for a long while on purpose: a percentile that changes between two
  // openings of the same screen reads as noise, and this is the most expensive
  // read on the page.
  const { data: ladder } = useQuery('leaderboard:rank-ladder', api.rankLadder, {
    staleMs: 5 * 60 * 1000,
  });

  const standing = useMemo(() => standingFrom(progression?.rank), [progression?.rank]);

  // Thresholds come from the measured ladder when it has landed. Before that
  // the rungs still draw, just without their numbers — which is the honest
  // version of not knowing them yet.
  const floors = useMemo(
    () => (ladder?.tiers || []).map((t) => t.floor),
    [ladder]
  );
  const shares = useMemo(
    () => (ladder?.tiers || []).map((t) => t.top_percent),
    [ladder]
  );

  return (
    <Screen gutter={false} edges={[]}>
      {/* ONE LINE, AND NOTHING ELSE. The header carried an eyebrow, a display
          sized tier name and a sentence about the gap, which is a hundred and
          forty points of flat pink standing on top of the ladder it is
          labelling — and every word of it is already on the rungs below (the
          plaque names the tier, the band prints the gap, the rail prints your
          points). It is chrome over the thing that matters, so it is sized
          like chrome: a title line at `type.title`, tight padding, done. */}
      <ToonHeader
        panel
        compact
        title={`Rank: ${standing.name}`}
        solid={standing.color}
        top={insets.top}
        titleStyle={type.title}
        onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined}
        style={styles.header}
      />

      {/* The ladder cannot be drawn honestly until the standing is in hand —
          a rung column that renders at Wood and then jumps to Gold is the
          screen assembling in front of you. Held behind one fade, with
          ScreenIn's own timeout as the guard so a slow read can never leave
          this blank. */}
      <ScreenIn ready={!!progression} armed style={{ flex: 1 }}>
      <RankLadder
        standing={standing}
        floors={floors.length === RANK_TIERS.length ? floors : []}
        shares={shares.length === RANK_TIERS.length ? shares : []}
        equipped={equipped}
        contentStyle={styles.content}
      />
      </ScreenIn>

      <View style={styles.footer}>
        <Text style={[type.caption, { color: colors.textDim }]}>
          Rank points come from ground taken and held. They fall when you stop.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Tighter than `compact` on its own: with no subtitle under the title there
  // is nothing for the standard bottom pad to separate the title from.
  header: { paddingBottom: space.sm, marginBottom: space.sm },
  content: { paddingLeft: space.sm },
  footer: { paddingHorizontal: space.gutter, paddingVertical: space.md },
});
