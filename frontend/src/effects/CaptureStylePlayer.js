// Plays a choreography.
//
// The old player understood two things: put a sprite here, rattle the stage.
// Everything a style could say was therefore a variation on "some art appeared
// somewhere" — and the people whose ground was being taken were not even its
// problem, because something upstream had already bumped them off screen. It
// now conducts a whole cast (see choreography.js):
//
//   attacker     forwarded to the cast, which owns one body per character
//   defenders    expanded against the REAL cast size, then forwarded the same way
//   camera       forwarded to the shared stage, which carries the reveal too
//   effect       a sprite in a place, or a sprite that TRAVELS between two
//   environment  shadows, cracks, sweeps, dust: primitives, not art
//   territory    the reveal cue, carrying HOW and FROM WHERE
//   feel         haptics, and pauses that exist only to be silent
//   victory      the beat the attacker has won on
//
// The player owns scheduling, cancellation and safety. Every visual step is
// optional presentation: a blocked licence, a bad import or a typo drops that
// step and nothing else. The reveal cue is the one step that matters, and it
// has a fallback in the controller so even a player that never mounts cannot
// strand a claim.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '../ui/motion';
import {
  buildTerritoryAnchorModel,
  fitEffectInBounds,
  flattenTerritoryRings,
  resolveEffectAnchor,
} from './anchors';
import { resolveCaptureStyle } from './captureStyles';
import {
  CAMERA_ACTION,
  EFFECT_SLOT,
  ROLE,
  expandCast,
  isExitAction,
  validateChoreography,
} from './choreography';
import EffectPlayer from './EffectPlayer';
import EnvironmentLayer from './EnvironmentLayer';
import { getEffect } from './effectRegistry';
import { CAPTURE_LAYER } from './layers';
import ReactionEffect from './ReactionEffect';
import { getReactionEffect } from './reactionRegistry';
import { EFFECT_TYPE } from './effectTypes';

// Two named slots, and that is the ceiling: one hero sprite and one thing it
// caused. It used to be three, evicted oldest-first, so which art survived
// depended on how many steps had recently fired and a sprite could disappear
// mid-play for a reason no viewer could infer. See EFFECT_SLOT.
export const MAX_CAPTURE_EFFECTS = 2;

// How far a sprite's playback rate may be pushed to make it fit its window.
//
// A sheet is drawn at a pace; doubling it reads as a fast-forward and halving
// it reads as a stall. Outside this band the art is simply cut at the end of
// its window instead — a beat that ends cleanly is always better than one that
// bleeds, and the window is the authored intent.
const MIN_SPRITE_SPEED = 0.7;
const MAX_SPRITE_SPEED = 2.4;

/**
 * How long this sheet takes to play once at its own natural pace.
 *
 * Deliberately computed here rather than imported from EffectPlayer: this is
 * plain arithmetic on a registry entry, the player needs it during scheduling
 * (before anything is rendered), and EffectPlayer is a component module that
 * tests legitimately mock — importing a pure helper across that boundary made
 * the whole player crash under a mock that only stubbed the default export.
 */
function naturalSpriteMs(spec) {
  if (spec?.frameCount > 0 && spec?.fps > 0) return (spec.frameCount / spec.fps) * 1000;
  if (spec?.duration > 0) return spec.duration;
  return 800;
}

/**
 * The playback rate that makes this sheet play through exactly once inside the
 * window the style gave it.
 *
 * This is the mechanical half of the "one beat, one effect" rule. The authored
 * `speed` numbers it replaces were guesses made without reference to frame
 * counts, and they were wrong by multiples: several styles asked for `speed`
 * below 1 on sheets that were already 2-3 seconds long, producing single
 * effects that ran for five seconds and covered every beat that followed.
 */
export function spriteSpeedForWindow(spec, hold) {
  if (!spec || !(hold > 0)) return 1;
  const natural = naturalSpriteMs(spec);
  if (!(natural > 0)) return 1;
  return Math.min(MAX_SPRITE_SPEED, Math.max(MIN_SPRITE_SPEED, natural / hold));
}

export function effectIdForCaptureStep(step) {
  if (step.effect) return step.effect;
  if (step.reaction) return getReactionEffect(step.reaction);
  return null;
}

/**
 * Every image a style can put on screen, for warming before it plays.
 *
 * A capture sheet is up to 34 MB of bitmap at 3x. Decoded as its step fires,
 * it lands a beat after the step that called for it; decoded while the run
 * replay is still flying (ResultScreen asks for this the moment the style is
 * picked), it is already in memory when the first beat lands. Lottie steps are
 * left out: their source is a document, not an image.
 */
export function captureStyleImageSources(styleId) {
  const captureStyle = resolveCaptureStyle(styleId);
  const sources = [];
  (captureStyle?.sequence || []).forEach((step) => {
    const id = effectIdForCaptureStep(step);
    const spec = id ? getEffect(id) : null;
    if (spec?.source != null && spec.type !== EFFECT_TYPE.LOTTIE) sources.push(spec.source);
  });
  return sources;
}

/**
 * Reduced motion keeps the STORY and drops the travel.
 *
 * The old reduced plan was the reveal plus a buzz: correct about movement,
 * wrong about information. A claim against three people that plays back as a
 * colour change has lost the fact that there were three people. So the
 * narrative skeleton survives — the runner does something, the world does
 * something, the rivals react, the ground changes hands, the rivals leave, the
 * runner wins — and each beat becomes a short fade, scale or reposition rather
 * than a dash across the map.
 */
export const REDUCED_BEATS = Object.freeze({
  attacker: 0,
  world: 100,
  react: 200,
  reveal: 300,
  impact: 340,
  exit: 460,
  victory: 620,
  duration: 900,
});

export function buildCapturePlan(captureStyle, reducedMotion = false) {
  const sequence = captureStyle.sequence || [];
  if (!reducedMotion) return { duration: captureStyle.duration, sequence };

  const B = REDUCED_BEATS;
  const first = (predicate) => sequence.find(predicate);
  const revealStep = first((step) => step.action === 'territoryReveal');
  const impactStep = first((step) => step.action === 'haptic');
  const attackerStep = first((step) => step.action === 'actor' && step.role === ROLE.ATTACKER);
  const worldStep = first((step) => step.action === 'environment');
  const reactStep = first((step) => (
    step.action === 'actor' && step.role === ROLE.DEFENDER
    && !(step.actions || [step.name]).every((name) => isExitAction(name))
  ));
  const exitStep = sequence.filter((step) => (
    step.action === 'actor' && step.role === ROLE.DEFENDER
    && (step.exit || (step.actions || [step.name]).every((name) => isExitAction(name)))
  )).pop();
  const victoryActor = [...sequence].reverse().find(
    (step) => step.action === 'actor' && step.role === ROLE.ATTACKER
  );
  const victoryStep = first((step) => step.action === 'victory');

  const plan = [
    attackerStep && { ...attackerStep, start: B.attacker },
    // One world beat, held still: a shadow that appears is information, a
    // shadow that sweeps the screen is the motion this setting suppresses.
    worldStep && { ...worldStep, start: B.world, duration: 180, still: true },
    reactStep && { ...reactStep, start: B.react, stagger: 0 },
    // The transition survives: a claim that freezes over and a claim that
    // shatters are different EVENTS, not different amounts of motion, and the
    // canvas plays every transition in a reduced form.
    revealStep && { ...revealStep, start: B.reveal },
    impactStep && { ...impactStep, start: B.impact, style: 'light' },
    exitStep && { ...exitStep, start: B.exit, stagger: 0 },
    victoryActor && victoryActor !== attackerStep && { ...victoryActor, start: B.victory },
    victoryStep && { ...victoryStep, start: B.victory },
  ].filter(Boolean);

  return { duration: B.duration, sequence: plan };
}

/**
 * Kept under its original name because the whole test suite and the animation
 * gallery call it. The rules it enforces live with the vocabulary; the
 * art-availability check stays here, because only the player knows what the
 * registry actually holds.
 */
export function validateCaptureStyle(captureStyle) {
  if (!captureStyle || !Array.isArray(captureStyle.sequence)) return ['missing capture style sequence'];
  const errors = validateChoreography(captureStyle);
  captureStyle.sequence.forEach((step, index) => {
    if (step.track !== 'effect') return;
    const id = effectIdForCaptureStep(step);
    if (!id && !step.optional) errors.push(`step ${index} has no playable effect`);
    if (id && !getEffect(id) && !step.optional) errors.push(`step ${index} references missing effect ${id}`);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// A sprite that travels
// ---------------------------------------------------------------------------

/**
 * Art crossing a gap.
 *
 * `grow` is what makes a falling object read as approaching rather than
 * sliding, and `bounce` is what stops a thrown charge from turning instantly
 * into an explosion: it lands, it hops once, and only then does the fuse burn.
 * Both are the difference between an object with weight and a cut between two
 * unrelated frames.
 *
 * The tween is on a plain wrapper rather than on the sprite itself: the sprite
 * is already animating its own frames, and driving position from the same
 * component would re-render it every frame.
 */
function TravellingEffect({ step, from, to, size, playToken, onDone }) {
  const progress = useSharedValue(0);
  const bounce = useSharedValue(0);

  useEffect(() => {
    const flight = Math.max(60, step.duration || 260);
    progress.value = 0;
    bounce.value = 0;
    progress.value = withTiming(1, {
      duration: flight,
      // A thrown thing accelerates; a beam does not.
      easing: step.arc ? Easing.in(Easing.quad) : Easing.inOut(Easing.quad),
    });
    if (step.bounce) {
      bounce.value = withDelay(
        flight,
        withTiming(1, { duration: step.bounce.duration || 300, easing: Easing.out(Easing.quad) })
      );
    }
  }, [bounce, playToken, progress, step.arc, step.bounce, step.duration]);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const b = bounce.value;
    // Straight line plus a parabolic lift. `arc` is the height of the hump in
    // pixels, negative for an overhand lob.
    const lift = step.arc ? step.arc * 4 * t * (1 - t) : 0;
    // The hop: a smaller, later parabola that also carries it a little onward.
    const hopHeight = step.bounce ? -(step.bounce.height || 24) * 4 * b * (1 - b) : 0;
    const hopDrift = step.bounce ? (step.bounce.drift || 16) * b : 0;
    const scale = 1 + ((step.grow || 1) - 1) * t;
    return {
      transform: [
        { translateX: from.x + (to.x - from.x) * t + hopDrift - size / 2 },
        { translateY: from.y + (to.y - from.y) * t + lift + hopHeight - size / 2 },
        { rotate: `${(step.spin || 0) * t}deg` },
        { scale },
      ],
      opacity: step.opacity == null ? 1 : step.opacity,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.travelling, { width: size, height: size }, style]}
    >
      <EffectPlayer
        effect={step.spec}
        size={size}
        speed={step.speed}
        loop
        playToken={playToken}
        reducedMotion={false}
        onComplete={onDone}
      />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------

function CaptureStylePlayer({
  style: styleId,
  playToken = 0,
  bounds,
  claimPoint,
  territoryRings,
  characterRect,
  // Where the cast is standing. The parent lays them out and passes the same
  // array here and into the anchor context, so `defender[1].feet` is the feet
  // of the rig that is actually drawn.
  defenderRects,
  defenderCount = 0,
  safeInsets,
  reducedMotion = false,
  // Deterministic per claim: the same claim gives the same people the same
  // reactions on every replay, and two different claims almost never match.
  seed = '',
  tint,
  ink,
  // Dev only, 1 everywhere else. Stretches the whole schedule so a 2.6s scene
  // can be watched at a quarter speed and each beat named as it happens — see
  // components/claim/DevSequenceControls.js. It multiplies DELAYS rather than
  // durations on purpose: the art and the rigs still animate at their authored
  // pace, so what you are inspecting is the ORDER and the overlap, which is
  // what this rework is about. A true pause is deliberately not offered; the
  // Reanimated bodies would keep moving under a frozen scheduler and the tool
  // would be lying about what it had stopped.
  timeScale = 1,
  onTerritoryReveal,
  onCharacterAction,
  onContact,
  onVictory,
  onSound,
  onScreenShake,
  onComplete,
  stageStyle,
  // The shared stage. Optional: without one the player still runs, it just has
  // no scene movement — which is what the animation gallery wants.
  stage,
  // The cast. Optional for the same reason, and absent by design in tests.
  cast,
}) {
  const captureStyle = resolveCaptureStyle(styleId);
  const plan = useMemo(() => buildCapturePlan(captureStyle, reducedMotion), [captureStyle, reducedMotion]);
  // The authored timeline resolved against the people who are actually here.
  const timeline = useMemo(
    () => expandCast(plan.sequence, { defenderCount, seed: `${seed}|${captureStyle.id}` }),
    [captureStyle.id, defenderCount, plan.sequence, seed]
  );

  const [active, setActive] = useState([]);
  const [world, setWorld] = useState([]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const callbacks = useRef({});
  callbacks.current = {
    onTerritoryReveal, onCharacterAction, onContact, onVictory, onSound, onScreenShake, onComplete,
  };

  const points = useMemo(() => flattenTerritoryRings(territoryRings), [territoryRings]);
  const anchorModel = useMemo(() => buildTerritoryAnchorModel({
    rings: territoryRings || [], bounds, insets: safeInsets, preferred: claimPoint,
  }), [bounds, claimPoint, safeInsets, territoryRings]);
  const anchorContext = useMemo(() => ({
    bounds,
    claimPoint,
    territoryCenter: claimPoint,
    territoryRings: territoryRings || [],
    territoryPoints: points,
    characterRect,
    defenderRects: defenderRects || [],
    safeInsets,
    anchorModel,
  }), [anchorModel, bounds, characterRect, claimPoint, defenderRects, points, safeInsets, territoryRings]);

  useEffect(() => () => {
    mounted.current = false;
    generation.current += 1;
  }, []);

  const remove = useCallback((key, run) => {
    if (!mounted.current || generation.current !== run) return;
    setActive((items) => items.filter((item) => item.key !== key));
  }, []);

  const removeWorld = useCallback((key, run) => {
    if (!mounted.current || generation.current !== run) return;
    setWorld((items) => items.filter((item) => item.key !== key));
  }, []);

  const anchorPoint = useCallback(
    (name, key) => resolveEffectAnchor(name, anchorContext, key),
    [anchorContext]
  );

  const runAction = useCallback((step, key) => {
    switch (step.action) {
      case 'territoryReveal':
        // The style says HOW and FROM WHERE; the controller owns the state
        // change and the canvas owns the drawing.
        callbacks.current.onTerritoryReveal?.({
          transition: step.transition,
          origin: step.origin,
          duration: step.duration,
        });
        break;
      case 'actor':
        // `from` and `toward` are anchor NAMES. Resolving them here, with the
        // same resolver the art uses, is what makes a shockwave push each
        // rival away from the crater that actually formed rather than away
        // from an assumed centre.
        cast?.current?.play({
          ...step,
          originPoint: step.from ? anchorPoint(step.from, `${key}:from`) : null,
          targetPoint: step.toward || step.lookAt
            ? anchorPoint(step.toward || step.lookAt, `${key}:to`)
            : null,
        });
        callbacks.current.onCharacterAction?.(step.name, step.role, step.index);
        break;
      case 'contact':
        // Direct character contact, and ONLY when a style asked for it.
        // Validation rejects this step outside a duel, which is what stops an
        // environmental style opening with a bump it never wanted.
        callbacks.current.onContact?.(step);
        break;
      case 'camera':
        stage?.runCamera(step);
        break;
      case 'screenShake':
        stage?.runShake(step);
        callbacks.current.onScreenShake?.(step.intensity || 1);
        break;
      case 'haptic':
        haptic[reducedMotion ? 'light' : step.style]?.();
        break;
      case 'victory':
        callbacks.current.onVictory?.(step);
        break;
      case 'sound':
        callbacks.current.onSound?.(step.name);
        break;
      case 'pause':
        // Deliberately nothing. A pause is a promise that the tracks above are
        // empty here, and it is load-bearing in the signature — the silence
        // before a detonation is what makes it a detonation.
        break;
      default:
        break;
    }
  }, [anchorPoint, cast, reducedMotion, stage]);

  useEffect(() => {
    const run = generation.current + 1;
    generation.current = run;
    const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
    const timers = new Set();
    setActive([]);
    setWorld([]);
    stage?.reset();
    cast?.current?.reset();

    timeline.forEach((step, index) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!mounted.current || generation.current !== run) return;
        const key = `${playToken}:${index}`;

        if (step.action === 'environment') {
          // Primitives, so there is nothing to fail to load and nothing to
          // license. They are removed on their own duration.
          const point = anchorPoint(step.anchor, key);
          setWorld((items) => [...items, { ...step, key, point, run }]);
          const clear = setTimeout(() => {
            timers.delete(clear);
            removeWorld(key, run);
          }, Math.max(120, step.duration || 600) + 60);
          timers.add(clear);
          return;
        }

        if (step.action && step.action !== 'projectile') {
          runAction(step, key);
          return;
        }

        const effectId = effectIdForCaptureStep(step);
        const spec = effectId ? getEffect(effectId) : null;
        // Every visual step is optional presentation. A blocked licence,
        // corrupt import or typo drops only that step and never the claim.
        if (!spec) return;

        if (step.action === 'projectile') {
          const from = anchorPoint(step.from, `${key}:from`);
          const to = anchorPoint(step.to, `${key}:to`);
          const size = step.size || 150;
          setActive((items) => [
            ...items,
            // Its own slot, so a projectile in flight never evicts the hero
            // sprite and is never evicted by one. Its life is bounded below by
            // the flight itself, which is the honest window for a thing that is
            // gone the moment it arrives.
            { ...step, effectId, spec, key, run, travelling: true, from, to, size, slot: `flight:${key}` },
          ]);
          // A projectile is gone the moment it has finished arriving — it must
          // not linger on the impact it caused. A bounce extends that life,
          // because the hop is part of the arrival.
          const life = Math.max(60, step.duration || 260)
            + (step.bounce ? (step.bounce.duration || 300) : 0) + 40;
          const arrive = setTimeout(() => {
            timers.delete(arrive);
            remove(key, run);
          }, life);
          timers.add(arrive);
          return;
        }

        const rawAnchor = anchorPoint(step.anchor, key);
        const visualExtent = (spec.visualScale || 1) + 2 * Math.max(
          Math.abs(spec.visualOffsetX || 0), Math.abs(spec.visualOffsetY || 0)
        );
        const fitted = fitEffectInBounds(rawAnchor, step.size || 200, bounds, safeInsets, visualExtent);
        const slot = step.slot || EFFECT_SLOT.HERO;
        // The window the style gave this art, and the rate that makes the sheet
        // fit inside it. Both are required — see spriteSpeedForWindow.
        const hold = Math.max(120, step.hold || 420);
        const speed = spriteSpeedForWindow(spec, hold);
        setActive((items) => [
          // Replacing by SLOT rather than dropping the oldest: a new hero
          // effect always takes over from the previous hero and never from the
          // debris the last one threw, so what is on screen is always "the one
          // thing happening" plus at most "the thing it caused".
          ...items.filter((item) => item.slot !== slot),
          { ...step, effectId, spec, key, anchor: fitted.anchor, size: fitted.size, slot, speed, run },
        ]);
        // Unconditional. This used to be `if (step.duration)`, and almost no
        // step set one, so a sprite lived for however long its sheet happened
        // to be — which for the pack's larger sheets is two to three seconds,
        // i.e. straight through the impact, the reveal and the exit that came
        // after it. A beat now ends when the style says it ends.
        const cleanup = setTimeout(() => {
          timers.delete(cleanup);
          remove(key, run);
        }, hold);
        timers.add(cleanup);
      }, Math.max(0, step.start) * scale);
      timers.add(id);
    });

    const done = setTimeout(() => {
      timers.delete(done);
      if (!mounted.current || generation.current !== run) return;
      setActive([]);
      setWorld([]);
      // Nothing may outlive a style: an unreleased zoom would hand the victory
      // beat a scaled stage, and a half-finished actor chain would hand it a
      // character mid-lunge.
      stage?.runCamera({ name: CAMERA_ACTION.RELEASE, duration: 260 });
      callbacks.current.onComplete?.();
    }, plan.duration * scale);
    timers.add(done);

    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      stage?.reset();
    };
  }, [anchorContext, plan.duration, playToken, remove, removeWorld, runAction, timeScale, timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  // THREE SIBLINGS, NOT ONE WRAPPER.
  //
  // This used to be a single absolutely-filled View carrying FOREGROUND_FX (40)
  // with all three layers inside it. A parent zIndex opens a stacking context,
  // so everything in that subtree painted at 40 whatever its own zIndex said —
  // including the ground environment, nominally 22 and documented as being
  // UNDER the cast. In practice a shadow cast onto the dirt somebody is
  // standing in was drawn over their face, and so were cracks, glow seams, the
  // scanline and the rise. Returning siblings puts each layer in the same
  // stacking context as CaptureCast (30), so the zIndex contract in layers.js
  // is compared for real.
  return (
    <>
      {/* Ground-level world: shadows cast onto the dirt, fissures, slabs. Under
          the cast, because people stand on top of them. */}
      <EnvironmentLayer
        items={world}
        bounds={bounds}
        tint={tint}
        ink={ink}
        playToken={playToken}
        containerStyle={stageStyle}
      />

      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, styles.stage, stageStyle]}
      >
        {active.map((item) => {
          if (item.travelling) {
            return (
              <TravellingEffect
                key={item.key}
                step={item}
                from={item.from}
                to={item.to}
                size={item.size}
                playToken={playToken}
                onDone={() => remove(item.key, item.run)}
              />
            );
          }
          if (item.reaction) {
            return (
              <ReactionEffect
                key={item.key}
                reaction={item.reaction}
                point={item.anchor}
                centered
                size={item.size}
                playToken={playToken}
                onComplete={() => remove(item.key, item.run)}
              />
            );
          }
          return (
            <View
              key={item.key}
              // Named so the bounded-lifetime rule is testable: "is this sprite
              // still on screen after its window closed" is the regression that
              // produced most of the visual noise, and it needs a handle.
              testID={`capture-sprite:${item.slot}`}
              style={{
                position: 'absolute',
                left: item.anchor.x - item.size / 2,
                top: item.anchor.y - item.size / 2,
                width: item.size,
                height: item.size,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <EffectPlayer
                effect={item.spec}
                size={item.size}
                // Derived from the step's window, not authored: see
                // spriteSpeedForWindow.
                speed={item.speed}
                // Never looped. A looping capture sprite is a sprite with no
                // end, which is the same bug as an unbounded hold wearing a
                // different hat.
                loop={false}
                opacity={item.opacity}
                playToken={playToken}
                reducedMotion={false}
                onComplete={() => remove(item.key, item.run)}
              />
            </View>
          );
        })}
      </View>

      {/* Air-level world: the flash, the dust, the wind. Over everything. */}
      <EnvironmentLayer
        items={world}
        bounds={bounds}
        tint={tint}
        ink={ink}
        playToken={playToken}
        containerStyle={stageStyle}
        air
      />
    </>
  );
}

const styles = StyleSheet.create({
  stage: { zIndex: CAPTURE_LAYER.FOREGROUND_FX },
  travelling: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
});

// Memoized: ResultScreen re-renders often during the claim sequence (phase
// transitions, replay-progress ticks) and most of those renders don't change
// this player's own props — a plain function component would re-run its whole
// cast/effects reconciliation on every one of them regardless.
export default React.memo(CaptureStylePlayer);
