// Standalone Leaderboard route (HomeStack / deep link). The list itself lives
// in LeaderboardView, which Home also embeds in its segmented control.
//
// Two boards, because they answer different questions:
//   Solo Elo — pairwise territory results move both runners in opposite
//              directions; the portrait border follows this rating.
//   Land — who simply holds the most ground right now.

import React, { useState } from 'react';
import { View } from 'react-native';

import { space, useTheme } from '../theme';
import { Segmented } from '../components/ui';
import LeaderboardView from '../components/LeaderboardView';

const TABS = [
  { key: 'rank', label: 'Solo Elo' },
  { key: 'land', label: 'Land' },
];

export default function LeaderboardScreen() {
  const { colors } = useTheme();
  const [board, setBoard] = useState('rank');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: space.md }}>
        <Segmented options={TABS} value={board} onChange={setBoard} />
      </View>
      {/* keyed so switching boards remounts the list rather than animating
          one dataset into the other's row positions */}
      <LeaderboardView key={board} board={board} />
    </View>
  );
}
