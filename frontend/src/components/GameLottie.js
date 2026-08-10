// GameLottie — one reduced-motion-aware entry point for gameplay Lotties.
// Changing `trigger` remounts a one-shot and reliably replays it on native and
// web. Screens name an event; asset paths remain centralised in config.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';

import { lottieSpec } from '../config/lottieAnimations';
import { useReduceMotion } from '../ui/motion';

export default function GameLottie({
  name,
  size = 96,
  trigger = 0,
  loop,
  speed = 1,
  visible = true,
  style,
  onFinish,
}) {
  const reduced = useReduceMotion();
  const spec = lottieSpec(name);

  if (!visible || reduced || !spec) return null;

  return (
    <LottieView
      key={`${name}:${trigger}`}
      source={spec.source}
      autoPlay
      loop={loop ?? !!spec.loop}
      speed={speed}
      resizeMode="contain"
      onAnimationFinish={(cancelled) => {
        if (!cancelled) onFinish?.();
      }}
      style={[{ width: size, height: size }, style]}
    />
  );
}

export function LottieOverlay({ children, style }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.overlay, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center' },
});
