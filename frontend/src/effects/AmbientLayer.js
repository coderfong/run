// AmbientLayer — the drift. A handful of sprites crossing a box forever, so a
// screen you are only looking at has something alive in it.
//
// This is the opposite kind of animation to everything else in this folder.
// An effect is fired, plays, and releases; this one never ends, and that
// changes what it is allowed to cost:
//
//   * NO PER-PARTICLE SPRITE CLOCK. Each particle is a single frame held
//     still (the sheets here are four and five frame loops of a leaf turning,
//     and at 20 points across the turn is not legible anyway). What moves is
//     the TRANSFORM, entirely on the UI thread — so a screen with seven leaves
//     on it costs seven running transforms and no JavaScript per frame.
//
//   * IT STOPS WHEN IT IS NOT WATCHED. A layer on an unfocused screen, or
//     under a modal, is animation nobody can see burning battery. `playing`
//     is how the caller says so; ProfileScreen ties it to focus.
//
//   * REDUCED MOTION MEANS NONE. Not "slower" — drifting scenery is exactly
//     what somebody who asked for less motion is asking to be rid of, and it
//     carries no information, so there is nothing to preserve.
//
//   * NO ART, NO LAYER. A preset whose sprites are not in this build renders
//     null. The leaves are licence blocked right now, so this is the live path
//     and not a hypothetical one.

import React, { useEffect, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '../ui/motion';
import { ambientSprites, getAmbient } from './ambientRegistry';

// A tiny deterministic generator. The particles must NOT be re-randomised on
// every render — a parent re-rendering while you watch would teleport the whole
// field — so the layout is derived once from a seed and memoised.
function seeded(seed) {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const between = (random, range) => range[0] + random() * (range[1] - range[0]);

function Particle({ spec, plan, width, height, playing, size }) {
  // Progress across the box, 0 to 1, looping. Everything else is derived from
  // it, so one timing drives position, fall and spin without three clocks.
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    if (!playing) return undefined;
    // Starts part way along rather than at the edge, so the field does not
    // enter as a rank the first time a screen opens.
    progress.value = plan.phase;
    progress.value = withDelay(
      plan.delay,
      withRepeat(withTiming(plan.phase + 1, { duration: plan.crossMs, easing: Easing.linear }), -1, false)
    );
    return () => cancelAnimation(progress);
  }, [playing, plan, progress]);

  // Wrapped to 0..1 so a particle that has run off the right re-enters left.
  const t = useDerivedValue(() => progress.value % 1, []);

  const style = useAnimatedStyle(() => {
    const travel = width + size * 2;
    const x = plan.reverse
      ? width + size - t.value * travel
      : -size + t.value * travel;
    // Sway is a sine off the same clock, so the path is an arc rather than a
    // line without needing a second animation per particle. A WHOLE number of
    // cycles per crossing (see plan.swayCycles) is what keeps it continuous
    // across the loop point — a fractional count would snap the particle
    // sideways every time the clock wrapped.
    const sway = Math.sin(t.value * plan.swayCycles * Math.PI * 2) * plan.swayPx;
    const y = plan.startY + t.value * plan.fall * height + sway;
    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: plan.spin ? `${t.value * 360 * plan.spinTurns}deg` : '0deg' },
      ],
    };
  }, [height, size, width]);

  const frameWidth = spec.frameWidth || size;
  const frameHeight = spec.frameHeight || size;
  const scale = size / Math.max(frameWidth, frameHeight);
  const columns = Math.max(1, spec.columns || 1);
  const rows = Math.max(1, spec.rows || 1);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        { width: frameWidth * scale, height: frameHeight * scale, opacity: plan.opacity },
        style,
      ]}
    >
      <Image
        source={spec.source}
        resizeMode="stretch"
        fadeDuration={0}
        style={{
          position: 'absolute',
          width: columns * frameWidth * scale,
          height: rows * frameHeight * scale,
          transform: [
            { translateX: -(plan.frame % columns) * frameWidth * scale },
            { translateY: -Math.floor(plan.frame / columns) * frameHeight * scale },
          ],
          imageRendering: 'pixelated',
        }}
      />
    </Animated.View>
  );
}

/**
 * `preset`  a key from the ambient registry ('leaves', 'embers', 'sparks').
 * `width`   / `height` the box to drift across. Both required: the layer is
 *           absolutely positioned and has no size of its own to measure.
 * `seed`    fixes the layout. Same seed, same arrangement, every mount.
 * `density` scales the preset's particle count. 0 draws nothing, which is a
 *           legitimate setting rather than a reason to unmount the layer.
 */
export default function AmbientLayer({
  preset,
  width,
  height,
  playing = true,
  density = 1,
  seed = 7,
  size,
  style,
}) {
  const reduced = useReduceMotion();
  const config = getAmbient(preset);

  // Keyed on `preset`, not on the sprite list: `ambientSprites` builds a fresh
  // array every call, so depending on it would rebuild the whole field on every
  // render of the parent and the particles would teleport as you watched.
  const plans = useMemo(() => {
    const sprites = ambientSprites(preset);
    if (!config || !sprites.length || !width || !height) return [];
    const count = Math.max(0, Math.round(config.count * density));
    const random = seeded(seed * 2654435761);
    return Array.from({ length: count }, (_, i) => {
      const spec = sprites[i % sprites.length];
      const crossMs = Math.round(between(random, config.crossMs));
      const swayMs = between(random, config.swayMs);
      return {
        key: `${spec.id}:${i}`,
        spec,
        plan: {
          phase: random(),
          delay: Math.round(random() * 900),
          crossMs,
          swayPx: between(random, config.swayPx),
          swayCycles: Math.max(1, Math.round(crossMs / swayMs)),
          fall: between(random, config.fall),
          opacity: between(random, config.opacity),
          // Spread down the box rather than all entering along one line. Kept
          // clear of the very bottom, where a scene's ground usually is.
          startY: random() * height * 0.7,
          reverse: random() < 0.25,
          spin: !!config.spin,
          spinTurns: config.spin ? 1 + Math.round(random() * 2) : 0,
          // Which frame of the sheet this particle is frozen on. Different per
          // particle, so a still field still looks like several leaves and not
          // one leaf duplicated.
          frame: Math.floor(random() * Math.max(1, spec.frameCount || 1)),
        },
      };
    });
  }, [config, density, height, preset, seed, width]);

  if (reduced || !plans.length) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer, style]}>
      {plans.map(({ key, spec, plan }) => (
        <Particle
          key={key}
          spec={spec}
          plan={plan}
          width={width}
          height={height}
          playing={playing}
          size={size || config.size}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { overflow: 'hidden' },
  particle: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
});
