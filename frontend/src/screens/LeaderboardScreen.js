// Standalone Leaderboard route (HomeStack / deep link). The list itself lives
// in LeaderboardView, which Home also embeds in its segmented control.
//
// Two boards, because they answer different questions:
//   Rank — pairwise territory results move both runners in opposite
//              directions; the portrait border follows this rating.
//   Land — who simply holds the most ground right now.
//
// WHY THIS SCREEN GOT A HEADER. It was the last hub in the app still opening
// as a bare segmented control floating on an empty page under the plain native
// title bar — no art, no colour, nothing that said which board you were on
// until you read the rows. Every other destination of its kind (Season,
// Rivals, Pasers, Crossroads, Missions) wears Home's hero-card panel, and a
// screen you reach from Home should look like it came from the same app.
//
// THE PANEL IS THE BOARD. Its colour and its sentence change with the tab, so
// the switch is felt as well as read: picking Land turns the header teal and
// says what Land means. That is the same device Season standings uses for its
// scope chips, and it is why the chips live INSIDE the header here rather than
// on the page under it.

import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, space, useThemedType } from '../theme';
import { Screen, Segmented, ToonHeader } from '../components/ui';
import LeaderboardView from '../components/LeaderboardView';
import { art } from '../config/onboardingArt';
import { Reveal } from '../ui/motion';

const TABS = [
  { key: 'rank', label: 'Rank' },
  { key: 'land', label: 'Land' },
];

// One entry per board: what the header says it is, and the colour it says it
// in. Kept beside TABS so a third board cannot be added without deciding both.
const BOARDS = {
  rank: {
    title: 'Rank',
    subtitle: 'Where every runner stands on the ladder',
    panel: brand.purple,
  },
  land: {
    title: 'Land',
    subtitle: 'Who is holding the most ground right now',
    panel: brand.teal,
  },
};

export default function LeaderboardScreen({ navigation }) {
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState('rank');
  const meta = BOARDS[board];

  return (
    <Screen gutter={false} edges={[]}>
      <ToonHeader
        panel
        compact
        eyebrow="Standings"
        title={meta.title}
        subtitle={meta.subtitle}
        // Two lines reserved: the two sentences differ in length, and a header
        // that changed height as you switched boards would move the chips out
        // from under the thumb that just pressed them.
        subtitleLines={2}
        art={art('headerLeaderboard') || art('leaderboard')}
        solid={meta.panel}
        // The art swaps with the board, so it takes the square box rather than
        // being measured per image (see ToonHeader's `stableArt`).
        stableArt
        titleStyle={type.display}
        eyebrowStyle={type.labelSm}
        top={insets.top}
        onBack={() =>
          (navigation?.canGoBack?.() ? navigation.goBack() : navigation?.navigate?.('HomeMain'))
        }
        style={{ marginBottom: space.md }}
      >
        {/* Inside the header, not under it: the chips ARE what the header is
            describing, and a control that changes the panel it sits on reads
            as part of it. */}
        <Segmented options={TABS} value={board} onChange={setBoard} />
      </ToonHeader>

      {/* keyed so switching boards remounts the list rather than animating
          one dataset into the other's row positions — and so the new board
          arrives on its own entrance instead of swapping in cold. */}
      <Reveal key={board} from="none" duration={260} style={{ flex: 1 }}>
        <LeaderboardView board={board} />
      </Reveal>
    </Screen>
  );
}
