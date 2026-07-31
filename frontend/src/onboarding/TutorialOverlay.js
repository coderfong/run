// The in-app tutorial — comic coach marks that play OVER the real home
// screen the first time a new runner lands there (the app is visible and
// dimmed behind, so the cards teach against the thing they describe).
//
// Armed by `completeIntro()` in state/profile.js and mounted by App.js while
// `profile.tutorialPending` is true. The last card hands off to Pasers.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Flag, ShieldCheck, Swords, UserPlus, Zap } from 'lucide-react-native';

import { space } from '../theme';
import { OutlinedText, ToonButton } from '../components/ui';
import { haptic, useReduceMotion } from '../ui/motion';
import { art, ART_BG } from '../config/onboardingArt';
import CharacterRig from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';
import { ComicPanel } from './ui';
import { toon, toonType } from './toon';

// `artKey` looks the illustration up in config/onboardingArt.js — cards whose
// art has not been generated yet fall back to the icon (or, on the welcome
// card, to the runner the player just built) on a tinted panel. `aspect`
// matches the source art so `contain` never letterboxes oddly: the existing
// story art is square, new panels are 4:3.
const CARDS = [
  {
    key: 'welcome',
    rig: true, // the character they just made takes the first panel
    icon: Flag,
    aspect: 4 / 3,
    title: (name) => (name ? `Welcome to PASER, ${name}!` : 'Welcome to PASER!'),
    cta: 'Next',
  },
  {
    key: 'claim',
    artKey: 'claim',
    icon: Flag,
    aspect: 1,
    title: () => 'Every run earns you ground to claim',
    cta: 'Next',
  },
  {
    key: 'energy',
    artKey: 'energy',
    icon: Zap,
    aspect: 4 / 3,
    title: () => 'Energy powers your claims — runs refill it',
    cta: 'Next',
  },
  {
    key: 'clans',
    artKey: 'clans',
    icon: Swords,
    aspect: 1,
    title: () => 'Clubs will come to take your land',
    cta: 'Next',
  },
  {
    key: 'safety',
    artKey: 'safety',
    icon: ShieldCheck,
    aspect: 1,
    title: () => "Territory can wait. Traffic can't.",
    cta: 'Got it',
  },
  {
    key: 'pasers',
    artKey: 'pasers',
    icon: UserPlus,
    aspect: 4 / 3,
    title: () => 'Add a paser to race the day with',
    cta: "Let's add a paser!",
    action: 'pasers',
  },
];

export default function TutorialOverlay({ name, onDone, onAddPaser }) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { equipped } = useAvatar();
  const [i, setI] = useState(0);
  const card = CARDS[i];
  const Icon = card.icon;

  const advance = () => {
    haptic.light();
    if (card.action === 'pasers') {
      onDone?.();
      onAddPaser?.();
      return;
    }
    if (i === CARDS.length - 1) {
      onDone?.();
      return;
    }
    setI((n) => n + 1);
  };

  const skip = () => {
    haptic.light();
    onDone?.();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dim the live app behind. Tapping the scrim advances — except on the
          last card, where the only action navigates away and a stray tap
          shouldn't trigger it. */}
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={card.action ? undefined : advance}
        accessibilityRole={card.action ? 'none' : 'button'}
        accessibilityLabel={card.action ? undefined : 'Next tip'}
      />

      <View style={[styles.skip, { top: insets.top + space.sm }]}>
        <Pressable onPress={skip} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip tutorial">
          <Text style={[toonType.label, { color: 'rgba(255,255,255,0.8)' }]}>Skip</Text>
        </Pressable>
      </View>

      <Animated.View
        key={card.key}
        style={styles.stack}
        entering={reduced ? undefined : FadeIn.duration(220)}
        exiting={reduced ? undefined : FadeOut.duration(120)}
      >
        <ComicPanel
          source={card.artKey ? art(card.artKey) : null}
          bg={ART_BG[card.artKey || card.key] || '#241B2E'}
          aspect={card.aspect}
          style={styles.panel}
          fallback={
            card.rig ? (
              <CharacterRig equipped={equipped} size={72} animate />
            ) : (
              <Icon size={72} color="#fff" strokeWidth={2} />
            )
          }
        />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.dots}>
            {CARDS.map((c, n) => (
              <View key={c.key} style={[styles.dot, n === i && styles.dotOn]} />
            ))}
          </View>

          <OutlinedText
            style={[toonType.headline, { color: '#fff' }]}
            outline={toon.ink}
            width={2.5}
            containerStyle={styles.title}
          >
            {card.title(name)}
          </OutlinedText>

          <ToonButton title={card.cta} onPress={advance} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(6,6,10,0.66)' },
  skip: { position: 'absolute', right: space.gutter },

  stack: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: {
    // the sheet overlaps the panel's bottom corners, comic-strip style
    marginBottom: -28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  sheet: {
    backgroundColor: '#1A1B22',
    borderTopWidth: 3,
    borderColor: toon.ink,
    paddingHorizontal: space.gutter,
    paddingTop: space.lg,
    gap: space.lg,
  },
  title: { alignSelf: 'stretch' },

  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dotOn: { backgroundColor: '#fff', width: 18 },
});
