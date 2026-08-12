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

import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ACTOR_ACTION, actorActionSpec } from './choreography';
import { CAPTURE_LAYER } from './layers';
import { CharacterBust } from '../components/character/CharacterRig';

export const ACTOR_SIZE = 60;

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

// ---------------------------------------------------------------------------
// The action library
// ---------------------------------------------------------------------------
//
// Each builder receives the shared values and the resolved options, and
// assigns one chain per value. `scale` lets a style stretch an action without
// rewriting it: every duration inside is multiplied, so the anticipation ratio
// that makes it readable survives the retune.

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
function playReduced(v, action) {
  const big = action === ACTOR_ACTION.SLAM
    || action === ACTOR_ACTION.JUMP_SLAM
    || action === ACTOR_ACTION.PUNCH
    || action === ACTOR_ACTION.STOMP
    || action === ACTOR_ACTION.KNOCKBACK;
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
  { equipped, anchor, bounds, size = ACTOR_SIZE, reducedMotion = false, visible = true, fadeIn = 0 },
  ref
) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(fadeIn > 0 ? 0 : 1);

  const values = useRef({ translateX, translateY, scaleX, scaleY, rotate }).current;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

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
  }, [rotate, scaleX, scaleY, translateX, translateY]);

  const play = useCallback((step) => {
    const name = step?.name;
    const builder = ACTIONS[name];
    if (!builder) return;
    if (reducedMotion) {
      playReduced(values, name);
      return;
    }
    const spec = actorActionSpec(name);
    const duration = step.duration || spec.duration;
    const options = {
      ...step,
      // `toward` / `lookAt` arrive as anchor NAMES; the player resolves them to
      // points and passes the result through as `targetPoint`.
      direction: directionTo(step.targetPoint, anchorRef.current),
    };
    builder(values, options, duration);
  }, [reducedMotion, values]);

  useImperativeHandle(ref, () => ({ play, reset }), [play, reset]);

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
      <CharacterBust equipped={equipped} size={size} bg="transparent" />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  actor: { position: 'absolute', zIndex: CAPTURE_LAYER.CHARACTER },
});

export default ClaimActor;
export { ACTIONS as ACTOR_ACTION_BUILDERS };
