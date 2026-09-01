// The in-app tutorial — comic coach marks that play OVER the real home
// screen the first time a new runner lands there (the app is visible and
// dimmed behind, so the cards teach against the thing they describe).
//
// Armed by `completeIntro()` in state/profile.js and mounted by App.js while
// `profile.tutorialPending` is true. The last card hands off into the first
// run (the record modal) rather than to Pasers — a brand-new account has no
// pasers to add yet, so the strongest next step is to go run.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Flag, ShieldCheck, Swords, Zap } from 'lucide-react-native';

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
//
// `title` is the headline; `sub` is one plain sentence under it that carries
// the actual mechanic (a headline alone can't). Keep `sub` short, plain and
// dash-free — same voice rules as the rest of the app's copy.
const CARDS = [
  {
    key: 'welcome',
    rig: true, // the character they just made takes the first panel
    icon: Flag,
    aspect: 4 / 3,
    title: (name) => (name ? `Welcome to PASER, ${name}!` : 'Welcome to PASER!'),
    sub: 'The streets you run become land you own.',
    cta: 'Next',
  },
  {
    key: 'claim',
    artKey: 'claim',
    icon: Flag,
    aspect: 1,
    title: () => 'Every run earns you ground',
    sub: 'Finish a run, then place your claim anywhere along the route you took. Longer runs claim more.',
    cta: 'Next',
  },
  {
    key: 'energy',
    artKey: 'energy',
    icon: Zap,
    aspect: 4 / 3,
    title: () => 'Claiming costs Energy',
    sub: 'Running earns it back, and your first claim each day is half price.',
    cta: 'Next',
  },
  {
    key: 'defend',
    artKey: 'clans',
    icon: Swords,
    aspect: 1,
    title: () => 'Land you take is never safe',
    sub: 'Anyone who runs over your ground can claim it back. Reinforce it on your next run, or join a club so your teammates help you hold it.',
    cta: 'Next',
  },
  {
    key: 'safety',
    artKey: 'safety',
    icon: ShieldCheck,
    aspect: 1,
    title: () => "Territory can wait. Traffic can't.",
    sub: 'Eyes up at crossings. Every run is checked, so there is no prize for cutting corners.',
    cta: 'Next',
  },
  {
    key: 'run',
    icon: Flag,
    aspect: 4 / 3,
    title: () => 'Go claim your first patch',
    sub: 'Pick a loop around your block and watch it land on the map.',
    cta: 'Start my run',
    action: 'run',
  },
];

export default function TutorialOverlay({ name, onDone, onStartRun }) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { equipped } = useAvatar();
  const [i, setI] = useState(0);
  const card = CARDS[i];
  const Icon = card.icon;

  const advance = () => {
    haptic.light();
    if (card.action === 'run') {
      onDone?.();
      onStartRun?.();
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

          {card.sub ? <Text style={styles.sub}>{card.sub}</Text> : null}

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
  sub: {
    ...toonType.body,
    color: 'rgba(255,255,255,0.82)',
    alignSelf: 'stretch',
    marginTop: -space.sm,
  },

  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dotOn: { backgroundColor: '#fff', width: 18 },
});
