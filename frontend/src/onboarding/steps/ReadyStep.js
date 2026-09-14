// "You're all set" — the payoff screen that closes the intro: the finished
// runner takes a bow under confetti, then the app opens.

import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { haptic, useReduceMotion } from '../../ui/motion';
import CharacterRig from '../../components/character/CharacterRig';
import GameAnimation, { AnimationStack } from '../../components/GameAnimation';
import { animationSpec } from '../../config/gameAnimations';
import { useAvatar } from '../../state/avatar';
import { StepHeadline } from '../ui';

// How long the banner lingers on its last frame before dissolving, and how long
// the dissolve takes.
const WELL_DONE_HOLD = 420;
const WELL_DONE_FADE = 900;

export default function ReadyStep({ name, onContinue }) {
  const { equipped } = useAvatar();
  const reduced = useReduceMotion();
  const rigRef = useRef(null);

  // WELL DONE plays once and then holds its final frame — forever, because
  // expo-image parks a finished clip on its last frame. So the banner just sat
  // there over the runner it was congratulating. It fades out into the night
  // instead, once its own authored duration has run.
  const wellDone = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    const played = animationSpec('wellDone')?.duration ?? 1570;
    wellDone.value = withDelay(
      played + WELL_DONE_HOLD,
      withTiming(0, { duration: WELL_DONE_FADE })
    );
  }, [reduced, wellDone]);
  const wellDoneStyle = useAnimatedStyle(() => ({ opacity: wellDone.value }));

  useEffect(() => {
    haptic.success();
    const t = setTimeout(() => rigRef.current?.play('celebrate'), 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.fill}>
      {/* The confetti and sparkles fade on the same clock as the banner — they
          are one beat, and half of it dissolving would read as a glitch. */}
      <Animated.View style={[styles.celebrationFx, wellDoneStyle]} pointerEvents="none">
        <AnimationStack names={['confettiRibbons', 'wellDoneSparkles']} size={300} />
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <StepHeadline
          title={name ? `Looking good, ${name}!` : 'Looking good!'}
          sub="Your runner is ready to claim some ground."
        />
        <View style={styles.stage}>
          <Animated.View style={[styles.wellDone, wellDoneStyle]} pointerEvents="none">
            <GameAnimation name="wellDone" size={190} />
          </Animated.View>
          <CharacterRig ref={rigRef} equipped={equipped} size={110} animate />
        </View>

        {/* With the payoff, not pinned to the bottom edge below it. */}
        <ToonButton title="Let's run" onPress={onContinue} style={styles.cta} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // flexGrow + centred content: the step sits in the middle of whatever room
  // it has, and scrolls instead of clipping when it doesn't have enough. The
  // Continue button lives INSIDE this column now, which is exactly the height
  // a small phone did not have spare.
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.gutter,
    paddingVertical: space.lg,
    alignItems: 'stretch',
  },
  stage: { alignItems: 'center', marginTop: space.lg },
  celebrationFx: { position: 'absolute', top: 76, left: 0, right: 0, alignItems: 'center' },
  wellDone: { marginBottom: -30 },
  cta: { marginTop: space.xl },
});
