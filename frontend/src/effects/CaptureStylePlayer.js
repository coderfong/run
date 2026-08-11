import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
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

export function buildCapturePlan(captureStyle, reducedMotion = false) {
  if (!reducedMotion) return { duration: captureStyle.duration, sequence: captureStyle.sequence };
  const reveal = captureStyle.sequence.find((step) => step.action === 'territoryReveal');
  const impact = captureStyle.sequence.find((step) => step.action === 'haptic');
  return {
    duration: REDUCED_CAPTURE_DURATION,
    sequence: [
      ...(reveal ? [{ ...reveal, start: 0 }] : []),
      ...(impact ? [{ ...impact, start: 40, style: 'light' }] : []),
    ],
  };
}

export function validateCaptureStyle(captureStyle) {
  const errors = [];
  if (!captureStyle || !Array.isArray(captureStyle.sequence)) return ['missing capture style sequence'];
  if (!(captureStyle.duration > 0)) errors.push('duration must be positive');
  if (captureStyle.sequence.filter((step) => step.action === 'territoryReveal').length !== 1) {
    errors.push('capture style must contain exactly one territory reveal cue');
  }
  if (captureStyle.sequence.filter((step) => step.action === 'haptic').length !== 1) {
    errors.push('capture style must contain exactly one primary haptic');
  }
  captureStyle.sequence.forEach((step, index) => {
    if (!Number.isFinite(step.start) || step.start < 0) errors.push(`step ${index} has an invalid start`);
    if (!step.action && !effectIdForCaptureStep(step) && !step.optional) errors.push(`step ${index} has no playable effect`);
    const id = effectIdForCaptureStep(step);
    if (id && !getEffect(id) && !step.optional) errors.push(`step ${index} references missing effect ${id}`);
  });
  return errors;
}

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
}) {
  const captureStyle = resolveCaptureStyle(styleId);
  const plan = useMemo(() => buildCapturePlan(captureStyle, reducedMotion), [captureStyle, reducedMotion]);
  const [active, setActive] = useState([]);
  const shakeX = useSharedValue(0);
  const mounted = useRef(true);
  const generation = useRef(0);
  const callbacks = useRef({});
  callbacks.current = { onTerritoryReveal, onCharacterAction, onSound, onScreenShake, onComplete };

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

  const runAction = useCallback((step) => {
    if (step.action === 'territoryReveal') callbacks.current.onTerritoryReveal?.(step.style || 'radial');
    if (step.action === 'character') callbacks.current.onCharacterAction?.(step.name);
    if (step.action === 'sound') callbacks.current.onSound?.(step.name);
    if (step.action === 'haptic') haptic[reducedMotion ? 'light' : step.style]?.();
    if (step.action === 'screenShake' && !reducedMotion) {
      const amount = 7 * (step.intensity || 1);
      shakeX.value = withSequence(
        withTiming(-amount, { duration: 42, easing: Easing.linear }),
        withTiming(amount, { duration: 55, easing: Easing.linear }),
        withTiming(-amount * 0.45, { duration: 50, easing: Easing.linear }),
        withTiming(0, { duration: 65, easing: Easing.out(Easing.quad) })
      );
      callbacks.current.onScreenShake?.(step.intensity || 1);
    }
  }, [reducedMotion]); // Reanimated shared values are stable; the Jest mock is not.

  useEffect(() => {
    const run = generation.current + 1;
    generation.current = run;
    const timers = new Set();
    setActive([]);

    plan.sequence.forEach((step, index) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (!mounted.current || generation.current !== run) return;
        if (step.action) {
          runAction(step);
          return;
        }
        const effectId = effectIdForCaptureStep(step);
        const spec = effectId ? getEffect(effectId) : null;
        // Every visual step is optional presentation. A blocked license,
        // corrupt import or typo drops only that step and never the claim.
        if (!spec) return;
        const key = `${playToken}:${index}`;
        const rawAnchor = resolveEffectAnchor(step.anchor, anchorContext, key);
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
      callbacks.current.onComplete?.();
    }, plan.duration);
    timers.add(done);

    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      cancelAnimation(shakeX);
      shakeX.value = 0;
    };
  }, [anchorContext, plan, playToken, remove, runAction]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.stage, shakeStyle, stageStyle]}
    >
      {active.map((item) => {
        const wrapper = {
          position: 'absolute',
          left: item.anchor.x - item.size / 2,
          top: item.anchor.y - item.size / 2,
          width: item.size,
          height: item.size,
          alignItems: 'center',
          justifyContent: 'center',
        };
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
          <View key={item.key} style={wrapper}>
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({ stage: { zIndex: CAPTURE_LAYER.FOREGROUND_FX } });
