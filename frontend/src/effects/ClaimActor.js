// The runner, doing something.
//
// The missing layer. Capture styles could put sprites anywhere on the screen
// and rattle the stage, but the character was a bystander in its own
// celebration — `onCharacterAction` was a prop on CaptureStylePlayer that no
// style had ever emitted. So every claim was "some art happened near a person".
//
// There are no pose sprites to cut to: a PASER character is assembled at
// runtime from live cosmetics (CharacterRig), so what animates here is the
// whole container. That is enough, because an action reads from its TIMING far
// more than from its drawing — a 360ms wind-up followed by a 90ms release is a
// punch whatever the arms are doing, and the same transforms played evenly are
// a shrug. Every action below is built as anticipation → commit → recovery,
// and the anticipation lengths are declared in choreography.js so the style
// can hang its effects off the moment the action COMMITS rather than the
// moment it started.
//
// Reanimated discipline, the same rule the capture encounter is built on: a
// shared value holds ONE animation, and a second assignment in the same tick
// cancels the first. So each action assigns every value it touches exactly
// once, as a single chain. Actions therefore cannot overlap — the later one
// wins outright — which is why validateChoreography rejects a style whose
// actor steps overlap instead of letting a beat silently disappear.

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ACTOR_ACTION, actorActionSpec } from './choreography';
import { CAPTURE_LAYER } from './layers';
import { CharacterBust } from '../components/character/CharacterRig';
import { withFace } from '../components/claim/expressions';

// The runner, and the subject of the whole scene.
//
// RETUNED 2026-08-14 (60→78→98) and again 2026-08-17 (98→118), the last time
// alongside the framing push in captureStyles.js — `FRAME_SCALE`, a 1.14x hold
// on the overlay stage for the length of the performance. The two together are
// what stop a capture reading as small figures in the middle of an empty map
// card: at 118 with the stage in, the runner, the rival and the one hero effect
// fill the middle half to two thirds of the usable viewport, which is the
// composition these scenes are directed for.
//
// `layoutDefenders` in anchors.js derives its spacing and clamping from whatever
// `size` it is handed, so growing the rigs self-adjusts the layout rather than
// overlapping them. Safe to retune here alone.
export const ACTOR_SIZE = 118;

// Where the actor sits relative to the point it is anchored on. The character
// stands ON the ground it is claiming, so the rig's feet want to be at the
// anchor rather than its middle.
const FOOT_OFFSET = ACTOR_SIZE * 0.44;

// Springs finish a chain; they never carry a timed section, because a spring's
// duration is open-ended and the schedule downstream is not.
const SETTLE = { damping: 12, stiffness: 260, mass: 0.5 };
const SOFT_SETTLE = { damping: 14, stiffness: 180, mass: 0.6 };

const ease = {
  out: Easing.out(Easing.quad),
  outCubic: Easing.out(Easing.cubic),
  inCubic: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.quad),
  // Wind-ups use this rather than a plain ease-out: a body gathering itself
  // starts slowly AND arrives slowly at the top of the wind-up, and the pause
  // implied by that second half is what makes the release read as a release.
  anticipate: Easing.inOut(Easing.quad),
};

/**
 * Where an action wants to face, as a signed direction.
 *
 * Actions that lunge or throw take a `toward` anchor; the actor leans and
 * travels along the x axis towards it. Nothing here rotates the rig to face a
 * point — a character built from front-facing cosmetic layers looks wrong
 * turned, so direction is expressed as lean and travel instead.
 */
function directionTo(target, origin) {
  if (!target || !origin) return 1;
  const dx = target.x - origin.x;
  if (!Number.isFinite(dx) || Math.abs(dx) < 1) return 1;
  return dx > 0 ? 1 : -1;
}

/**
 * A unit vector from `a` to `b`, or a sensible default when there is nothing
 * to measure.
 *
 * This is what makes a shockwave a shockwave. The displacement direction is
 * `defenderPosition - impactPosition`, so two rivals standing on opposite
 * sides of the same crater are thrown in opposite directions, and a rival
 * standing beyond it is thrown further out rather than back through it. The
 * old vocabulary had only a signed x, which meant every knockback was "left or
 * right of the attacker" no matter where the event actually happened.
 */
function unitVector(from, to, fallback = { x: 1, y: 0 }) {
  if (!from || !to) return fallback;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.5) return fallback;
  // Flattened vertically: the map is a ground plane seen from above, and a
  // character thrown mostly upward reads as launched into the sky rather than
  // across the dirt.
  const v = { x: dx / length, y: (dy / length) * 0.65 };
  const scale = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / scale, y: v.y / scale };
}

// ---------------------------------------------------------------------------
// The action library
// ---------------------------------------------------------------------------
//
// Each builder receives the shared values and the resolved options, and
// assigns one chain per value. `scale` lets a style stretch an action without
// rewriting it: every duration inside is multiplied, so the anticipation ratio
// that makes it readable survives the retune.

// Left and right versions of the same movement, written once. `sign` is the
// only difference, and keeping them as one builder is what makes a pool of
// [DODGE_LEFT, DODGE_RIGHT, BRACE] read as three people reacting to one event
// rather than three unrelated animations.

/** Out of the way fast, and stay off the spot they were standing on. */
function dodge(v, d, sign) {
  v.translateX.value = withSequence(
    withTiming(-8 * sign, { duration: d * 0.2, easing: ease.anticipate }),
    withTiming(40 * sign, { duration: d * 0.3, easing: ease.outCubic }),
    withSpring(34 * sign, SETTLE)
  );
  v.translateY.value = withSequence(
    withTiming(3, { duration: d * 0.2 }),
    withTiming(-11, { duration: d * 0.16, easing: ease.out }),
    withTiming(2, { duration: d * 0.16, easing: ease.inCubic }),
    withSpring(0, SETTLE)
  );
  v.rotate.value = withSequence(
    withTiming(-6 * sign, { duration: d * 0.2 }),
    withTiming(18 * sign, { duration: d * 0.3, easing: ease.outCubic }),
    withSpring(6 * sign, SOFT_SETTLE)
  );
  v.scaleX.value = withSequence(
    withTiming(0.94, { duration: d * 0.2 }),
    withTiming(1.14, { duration: d * 0.3 }),
    withSpring(1, SETTLE)
  );
  v.scaleY.value = withSequence(
    withTiming(1.05, { duration: d * 0.2 }),
    withTiming(0.9, { duration: d * 0.3 }),
    withSpring(1, SETTLE)
  );
}

/** Off balance, catching themselves. No anticipation: nobody chose this. */
function stumble(v, d, sign) {
  v.translateX.value = withSequence(
    withTiming(26 * sign, { duration: d * 0.26, easing: ease.outCubic }),
    withTiming(38 * sign, { duration: d * 0.2, easing: ease.out }),
    withTiming(30 * sign, { duration: d * 0.18 }),
    withSpring(28 * sign, SOFT_SETTLE)
  );
  v.rotate.value = withSequence(
    withTiming(24 * sign, { duration: d * 0.26, easing: ease.outCubic }),
    withTiming(-12 * sign, { duration: d * 0.22 }),
    withTiming(8 * sign, { duration: d * 0.18 }),
    withSpring(0, SOFT_SETTLE)
  );
  v.translateY.value = withSequence(
    withTiming(6, { duration: d * 0.26 }),
    withTiming(-4, { duration: d * 0.2 }),
    withSpring(0, SETTLE)
  );
  v.scaleY.value = withSequence(
    withTiming(0.92, { duration: d * 0.26 }),
    withTiming(1.06, { duration: d * 0.2 }),
    withSpring(1, SETTLE)
  );
}

/**
 * Away, at speed, and off the scene. Four bobs so it is running, not sliding.
 *
 * `reach` is how far this run travels — the caller works out how far the
 * actual edge of the screen is from here, so the run doesn't stop short and
 * fade out in the middle of the shot.
 */
function run(v, d, sign, reach = 160) {
  v.translateX.value = withSequence(
    withTiming(-10 * sign, { duration: d * 0.14, easing: ease.anticipate }),
    withTiming(reach * sign, { duration: d * 0.86, easing: ease.inCubic })
  );
  v.translateY.value = withSequence(
    withTiming(4, { duration: d * 0.14 }),
    withTiming(-7, { duration: d * 0.215 }),
    withTiming(1, { duration: d * 0.215 }),
    withTiming(-7, { duration: d * 0.215 }),
    withTiming(0, { duration: d * 0.215 })
  );
  v.rotate.value = withSequence(
    withTiming(-6 * sign, { duration: d * 0.14 }),
    withTiming(12 * sign, { duration: d * 0.86 })
  );
  v.scaleX.value = withSequence(
    withTiming(0.95, { duration: d * 0.14 }),
    withTiming(1.08, { duration: d * 0.43 }),
    withTiming(1.02, { duration: d * 0.43 })
  );
}

const ACTIONS = {
  [ACTOR_ACTION.IDLE]: (v, o, d) => {
    v.translateX.value = withSpring(0, SOFT_SETTLE);
    v.translateY.value = withSpring(0, SOFT_SETTLE);
    v.scaleX.value = withSpring(1, SOFT_SETTLE);
    v.scaleY.value = withSpring(1, SOFT_SETTLE);
    v.rotate.value = withSpring(0, SOFT_SETTLE);
  },

  // A turn of the head, expressed as a lean. Reads as "look at that".
  [ACTOR_ACTION.LOOK]: (v, o, d) => {
    const tilt = 7 * o.direction;
    v.rotate.value = withSequence(
      withTiming(tilt, { duration: d * 0.35, easing: ease.out }),
      withTiming(tilt * 0.7, { duration: d * 0.4 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(4 * o.direction, { duration: d * 0.35, easing: ease.out }),
      withSpring(0, SOFT_SETTLE)
    );
  },

  // Weight back, knees bent, waiting for it to arrive.
  [ACTOR_ACTION.BRACE]: (v, o, d) => {
    v.scaleY.value = withSequence(
      withTiming(0.9, { duration: d * 0.36, easing: ease.out }),
      withTiming(0.93, { duration: d * 0.4 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.07, { duration: d * 0.36, easing: ease.out }),
      withTiming(1.05, { duration: d * 0.4 }),
      withSpring(1, SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(5, { duration: d * 0.36, easing: ease.out }),
      withTiming(4, { duration: d * 0.4 }),
      withSpring(0, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-4 * o.direction, { duration: d * 0.36 }),
      withSpring(0, SETTLE)
    );
  },

  // A long build. The tremor is what sells it as effort rather than a pose.
  [ACTOR_ACTION.CHARGE]: (v, o, d) => {
    const build = d * 0.82;
    v.scaleY.value = withSequence(
      withTiming(0.94, { duration: build * 0.3, easing: ease.out }),
      withTiming(1.06, { duration: build * 0.7, easing: ease.inOut }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.05, { duration: build * 0.3, easing: ease.out }),
      withTiming(0.96, { duration: build * 0.7, easing: ease.inOut }),
      withSpring(1, SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(4, { duration: build * 0.3 }),
      withTiming(-7, { duration: build * 0.7, easing: ease.inOut }),
      withSpring(0, SETTLE)
    );
    // Six-frame shiver over the build, on top of the rise.
    v.translateX.value = withSequence(
      withTiming(-1.6, { duration: build / 6 }),
      withTiming(1.6, { duration: build / 6 }),
      withTiming(-2.2, { duration: build / 6 }),
      withTiming(2.2, { duration: build / 6 }),
      withTiming(-2.8, { duration: build / 6 }),
      withTiming(2.8, { duration: build / 6 }),
      withSpring(0, SETTLE)
    );
  },

  // Arms out and up: a push away from the body rather than at anything.
  [ACTOR_ACTION.CAST]: (v, o, d) => {
    const wind = d * 0.48;
    const side = o.side === 'left' ? -1 : o.side === 'right' ? 1 : o.direction;
    v.rotate.value = withSequence(
      withTiming(-6 * side, { duration: wind, easing: ease.anticipate }),
      withTiming(9 * side, { duration: d * 0.2, easing: ease.out }),
      o.hold ? withTiming(6 * side, { duration: d * 0.32 }) : withSpring(0, SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(o.raise ? -10 : 4, { duration: wind, easing: ease.anticipate }),
      withTiming(o.raise ? -14 : -6, { duration: d * 0.2, easing: ease.out }),
      o.hold ? withTiming(-8, { duration: d * 0.32 }) : withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.95, { duration: wind }),
      withTiming(1.08, { duration: d * 0.2, easing: ease.out }),
      o.hold ? withTiming(1.04, { duration: d * 0.32 }) : withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.04, { duration: wind }),
      withTiming(0.95, { duration: d * 0.2, easing: ease.out }),
      o.hold ? withTiming(0.98, { duration: d * 0.32 }) : withSpring(1, SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(-5 * side, { duration: wind, easing: ease.anticipate }),
      withTiming(7 * side, { duration: d * 0.2, easing: ease.out }),
      o.hold ? withTiming(4 * side, { duration: d * 0.32 }) : withSpring(0, SETTLE)
    );
  },

  // Wind back slowly, cross the gap fast. The ratio IS the punch.
  [ACTOR_ACTION.PUNCH]: (v, o, d) => {
    const wind = d * 0.55;
    const hit = d * 0.14;
    const reach = 34 * o.direction;
    v.translateX.value = withSequence(
      withTiming(-14 * o.direction, { duration: wind, easing: ease.anticipate }),
      withTiming(reach, { duration: hit, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-9 * o.direction, { duration: wind, easing: ease.anticipate }),
      withTiming(12 * o.direction, { duration: hit, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(0.94, { duration: wind }),
      withTiming(1.18, { duration: hit }),
      withTiming(0.92, { duration: d * 0.09 }),
      withSpring(1, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.05, { duration: wind }),
      withTiming(0.85, { duration: hit }),
      withTiming(1.12, { duration: d * 0.09 }),
      withSpring(1, SETTLE)
    );
  },

  // Rise, then drive one foot down. Vertical where punch is horizontal.
  [ACTOR_ACTION.STOMP]: (v, o, d) => {
    const lift = d * 0.54;
    const drop = d * 0.13;
    v.translateY.value = withSequence(
      withTiming(-18, { duration: lift, easing: ease.anticipate }),
      withTiming(6, { duration: drop, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.08, { duration: lift }),
      withTiming(0.8, { duration: drop }),
      withTiming(1.1, { duration: d * 0.1 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(0.95, { duration: lift }),
      withTiming(1.22, { duration: drop }),
      withTiming(0.94, { duration: d * 0.1 }),
      withSpring(1, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(4 * o.direction, { duration: lift }),
      withSpring(0, SETTLE)
    );
  },

  [ACTOR_ACTION.JUMP]: (v, o, d) => {
    const crouch = d * 0.26;
    const rise = d * 0.5;
    const height = o.height || 74;
    v.translateY.value = withSequence(
      withTiming(9, { duration: crouch, easing: ease.anticipate }),
      withTiming(-height, { duration: rise, easing: ease.outCubic }),
      withTiming(-height, { duration: d * 0.24 })
    );
    v.scaleY.value = withSequence(
      withTiming(0.82, { duration: crouch }),
      withTiming(1.18, { duration: rise * 0.4, easing: ease.out }),
      withTiming(1, { duration: rise * 0.6 }),
      withTiming(1, { duration: d * 0.24 })
    );
    v.scaleX.value = withSequence(
      withTiming(1.18, { duration: crouch }),
      withTiming(0.86, { duration: rise * 0.4, easing: ease.out }),
      withTiming(1, { duration: rise * 0.6 }),
      withTiming(1, { duration: d * 0.24 })
    );
  },

  // Assumes the actor is already up (JUMP leaves it there). Down fast, squash,
  // recover — the recovery is what makes the ground feel hard.
  [ACTOR_ACTION.SLAM]: (v, o, d) => {
    const fall = d * 0.42;
    v.translateY.value = withSequence(
      withTiming(-8, { duration: d * 0.12, easing: ease.anticipate }),
      withTiming(10, { duration: fall, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.14, { duration: d * 0.12 }),
      withTiming(0.7, { duration: fall * 0.5, easing: ease.inCubic }),
      withTiming(1.14, { duration: d * 0.16 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(0.9, { duration: d * 0.12 }),
      withTiming(1.34, { duration: fall * 0.5, easing: ease.inCubic }),
      withTiming(0.9, { duration: d * 0.16 }),
      withSpring(1, SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(8 * o.direction, { duration: fall, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
  },

  // Up, hang, down — one chain, so the hang is real rather than a gap between
  // two actions that Reanimated would collapse.
  [ACTOR_ACTION.JUMP_SLAM]: (v, o, d) => {
    const crouch = d * 0.16;
    const rise = d * 0.26;
    const hang = d * 0.16;
    const fall = d * 0.2;
    const height = o.height || 88;
    v.translateY.value = withSequence(
      withTiming(10, { duration: crouch, easing: ease.anticipate }),
      withTiming(-height, { duration: rise, easing: ease.outCubic }),
      withTiming(-height + 4, { duration: hang }),
      withTiming(12, { duration: fall, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.8, { duration: crouch }),
      withTiming(1.16, { duration: rise, easing: ease.out }),
      withTiming(1, { duration: hang }),
      withTiming(0.68, { duration: fall, easing: ease.inCubic }),
      withTiming(1.16, { duration: d * 0.08 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.2, { duration: crouch }),
      withTiming(0.88, { duration: rise, easing: ease.out }),
      withTiming(1, { duration: hang }),
      withTiming(1.36, { duration: fall, easing: ease.inCubic }),
      withTiming(0.88, { duration: d * 0.08 }),
      withSpring(1, SETTLE)
    );
  },

  [ACTOR_ACTION.STEP_FORWARD]: (v, o, d) => {
    const dir = o.away ? -o.direction : o.direction;
    v.translateX.value = withSequence(
      withTiming(20 * dir, { duration: d * 0.6, easing: ease.out }),
      withSpring(16 * dir, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.04, { duration: d * 0.3 }),
      withSpring(1, SOFT_SETTLE)
    );
  },

  [ACTOR_ACTION.DASH_FORWARD]: (v, o, d) => {
    v.translateX.value = withSequence(
      withTiming(-16 * o.direction, { duration: d * 0.28, easing: ease.anticipate }),
      withTiming(46 * o.direction, { duration: d * 0.42, easing: ease.inCubic }),
      withSpring(24 * o.direction, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(0.94, { duration: d * 0.28 }),
      withTiming(1.2, { duration: d * 0.42 }),
      withSpring(1, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.04, { duration: d * 0.28 }),
      withTiming(0.85, { duration: d * 0.42 }),
      withSpring(1, SETTLE)
    );
  },

  // The release is the important frame: it is when the projectile leaves, and
  // `anticipation` in choreography.js is set so a projectile step lands on it.
  [ACTOR_ACTION.THROW]: (v, o, d) => {
    const wind = d * 0.57;
    const release = d * 0.13;
    const dir = o.upward ? 0 : o.direction;
    v.rotate.value = withSequence(
      withTiming(-14 * (dir || 1), { duration: wind, easing: ease.anticipate }),
      withTiming(o.upward ? -4 : 16 * dir, { duration: release, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(-12 * (dir || 1), { duration: wind, easing: ease.anticipate }),
      withTiming(14 * dir, { duration: release, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(6, { duration: wind, easing: ease.anticipate }),
      withTiming(o.upward ? -14 : -4, { duration: release, easing: ease.out }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.94, { duration: wind }),
      withTiming(1.12, { duration: release }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.06, { duration: wind }),
      withTiming(0.92, { duration: release }),
      withSpring(1, SETTLE)
    );
  },

  // Crouch, press something into the ground, stand back up.
  [ACTOR_ACTION.PLANT]: (v, o, d) => {
    const down = d * 0.48;
    v.translateY.value = withSequence(
      withTiming(14, { duration: down, easing: ease.out }),
      withTiming(16, { duration: d * 0.12 }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.8, { duration: down, easing: ease.out }),
      withTiming(0.78, { duration: d * 0.12 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.16, { duration: down, easing: ease.out }),
      withTiming(1.18, { duration: d * 0.12 }),
      withSpring(1, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(6 * o.direction, { duration: down }),
      withSpring(0, SETTLE)
    );
  },

  // Hit by something. Short, sharp, and it comes back.
  [ACTOR_ACTION.RECOIL]: (v, o, d) => {
    const back = -26 * o.direction;
    const jitter = o.jitter;
    v.translateX.value = jitter
      ? withSequence(
          withTiming(back * 0.5, { duration: d * 0.1, easing: ease.out }),
          withTiming(back * 0.9, { duration: d * 0.08 }),
          withTiming(back * 0.3, { duration: d * 0.08 }),
          withTiming(back * 0.7, { duration: d * 0.08 }),
          withSpring(0, SETTLE)
        )
      : withSequence(
          withTiming(back, { duration: d * 0.22, easing: ease.out }),
          withSpring(0, SETTLE)
        );
    v.rotate.value = withSequence(
      withTiming(-16 * o.direction, { duration: d * 0.22, easing: ease.out }),
      withSpring(0, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.12, { duration: d * 0.16 }),
      withSpring(1, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.9, { duration: d * 0.16 }),
      withSpring(1, SETTLE)
    );
  },

  // Recoil's big sibling: leaves the ground and comes back down.
  [ACTOR_ACTION.KNOCKBACK]: (v, o, d) => {
    v.translateX.value = withSequence(
      withTiming(-52 * o.direction, { duration: d * 0.34, easing: ease.outCubic }),
      withSpring(0, SOFT_SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(-30, { duration: d * 0.18, easing: ease.out }),
      withTiming(8, { duration: d * 0.22, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-34 * o.direction, { duration: d * 0.34, easing: ease.outCubic }),
      withTiming(8 * o.direction, { duration: d * 0.2 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.88, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.12, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
  },

  // Dragged towards something, leaning against it. Slow, and it does not win.
  [ACTOR_ACTION.PULLED]: (v, o, d) => {
    v.translateX.value = withSequence(
      withTiming(18 * o.direction, { duration: d * 0.62, easing: ease.inOut }),
      withTiming(22 * o.direction, { duration: d * 0.18 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-12 * o.direction, { duration: d * 0.62, easing: ease.inOut }),
      withTiming(-15 * o.direction, { duration: d * 0.18 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(0.92, { duration: d * 0.62 }),
      withSpring(1, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.08, { duration: d * 0.62 }),
      withSpring(1, SOFT_SETTLE)
    );
  },

  // Points at something above the scene and HOLDS the pose, so whatever is
  // arriving has somebody already looking at it when it appears. The hold is
  // the difference between "called this down" and "flinched at it".
  [ACTOR_ACTION.POINT_SKY]: (v, o, d) => {
    const dir = o.direction;
    v.rotate.value = withSequence(
      withTiming(-6 * dir, { duration: d * 0.28, easing: ease.anticipate }),
      withTiming(10 * dir, { duration: d * 0.16, easing: ease.out }),
      withTiming(8 * dir, { duration: d * 0.56 })
    );
    v.translateY.value = withSequence(
      withTiming(5, { duration: d * 0.28, easing: ease.anticipate }),
      withTiming(-12, { duration: d * 0.16, easing: ease.out }),
      withTiming(-9, { duration: d * 0.56 })
    );
    v.translateX.value = withSequence(
      withTiming(-4 * dir, { duration: d * 0.28 }),
      withTiming(6 * dir, { duration: d * 0.16, easing: ease.out }),
      withTiming(5 * dir, { duration: d * 0.56 })
    );
    v.scaleY.value = withSequence(
      withTiming(0.96, { duration: d * 0.28 }),
      withTiming(1.09, { duration: d * 0.16, easing: ease.out }),
      withTiming(1.06, { duration: d * 0.56 })
    );
  },

  [ACTOR_ACTION.RAISE_ARMS]: (v, o, d) => {
    v.translateY.value = withSequence(
      withTiming(6, { duration: d * 0.3, easing: ease.anticipate }),
      withTiming(-13, { duration: d * 0.2, easing: ease.out }),
      withTiming(-10, { duration: d * 0.5 })
    );
    v.scaleY.value = withSequence(
      withTiming(0.93, { duration: d * 0.3 }),
      withTiming(1.12, { duration: d * 0.2, easing: ease.out }),
      withTiming(1.08, { duration: d * 0.5 })
    );
    v.scaleX.value = withSequence(
      withTiming(1.06, { duration: d * 0.3 }),
      withTiming(0.94, { duration: d * 0.2, easing: ease.out }),
      withTiming(0.97, { duration: d * 0.5 })
    );
  },

  // Walk to a point and STAY there. `delta` is the real pixel offset from this
  // body's anchor to the target, so the attacker can end the scene standing on
  // the ground they just took rather than where they threw from.
  [ACTOR_ACTION.MOVE_TO]: (v, o, d) => {
    const dx = o.delta?.x || 0;
    const dy = o.delta?.y || 0;
    v.translateX.value = withSequence(
      withTiming(-dx * 0.06, { duration: d * 0.14, easing: ease.anticipate }),
      withTiming(dx, { duration: d * 0.62, easing: ease.inOut }),
      withSpring(dx, SOFT_SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(dy * 0.5, { duration: d * 0.38, easing: ease.inOut }),
      withTiming(dy, { duration: d * 0.38, easing: ease.inOut }),
      withSpring(dy, SOFT_SETTLE)
    );
    // Two bobs on the way, so it reads as walking rather than sliding.
    v.scaleY.value = withSequence(
      withTiming(1.05, { duration: d * 0.19 }),
      withTiming(0.96, { duration: d * 0.19 }),
      withTiming(1.05, { duration: d * 0.19 }),
      withSpring(1, SOFT_SETTLE)
    );
  },

  // ---- the defender vocabulary -------------------------------------------
  //
  // These are the beats that let a rival be part of the event instead of an
  // obstacle removed before it. Same rules as everything above: one chain per
  // shared value, anticipation before commit, and nothing open-ended in the
  // timed section.

  [ACTOR_ACTION.LOOK_UP]: (v, o, d) => {
    v.translateY.value = withSequence(
      withTiming(-7, { duration: d * 0.3, easing: ease.out }),
      withTiming(-5, { duration: d * 0.42 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-6, { duration: d * 0.3, easing: ease.out }),
      withTiming(-5, { duration: d * 0.42 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.06, { duration: d * 0.3 }),
      withSpring(1, SOFT_SETTLE)
    );
  },

  [ACTOR_ACTION.LOOK_LEFT]: (v, o, d) => {
    v.rotate.value = withSequence(
      withTiming(-9, { duration: d * 0.32, easing: ease.out }),
      withTiming(-7, { duration: d * 0.38 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(-6, { duration: d * 0.32, easing: ease.out }),
      withSpring(0, SOFT_SETTLE)
    );
  },

  [ACTOR_ACTION.LOOK_RIGHT]: (v, o, d) => {
    v.rotate.value = withSequence(
      withTiming(9, { duration: d * 0.32, easing: ease.out }),
      withTiming(7, { duration: d * 0.38 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(6, { duration: d * 0.32, easing: ease.out }),
      withSpring(0, SOFT_SETTLE)
    );
  },

  // A double-take toward whatever just happened. Small recoil first, then the
  // turn: seeing something is a reaction before it is a movement.
  [ACTOR_ACTION.NOTICE]: (v, o, d) => {
    const dir = o.pull?.x >= 0 ? 1 : -1;
    v.translateX.value = withSequence(
      withTiming(-5 * dir, { duration: d * 0.18, easing: ease.out }),
      withTiming(4 * dir, { duration: d * 0.22, easing: ease.out }),
      withSpring(0, SOFT_SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-8 * dir, { duration: d * 0.18, easing: ease.out }),
      withTiming(7 * dir, { duration: d * 0.22 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.08, { duration: d * 0.18 }),
      withTiming(0.97, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
  },

  [ACTOR_ACTION.SURPRISED]: (v, o, d) => {
    v.translateY.value = withSequence(
      withTiming(3, { duration: d * 0.1 }),
      withTiming(-16, { duration: d * 0.2, easing: ease.outCubic }),
      withTiming(2, { duration: d * 0.2, easing: ease.inCubic }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.9, { duration: d * 0.1 }),
      withTiming(1.18, { duration: d * 0.2 }),
      withTiming(0.96, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.1, { duration: d * 0.1 }),
      withTiming(0.88, { duration: d * 0.2 }),
      withTiming(1.05, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
  },

  [ACTOR_ACTION.DUCK]: (v, o, d) => {
    v.translateY.value = withSequence(
      withTiming(-3, { duration: d * 0.14, easing: ease.anticipate }),
      withTiming(16, { duration: d * 0.18, easing: ease.inCubic }),
      withTiming(15, { duration: d * 0.36 }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.04, { duration: d * 0.14 }),
      withTiming(0.66, { duration: d * 0.18, easing: ease.inCubic }),
      withTiming(0.68, { duration: d * 0.36 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(0.97, { duration: d * 0.14 }),
      withTiming(1.28, { duration: d * 0.18 }),
      withTiming(1.26, { duration: d * 0.36 }),
      withSpring(1, SETTLE)
    );
  },

  [ACTOR_ACTION.DODGE_LEFT]: (v, o, d) => dodge(v, d, -1),
  [ACTOR_ACTION.DODGE_RIGHT]: (v, o, d) => dodge(v, d, 1),

  // Away from whatever is coming, and it keeps the ground it retreated to.
  [ACTOR_ACTION.HOP_BACK]: (v, o, d) => {
    const push = o.push || { x: -1, y: 0 };
    const reach = 30;
    v.translateX.value = withSequence(
      withTiming(-push.x * 5, { duration: d * 0.2, easing: ease.anticipate }),
      withTiming(push.x * reach, { duration: d * 0.34, easing: ease.outCubic }),
      withSpring(push.x * reach * 0.86, SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(4, { duration: d * 0.2, easing: ease.anticipate }),
      withTiming(-14 + push.y * reach * 0.5, { duration: d * 0.18, easing: ease.out }),
      withTiming(push.y * reach * 0.6, { duration: d * 0.16, easing: ease.inCubic }),
      withSpring(push.y * reach * 0.5, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.86, { duration: d * 0.2 }),
      withTiming(1.12, { duration: d * 0.18 }),
      withSpring(1, SETTLE)
    );
  },

  [ACTOR_ACTION.STUMBLE_LEFT]: (v, o, d) => stumble(v, d, -1),
  [ACTOR_ACTION.STUMBLE_RIGHT]: (v, o, d) => stumble(v, d, 1),

  /**
   * Blown off their feet, along `defenderPosition - impactPosition`.
   *
   * The direction comes in as a resolved unit vector, so this single action
   * covers everybody in the scene: the rival on the far side of the crater
   * goes the other way, and nobody is thrown through the thing that hit them.
   */
  [ACTOR_ACTION.SHOCKWAVE_KNOCKBACK]: (v, o, d) => {
    const push = o.push || { x: 1, y: 0 };
    const reach = 84;
    const spin = push.x >= 0 ? 1 : -1;
    v.translateX.value = withSequence(
      withTiming(push.x * reach, { duration: d * 0.34, easing: ease.outCubic }),
      withTiming(push.x * reach * 1.1, { duration: d * 0.3, easing: ease.out }),
      withSpring(push.x * reach * 1.05, SOFT_SETTLE)
    );
    // Up first, then down: hit by a blast, not dragged along the floor.
    v.translateY.value = withSequence(
      withTiming(-34 + push.y * reach * 0.4, { duration: d * 0.2, easing: ease.out }),
      withTiming(push.y * reach * 0.75 + 6, { duration: d * 0.26, easing: ease.inCubic }),
      withTiming(push.y * reach * 0.75, { duration: d * 0.2 }),
      withSpring(push.y * reach * 0.7, SOFT_SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(46 * spin, { duration: d * 0.34, easing: ease.outCubic }),
      withTiming(12 * spin, { duration: d * 0.3 }),
      withSpring(0, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.84, { duration: d * 0.2 }),
      withTiming(1.1, { duration: d * 0.24 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.16, { duration: d * 0.2 }),
      withTiming(0.92, { duration: d * 0.24 }),
      withSpring(1, SETTLE)
    );
  },

  // Dragged toward something, feet losing purchase.
  [ACTOR_ACTION.SLIDE_TOWARD]: (v, o, d) => {
    const pull = o.pull || { x: 1, y: 0 };
    const reach = 46;
    v.translateX.value = withSequence(
      withTiming(pull.x * reach * 0.45, { duration: d * 0.4, easing: ease.inOut }),
      withTiming(pull.x * reach, { duration: d * 0.4, easing: ease.inCubic }),
      withSpring(pull.x * reach, SOFT_SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(pull.y * reach * 0.45, { duration: d * 0.4, easing: ease.inOut }),
      withTiming(pull.y * reach, { duration: d * 0.4, easing: ease.inCubic }),
      withSpring(pull.y * reach, SOFT_SETTLE)
    );
    // Leaning back against the direction of travel is what makes it a drag.
    v.rotate.value = withSequence(
      withTiming(-16 * (pull.x >= 0 ? 1 : -1), { duration: d * 0.5, easing: ease.inOut }),
      withSpring(-10 * (pull.x >= 0 ? 1 : -1), SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(1.06, { duration: d * 0.5 }),
      withSpring(1, SOFT_SETTLE)
    );
  },

  // Digging in: they lose a little ground, then hold it. Slipping IN and being
  // dragged AWAY are different beats, and a scene needs both to have a fight.
  [ACTOR_ACTION.RESIST_PULL]: (v, o, d) => {
    const pull = o.pull || { x: 1, y: 0 };
    const dir = pull.x >= 0 ? 1 : -1;
    v.translateX.value = withSequence(
      withTiming(pull.x * 22, { duration: d * 0.3, easing: ease.inOut }),
      withTiming(pull.x * 12, { duration: d * 0.22, easing: ease.out }),
      withTiming(pull.x * 26, { duration: d * 0.28, easing: ease.inOut }),
      withSpring(pull.x * 18, SOFT_SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(pull.y * 22 + 5, { duration: d * 0.3, easing: ease.inOut }),
      withTiming(pull.y * 14 + 5, { duration: d * 0.5 }),
      withSpring(pull.y * 18, SOFT_SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-22 * dir, { duration: d * 0.3, easing: ease.out }),
      withTiming(-18 * dir, { duration: d * 0.5 }),
      withSpring(-12 * dir, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.9, { duration: d * 0.3 }),
      withTiming(0.93, { duration: d * 0.5 }),
      withSpring(1, SOFT_SETTLE)
    );
  },

  [ACTOR_ACTION.RUN_LEFT]: (v, o, d) => run(v, d, -1, o.edgeReach),
  [ACTOR_ACTION.RUN_RIGHT]: (v, o, d) => run(v, d, 1, o.edgeReach),

  // Off in whatever direction is away from the event. The exit beat that
  // matters most: a rival who runs has left, a rival who fades has been
  // deleted, and only one of those is a story. `edgeReach` (screen-edge
  // relative, from `play` below) carries the X travel; the Y drift stays a
  // fixed modest arc regardless of how far sideways that edge turns out to be.
  [ACTOR_ACTION.FLEE_FROM]: (v, o, d) => {
    const push = o.push || { x: 1, y: 0 };
    const reach = o.edgeReach || 150;
    const vDrift = 150;
    const dir = push.x >= 0 ? 1 : -1;
    v.translateX.value = withSequence(
      withTiming(-push.x * 8, { duration: d * 0.14, easing: ease.anticipate }),
      withTiming(push.x * reach, { duration: d * 0.86, easing: ease.inCubic })
    );
    v.translateY.value = withSequence(
      withTiming(3, { duration: d * 0.14 }),
      withTiming(push.y * vDrift * 0.7 - 6, { duration: d * 0.43, easing: ease.out }),
      withTiming(push.y * vDrift * 0.9, { duration: d * 0.43, easing: ease.inOut })
    );
    v.rotate.value = withSequence(
      withTiming(-7 * dir, { duration: d * 0.14 }),
      withTiming(13 * dir, { duration: d * 0.4 }),
      withTiming(9 * dir, { duration: d * 0.46 })
    );
    v.scaleY.value = withSequence(
      withTiming(0.92, { duration: d * 0.14 }),
      withTiming(1.06, { duration: d * 0.28 }),
      withTiming(0.97, { duration: d * 0.28 }),
      withTiming(1.04, { duration: d * 0.3 })
    );
  },

  // Knocked down and back up. The recovery is the point: they are beaten, not
  // erased, and they get to leave under their own power afterwards.
  [ACTOR_ACTION.FALL_AND_RECOVER]: (v, o, d) => {
    const dir = o.push?.x >= 0 ? 1 : -1;
    v.rotate.value = withSequence(
      withTiming(72 * dir, { duration: d * 0.22, easing: ease.inCubic }),
      withTiming(76 * dir, { duration: d * 0.3 }),
      withTiming(14 * dir, { duration: d * 0.24, easing: ease.out }),
      withSpring(0, SETTLE)
    );
    v.translateY.value = withSequence(
      withTiming(18, { duration: d * 0.22, easing: ease.inCubic }),
      withTiming(20, { duration: d * 0.3 }),
      withTiming(-6, { duration: d * 0.24, easing: ease.out }),
      withSpring(0, SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(24 * dir, { duration: d * 0.22, easing: ease.outCubic }),
      withTiming(26 * dir, { duration: d * 0.54 }),
      withSpring(18 * dir, SOFT_SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.82, { duration: d * 0.22 }),
      withTiming(0.84, { duration: d * 0.3 }),
      withTiming(1.08, { duration: d * 0.24 }),
      withSpring(1, SETTLE)
    );
  },

  // Quantised jitter. No easing anywhere on purpose: a glitch that eases is a
  // wobble.
  [ACTOR_ACTION.GLITCH_JUMP]: (v, o, d) => {
    const step = d / 7;
    v.translateX.value = withSequence(
      withTiming(9, { duration: step, easing: Easing.linear }),
      withTiming(-11, { duration: step, easing: Easing.linear }),
      withTiming(5, { duration: step, easing: Easing.linear }),
      withTiming(-7, { duration: step, easing: Easing.linear }),
      withTiming(3, { duration: step, easing: Easing.linear }),
      withTiming(0, { duration: step, easing: Easing.linear })
    );
    v.translateY.value = withSequence(
      withTiming(-6, { duration: step * 1.5, easing: Easing.linear }),
      withTiming(4, { duration: step * 1.5, easing: Easing.linear }),
      withTiming(-3, { duration: step * 1.5, easing: Easing.linear }),
      withTiming(0, { duration: step * 1.5, easing: Easing.linear })
    );
    v.scaleX.value = withSequence(
      withTiming(1.14, { duration: step * 2, easing: Easing.linear }),
      withTiming(0.88, { duration: step * 2, easing: Easing.linear }),
      withTiming(1, { duration: step * 2, easing: Easing.linear })
    );
  },

  [ACTOR_ACTION.BOUNCE_REACTION]: (v, o, d) => {
    v.translateY.value = withSequence(
      withTiming(8, { duration: d * 0.16, easing: ease.anticipate }),
      withTiming(-22, { duration: d * 0.22, easing: ease.outCubic }),
      withTiming(3, { duration: d * 0.18, easing: ease.inCubic }),
      withTiming(-9, { duration: d * 0.14, easing: ease.out }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.8, { duration: d * 0.16 }),
      withTiming(1.16, { duration: d * 0.22 }),
      withTiming(0.92, { duration: d * 0.18 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.2, { duration: d * 0.16 }),
      withTiming(0.88, { duration: d * 0.22 }),
      withTiming(1.08, { duration: d * 0.18 }),
      withSpring(1, SETTLE)
    );
  },

  [ACTOR_ACTION.WINCE]: (v, o, d) => {
    v.scaleY.value = withSequence(
      withTiming(0.88, { duration: d * 0.24, easing: ease.out }),
      withTiming(0.94, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.1, { duration: d * 0.24, easing: ease.out }),
      withSpring(1, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-7, { duration: d * 0.24 }),
      withTiming(5, { duration: d * 0.2 }),
      withSpring(0, SETTLE)
    );
  },

  // Shaking off paint, dust, frost. The consequence beat that says an impact
  // left something on them.
  [ACTOR_ACTION.SHAKE_OFF]: (v, o, d) => {
    const beat = d / 8;
    v.rotate.value = withSequence(
      withTiming(-13, { duration: beat }),
      withTiming(12, { duration: beat }),
      withTiming(-9, { duration: beat }),
      withTiming(8, { duration: beat }),
      withTiming(-5, { duration: beat }),
      withSpring(0, SETTLE)
    );
    v.translateX.value = withSequence(
      withTiming(-5, { duration: beat }),
      withTiming(5, { duration: beat }),
      withTiming(-3, { duration: beat }),
      withTiming(3, { duration: beat }),
      withSpring(0, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.07, { duration: beat * 2 }),
      withTiming(0.96, { duration: beat * 2 }),
      withSpring(1, SETTLE)
    );
  },

  // Pulled through something and gone. Sinks and spins down rather than
  // shrinking on the spot, so it reads as a destination rather than a delete.
  [ACTOR_ACTION.PORTAL_EXIT]: (v, o, d) => {
    const pull = o.pull || { x: 0, y: 1 };
    v.translateX.value = withSequence(
      withTiming(-pull.x * 6, { duration: d * 0.22, easing: ease.anticipate }),
      withTiming(pull.x * 30, { duration: d * 0.78, easing: ease.inCubic })
    );
    v.translateY.value = withSequence(
      withTiming(-8, { duration: d * 0.22, easing: ease.anticipate }),
      withTiming(pull.y * 30 + 12, { duration: d * 0.78, easing: ease.inCubic })
    );
    v.rotate.value = withSequence(
      withTiming(0, { duration: d * 0.22 }),
      withTiming(160 * (pull.x >= 0 ? 1 : -1), { duration: d * 0.78, easing: ease.inCubic })
    );
    v.scaleY.value = withSequence(
      withTiming(1.1, { duration: d * 0.22 }),
      withTiming(0.05, { duration: d * 0.78, easing: ease.inCubic })
    );
    v.scaleX.value = withSequence(
      withTiming(0.92, { duration: d * 0.22 }),
      withTiming(0.05, { duration: d * 0.78, easing: ease.inCubic })
    );
  },

  [ACTOR_ACTION.CELEBRATE]: (v, o, d) => {
    v.translateY.value = withSequence(
      withTiming(6, { duration: d * 0.14, easing: ease.anticipate }),
      withTiming(-30, { duration: d * 0.24, easing: ease.outCubic }),
      withTiming(4, { duration: d * 0.2, easing: ease.inCubic }),
      withTiming(-12, { duration: d * 0.16, easing: ease.out }),
      withSpring(0, SETTLE)
    );
    v.scaleY.value = withSequence(
      withTiming(0.86, { duration: d * 0.14 }),
      withTiming(1.14, { duration: d * 0.24 }),
      withTiming(0.94, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
    v.scaleX.value = withSequence(
      withTiming(1.14, { duration: d * 0.14 }),
      withTiming(0.9, { duration: d * 0.24 }),
      withTiming(1.06, { duration: d * 0.2 }),
      withSpring(1, SETTLE)
    );
    v.rotate.value = withSequence(
      withTiming(-8, { duration: d * 0.24 }),
      withTiming(8, { duration: d * 0.2 }),
      withSpring(0, SETTLE)
    );
  },
};

/**
 * Reduced motion keeps the BEAT and drops the movement.
 *
 * Not "play it faster": a character that squashes, spins and is thrown across
 * the screen quickly is exactly the large-field movement the setting exists to
 * suppress. What survives is a small scale nudge on the frame the action
 * commits, so the sequence still has a pulse where its impact is and the
 * runner is not left watching a static rig.
 */
function playReduced(v, action, options = {}) {
  const spec = actorActionSpec(action);
  const big = action === ACTOR_ACTION.SLAM
    || action === ACTOR_ACTION.JUMP_SLAM
    || action === ACTOR_ACTION.PUNCH
    || action === ACTOR_ACTION.STOMP
    || action === ACTOR_ACTION.KNOCKBACK
    || action === ACTOR_ACTION.SHOCKWAVE_KNOCKBACK;

  // An exit still has to END with the character gone, or reduced motion would
  // leave the whole cast standing on ground that has already changed hands.
  // It is a fade and a short shift rather than a sprint across the screen.
  if (spec.exit || options.exit) {
    const push = options.push || { x: 1, y: 0 };
    v.translateX.value = withTiming(push.x * 18, { duration: 200 });
    v.translateY.value = withTiming(push.y * 18, { duration: 200 });
    v.opacity.value = withTiming(0, { duration: 220 });
    return;
  }

  // Displacement keeps its DIRECTION and loses its distance, so "everyone was
  // blown away from the crater" still reads at a glance.
  if (spec.directional && options.push) {
    v.translateX.value = withSequence(
      withTiming(options.push.x * 12, { duration: 120 }),
      withTiming(0, { duration: 180 })
    );
    v.translateY.value = withSequence(
      withTiming(options.push.y * 12, { duration: 120 }),
      withTiming(0, { duration: 180 })
    );
  }

  // Settling somewhere new is information, not decoration: it is how the
  // attacker ends up standing on the claim.
  if (action === ACTOR_ACTION.MOVE_TO && options.delta) {
    v.translateX.value = withTiming(options.delta.x, { duration: 220 });
    v.translateY.value = withTiming(options.delta.y, { duration: 220 });
    return;
  }

  v.scaleX.value = withSequence(
    withTiming(big ? 1.08 : 1.04, { duration: 90 }),
    withTiming(1, { duration: 130 })
  );
  v.scaleY.value = withSequence(
    withTiming(big ? 0.94 : 0.97, { duration: 90 }),
    withTiming(1, { duration: 130 })
  );
}

// ---------------------------------------------------------------------------

/**
 * The actor layer.
 *
 * Positioned by `anchor` (a screen point, normally the claim point), driven by
 * `play(step)` through the ref. The player calls it; nothing else should.
 */
const ClaimActor = React.forwardRef(function ClaimActor(
  {
    equipped, anchor, bounds, size = ACTOR_SIZE, reducedMotion = false,
    visible = true, fadeIn = 0,
    // An expression is one swapped cosmetic slot, so a character can be
    // startled without their hat moving. The cast decides it from the action.
    face,
  },
  ref
) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(fadeIn > 0 ? 0 : 1);

  const values = useRef({ translateX, translateY, scaleX, scaleY, rotate, opacity }).current;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    if (fadeIn > 0) opacity.value = withTiming(1, { duration: fadeIn });
    else opacity.value = 1;
  }, [fadeIn, opacity]);

  const reset = useCallback(() => {
    [translateX, translateY, rotate].forEach((value) => {
      cancelAnimation(value);
      value.value = 0;
    });
    [scaleX, scaleY].forEach((value) => {
      cancelAnimation(value);
      value.value = 1;
    });
    cancelAnimation(opacity);
    opacity.value = 1;
  }, [opacity, rotate, scaleX, scaleY, translateX, translateY]);

  const play = useCallback((step) => {
    const name = step?.name;
    const builder = ACTIONS[name];
    if (!builder) return;
    const spec = actorActionSpec(name);
    // `originPoint` / `targetPoint` arrive already resolved: the player turns
    // the step's anchor NAMES into screen points with the same resolver the
    // effects use, so a shockwave is aimed at the crater that actually formed.
    const here = anchorRef.current;
    const options = {
      ...step,
      direction: directionTo(step.targetPoint || step.originPoint, here),
      // Away from what happened, and toward what is pulling. Both are unit
      // vectors so an action can commit to a distance of its own.
      push: step.originPoint ? unitVector(step.originPoint, here) : null,
      pull: step.targetPoint ? unitVector(here, step.targetPoint) : null,
      delta: step.targetPoint && here
        ? { x: step.targetPoint.x - here.x, y: step.targetPoint.y - here.y }
        : null,
    };

    // RUN_LEFT/RUN_RIGHT/FLEE_FROM used to travel a fixed ~150px and fade
    // mid-shot, which reads as "gave up" rather than "left". Instead they now
    // travel exactly as far as the actual edge of the stage from wherever
    // this rig is standing, so the fade at the tail of the action lands once
    // they've cleared the side of the screen rather than stranded in the open.
    if (here && (
      name === ACTOR_ACTION.RUN_LEFT
      || name === ACTOR_ACTION.RUN_RIGHT
      || name === ACTOR_ACTION.FLEE_FROM
    )) {
      const stageWidth = boundsRef.current?.width || 0;
      const clearance = size * 0.6;
      const dirSign = name === ACTOR_ACTION.RUN_LEFT ? -1
        : name === ACTOR_ACTION.RUN_RIGHT ? 1
        : (options.push?.x >= 0 ? 1 : -1);
      options.edgeReach = Math.max(
        dirSign > 0 ? (stageWidth - here.x) + clearance : here.x + clearance,
        160
      );
    }

    if (reducedMotion) {
      playReduced(values, name, options);
      return;
    }

    const duration = step.duration || spec.duration;
    builder(values, options, duration);

    // An exit action ends with the character off the scene. Done here rather
    // than by the cast so the fade is part of the same chain as the movement
    // that carried them off, and cannot land a frame early on a slow device.
    if (spec.exit || step.exit) {
      opacity.value = withDelay(
        Math.round(duration * 0.55),
        withTiming(0, { duration: Math.round(duration * 0.4) })
      );
    }
  }, [opacity, reducedMotion, size, values]);

  useImperativeHandle(ref, () => ({ play, reset }), [play, reset]);

  // One slot swapped, everything else the character is wearing kept.
  const worn = useMemo(() => (face ? withFace(equipped, face) : (equipped || {})), [equipped, face]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  if (!visible || !anchor) return null;

  // Kept inside the stage box so an actor thrown sideways is not clipped by
  // the map card's edge.
  const left = Math.min(
    Math.max(anchor.x - size / 2, 4),
    Math.max(4, (bounds?.width || size) - size - 4)
  );
  const top = Math.min(
    Math.max(anchor.y - size / 2 - FOOT_OFFSET, 4),
    Math.max(4, (bounds?.height || size) - size - 4)
  );

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.actor, { left, top, width: size, height: size }, style]}
    >
      {/* No `ring` and no `bg`: an actor in the scene is a body, not a framed
          portrait. Every cast member is drawn the same way, which is why the
          runner and the rivals read as being in the same scene. */}
      <CharacterBust equipped={worn} size={size} bg="transparent" />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  actor: { position: 'absolute', zIndex: CAPTURE_LAYER.CHARACTER },
});

export default ClaimActor;
export { ACTIONS as ACTOR_ACTION_BUILDERS };
