// Plays a choreography.
//
// The old player understood two things: put a sprite here, rattle the stage.
// Everything a style could say was therefore a variation on "some art appeared
// somewhere", which is why fifteen styles were one animation. It now runs five
// tracks (see choreography.js):
//
//   actor      forwarded to ClaimActor, which owns the transform chains
//   camera     forwarded to the shared stage, which carries the reveal too
//   effect     a sprite in a place, or a sprite that TRAVELS between two
//   territory  the reveal cue, now carrying HOW and FROM WHERE
//   feel       haptics, and pauses that exist only to be silent
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
import { CAMERA_ACTION, validateChoreography } from './choreography';
import ClaimActor from './ClaimActor';
import EffectPlayer from './EffectPlayer';
import { getEffect } from './effectRegistry';
import { CAPTURE_LAYER } from './layers';
import ReactionEffect from './ReactionEffect';
import { getReactionEffect } from './reactionRegistry';

export const MAX_CAPTURE_EFFECTS = 3;
export const REDUCED_CAPTURE_DURATION = 220;

export function effectIdForCaptureStep(step) {
  if (step.effect) return step.effect;
  if (step.reaction) return getReactionEffect(step.reaction);
  return null;
}

/**
 * Reduced motion keeps the INFORMATION and drops the movement.
 *
 * The ground still changes hands and the impact is still felt; there is no
 * travel, no shake, no camera and no sprite. Unchanged in intent from the
 * original — but it now also has to strip actor and camera steps, which are
 * exactly the large-field movement the setting exists to suppress.
 */
export function buildCapturePlan(captureStyle, reducedMotion = false) {
  if (!reducedMotion) return { duration: captureStyle.duration, sequence: captureStyle.sequence };
  const reveal = captureStyle.sequence.find((step) => step.action === 'territoryReveal');
  const impact = captureStyle.sequence.find((step) => step.action === 'haptic');
  return {
    duration: REDUCED_CAPTURE_DURATION,
    sequence: [
      // The transition survives even here: a claim that freezes over and a
      // claim that shatters are different EVENTS, not different amounts of
      // motion, and the canvas plays every transition in a reduced form.
      ...(reveal ? [{ ...reveal, start: 0 }] : []),
      ...(impact ? [{ ...impact, start: 40, style: 'light' }] : []),
    ],
  };
}

/**
 * Kept under its original name because the whole test suite and the animation
 * gallery call it. The rules it enforces now live with the vocabulary; the
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
 * The single biggest thing the old vocabulary could not say.
 *
 * A bolt at the top of the screen and an impact in the middle were two
 * unrelated flashes; nothing ever crossed the gap, so a strike from the sky
 * had no strike in it. This tweens an effect between two resolved points, with
 * an optional arc (a lobbed charge falls, it does not slide) and spin.
 *
 * The tween is on a plain RN Animated.View wrapping the player rather than on
 * the sprite itself: the sprite is already animating its own frames, and
 * driving position from the same component would re-render it every frame.
 */
function TravellingEffect({ step, from, to, size, playToken, onDone }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: Math.max(60, step.duration || 260),
      // A thrown thing accelerates; a beam does not.
      easing: step.arc ? Easing.in(Easing.quad) : Easing.inOut(Easing.quad),
    });
  }, [playToken, progress, step.arc, step.duration]);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    // Straight line plus a parabolic lift. `arc` is the height of the hump in
    // pixels, negative for an overhand lob.
    const lift = step.arc ? step.arc * 4 * t * (1 - t) : 0;
    return {
      transform: [
        { translateX: from.x + (to.x - from.x) * t - size / 2 },
        { translateY: from.y + (to.y - from.y) * t + lift - size / 2 },
        { rotate: `${(step.spin || 0) * t}deg` },
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

export default function CaptureStylePlayer({
  style: styleId,
  playToken = 0,
  bounds,
  claimPoint,
  territoryRings,
  characterRect,
  safeInsets,
  reducedMotion = false,
  onTerritoryReveal,
  onCharacterAction,
  onSound,
  onScreenShake,
  onComplete,
  stageStyle,
  // The shared stage. Optional: without one the player still runs, it just has
  // no scene movement — which is what the animation gallery wants.
  stage,
  // The actor. Optional for the same reason, and absent by design in tests.
  actor,
  actorEquipped,
}) {
  const captureStyle = resolveCaptureStyle(styleId);
  const plan = useMemo(() => buildCapturePlan(captureStyle, reducedMotion), [captureStyle, reducedMotion]);
  const [active, setActive] = useState([]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const callbacks = useRef({});
  callbacks.current = { onTerritoryReveal, onCharacterAction, onSound, onScreenShake, onComplete };

  const ownActor = useRef(null);
  const actorRef = actor || ownActor;

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
    safeInsets,
    anchorModel,
  }), [anchorModel, bounds, characterRect, claimPoint, points, safeInsets, territoryRings]);

  useEffect(() => () => {
    mounted.current = false;
    generation.current += 1;
  }, []);

  const remove = useCallback((key, run) => {
    if (!mounted.current || generation.current !== run) return;
    setActive((items) => items.filter((item) => item.key !== key));
  }, []);

  const anchorPoint = useCallback(
    (name, key) => resolveEffectAnchor(name, anchorContext, key),
    [anchorContext]
  );

  const runAction = useCallback((step) => {
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
        actorRef.current?.play({
          ...step,
          targetPoint: step.toward || step.lookAt
            ? anchorPoint(step.toward || step.lookAt, `actor:${step.start}`)
            : null,
        });
        callbacks.current.onCharacterAction?.(step.name);
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
  }, [actorRef, anchorPoint, reducedMotion, stage]);

  useEffect(() => {
    const run = generation.current + 1;
    generation.current = run;
    const timers = new Set();
    setActive([]);
    stage?.reset();
    actorRef.current?.reset();

    plan.sequence.forEach((step, index) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!mounted.current || generation.current !== run) return;

        if (step.action && step.action !== 'projectile') {
          runAction(step);
          return;
        }

        const effectId = effectIdForCaptureStep(step);
        const spec = effectId ? getEffect(effectId) : null;
        // Every visual step is optional presentation. A blocked licence,
        // corrupt import or typo drops only that step and never the claim.
        if (!spec) return;
        const key = `${playToken}:${index}`;

        if (step.action === 'projectile') {
          const from = anchorPoint(step.from, `${key}:from`);
          const to = anchorPoint(step.to, `${key}:to`);
          const size = step.size || 150;
          setActive((items) => [
            ...items.slice(-(MAX_CAPTURE_EFFECTS - 1)),
            { ...step, effectId, spec, key, run, travelling: true, from, to, size },
          ]);
          // A projectile is gone the moment it arrives — it must not linger on
          // the impact it caused.
          const arrive = setTimeout(() => {
            timers.delete(arrive);
            remove(key, run);
          }, Math.max(60, step.duration || 260) + 40);
          timers.add(arrive);
          return;
        }

        const rawAnchor = anchorPoint(step.anchor, key);
        const visualExtent = (spec.visualScale || 1) + 2 * Math.max(
          Math.abs(spec.visualOffsetX || 0), Math.abs(spec.visualOffsetY || 0)
        );
        const fitted = fitEffectInBounds(rawAnchor, step.size || 200, bounds, safeInsets, visualExtent);
        setActive((items) => [
          ...items.slice(-(MAX_CAPTURE_EFFECTS - 1)),
          { ...step, effectId, spec, key, anchor: fitted.anchor, size: fitted.size, run },
        ]);
        if (step.duration) {
          const cleanup = setTimeout(() => {
            timers.delete(cleanup);
            remove(key, run);
          }, step.duration);
          timers.add(cleanup);
        }
      }, Math.max(0, step.start));
      timers.add(id);
    });

    const done = setTimeout(() => {
      timers.delete(done);
      if (!mounted.current || generation.current !== run) return;
      setActive([]);
      // Nothing may outlive a style: an unreleased zoom would hand the victory
      // beat a scaled stage, and a half-finished actor chain would hand it a
      // character mid-lunge.
      stage?.runCamera({ name: CAMERA_ACTION.RELEASE, duration: 260 });
      callbacks.current.onComplete?.();
    }, plan.duration);
    timers.add(done);

    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      stage?.reset();
    };
  }, [anchorContext, plan, playToken, remove, runAction]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.stage, stageStyle]}
    >
      {/* The actor sits UNDER the foreground art: the effect a character
          causes should read as being in front of them, not behind. Only
          rendered when the player owns the actor; ResultScreen passes its own
          ref in and places the rig itself so the reveal can sit between. */}
      {!actor && actorEquipped ? (
        <ClaimActor
          ref={ownActor}
          equipped={actorEquipped}
          anchor={claimPoint}
          bounds={bounds}
          reducedMotion={reducedMotion}
        />
      ) : null}

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
              speed={item.speed}
              loop={item.loop}
              opacity={item.opacity}
              playToken={playToken}
              reducedMotion={false}
              onComplete={() => remove(item.key, item.run)}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { zIndex: CAPTURE_LAYER.FOREGROUND_FX },
  travelling: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
});
