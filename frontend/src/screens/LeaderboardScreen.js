// Standalone Leaderboard route (HomeStack / deep link). The list itself lives
// in LeaderboardView, which Home also embeds in its segmented control.

import React from 'react';
import { View } from 'react-native';

import { colors } from '../theme';
import LeaderboardView from '../components/LeaderboardView';

export default function LeaderboardScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LeaderboardView />
    </View>
  );
}
