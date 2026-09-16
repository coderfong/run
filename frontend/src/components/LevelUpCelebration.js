// LevelUpCelebration — the full-screen moment a level is crossed.
//
// THREE BEATS, ONE TIMELINE, the same shape the reward reveal runs:
//
//   1. BUILD   the runner comes up standing on a plinth that still carries the
//              OLD number. A cone of light opens up out of the plinth and
//              arrows start climbing beside them, faster and faster, while the
//              number shivers and two rings close on it.
//   2. HIT     a white frame. The old number is knocked off the plinth and the
//              new one slams down in its place (the victory beat's slam, so the
//              two read as family), the plinth takes the new band's colour, a
//              shockwave leaves the number, the runner is lifted a step and the
//              confetti goes. The one haptic this owns lands here.
//   3. GLORY   LEVEL UP stamps in a letter at a time, each letter a sticker
//              with a hard shadow in the runner's colour, sparkles catch, and
//              the arrows keep climbing while the fan turns.
//
// WHY IT WAS REBUILT. The last version faded the runner in over the fan and put
// a small arrow disc, a 30pt headline and the result card's own level chip
// under them. Nothing was waited for, the number never changed in front of
// anybody, and the rarest thing on the result screen read as a caption. A
// level is a number going UP, so this is about the number and about up: the
// count turns over where you can see it, and everything that moves climbs.
//
// THE RUNNER IS STILL THE POINT, AND STILL DOES NOT BOUNCE. They rise and are
// lifted on eased moves with no overshoot. Everything that springs is TYPE (the
// letters, the number): a person on a spring turned into part of the effect,
// which is why the version before this took the bounce out. Nothing is drawn
// over them either: the arrows climb in two columns BESIDE them, because
// arrows passing behind a character only ever peek out around its edges.
//
// `from` is the level the run started at. ResultScreen keeps it, so a run that
// crosses two levels counts from the number it really started on; left out, it
// is the level below.
//
// A TAP DURING THE BUILD SKIPS TO THE HIT. Only once the new number is down does
// a tap dismiss, so an impatient tap still sees what it was waiting for. After
// that the moment lets go on its own.
//
// IT NEVER STACKS ON ANOTHER CELEBRATION; the caller holds it until nothing
// else is up (see the queue in ResultScreen).
//
// REDUCED MOTION lands at once: the plinth with the new number, the headline,
// the arrows standing still in the light. That is all content, so it stays;
// only the movement goes.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import CharacterRig, { BODY_RATIO, HEADROOM } from './character/CharacterRig';
import GameAnimation from './GameAnimation';
import { RevealRays } from './RewardReveal';
import { Framed, OutlinedText } from './ui';
import { levelBandColor } from '../config/progression';
import { INK, framePose } from '../ui/frameRegistry';
import { Confetti, haptic, useReduceMotion } from '../ui/motion';
import { fonts, nbTextOn, space, toon } from '../theme';

// The same deep ink the reward reveal scrims to. A celebration that is charcoal
// in dark mode and cream in light is two different moments; this one is a
// lightbox, so it picks its own ground and keeps it.
const BACKDROP = '#140E24';

// One full turn of the ray fan. Slow enough to read as light rather than as a
// spinning graphic, and matched by ProWelcome.
const SPIN_MS = 16000;
const RAY_ALPHA = 0.62;

// ---------------------------------------------------------------------------
// THE TIMELINE
//
// Every beat lives here because the beats have to stay in proportion: moving
// the hit without moving the headline is how a word ends up arriving before
// the thing it announces.
// ---------------------------------------------------------------------------

// From the modal opening.
const RISE_AT = 60;
const RISE_MS = 520;
const BUILD_AT = 220;
// A little over a second: long enough to be a wait, short enough that nobody
// levelling for the tenth time is sitting through a cutscene.
export const HIT_AT = 1050;
export const AUTO_MS_REDUCED = 3200;

// From the hit.
const FLASH_UP_MS = 60;
const FLASH_DOWN_MS = 360;
const WAVE_MS = 720;
const KNOCK_MS = 260;
const LIFT_MS = 360;
const LIFT = 16;
const SURGE_MS = 1100;
const TITLE_AT = 110;
const LETTER_GAP = 55;
const SPARKLE_AT = 520;
// Last, and alone. Offering "Tap to continue" while the number is still
// landing is an invitation to skip the thing just built.
const HINT_AT = 1100;
// How long the landed moment holds before it lets go on its own.
export const HOLD_MS = 4600;

// The slam, as TerritoryVictoryBeat throws it: in from above at well over its
// size, a hard stop on a quintic ease out, a recoil a touch under size, sprung
// back. `poly(5)`, never `quint`: Reanimated has no `quint`, and naming one
// crashes a release build on the first animated frame.
const SLAM_MS = 120;
const SLAM_RISE = 44;
const SLAM_SCALE = 2.4;
const SLAM_EASING = Easing.out(Easing.poly(5));

// ---------------------------------------------------------------------------
// THE ARROWS
//
// Every arrow reads ONE clock and places itself off its own phase, so a dozen
// of them cost three animations (the clock, the build, the surge) rather than
// a dozen, and they can never drift out of step. `speed` multiplies the clock
// and must be a whole number: the clock wraps from 1 to 0, and only a whole
// multiple of a full trip wraps onto the same place.
// ---------------------------------------------------------------------------

const CHEVRON_MS = 2400;
// Extra trips the build winds on (squared, so the stream visibly accelerates),
// and extra trips the hit throws on as it eases out.
const BOOST = 1.4;
const SURGE = 0.9;
// Drawn in a 100 x 58 box with room for the outline's round caps and joins.
const CHEVRON_D = 'M 18 42 L 50 16 L 82 42';
const CHEVRON_ASPECT = 58 / 100;
// Two columns hugging the runner, three arrows each, the sides staggered by
// half a gap so the pair climbs in alternation rather than in lockstep.
const FLANK = [
  { side: -1, phase: 0 },
  { side: -1, phase: 1 / 3 },
  { side: -1, phase: 2 / 3 },
  { side: 1, phase: 1 / 6 },
  { side: 1, phase: 1 / 2 },
  { side: 1, phase: 5 / 6 },
];
// And a faint lane at each edge of the screen, so the whole frame climbs and
// not just the middle of it.
const SIDE_LANES = [
  { x: 0.08, w: 30, alpha: 0.45, phases: [0.1, 0.43, 0.76] },
  { x: 0.92, w: 30, alpha: 0.45, phases: [0.27, 0.6, 0.93] },
];

// The headline, one sticker per letter. The tilts and nudges are fixed rather
// than rolled, so the word is the same hand-set word every time.
const TITLE = 'LEVEL UP'.split('');
const TILT = [-8, 4, -3, 6, -5, 0, 5, -7];
const NUDGE = [2, -3, 1, -2, 3, 0, -3, 2];
const LETTERS = TITLE.map((char, i) => ({
  char,
  i,
  order: TITLE.slice(0, i).filter((c) => c !== ' ').length,
}));

const TWINKLE_MS = 1500;
const SPARK_D =
  'M 12 0 C 13.2 7.6 16.4 10.8 24 12 C 16.4 13.2 13.2 16.4 12 24 ' +
  'C 10.8 16.4 7.6 13.2 0 12 C 7.6 10.8 10.8 7.6 12 0 Z';
const SPARK_FILL = '#FFF7D6';

// How far the runner's feet sink into the top of the plinth, so they stand ON
// it rather than hovering over its ink line.
const FEET_OVERLAP = 6;

function Chevron({ width, color, outline }) {
  return (
    <Svg width={width} height={width * CHEVRON_ASPECT} viewBox="0 0 100 58">
      {outline ? (
        <Path
          d={CHEVRON_D}
          stroke={toon.ink}
          strokeWidth={30}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      <Path
        d={CHEVRON_D}
        stroke={color}
        strokeWidth={outline ? 18 : 22}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** One arrow on the shared clock. Fades in at the bottom of its trip and out
 *  at the top: an arrow that pops into being mid screen reads as a glitch. */
function RisingChevron({ clock, build, surge, presence, phase, speed = 1, travel, left, width, color, outline, alpha = 1 }) {
  const style = useAnimatedStyle(() => {
    const trip = clock.value * speed + phase + build.value * build.value * BOOST + surge.value * SURGE;
    const t = trip - Math.floor(trip);
    return {
      opacity: presence.value * alpha * Math.sin(Math.PI * t),
      transform: [{ translateY: -t * travel }, { scale: 0.78 + 0.34 * t }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.chevron, { left }, style]}>
      <Chevron width={width} color={color} outline={outline} />
    </Animated.View>
  );
}

/** The light the runner stands in: a cone opening UP out of the plinth, a
 *  bright core inside a tinted shoulder, both fading out as they climb. Hard
 *  edged on purpose, the same drawn wedge the ray fan is made of, so the two
 *  lights read as one kind of light. */
function Beam({ width, height, color }) {
  const cx = width / 2;
  const base = width * 0.2;
  const core = width * 0.07;
  const coreTop = width * 0.2;
  const outer = `M ${cx - base} ${height} L 0 0 L ${width} 0 L ${cx + base} ${height} Z`;
  const inner = `M ${cx - core} ${height} L ${cx - coreTop} 0 L ${cx + coreTop} 0 L ${cx + core} ${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="lvupBeam" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="0.55" />
          <Stop offset="0.5" stopColor={color} stopOpacity="0.16" />
          <Stop offset="0.85" stopColor={color} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="lvupCore" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.6" />
          <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.12" />
          <Stop offset="0.8" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={outer} fill="url(#lvupBeam)" />
      <Path d={inner} fill="url(#lvupCore)" />
    </Svg>
  );
}

function Sparkle({ twinkle, show, phase, size, still, style }) {
  const animated = useAnimatedStyle(() => {
    if (still) return { opacity: show.value, transform: [{ scale: show.value * 0.9 }] };
    const trip = twinkle.value + phase;
    const t = trip - Math.floor(trip);
    const pulse = Math.sin(Math.PI * t);
    return {
      opacity: show.value * (0.25 + 0.75 * pulse),
      transform: [{ scale: show.value * (0.45 + 0.65 * pulse) }, { rotate: `${t * 90}deg` }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.sparkle, { width: size, height: size }, style, animated]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={SPARK_D} fill={SPARK_FILL} />
      </Svg>
    </Animated.View>
  );
}

/** A ring closing on the number through the build. `phase` holds the second one
 *  back so the pair reads as a pulse; the knock clears them at the hit. */
function ChargeRing({ build, knock, color, size, phase = 0 }) {
  const style = useAnimatedStyle(() => {
    const c = Math.max(0, Math.min(1, (build.value - phase) / (1 - phase)));
    return {
      opacity: (c <= 0 ? 0 : Math.min(1, c * 3) * (1 - c * 0.3)) * (1 - knock.value),
      transform: [{ scale: 2.4 - 1.6 * c }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { width: size, height: size, borderRadius: size, borderWidth: 3, borderColor: color }, style]}
    />
  );
}

/** The hit's shockwave, thrown back out of the point the rings closed on. */
function Shockwave({ wave, color, size }) {
  const style = useAnimatedStyle(() => ({
    opacity: wave.value <= 0 || wave.value >= 1 ? 0 : (1 - wave.value) * 0.85,
    transform: [{ scale: 0.3 + wave.value * 3 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { width: size, height: size, borderRadius: size, borderWidth: 6, borderColor: color }, style]}
    />
  );
}

/**
 * The slam as a hook, so the number and every letter of the headline land the
 * same way. Plays when `go` turns true, after `delay`; held invisible before
 * that. Keyed on `go` and Reduce Motion only: the shared values are stable at
 * runtime, and an animation handle in the dependencies restarts the slam on
 * every render under the reanimated jest mock.
 */
function useSlamIn(go, delay, reduced, echoes) {
  const drop = useSharedValue(0);
  const punch = useSharedValue(1);
  const shown = useSharedValue(reduced ? 1 : 0);
  const echo = useSharedValue(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (reduced) {
      shown.value = 1;
      punch.value = 1;
      drop.value = 0;
      echo.value = 0;
      return undefined;
    }
    if (!go) {
      shown.value = 0;
      echo.value = 0;
      return undefined;
    }
    shown.value = withDelay(delay, withTiming(1, { duration: 40 }));
    drop.value = -SLAM_RISE;
    drop.value = withDelay(delay, withTiming(0, { duration: SLAM_MS, easing: SLAM_EASING }));
    punch.value = SLAM_SCALE;
    punch.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: SLAM_MS, easing: SLAM_EASING }),
        // The recoil: a touch under size, then sprung back. A stop with no
        // consequence does not read as a hit.
        withTiming(0.92, { duration: 70, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 9, stiffness: 360, mass: 0.45 })
      )
    );
    if (echoes) {
      echo.value = 0;
      echo.value = withDelay(delay + SLAM_MS, withTiming(1, { duration: 360, easing: Easing.out(Easing.quad) }));
    }
    return () => {
      cancelAnimation(shown);
      cancelAnimation(drop);
      cancelAnimation(punch);
      cancelAnimation(echo);
    };
  }, [go, reduced]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: drop.value }, { scale: punch.value }],
  }));
  // A ghost of the same glyph blown past it on the landing frame, so the impact
  // leaves a shockwave instead of just stopping.
  const echoStyle = useAnimatedStyle(() => ({
    opacity: echo.value > 0 && echo.value < 1 ? 0.5 * (1 - echo.value) : 0,
    transform: [{ scale: 1 + echo.value * 0.9 }],
  }));
  return { style, echoStyle };
}

/** A glyph as a sticker: the face, and behind it a solid copy offset down and
 *  right as its hard shadow. Both inked, so the shadow has an edge too. */
function StickerText({ children, size, face = '#FFFFFF', shadow, lineHeight, style }) {
  const text = [style, { fontSize: size, lineHeight: lineHeight ?? Math.round(size * 1.24) }];
  return (
    <View>
      <OutlinedText
        style={[text, { color: shadow }]}
        outline={toon.ink}
        width={4}
        containerStyle={styles.stickerShadow}
      >
        {children}
      </OutlinedText>
      <OutlinedText style={[text, { color: face }]} outline={toon.ink} width={4}>
        {children}
      </OutlinedText>
    </View>
  );
}

function SlamLetter({ char, i, order, go, reduced, size, shadow }) {
  const { style } = useSlamIn(go, TITLE_AT + order * LETTER_GAP, reduced, false);
  return (
    <View style={{ transform: [{ translateY: NUDGE[i] }, { rotate: `${TILT[i]}deg` }] }}>
      <Animated.View style={style}>
        <StickerText size={size} shadow={shadow} style={styles.letter}>
          {char}
        </StickerText>
      </Animated.View>
    </View>
  );
}

function SlamNumber({ value, go, reduced, size, lineHeight }) {
  const { style, echoStyle } = useSlamIn(go, 0, reduced, true);
  return (
    <Animated.View style={[styles.numberLayer, style]}>
      <Animated.View style={[styles.numberLayer, echoStyle]}>
        <OutlinedText
          style={[styles.number, { fontSize: size, lineHeight, color: '#FFFFFF' }]}
          outline={toon.ink}
          width={4}
        >
          {String(value)}
        </OutlinedText>
      </Animated.View>
      <StickerText size={size} lineHeight={lineHeight} shadow={toon.ink} style={styles.number}>
        {String(value)}
      </StickerText>
    </Animated.View>
  );
}

export default function LevelUpCelebration({ visible, level, from, equipped, accent, onClose }) {
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  // Whether the new number is down. Flips once, at the hit.
  const [hit, setHit] = useState(false);
  const timers = useRef([]);
  const hitDone = useRef(false);
  const hitNow = useRef(null);
  // Read through a ref, so a caller that hands in a fresh lambda every render
  // (the dev panel does) cannot restart the moment by re-rendering.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const scrim = useSharedValue(0);
  const spin = useSharedValue(0);
  const rise = useSharedValue(0);
  const build = useSharedValue(0);
  const shake = useSharedValue(0.5);
  const beam = useSharedValue(0);
  const clock = useSharedValue(0);
  const flash = useSharedValue(0);
  const wave = useSharedValue(0);
  const knock = useSharedValue(0);
  const lift = useSharedValue(0);
  const surge = useSharedValue(0);
  const twinkle = useSharedValue(0);
  const sparkle = useSharedValue(0);
  const hint = useSharedValue(0);

  // Keyed on the moment itself (shown, which level, Reduce Motion) and nothing
  // else. The shared values are stable refs at runtime and are read through
  // `.value`; listing them would restart the whole timeline on every render
  // under the reanimated jest mock, where their handles change identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const clearTimers = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // The fan, the arrows, the sparkles and the tremor are INFINITE repeats.
    // Left running they keep turning on the UI thread behind whatever screen
    // comes next, for the rest of the session; fading out is not stopping.
    const stopLoops = () => {
      cancelAnimation(spin);
      cancelAnimation(clock);
      cancelAnimation(twinkle);
      cancelAnimation(shake);
    };
    clearTimers();
    hitDone.current = false;
    hitNow.current = null;
    setHit(false);

    if (!visible || level == null) {
      stopLoops();
      spin.value = 0;
      clock.value = 0;
      twinkle.value = 0;
      shake.value = 0.5;
      scrim.value = 0;
      rise.value = 0;
      build.value = 0;
      beam.value = 0;
      flash.value = 0;
      wave.value = 0;
      knock.value = 0;
      lift.value = 0;
      surge.value = 0;
      sparkle.value = 0;
      hint.value = 0;
      return undefined;
    }

    const close = () => closeRef.current?.();

    if (reduced) {
      scrim.value = 1;
      rise.value = 1;
      beam.value = 1;
      build.value = 0;
      knock.value = 1;
      lift.value = 1;
      sparkle.value = 1;
      hint.value = 1;
      hitDone.current = true;
      setHit(true);
      haptic.success();
      timers.current.push(setTimeout(close, AUTO_MS_REDUCED));
      return clearTimers;
    }

    // THE HIT, on its timer or on an impatient tap. A tap mid build FINISHES
    // the build in one short move rather than cutting it, so the rings still
    // land and the stream still leaps: compressed, not thrown away.
    const fire = () => {
      if (hitDone.current) return;
      hitDone.current = true;
      setHit(true);
      haptic.success();
      cancelAnimation(shake);
      shake.value = 0.5;
      build.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
      rise.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
      beam.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
      flash.value = withSequence(
        withTiming(1, { duration: FLASH_UP_MS, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: FLASH_DOWN_MS, easing: Easing.in(Easing.quad) })
      );
      wave.value = 0;
      wave.value = withTiming(1, { duration: WAVE_MS, easing: Easing.out(Easing.cubic) });
      knock.value = withTiming(1, { duration: KNOCK_MS, easing: Easing.out(Easing.cubic) });
      lift.value = withTiming(1, { duration: LIFT_MS, easing: Easing.out(Easing.cubic) });
      surge.value = withTiming(1, { duration: SURGE_MS, easing: Easing.out(Easing.cubic) });
      sparkle.value = withDelay(SPARKLE_AT, withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }));
      hint.value = withDelay(HINT_AT, withTiming(1, { duration: 380 }));
      timers.current.push(setTimeout(close, HOLD_MS));
    };
    hitNow.current = fire;

    // THE BUILD. `build` is the one accelerating value every part of the wind
    // up reads: the rings, the tremor, the arrows' extra trips, the fan's
    // extra turn. Sharing it is why they tighten together.
    scrim.value = withTiming(1, { duration: 180 });
    spin.value = 0;
    spin.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
    clock.value = 0;
    clock.value = withRepeat(withTiming(1, { duration: CHEVRON_MS, easing: Easing.linear }), -1, false);
    twinkle.value = 0;
    twinkle.value = withRepeat(withTiming(1, { duration: TWINKLE_MS, easing: Easing.linear }), -1, false);
    rise.value = withDelay(RISE_AT, withTiming(1, { duration: RISE_MS, easing: Easing.out(Easing.cubic) }));
    beam.value = withDelay(BUILD_AT, withTiming(1, { duration: HIT_AT - BUILD_AT, easing: Easing.out(Easing.quad) }));
    build.value = withDelay(BUILD_AT, withTiming(1, { duration: HIT_AT - BUILD_AT, easing: Easing.in(Easing.cubic) }));
    // The tremor runs flat out and takes its amplitude from the build, so it
    // starts as a shiver and ends as a rattle without a second clock.
    shake.value = 0.5;
    shake.value = withRepeat(withTiming(1, { duration: 84, easing: Easing.inOut(Easing.quad) }), -1, true);
    timers.current.push(setTimeout(fire, HIT_AT));

    return () => {
      clearTimers();
      stopLoops();
    };
  }, [visible, level, reduced]);

  // Sized off the DIAGONAL so the fan clears the corners at every angle it
  // turns through.
  const raySize = Math.ceil(Math.hypot(width, height));
  // The runner gives way first on a short screen: the headline and the plinth
  // are what say what happened, and they have fixed minimum sizes.
  const rigSize = Math.min(width * 0.36, (height * 0.4) / (BODY_RATIO * (1 + HEADROOM)), 160);
  const rigH = rigSize * BODY_RATIO * (1 + HEADROOM);
  // From the feet to past the top of the screen. It has faded out long before.
  const beamW = rigSize * 2.4;
  const beamH = height;
  // The flanking arrows: clear of the runner's shoulders, inside the cone.
  const flankW = Math.round(rigSize * 0.4);
  const flankDx = rigSize * 0.5 + flankW * 0.55;
  const plinthW = Math.min(width * 0.46, 188);
  const numberSize = Math.round(Math.min(64, plinthW * 0.36));
  const numberLine = Math.round(numberSize * 1.22);
  const titleSize = Math.round(Math.min(52, (width - space.lg * 2) / 5.4));
  const ringSize = plinthW * 0.92;

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const raysStyle = useAnimatedStyle(() => ({
    opacity: RAY_ALPHA * scrim.value * (0.45 + 0.55 * build.value),
    transform: [
      { rotate: `${spin.value * 360 + build.value * build.value * 160}deg` },
      // Never below 1: the fan is sized to the diagonal exactly.
      { scale: 1 + flash.value * 0.08 },
    ],
  }));
  const heroStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, rise.value * 1.6),
    transform: [{ translateY: (1 - rise.value) * 44 - lift.value * LIFT }],
  }));
  const beamStyle = useAnimatedStyle(() => ({
    opacity: beam.value,
    // Opens UP out of the plinth: scaled about its centre, then moved down by
    // the half it lost, so the foot of the cone never leaves the feet.
    transform: [
      { translateY: (1 - beam.value) * beamH * 0.5 },
      { scaleY: Math.max(0.001, beam.value) },
      { scaleX: 1 + flash.value * 0.25 },
    ],
  }));
  const oldStyle = useAnimatedStyle(() => {
    const swing = (shake.value - 0.5) * 2 * build.value;
    return {
      opacity: 1 - knock.value,
      transform: [
        { translateX: swing * 4 },
        { translateY: -knock.value * 52 },
        { rotate: `${swing * 5 - knock.value * 14}deg` },
        { scale: 1 + build.value * 0.1 + knock.value * 0.5 },
      ],
    };
  });
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));
  // Over EVERYTHING, the plinth included. A flash the number sits on top of is
  // a glow behind the number.
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.9 }));

  if (level == null) return null;

  const fromLevel = Math.max(0, Math.min(level - 1, from ?? level - 1));
  const band = levelBandColor(level);
  // The plinth wears the band the runner LEFT until the hit, so the colour
  // change that comes with every fifth level happens on the beat, in view.
  const shownBand = hit ? band : levelBandColor(fromLevel);
  const tint = accent || band;

  const onTap = () => {
    if (!hitDone.current) {
      hitNow.current?.();
      return;
    }
    closeRef.current?.();
  };

  const chevronProps = { clock, build, surge, presence: beam };

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => closeRef.current?.()}
    >
      <Pressable
        style={styles.fill}
        onPress={onTap}
        accessibilityRole="button"
        accessibilityLabel={`Level up. Level ${level}. Tap to continue.`}
      >
        <Animated.View style={[styles.fill, { backgroundColor: BACKDROP }, scrimStyle]} />

        {/* The effects run full bleed and are clipped by the screen. That is
            what makes them a background instead of a picture of one. */}
        <View
          style={[styles.fill, styles.bleed]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
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
          {SIDE_LANES.flatMap((lane) =>
            lane.phases.map((phase) => (
              <RisingChevron
                key={`${lane.x}:${phase}`}
                {...chevronProps}
                phase={phase}
                travel={height * 0.9}
                left={lane.x * width - lane.w / 2}
                width={lane.w}
                color={tint}
                alpha={lane.alpha}
              />
            ))
          )}
          {/* Thrown at the HIT. Paper already falling while the screen is
              still winding up gives the ending away. */}
          {hit ? <Confetti count={36} /> : null}
        </View>

        <View
          style={styles.stage}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Above everything else on the stage: the cone reaches up behind
              the headline, and nothing may cross in front of the words. */}
          <View style={styles.titleRow}>
            {LETTERS.map(({ char, i, order }) =>
              char === ' ' ? (
                <View key={i} style={{ width: titleSize * 0.3 }} />
              ) : (
                <SlamLetter
                  key={i}
                  char={char}
                  i={i}
                  order={order}
                  go={hit}
                  reduced={reduced}
                  size={titleSize}
                  shadow={tint}
                />
              )
            )}
            <Sparkle twinkle={twinkle} show={sparkle} phase={0} size={26} still={reduced} style={styles.sparkTitleLeft} />
            <Sparkle twinkle={twinkle} show={sparkle} phase={0.5} size={18} still={reduced} style={styles.sparkTitleRight} />
          </View>

          <Animated.View style={[styles.hero, heroStyle]}>
            <View>
              {/* The cone, behind the runner and rooted at the feet. */}
              <View
                pointerEvents="none"
                style={[styles.beamWrap, { width: beamW, height: beamH, left: (rigSize - beamW) / 2 }]}
              >
                <Animated.View style={beamStyle}>
                  <Beam width={beamW} height={beamH} color={tint} />
                </Animated.View>
              </View>
              {/* The arrows climb BESIDE the runner, never behind them. */}
              {FLANK.map(({ side, phase }) => (
                <RisingChevron
                  key={`${side}:${phase}`}
                  {...chevronProps}
                  phase={phase}
                  travel={rigH * 0.9}
                  left={rigSize / 2 + side * flankDx - flankW / 2}
                  width={flankW}
                  color={tint}
                  outline
                />
              ))}
              <CharacterRig equipped={equipped} size={rigSize} animate={false} clanColor={tint} />
            </View>

            {/* THE PLINTH. A hand-drawn box, like every hero surface, filled
                with the level band; the number on it is the thing that
                changes. */}
            <View style={styles.plinthWrap}>
              <Framed
                frame="panel"
                fill={shownBand}
                weight={INK.bold}
                pose={framePose(`levelup:${level}`)}
                boil={!reduced}
                inset={4}
                style={{ width: plinthW }}
                contentStyle={styles.plinthContent}
              >
                <Text style={[styles.plinthLabel, { color: nbTextOn(shownBand) }]}>LEVEL</Text>
                <View style={[styles.numberBox, { height: numberLine }]}>
                  {!reduced ? (
                    <>
                      <ChargeRing build={build} knock={knock} color={tint} size={ringSize} />
                      <ChargeRing build={build} knock={knock} color={tint} size={ringSize} phase={0.35} />
                      <Shockwave wave={wave} color="#FFFFFF" size={ringSize * 0.7} />
                    </>
                  ) : null}
                  {/* Behind the number and only behind it: the gold hit is what
                      makes the landing land. Mounted at the hit, keyed on the
                      level, so re-rendering does not replay it. */}
                  {hit ? (
                    <View style={styles.numberLayer}>
                      <GameAnimation name="impactGold" size={plinthW * 1.5} trigger={level} />
                    </View>
                  ) : null}
                  {!reduced ? (
                    <Animated.View style={[styles.numberLayer, oldStyle]}>
                      <StickerText size={numberSize} lineHeight={numberLine} shadow={toon.ink} style={styles.number}>
                        {String(fromLevel)}
                      </StickerText>
                    </Animated.View>
                  ) : null}
                  <SlamNumber value={level} go={hit} reduced={reduced} size={numberSize} lineHeight={numberLine} />
                </View>
              </Framed>
              <Sparkle twinkle={twinkle} show={sparkle} phase={0.25} size={22} still={reduced} style={styles.sparkPlinthLeft} />
              <Sparkle twinkle={twinkle} show={sparkle} phase={0.75} size={30} still={reduced} style={styles.sparkPlinthRight} />
            </View>
          </Animated.View>
        </View>

        <Animated.Text style={[styles.hint, hintStyle]}>Tap to continue</Animated.Text>

        <Animated.View pointerEvents="none" style={[styles.fill, { backgroundColor: '#FFFFFF' }, flashStyle]} />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  bleed: { overflow: 'hidden' },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    // Room under the stack for "Tap to continue", so the stage centres in the
    // space above it rather than on the whole page.
    paddingBottom: space.huge,
  },
  chevron: { position: 'absolute', bottom: 0 },
  sparkle: { position: 'absolute' },
  ring: { position: 'absolute' },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: space.lg,
    zIndex: 2,
  },
  letter: { fontFamily: fonts.hero, textAlign: 'center' },
  stickerShadow: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ translateX: 4 }, { translateY: 5 }],
  },
  sparkTitleLeft: { left: -20, top: -8 },
  sparkTitleRight: { right: -14, top: 8 },

  hero: { alignItems: 'center', zIndex: 1 },
  beamWrap: { position: 'absolute', bottom: 0 },

  plinthWrap: { marginTop: -FEET_OVERLAP },
  // Alignment only. The padding on a Framed content row is the frame's own
  // measured ink clearance; horizontal air lives on the text instead.
  plinthContent: { alignItems: 'center' },
  plinthLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 4,
    paddingHorizontal: space.sm,
    marginTop: 2,
    opacity: 0.9,
  },
  numberBox: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  numberLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  number: { fontFamily: fonts.hero, textAlign: 'center', letterSpacing: 1 },
  sparkPlinthLeft: { left: -18, top: 10 },
  sparkPlinthRight: { right: -20, bottom: 12 },

  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.huge,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 16,
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.85)',
  },
});
