// LevelUpCelebration — the full-screen moment a level is crossed.
//
// WHAT IT REPLACES. A level-up was a 64pt burst laid on top of two words on
// the result card, and that was the whole of it: the rarest thing that happens
// on that screen was smaller than the coin chip underneath it, and the art was
// drawn over the very words naming what had happened. Meanwhile the app
// already had the vocabulary for a real payoff — the reveal's turning ray fan,
// the drawn confetti, the character rig — and a level was the one earned
// moment not using any of it.
//
// So a level is a MOMENT now: the screen gives way, the runner's own character
// comes up onto a lit stage with the ladder's colour behind them, and the
// number they just reached is stamped underneath. It is the same backdrop the
// reward reveal uses (`RevealRays`, imported rather than re-drawn) tinted with
// the LEVEL BAND rather than a rarity, so the two payoffs read as members of
// one family without being the same screen.
//
// IT IS THE RUNNER, NOT A TROPHY. The character is the point. A generic badge
// says a number went up; the avatar somebody dressed themselves, standing in
// the light with confetti on it, says THEY went up. `equipped` is the same
// loadout every other rig on the result screen is drawn from, so it is already
// in hand at the call site.
//
// IT NEVER STACKS ON ANOTHER CELEBRATION. The result screen has a whole
// sequence of overlays — the claim payoff, the standings wipe, the crossed
// paths reveal — and two of those on screen at once is a mess, not a bigger
// party. The caller holds the level until nothing else is up; see the queue in
// ResultScreen.
//
// REDUCED MOTION keeps the whole thing and stops it moving: the stage, the
// character and the number are CONTENT (this is the only place the level is
// announced), so they stay. The spin, the confetti and the springs go.

import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import CharacterRig, { BODY_RATIO, HEADROOM } from './character/CharacterRig';
import GameAnimation from './GameAnimation';
import GameLottie from './GameLottie';
import { RevealRays } from './RewardReveal';
import { Framed, OutlinedText } from './ui';
import { levelBandColor } from '../config/progression';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { Confetti, haptic, useReduceMotion } from '../ui/motion';
import { nbTextOn, space, toon, toonType, useThemedType } from '../theme';

// The same deep ink the reward reveal scrims to. A celebration that is charcoal
// in dark mode and cream in light is two different moments; this one is a
// lightbox, so it picks its own ground and keeps it.
const BACKDROP = '#140E24';

// One full turn of the ray fan. Slow enough to read as light rather than as a
// spinning graphic.
const SPIN_MS = 16000;

// How long the moment holds before it lets go on its own. Long enough to look
// at the character, short enough that nobody has to dismiss it to carry on —
// and a tap takes it away sooner either way.
const AUTO_MS = 4200;
const AUTO_MS_REDUCED = 2400;

export default function LevelUpCelebration({ visible, level, equipped, accent, onClose }) {
  const type = useThemedType();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  const scrim = useSharedValue(0);
  const spin = useSharedValue(0);
  const hero = useSharedValue(0);
  const label = useSharedValue(0);

  useEffect(() => {
    if (!visible || level == null) {
      // An infinite repeat left running keeps turning on the UI thread behind
      // whatever screen comes next, for the rest of the session. Fading it out
      // is not the same as stopping it.
      cancelAnimation(spin);
      spin.value = 0;
      scrim.value = 0;
      hero.value = 0;
      label.value = 0;
      return undefined;
    }

    // The one haptic this owns. A level is rare, and this is the beat it lands
    // on — the bar's own success tick fires as the fill crosses, which is a
    // moment earlier and a different event.
    haptic.success();

    if (reduced) {
      scrim.value = 1;
      hero.value = 1;
      label.value = 1;
    } else {
      scrim.value = withTiming(1, { duration: 180 });
      spin.value = withRepeat(
        withTiming(1, { duration: SPIN_MS, easing: Easing.linear }),
        -1,
        false
      );
      // A clean camera-like reveal: a small rise and scale settles exactly at
      // 1. There is deliberately no spring/overshoot here; making the runner
      // bounce turned the person into part of the UI effect.
      hero.value = withDelay(
        90,
        withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) })
      );
      label.value = withDelay(680, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    }

    const timer = setTimeout(() => onClose?.(), reduced ? AUTO_MS_REDUCED : AUTO_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(spin);
    };
  }, [visible, level, reduced, onClose, scrim, spin, hero, label]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const raysStyle = useAnimatedStyle(() => ({
    opacity: 0.62 * scrim.value,
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));
  const heroStyle = useAnimatedStyle(() => ({
    opacity: hero.value,
    transform: [
      { scale: 0.94 + hero.value * 0.06 },
      { translateY: (1 - hero.value) * 28 },
    ],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 12 }],
  }));

  if (level == null) return null;

  const band = levelBandColor(level);
  const tint = accent || band;
  // Sized off the DIAGONAL so the fan clears the corners at every angle it
  // turns through. A square clipped to the screen would sweep bare backdrop
  // across a corner once a turn.
  const raySize = Math.ceil(Math.hypot(width, height));
  const rigSize = Math.min(width * 0.42, (height * 0.46) / (BODY_RATIO * (1 + HEADROOM)), 180);

  return (
    <Modal visible={!!visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Dismiss level up">
        <Animated.View style={[styles.fill, { backgroundColor: BACKDROP }, scrimStyle]} />

        <View style={[styles.fill, styles.bleed]} pointerEvents="none">
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: (width - raySize) / 2,
                top: (height - raySize) / 2,
                width: raySize,
                height: raySize,
              },
              raysStyle,
            ]}
          >
            <RevealRays size={raySize} tint={tint} />
          </Animated.View>
          {/* Drawn, not decoded — full screen at whatever resolution the device
              has, and a no-op on its own under Reduce Motion. */}
          {visible ? <Confetti count={38} /> : null}
        </View>

        <View style={styles.center} pointerEvents="none">
          {/* The runner owns only the runner entrance and its impact light. */}
          <Animated.View style={[{ alignItems: 'center' }, heroStyle]}>
            {/* Behind the runner, and only behind them: the gold hit is what
                makes the arrival land. It fires once, keyed on the level, so
                re-rendering the screen underneath does not replay it. */}
            <View style={[StyleSheet.absoluteFill, styles.stageFx]}>
              <GameAnimation name="impactGold" size={rigSize * 1.5} trigger={level} />
            </View>
            <CharacterRig equipped={equipped} size={rigSize} animate={false} clanColor={tint} />
          </Animated.View>

          <Animated.View style={[styles.labelWrap, labelStyle]}>
            {/* A standalone Lottie with its own authored motion and lifecycle.
                It is a level-change symbol, not part of the avatar rig. */}
            <GameLottie name="levelUpArrow" size={72} trigger={level} />
            <OutlinedText style={[toonType.hero, { color: '#fff' }]} outline={toon.ink} width={3}>
              LEVEL UP
            </OutlinedText>
            {/* The number, in the same drawn chip the result card wears — the
                ladder's own colour, so the band change that comes with every
                fifth level is part of the celebration rather than something
                noticed later on a profile. */}
            <Framed
              frame={frameVariant('chip', `levelup:${level}`)}
              fill={band}
              on={band}
              weight={INK.base}
              pose={framePose(`levelup:${level}`)}
              inset={5}
              style={styles.chip}
            >
              <Text style={[type.title, styles.chipText, { color: nbTextOn(band) }]}>
                {`LEVEL ${level}`}
              </Text>
            </Framed>
            <Text style={[type.caption, styles.hint]}>tap to continue</Text>
          </Animated.View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  // The effects run full bleed and are clipped by the screen. That is what
  // makes them a background instead of a picture of one.
  bleed: { overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  stageFx: { alignItems: 'center', justifyContent: 'center' },
  labelWrap: { alignItems: 'center', marginTop: space.lg, gap: space.xs },
  chip: { marginTop: space.md },
  chipText: { letterSpacing: 1, paddingHorizontal: space.sm },
  hint: { color: 'rgba(255,255,255,0.62)', marginTop: space.md },
});
