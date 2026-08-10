import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { animationSpec } from '../config/gameAnimations';
import { useReduceMotion } from '../ui/motion';

/**
 * A transparent game animation. Changing `trigger` remounts the image and
 * replays it; `loop` restarts it only after its authored duration.
 *
 * THREE WAYS THIS CAN RENDER, and the difference matters:
 *   playing  the default
 *   still    frame one, held — pass `still` when the artwork is CONTENT rather
 *            than an effect, so it must be on screen whether or not it moves
 *   nothing  a decorative effect under Reduce Motion
 *
 * `still` is the caller's call, not this component's, because only the caller
 * knows whether its animation is an effect or an object. A reward tile passes
 * `still` under Reduce Motion (the chest still has to be a chest); a confetti
 * burst passes nothing and correctly disappears.
 */
export default function GameAnimation({
  name,
  size = 96,
  trigger = 0,
  loop = false,
  still = false,
  visible = true,
  style,
  accessibilityLabel,
}) {
  const reduced = useReduceMotion();
  const spec = animationSpec(name);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    // A self-looping asset cycles in the decoder; remounting it on a timer
    // would restart it mid-cycle and visibly stutter.
    if (!loop || !visible || reduced || still || !spec || spec.selfLooping) return undefined;
    const id = setTimeout(() => setCycle((value) => value + 1), spec.duration + 40);
    return () => clearTimeout(id);
  }, [cycle, loop, reduced, still, spec, visible]);

  if (!visible || !spec) return null;
  // A self-looping asset is SCENERY — a shop's OPEN sign that vanished when you
  // turned motion down would be a missing object, not a calmer screen — so it
  // falls back to a still rather than to nothing.
  const hold = still || (reduced && spec.selfLooping);
  if (reduced && !hold) return null;

  return (
    <Image
      key={`${name}:${trigger}:${cycle}`}
      source={spec.source}
      style={[{ width: size, aspectRatio: spec.aspect }, style]}
      contentFit="contain"
      autoplay={!hold}
      cachePolicy="memory-disk"
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/** Layers several effects in one predictable square without taking touches. */
export function AnimationStack({ names, size = 160, trigger = 0, loop = false, visible = true, style }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.stack, { width: size, height: size }, style]}
    >
      {(names || []).map((name, index) => (
        <View key={`${name}:${index}`} style={styles.layer}>
          <GameAnimation
            name={name}
            size={size}
            trigger={trigger}
            loop={loop}
            visible={visible}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: 'center', justifyContent: 'center' },
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
