// The lootbox screen's effects.
//
// EVERY ONE OF THEM IS DRAWN, for the two reasons the chest is: the OTA asset
// ceiling (see the header of Chest.js), and because each one has to take a
// colour the screen only settles at runtime — the light climbing from white
// through blue and purple to gold is the same four components wearing four
// different fills.
//
// ALMOST NONE OF THEM OWN A CLOCK. They read shared values the gamble hands
// them, so twenty effects run off a handful of numbers and cannot drift out of
// step with each other or with the chest. The ones that do loop take `live`,
// and the caller derives that from `useOnScreen`: a loop nobody is looking at
// still costs every other screen a whole-tree commit per frame.
//
// Anything that fires ONCE (a ring, a burst) renders nothing at all until its
// trigger has moved, rather than sitting at rest in the tree — a resting
// effect is a pile of sparkles parked on the chest waiting to be noticed.

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
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
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Sparkle } from './Chest';

// The light the chest gives off at each rung of the climb. Paler than the
// panels in Chest.js on purpose: this is light, not paint.
export const TIER_LIGHT = {
  mystery: '#8F7BFF',
  common: '#EAF1FA',
  rare: '#6FDCFF',
  epic: '#CB9CFF',
  legendary: '#FFD84D',
};

// ...and once the page itself is the rarity, the light has to read against it,
// so the reveal's beam and glow go white. Gold light on a gold page is a
// smudge; white light on it is a beam.
export const REVEAL_LIGHT = {
  common: '#FFFFFF',
  rare: '#E8FAFF',
  epic: '#F4E8FF',
  legendary: '#FFFFFF',
};

// Paper and glints, per tier, picked to read ON that tier's page rather than
// in the abstract — hence the browns and oranges under legendary's gold.
export const TIER_CONFETTI = {
  common: ['#FFFFFF', '#D5DEE8'],
  rare: ['#FFFFFF', '#6FDCFF', '#1B9FD6', '#FFC93C'],
  epic: ['#FFFFFF', '#CB9CFF', '#7E38D2', '#6FDCFF', '#FFC93C'],
  legendary: ['#FFFFFF', '#F08A00', '#A85B00', '#FF6B3D', '#FFF6DC'],
};

export const TIER_SPARKS = {
  common: ['#FFFFFF'],
  rare: ['#FFFFFF', '#BDF0FF'],
  epic: ['#FFFFFF', '#E9D5FF', '#FFC93C'],
  legendary: ['#FFFFFF', '#FFF6DC', '#F08A00'],
};

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

/**
 * A soft disc of light. Every glow on the screen is one of these, scaled and
 * faded by whatever shared value should be driving it.
 *
 * `id` must be unique on screen: react-native-svg resolves `url(#id)` per
 * document, and two glows sharing an id is how one of them ends up wearing the
 * other's colour.
 */
export function Glow({ size, color, id, core = 0.85 }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={core} />
          <Stop offset="38%" stopColor={color} stopOpacity={core * 0.42} />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The edges of the stage falling away, so the chest is the only lit thing. */
export function Vignette({ width, height, id }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="46%" r="72%">
          <Stop offset="40%" stopColor="#05030F" stopOpacity="0" />
          <Stop offset="100%" stopColor="#05030F" stopOpacity="0.72" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

/**
 * The crack of light along the seam. Wide and thin, brightest in the middle:
 * light being squeezed out of a gap rather than a lamp behind a box.
 */
export function SeamGlow({ width, height, color, id }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <Stop offset="30%" stopColor={color} stopOpacity="0.9" />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

// Where the shafts point, in degrees, with -90 straight up. Fixed rather than
// random so the fan never re-scatters on a render.
const FAN = [-164, -146, -128, -110, -90, -70, -52, -34, -16];

/**
 * Shafts of light thrown up out of the seam.
 *
 * Drawn from the bottom centre of its own box, so a caller that puts that
 * point on the seam and scales the box is opening the fan from the crack.
 * The gradient is in user space, not the box's, or the shafts would fade at
 * different rates sideways and upwards.
 */
export function LightFan({ width, height, color, id }) {
  const cx = width / 2;
  const cy = height;
  const r = Math.hypot(cx, height);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <Stop offset="0.35" stopColor={color} stopOpacity="0.55" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {FAN.map((deg, i) => {
        const half = (i % 2 ? 3 : 5) * (Math.PI / 180);
        const reach = r * (i % 2 ? 0.78 : 1);
        const a = (deg * Math.PI) / 180;
        const d = `M ${cx} ${cy} `
          + `L ${cx + reach * Math.cos(a - half)} ${cy + reach * Math.sin(a - half)} `
          + `L ${cx + reach * Math.cos(a + half)} ${cy + reach * Math.sin(a + half)} Z`;
        return <Path key={i} d={d} fill={`url(#${id})`} />;
      })}
    </Svg>
  );
}

/**
 * The column of light standing out of an open chest: white core, coloured
 * shoulders, gone by the top.
 *
 * Two trapezoids rather than one masked rectangle. A mask would give a softer
 * edge, but react-native-svg masks are the one thing in this file that has to
 * be right on two platforms at once, and a flat screen does not miss it.
 */
export function Beam({ width, height, color, id }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={`${id}o`} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="0.85" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={`${id}c`} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <Stop offset="0.85" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path
        d={`M ${width * 0.2} ${height} L ${width * 0.8} ${height} L ${width} 0 L 0 0 Z`}
        fill={`url(#${id}o)`}
      />
      <Path
        d={`M ${width * 0.38} ${height} L ${width * 0.62} ${height} L ${width * 0.7} 0 L ${width * 0.3} 0 Z`}
        fill={`url(#${id}c)`}
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

// Dust hanging in the spotlight. Hand placed, so it never re-scatters, and
// every mote reads the ONE clock at its own offset: twelve motes, one
// animation, and they can never fall out of step.
const DRIFT = [
  { x: 0.1, o: 0, s: 4, w: 10 },
  { x: 0.24, o: 0.55, s: 3, w: 14 },
  { x: 0.36, o: 0.2, s: 5, w: 8 },
  { x: 0.5, o: 0.78, s: 3, w: 12 },
  { x: 0.62, o: 0.35, s: 4, w: 16 },
  { x: 0.76, o: 0.9, s: 5, w: 9 },
  { x: 0.88, o: 0.12, s: 3, w: 13 },
  { x: 0.18, o: 0.66, s: 3, w: 11 },
  { x: 0.44, o: 0.45, s: 4, w: 15 },
  { x: 0.7, o: 0.05, s: 3, w: 10 },
  { x: 0.93, o: 0.6, s: 4, w: 8 },
  { x: 0.05, o: 0.3, s: 3, w: 12 },
];

function DriftMote({ clock, spec, width, height }) {
  const style = useAnimatedStyle(() => {
    const p = (clock.value + spec.o) % 1;
    return {
      opacity: Math.sin(p * Math.PI) * 0.6,
      transform: [
        { translateX: spec.x * width + Math.sin((p + spec.o) * Math.PI * 2) * spec.w },
        { translateY: height * (0.95 - p * 0.9) },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.mote, { width: spec.s, height: spec.s, borderRadius: spec.s }, style]}
    />
  );
}

export function DriftMotes({ clock, width, height }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {DRIFT.map((spec, i) => (
        <DriftMote key={i} clock={clock} spec={spec} width={width} height={height} />
      ))}
    </View>
  );
}

const STREAM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/**
 * Sparks pulled INTO the seam while the chest charges.
 *
 * `stream` is a loop, so this is a continuous fall rather than one pass: each
 * spark starts out at the radius and is squared toward the middle, so it
 * drifts at first and is falling by the end. `charge` fades the whole stream
 * up; `calm` takes it away again for legendary's held breath, which is what
 * makes that silence read as the light being sucked back in.
 */
function ChargeMote({ index, stream, charge, calm, color, radius }) {
  const angle = (index / STREAM.length) * Math.PI * 2 + (index % 3) * 0.38;
  const offset = (index * 0.37) % 1;
  const size = index % 3 === 0 ? 7 : 4;
  const style = useAnimatedStyle(() => {
    const p = (stream.value + offset) % 1;
    const d = radius * (1 - p) * (1 - p);
    const on = Math.min(1, charge.value * 2.5) * (1 - calm.value * 0.85);
    return {
      opacity: on * Math.min(1, p * 5),
      transform: [
        { translateX: Math.cos(angle) * d },
        { translateY: Math.sin(angle) * d },
        { scale: 0.6 + p * 0.7 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.abs, { width: size, height: size, borderRadius: size, backgroundColor: color }, style]}
    />
  );
}

export function ChargeMotes(props) {
  return (
    <>
      {STREAM.map((i) => (
        <ChargeMote key={i} index={i} {...props} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// One-shots
// ---------------------------------------------------------------------------

/**
 * A shockwave: one ring thrown out of the chest and gone.
 *
 * KEYED ON `trigger` ALONE. The shared value is a stable ref in the app and a
 * brand new object on every render under the reanimated jest mock, so listing
 * it in the deps would restart the ring forever in tests (and pointlessly in
 * the app). Same rule everywhere in this file.
 */
export function Ring({ trigger, color, size, to = 2.6, ms = 700, delay = 0, thickness = 5 }) {
  const t = useSharedValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trigger) return undefined;
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration: ms, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(t);
  }, [trigger]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value <= 0 || t.value >= 1 ? 0 : (1 - t.value) * 0.9,
    transform: [{ scale: 0.3 + (to - 0.3) * t.value }],
  }));
  if (!trigger) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.abs,
        { width: size, height: size, borderRadius: size / 2, borderWidth: thickness, borderColor: color },
        style,
      ]}
    />
  );
}

function BurstSpark({ spec, trigger }) {
  const life = useSharedValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trigger) return undefined;
    life.value = 0;
    life.value = withDelay(spec.delay, withTiming(1, { duration: spec.ms, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(life);
  }, [trigger]);
  const rad = (spec.angle * Math.PI) / 180;
  const style = useAnimatedStyle(() => ({
    // Squared, so a glint is bright for most of its flight and then goes
    // quickly. A linear fade reads as a glint running out of batteries.
    opacity: life.value <= 0 ? 0 : 1 - life.value * life.value,
    transform: [
      { translateX: Math.cos(rad) * spec.dist * life.value },
      { translateY: Math.sin(rad) * spec.dist * life.value },
      { scale: 0.4 + life.value * 0.9 },
      { rotate: `${life.value * 160}deg` },
    ],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.abs, style]}>
      <Sparkle size={spec.size} color={spec.color} />
    </Animated.View>
  );
}

/** Glints thrown out of the chest at the hit. `colors` must be a constant. */
export function SparkBurst({ trigger, count, reach, colors }) {
  const specs = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: (i / count) * 360 - 90 + (i % 2) * (180 / count),
        dist: reach * (0.72 + (i % 3) * 0.14),
        size: 12 + (i % 4) * 5,
        delay: (i % 3) * 30,
        ms: 700 + (i % 4) * 90,
        color: colors[i % colors.length],
      })),
    [count, reach, colors]
  );
  if (!trigger) return null;
  return (
    <>
      {specs.map((spec, i) => (
        <BurstSpark key={i} spec={spec} trigger={trigger} />
      ))}
    </>
  );
}

/**
 * The white arc that sweeps over the chest on every swipe.
 *
 * It is the swipe's receipt. Without it a swipe that did not open the chest
 * produced no change on screen at all, which reads as a dropped input rather
 * than as a swipe that landed — the one thing this screen cannot afford, since
 * two of the three swipes never open anything.
 */
export function Swoosh({ trigger, size }) {
  const life = useSharedValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trigger) return undefined;
    life.value = 0;
    life.value = withTiming(1, { duration: 340, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(life);
  }, [trigger]);
  const style = useAnimatedStyle(() => ({
    opacity: life.value <= 0 || life.value > 0.85 ? 0 : 0.9,
    transform: [{ rotate: `${-30 + life.value * 60}deg` }, { scale: 0.8 + life.value * 0.5 }],
  }));
  if (!trigger) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.abs, { width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d="M 14 62 Q 24 16 62 10 Q 44 22 34 44 Q 27 58 24 74 Z" fill="#ffffff" />
      </Svg>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// The furniture under the chest
// ---------------------------------------------------------------------------

function Arrow({ color }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path d="M12 4 L20 13 L15.5 13 L15.5 20 L8.5 20 L8.5 13 L4 13 Z" fill={color} />
    </Svg>
  );
}

/**
 * One charge cell: empty with an arrow, or filled with a gem.
 *
 * They count UP rather than down (three swipes spent, not three left) because
 * the chest is charging, not being used up — the same reason the chest gets
 * more restless with each one.
 */
function ChargeCell({ filled, next, live, reduced }) {
  const pop = useSharedValue(filled ? 1 : 0);
  const pulse = useSharedValue(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!filled) {
      cancelAnimation(pop);
      pop.value = 0;
      return;
    }
    if (reduced) {
      pop.value = 1;
      return;
    }
    pop.value = 0;
    pop.value = withSequence(
      withTiming(1.3, { duration: 130, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 8, stiffness: 240 })
    );
  }, [filled]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!next || !live) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return undefined;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [next, live]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.12 }] }));
  const arrowStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * pulse.value }] }));
  const gemStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 2),
    transform: [{ scale: pop.value }],
  }));

  return (
    <Animated.View style={[styles.cell, next ? styles.cellNext : null, ringStyle]}>
      {!filled ? (
        <Animated.View style={arrowStyle}>
          <Arrow color={next ? '#FFFFFF' : 'rgba(255,255,255,0.4)'} />
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[styles.gem, gemStyle]}>
        <Sparkle size={16} color="#FFF6DC" />
      </Animated.View>
    </Animated.View>
  );
}

export function ChargeCells({ total, spent, live, reduced }) {
  return (
    <View style={styles.cells}>
      {Array.from({ length: total }, (_, i) => (
        <ChargeCell key={i} filled={i < spent} next={i === spent} live={live} reduced={reduced} />
      ))}
    </View>
  );
}

/**
 * Three chevrons with a wave running up them: the whole instruction, wordless.
 *
 * It replaces the two lines of small print this screen used to carry. A swipe
 * cue that has to be READ is not a cue, and the screen reader gets the same
 * thing in words from the stage's label anyway.
 */
function Chevron({ t, index, live }) {
  const style = useAnimatedStyle(() => {
    const w = t.value * 1.6 - 0.3;
    const at = index / 2;
    const k = live ? Math.max(0, 1 - Math.abs(w - at) * 2.4) : 0.5;
    return { opacity: 0.22 + 0.78 * k, transform: [{ translateY: -3 * k }] };
  });
  return (
    <Animated.View style={style}>
      <Svg width={26} height={12} viewBox="0 0 26 12">
        <Path
          d="M 3 10 L 13 3 L 23 10"
          stroke="#FFFFFF"
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

export function SwipeCue({ live }) {
  const t = useSharedValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live) {
      cancelAnimation(t);
      t.value = 0;
      return undefined;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [live]);
  return (
    <View pointerEvents="none" style={styles.cue}>
      {/* Top of the stack first: the wave runs bottom to top, like the swipe. */}
      {[2, 1, 0].map((i) => (
        <Chevron key={i} t={t} index={i} live={live} />
      ))}
    </View>
  );
}

// Where the ambient glints sit, as fractions of the chest box. Fixed rather
// than random so they do not re-scatter on every render, and hand placed so
// none of them lands on the clasp.
const AMBIENT = [
  { x: -0.22, y: 0.06, size: 20, delay: 0 },
  { x: 1.06, y: 0.22, size: 15, delay: 420 },
  { x: -0.1, y: 0.62, size: 12, delay: 900 },
  { x: 1.14, y: 0.68, size: 18, delay: 1300 },
  { x: 0.18, y: -0.16, size: 14, delay: 700 },
  { x: 0.82, y: -0.1, size: 11, delay: 1600 },
];

function AmbientSparkle({ spot, box, live }) {
  const life = useSharedValue(0.6);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live) {
      cancelAnimation(life);
      life.value = 0.6;
      return undefined;
    }
    life.value = 0;
    life.value = withDelay(
      spot.delay,
      withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true)
    );
    return () => cancelAnimation(life);
  }, [live]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.25 + life.value * 0.6,
    transform: [{ scale: 0.7 + life.value * 0.5 }, { rotate: `${life.value * 45}deg` }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.abs, { left: box * spot.x, top: box * spot.y }, style]}
    >
      <Sparkle size={spot.size} />
    </Animated.View>
  );
}

export function AmbientSparkles({ box, live }) {
  return (
    <>
      {AMBIENT.map((spot, i) => (
        <AmbientSparkle key={i} spot={spot} box={box} live={live} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  mote: { position: 'absolute', left: 0, top: 0, backgroundColor: '#FFFFFF' },
  cells: { flexDirection: 'row', gap: 18 },
  cell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  cellNext: { borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.18)' },
  gem: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFC93C',
    borderWidth: 2.5,
    borderColor: '#FFF6DC',
  },
  cue: { alignItems: 'center', gap: 1 },
});
