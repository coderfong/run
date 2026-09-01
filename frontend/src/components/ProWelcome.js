// ProWelcome — the moment a PASER PRO subscription goes live.
//
// WHAT IT REPLACES. Joining PRO was a one line toast — "PASER PRO is active!" —
// slid in over whatever screen the paywall happened to close onto, gone in two
// seconds. That is the receipt for the largest thing a runner ever chooses to
// do in this app, shown smaller than a coin pickup. The app already owns a
// vocabulary for a real payoff (the reward reveal's turning ray fan, the drawn
// confetti, the struck badge) and crossing into PRO was the one deliberate
// threshold not using any of it.
//
// So it is a MOMENT now: the screen gives way to the same deep lightbox the
// reveal scrims to, a gold fan turns behind a struck badge, and the thing the
// runner just unlocked is spelled out underneath — not a generic "thanks", the
// actual perk list, because "what did I just get" is the question this screen
// exists to answer.
//
// ONE FAMILY, NOT ONE SCREEN. It shares `RevealRays` (imported, not re-drawn)
// with the reward reveal and LevelUpCelebration, tinted with PRO's gold rather
// than a rarity, so the three payoffs read as relatives.
//
// IT IS ACKNOWLEDGED, NOT TIMED OUT. A level rolls past on its own; joining PRO
// is a threshold you step over, and there is a list to read, so this one waits
// for a tap. The long auto close is only a floor so a dropped `onClose` can
// never strand somebody behind a modal.
//
// RESTORE SAYS "WELCOME BACK". The same ceremony carries a returning
// subscriber — a reinstall, a new device — with only the headline changed, so
// getting PRO back feels like getting PRO, not like clearing an error.
//
// REDUCED MOTION keeps the whole thing and stops it moving: the backdrop, the
// badge, the wordmark and every perk row are CONTENT and stay; the spin, the
// confetti and the springs go.

import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import AppIcon from './AppIcon';
import GameAnimation from './GameAnimation';
import { RevealRays } from './RewardReveal';
import { Framed, OutlinedText } from './ui';
import ToonButton from './ui/ToonButton';
import { GOLD, PRO_PERKS } from '../config/pro';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { Confetti, Reveal, haptic, staggerDelay, useReduceMotion } from '../ui/motion';
import { nbTextOn, space, toon, toonType, useThemedType } from '../theme';

// The same deep ink the reward reveal and the level-up moment scrim to. A
// celebration that is charcoal in dark mode and cream in light is two different
// moments; this one is a lightbox and picks its own ground.
const BACKDROP = '#140E24';

// One full turn of the ray fan. Slow enough to read as light rather than as a
// spinning graphic — matched to LevelUpCelebration on purpose.
const SPIN_MS = 16000;

// A floor, not a target. The screen is dismissed by a tap or the button; this
// only exists so a missed `onClose` cannot leave a modal up for the session.
const AUTO_MS = 15000;

// The perks worth naming in a celebration. The full six live on the paywall
// where they are an argument; here they are a reminder, and four short lines
// clear a small screen without a scroll.
const SHOWN_PERKS = PRO_PERKS.slice(0, 4);

export default function ProWelcome({ visible, returning = false, onClose }) {
  const type = useThemedType();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  const scrim = useSharedValue(0);
  const spin = useSharedValue(0);
  const hero = useSharedValue(0);
  const label = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      // An infinite repeat left running keeps turning on the UI thread behind
      // whatever screen comes next. Fading it out is not the same as stopping.
      cancelAnimation(spin);
      spin.value = 0;
      scrim.value = 0;
      hero.value = 0;
      label.value = 0;
      return undefined;
    }

    // The one haptic this owns, on the beat the badge lands.
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
      // Struck onto the stage and settling, rather than fading in. The
      // overshoot is the arrival; the second spring is the landing.
      hero.value = withDelay(
        90,
        withSequence(
          withSpring(1.08, { damping: 9, stiffness: 240 }),
          withSpring(1, { damping: 14, stiffness: 200 })
        )
      );
      label.value = withDelay(420, withTiming(1, { duration: 240 }));
    }

    const timer = setTimeout(() => onClose?.(), AUTO_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(spin);
    };
  }, [visible, returning, reduced, onClose, scrim, spin, hero, label]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const raysStyle = useAnimatedStyle(() => ({
    opacity: 0.62 * scrim.value,
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));
  const heroStyle = useAnimatedStyle(() => ({
    opacity: hero.value > 0 ? 1 : 0,
    transform: [
      { scale: hero.value },
      { translateY: (1 - Math.min(1, hero.value)) * 60 },
    ],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 12 }],
  }));

  if (!visible) return null;

  // Sized off the DIAGONAL so the fan clears the corners at every angle it
  // turns through. A square clipped to the screen would sweep bare backdrop
  // across a corner once a turn.
  const raySize = Math.ceil(Math.hypot(width, height));
  const badgeSize = Math.min(Math.round(width * 0.42), 172);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Dismiss">
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
            <RevealRays size={raySize} tint={GOLD} />
          </Animated.View>
          {/* Drawn, not decoded, and a no-op on its own under Reduce Motion. */}
          <Confetti count={40} />
        </View>

        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.center}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[{ width: badgeSize, height: badgeSize }, heroStyle]} pointerEvents="none">
            {/* Behind the badge and only behind it: the gold hit is what makes
                the arrival land. Keyed so re-rendering does not replay it. */}
            <View style={[StyleSheet.absoluteFill, styles.stageFx]}>
              <GameAnimation name="impactGold" size={badgeSize * 1.6} trigger={visible ? 1 : 0} />
            </View>
            <GameAnimation
              name="achievementBadge"
              size={badgeSize}
              trigger={visible ? 1 : 0}
              still={reduced}
            />
          </Animated.View>

          <Animated.View style={[styles.labelWrap, labelStyle]}>
            <OutlinedText style={[toonType.hero, { color: GOLD }]} outline={toon.ink} width={3}>
              PASER PRO
            </OutlinedText>
            <Framed
              frame={frameVariant('chip', returning ? 'prowelcome:back' : 'prowelcome:new')}
              fill={GOLD}
              on={GOLD}
              weight={INK.base}
              pose={framePose('prowelcome')}
              inset={5}
              style={styles.chip}
            >
              <Text style={[type.title, styles.chipText, { color: nbTextOn(GOLD) }]}>
                {returning ? 'WELCOME BACK' : "YOU'RE IN"}
              </Text>
            </Framed>
          </Animated.View>

          <View style={styles.perks} pointerEvents="none">
            {SHOWN_PERKS.map(([icon, text], i) => (
              <Reveal
                key={icon}
                from="up"
                delay={reduced ? 0 : staggerDelay(i, 620)}
                style={styles.perkRow}
              >
                <AppIcon name={icon} size={22} />
                <Text style={[type.bodySm, styles.perkText]}>{text}</Text>
              </Reveal>
            ))}
          </View>

          <ToonButton title="Let's go" onPress={onClose} style={styles.cta} />
          <Text style={[type.caption, styles.hint]}>tap anywhere to continue</Text>
        </ScrollView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  // The effects run full bleed and are clipped by the screen. That is what
  // makes them a background instead of a picture of one.
  bleed: { overflow: 'hidden' },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    paddingVertical: space.xl,
  },
  stageFx: { alignItems: 'center', justifyContent: 'center' },
  labelWrap: { alignItems: 'center', marginTop: space.lg },
  chip: { marginTop: space.md },
  chipText: { letterSpacing: 1, paddingHorizontal: space.sm },
  perks: { alignSelf: 'stretch', marginTop: space.xl, gap: space.sm },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  perkText: { flex: 1, color: 'rgba(255,255,255,0.92)' },
  cta: { alignSelf: 'stretch', marginTop: space.xl },
  hint: { color: 'rgba(255,255,255,0.62)', marginTop: space.md },
});
