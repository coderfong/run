// The three cards that say what PASER IS, before it asks the runner for
// anything.
//
// WHY THEY MOVED HERE. The game used to be explained by the tutorial coach
// marks, which play AFTER onboarding, over the home screen. That meant the
// first-run flow opened by asking for a name, a birthday and a face from
// somebody who had not yet been told what they were signing up to, and a
// tester could finish the whole of onboarding without being able to say what
// the app was for. Account and avatar are the price of entry; they should not
// be the pitch.
//
// THREE CARDS, THREE QUESTIONS, IN THIS ORDER: what do I do, what happens when
// I do it, why keep doing it. Nothing else goes in front. Energy, clubs,
// Crossed Paths and PRO are all real, and all of them are noise to somebody
// who does not yet know that running paints the map — they wait for the coach
// marks (TutorialOverlay) and for the game itself.
//
// NO PRIZE PROMISE. "Rewards" here means the ones the app always has: levels,
// boxes, the board. Seasonal prize campaigns say so themselves, when they are
// running.

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { ART_BG, art } from '../../config/onboardingArt';
import { ComicPanel, StepHeadline } from '../ui';

export const INTRO_CARDS = [
  {
    key: 'intro-claim',
    artKey: 'claim',
    aspect: 1,
    title: 'Run to claim your city',
    sub: 'Your runs capture zones on the map.',
  },
  {
    key: 'intro-defend',
    artKey: 'clans',
    aspect: 1,
    title: 'Take them. Keep them.',
    sub: 'Other runners can take your zones. Run them again to take them back.',
  },
  {
    key: 'intro-climb',
    artKey: 'leaderboard',
    aspect: 4 / 3,
    title: 'Climb the board',
    sub: 'Hold ground, outrun your rivals and earn rewards as you go.',
  },
];

export default function IntroStep({ card, onContinue, isLast }) {
  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <ComicPanel
          source={art(card.artKey)}
          bg={ART_BG[card.artKey] || '#241B2E'}
          aspect={card.aspect}
        />

        <StepHeadline
          title={card.title}
          sub={card.sub}
          style={{ marginTop: space.lg }}
        />

        <ToonButton
          title={isLast ? "Let's go" : 'Next'}
          onPress={onContinue}
          style={{ marginTop: space.xl }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: space.lg,
    paddingHorizontal: space.gutter,
  },
});
