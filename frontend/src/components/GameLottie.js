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

  // NEVER INTERACTIVE. Almost every caller drops one of these over a control —
  // the kudos burst sits on top of the heart, the rank-up burst on top of a
  // leaderboard row — at a size several times the control's own. A bare
  // LottieView is a normal view that hit-tests, so once one had played it went
  // on swallowing every tap aimed at what it was celebrating: liking a run on
  // the feed made the heart (and its neighbour, the comment button) dead for
  // the rest of that card's life. The wrapper carries the positioning so
  // `pointerEvents` covers the animation whatever the caller's style does with
  // it, and the Lottie fills the wrapper.
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
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
        style={StyleSheet.absoluteFill}
      />
    </View>
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
