// Motion + haptics primitives. Every animated flourish in the app goes
// through here so Reduce Motion is respected in exactly one place.

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, TextInput } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '../theme';

// Re-export haptics from the theme module so both import paths work.
export { haptic } from '../theme/haptics';

// ---------------------------------------------------------------------------
// Reduce Motion
// ---------------------------------------------------------------------------

const ReduceMotionContext = createContext(false);

export function useReduceMotion() {
  return useContext(ReduceMotionContext);
}

// Standalone hook for use outside the provider (and inside it).
export function useSystemReduceMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(!!v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) =>
      setReduced(!!v)
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

export function MotionProvider({ children }) {
  const reduced = useSystemReduceMotion();
  return (
    <ReduceMotionContext.Provider value={reduced}>
      {children}
    </ReduceMotionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// PressableScale — the standard button press affordance (scale 0.97).
// ---------------------------------------------------------------------------

export function PressableScale({ children, style, onPress, disabled, scaleTo = 0.97, ...rest }) {
  const reduced = useReduceMotion();
  const scale = useSharedValue(1);

  // useAnimatedStyle keeps the shared-value read on the UI thread —
  // reading `scale` inline in the render would trip Reanimated strict mode.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPressIn={() => {
        if (!reduced) scale.value = withSpring(scaleTo, { damping: 20, stiffness: 300 });
      }}
      onPressOut={() => {
        if (!reduced) scale.value = withSpring(1, { damping: 20, stiffness: 300 });
      }}
      onPress={onPress}
      disabled={disabled}
      {...rest}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// CountUpText — Reanimated-driven number count-up (tabular styles expected).
// Renders instantly when Reduce Motion is on.
// props: value (number), format (worklet-safe fn number -> string), style
// ---------------------------------------------------------------------------

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function defaultFormat(n) {
  'worklet';
  const rounded = Math.round(n);
  const s = String(rounded);
  // Manual thousands separator — toLocaleString isn't worklet-safe.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0 && s[i] !== '-') out += ',';
  }
  return out;
}

export function CountUpText({ value, durationMs = 1100, format = defaultFormat, style, ...rest }) {
  const reduced = useReduceMotion();
  const progress = useSharedValue(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = value;
    } else {
      progress.value = withTiming(value, {
        duration: durationMs,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [value, reduced, durationMs, progress]);

  const animatedProps = useAnimatedProps(() => ({
    text: format(progress.value),
    defaultValue: format(progress.value),
  }));

  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      style={[{ padding: 0 }, style]}
      animatedProps={animatedProps}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton — pulsing placeholder block for loading lists/maps.
// ---------------------------------------------------------------------------

export function Skeleton({ width = '100%', height = 16, style, dark = false }) {
  const reduced = useReduceMotion();
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    if (reduced) {
      opacity.value = 0.45;
      return;
    }
    opacity.value = withRepeat(
      withTiming(0.9, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [reduced, opacity]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius.sm,
          backgroundColor: dark ? 'rgba(255,255,255,0.08)' : colors.bgElevated,
        },
        pulse,
        style,
      ]}
    />
  );
}
