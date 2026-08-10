// Butterflies over the plaza.
//
// WHY THESE ARE DRAWN AND NOT PLAYED. The supplied clip (butterfly.webm) is a
// 150x84 VP8 with alpha, and the butterfly inside it measures about 13x11
// PIXELS — perfect as a motion reference, unusable as a sprite: drawn at 26pt
// on a 3x screen it is a 6x upscale, which is a smudge. Vector butterflies cost
// a few hundred bytes, stay crisp at any size, and give the two things the clip
// could not: a real colour per butterfly, and a flight path per butterfly
// rather than the one path baked into the frames. The clip's own motion — a
// slow diagonal drift with a fast, shallow wingbeat over it — is what `SPECS`
// below is tuned against.
//
// COST. Two animation drivers for the whole swarm, not two per butterfly: one
// slow ramp for the paths and one fast ramp for the wings, both shared, with
// each butterfly reading them at its own phase and rate. Everything is a
// worklet on the UI thread, so a butterfly costs one view and no JS per frame.
//
// Reduce Motion holds them still where they are — decoration that stops rather
// than decoration that disappears, the same rule the rest of the app follows.

import React, { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { toon } from '../../theme';
import { useReduceMotion } from '../../ui/motion';

const TAU = Math.PI * 2;

// How long a butterfly takes to walk its whole path once, and how long one
// wingbeat lasts. The wing ramp is deliberately not a multiple of the path
// ramp — shared phase would make the whole swarm beat in unison.
const PATH_MS = 16000;
const WING_MS = 460;

// One entry per butterfly: where it lives (fractions of the scene box), how far
// it wanders, how fast it reads each clock, and its colours.
//
// They are all kept in the 0.42-0.68 band, for two reasons. It is the plaza's
// planting and paving — where a butterfly would actually be, rather than up in
// the clouds — and it clears the scene's bottom scrim: a butterfly below 0.7
// would be dimmed by the plate the buttons sit on, and a butterfly nobody can
// see is just a decoder.
//
// No two share a rate, a phase or a wingbeat: matching any of them makes the
// swarm move as one object, which is the thing that reads as fake.
const SPECS = [
  { x: 0.13, y: 0.60, ax: 0.10, ay: 0.055, rate: 1.00, phase: 0.00, wing: 1.00, size: 26, wings: '#F5A3C7', body: '#7A2E52' },
  { x: 0.84, y: 0.52, ax: 0.09, ay: 0.070, rate: 0.78, phase: 0.37, wing: 1.17, size: 22, wings: '#8ED9F5', body: '#1C5A78' },
  { x: 0.28, y: 0.66, ax: 0.12, ay: 0.045, rate: 1.23, phase: 0.62, wing: 0.88, size: 20, wings: '#FFD86B', body: '#8A5A0B' },
  { x: 0.72, y: 0.63, ax: 0.08, ay: 0.050, rate: 0.64, phase: 0.11, wing: 1.31, size: 24, wings: '#C3A6F0', body: '#4A2A7A' },
  { x: 0.47, y: 0.45, ax: 0.14, ay: 0.040, rate: 0.91, phase: 0.79, wing: 1.06, size: 18, wings: '#9BE8B0', body: '#1F6B3A' },
  { x: 0.93, y: 0.68, ax: 0.07, ay: 0.055, rate: 1.11, phase: 0.24, wing: 0.94, size: 21, wings: '#FFB08A', body: '#8A3A18' },
];

/**
 * A free-running 0->1 ramp. Linear, because the easing belongs to each
 * butterfly's own interpolation — a ramp that eased would make the whole swarm
 * hesitate in step. Same shape as the Pit Stop's ambient clock.
 */
function useRamp(active, reduced, duration) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(t);
      t.value = 0;
      return undefined;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [active, reduced, duration, t]);
  return t;
}

// The wings, the body and the two antennae, in a 100x74 box. Drawn once per
// butterfly and never re-rendered — everything that moves is a transform on the
// views around it.
const Wings = memo(function Wings({ size, wings, body }) {
  const h = size * 0.74;
  return (
    <Svg width={size} height={h} viewBox="0 0 100 74">
      {/* upper pair — the big ones, swept back from the shoulder */}
      <Path
        d="M50 30 C40 6, 16 0, 8 12 C1 23, 14 36, 50 40 Z"
        fill={wings}
        stroke={toon.ink}
        strokeWidth={5.5}
        strokeLinejoin="round"
      />
      <Path
        d="M50 30 C60 6, 84 0, 92 12 C99 23, 86 36, 50 40 Z"
        fill={wings}
        stroke={toon.ink}
        strokeWidth={5.5}
        strokeLinejoin="round"
      />
      {/* lower pair — smaller, tucked under */}
      <Path
        d="M50 38 C40 50, 24 66, 16 58 C10 51, 26 44, 50 44 Z"
        fill={wings}
        stroke={toon.ink}
        strokeWidth={5.5}
        strokeLinejoin="round"
        opacity={0.92}
      />
      <Path
        d="M50 38 C60 50, 76 66, 84 58 C90 51, 74 44, 50 44 Z"
        fill={wings}
        stroke={toon.ink}
        strokeWidth={5.5}
        strokeLinejoin="round"
        opacity={0.92}
      />
      {/* body + antennae */}
      <Ellipse cx="50" cy="36" rx="5" ry="17" fill={body} stroke={toon.ink} strokeWidth={4} />
      <Path
        d="M48 20 C44 12, 40 9, 36 8 M52 20 C56 12, 60 9, 64 8"
        stroke={toon.ink}
        strokeWidth={3.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
});

const Butterfly = memo(function Butterfly({ spec, path, wing, box, reduced }) {
  const size = spec.size;
  const left = spec.x * box.width - size / 2;
  const top = spec.y * box.height - size / 2;

  // The wander. Two sines at different rates make a lissajous loop — it closes
  // on itself, so the butterfly never drifts off the scene however long the
  // screen is open, and it never retraces a straight line either.
  const flight = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ translateX: 0 }, { translateY: 0 }, { rotateZ: '0deg' }] };
    const t = path.value * spec.rate + spec.phase;
    const dx = Math.sin(TAU * t) * spec.ax * box.width;
    const dy = Math.sin(TAU * (t * 1.7 + 0.25)) * spec.ay * box.height;
    // Bank into the turn: the horizontal velocity is the cosine, so this leans
    // the butterfly the way it is actually going.
    const tilt = Math.cos(TAU * t) * 14;
    return {
      transform: [{ translateX: dx }, { translateY: dy }, { rotateZ: `${tilt}deg` }],
    };
  });

  // The wingbeat. Scaling X is what a butterfly seen from behind actually does
  // — the wings sweep toward each other and the silhouette narrows — and it
  // costs one transform instead of two animated sub-trees.
  const beat = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ scaleX: 1 }] };
    const t = wing.value * spec.wing + spec.phase;
    return { transform: [{ scaleX: 0.42 + 0.58 * (0.5 + 0.5 * Math.cos(TAU * t)) }] };
  });

  return (
    <Animated.View style={[styles.butterfly, { left, top }, flight]} pointerEvents="none">
      <Animated.View style={beat}>
        <Wings size={size} wings={spec.wings} body={spec.body} />
      </Animated.View>
    </Animated.View>
  );
});

/**
 * The swarm. `box` is the scene's pixel size — every spec is a fraction of it,
 * so the same layout works on any phone.
 *
 * `count` trims from the end of SPECS rather than sampling, so a smaller swarm
 * is still spread across the scene rather than bunched in one corner.
 */
export default function Butterflies({ box, count = SPECS.length, active = true, style }) {
  const reduced = useReduceMotion();
  const path = useRamp(active, reduced, PATH_MS);
  const wing = useRamp(active, reduced, WING_MS);
  const specs = useMemo(() => SPECS.slice(0, Math.max(0, count)), [count]);

  if (!box?.width || !box?.height) return null;

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {specs.map((spec, i) => (
        <Butterfly key={i} spec={spec} path={path} wing={wing} box={box} reduced={reduced} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  butterfly: { position: 'absolute' },
});
