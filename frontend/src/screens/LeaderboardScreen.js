// Standalone Leaderboard route (HomeStack / deep link). The list itself lives
// in LeaderboardView, which Home also embeds in its segmented control.
//
// Two boards, because they answer different questions:
//   Rank — who's winning ground. Points decay with inactivity and are lost
//          when someone takes your land, so this is the competitive standing
//          the portrait border is drawn from.
//   Land — who simply holds the most ground right now.

import React, { useState } from 'react';
import { View } from 'react-native';

import { space, useTheme } from '../theme';
import { Segmented } from '../components/ui';
import LeaderboardView from '../components/LeaderboardView';

const TABS = [
  { key: 'rank', label: 'Rank' },
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
