import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { brand, darkColors, radius, shadow, space, toon, type } from '../../theme';
import { useReduceMotion } from '../../ui/motion';
import EffectPlayer from '../../effects/EffectPlayer';
import GameLottie from '../GameLottie';
import OutlinedText from '../ui/OutlinedText';

const EVENT_COPY = {
  kilometre: (event) => ({ title: `${event.value} KM`, body: 'Split secured', lottie: 'kilometre' }),
  claimReady: () => ({ title: 'CLAIM READY', body: 'This run can secure territory', lottie: 'claimReady' }),
  rivalEntry: () => ({ title: 'RIVAL TURF', body: 'You crossed into contested ground', lottie: 'rivalEntry' }),
};

// The three ticks and the GO, each with its own sheet out of the curated FX
// library. Deliberately DIFFERENT art per beat rather than one effect played
// four times: a countdown that repeats itself has no build in it, and the whole
// job of a countdown is to build.
//
// Nothing here is a new asset. These four are already in the bundle for the
// claim celebrations, which matters — the project is over the OTA asset cap
// (docs: eas update fails at 1000 referenced assets) and a countdown is not
// worth another native build on its own.
const COUNT_FX = {
  3: { id: 'sunburn_ring_01', size: 300 },
  2: { id: 'electric_burst_01', size: 300 },
  1: { id: 'solar_shrapnel_01', size: 320 },
  GO: { id: 'warm_explosion_01', size: 380 },
};

// One clock per beat, 0 → 1 over the beat's own length. Every transform below
// reads it, so the ring, the digit and the shake can never drift apart the way
// four independently-timed animations do.
const TICK_MS = 520;

/**
 * The start countdown: three · two · one · GO.
 *
 * It used to be a number in a circle with a ZoomIn on it, which is the same
 * gesture at the same size four times over. Now the digit is THROWN at you —
 * over-scaled and blurred past its resting size, snapped back with a bounce,
 * held, then punched out towards the viewer as the next one arrives — over a
 * different burst each time, with the ring behind it sweeping closed as the
 * beat runs out. GO is the only one that leaves rather than shrinks.
 */
export function RunStartOverlay({ value, trigger }) {
  const reduced = useReduceMotion();
  const clock = useSharedValue(0);
  const go = value === 'GO';
  const fx = value == null ? null : COUNT_FX[value];

  useEffect(() => {
    cancelAnimation(clock);
    if (value == null) return undefined;
    if (reduced) {
      clock.value = 0.5;
      return undefined;
    }
    clock.value = 0;
    clock.value = withTiming(1, { duration: TICK_MS, easing: Easing.linear });
    return () => cancelAnimation(clock);
  }, [clock, reduced, value]);

  // In hard and heavy, settle, then punch out towards the viewer. The overshoot
  // is on the way IN (1.5 → 0.86 → 1) rather than on the way out, so the beat
  // lands on the snap-back and the exit is pure follow-through.
  const digitStyle = useAnimatedStyle(() => ({
    opacity: interpolate(clock.value, [0, 0.06, 0.82, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(
          clock.value,
          [0, 0.16, 0.3, 0.82, 1],
          [1.5, 0.86, 1, 1, go ? 1.9 : 1.45],
          Extrapolation.CLAMP
        ),
      },
      {
        // A shudder on the landing, and nothing after it. Three degrees is
        // enough to read as impact at this size; more reads as a wobble.
        rotate: `${interpolate(
          clock.value,
          [0.16, 0.22, 0.28, 0.34],
          [go ? -5 : -3, go ? 4 : 2.5, -1.5, 0],
          Extrapolation.CLAMP
        )}deg`,
      },
    ],
  }));

  // The ring behind the digit sweeps closed over the beat, so the time left in
  // the count is readable without reading the number.
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(clock.value, [0, 0.12, 0.9, 1], [0, 0.9, 0.9, 0], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(clock.value, [0, 1], [1.35, 0.98], Extrapolation.CLAMP) },
      { rotate: `${interpolate(clock.value, [0, 1], [0, go ? 40 : 18], Extrapolation.CLAMP)}deg` },
    ],
  }));

  // The scrim pulses with the beat rather than sitting flat, so the screen
  // itself takes part in the count.
  const scrimStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(7,9,13,${interpolate(
      clock.value,
      [0, 0.18, 1],
      [0.22, 0.5, 0.34],
      Extrapolation.CLAMP
    )})`,
  }));

  if (value == null) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.fullOverlay, scrimStyle]}>
      {/* The burst for this beat. Keyed on the value so each tick mounts its
          own player and starts from frame zero — one player fed a changing id
          would carry the previous sheet's playhead into the next beat. */}
      {fx ? (
        <View style={styles.startLottie}>
          <EffectPlayer
            key={`${value}:${trigger}`}
            effect={fx.id}
            size={fx.size}
            playToken={`${value}:${trigger}`}
          />
        </View>
      ) : null}
      {go ? <GameLottie name="runStart" size={260} trigger={trigger} style={styles.startLottie} /> : null}

      <Animated.View style={[styles.countRing, go && styles.goRing, ringStyle]} />

      <Animated.View
        key={`${value}:${trigger}`}
        style={[styles.countBubble, go && styles.goBubble, digitStyle]}
      >
        <OutlinedText
          style={[styles.countText, go && styles.goText]}
          outline={toon.ink}
          width={go ? 4 : 3}
        >
          {String(value)}
        </OutlinedText>
      </Animated.View>

      <Text style={styles.readyLabel}>{go ? 'RUN!' : 'GET READY'}</Text>
    </Animated.View>
  );
}

export function RunEventOverlay({ event, onDone }) {
  const reduced = useReduceMotion();
  useEffect(() => {
    if (!event) return undefined;
    const id = setTimeout(() => onDone?.(), reduced ? 750 : 1550);
    return () => clearTimeout(id);
  }, [event, onDone, reduced]);

  if (!event) return null;
  const copy = EVENT_COPY[event.kind]?.(event);
  if (!copy) return null;

  return (
    <View pointerEvents="none" style={styles.eventHost}>
      <GameLottie name={copy.lottie} size={220} trigger={event.token} style={styles.eventLottie} />
      <Animated.View
        key={event.token}
        entering={reduced ? undefined : FadeIn.duration(160)}
        exiting={reduced ? undefined : FadeOut.duration(180)}
        style={[styles.eventCard, event.kind === 'rivalEntry' && styles.rivalCard]}
      >
        <Text style={styles.eventTitle}>{copy.title}</Text>
        <Text style={styles.eventBody}>{copy.body}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startLottie: { position: 'absolute' },
  // A ring rather than a filled disc: the burst plays BEHIND the number, and a
  // solid plate in the middle of the screen would hide the thing it is meant to
  // be announcing.
  countRing: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.85)',
    borderTopColor: 'transparent',
    borderRightColor: 'rgba(255,255,255,0.28)',
  },
  goRing: { borderColor: brand.teal, borderTopColor: 'transparent', borderRightColor: 'rgba(45,212,191,0.3)' },
  countBubble: {
    minWidth: 112,
    height: 112,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goBubble: { minWidth: 146 },
  countText: { ...type.display, color: '#ffffff', fontSize: 76, lineHeight: 84 },
  goText: { color: brand.teal, fontSize: 58, lineHeight: 66 },
  readyLabel: { ...type.label, color: '#ffffff', marginTop: space.md, letterSpacing: 2 },
  eventHost: {
    position: 'absolute',
    zIndex: 45,
    left: 0,
    right: 0,
    top: '19%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLottie: { position: 'absolute' },
  eventCard: {
    minWidth: 210,
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    backgroundColor: 'rgba(17,24,39,0.92)',
    borderWidth: 2,
    borderColor: brand.teal,
    ...shadow.raised,
  },
  rivalCard: { borderColor: darkColors.danger },
  eventTitle: { ...type.heading, color: '#ffffff', letterSpacing: 1.2 },
  eventBody: { ...type.caption, color: 'rgba(255,255,255,0.78)', marginTop: 2 },
});
