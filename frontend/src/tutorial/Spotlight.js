// The hole in the screen.
//
// Two layers, and keeping them apart is the whole trick:
//
//   THE DRAWING (this file) paints the dim and the glow, and takes no touches
//   at all. It is free to lag a frame behind, to animate, to breathe.
//   THE BLOCKER (TutorialOverlay) is four plain views around the hole. It is
//   what actually stops a stray tap, and there is deliberately nothing over
//   the hole itself, which is how the real Start button under it takes a real
//   press with no fake copy of it drawn on top.
//
// The dim is ONE PATH with two subpaths and `fillRule="evenodd"` — the outer
// rectangle is the window, the inner one is the hole. Not a <Mask> and not a
// <ClipPath>: a ClipPath's children union rather than subtract (the note in
// components/claim/TerritoryRevealCanvas.js), and evenodd is plain path data
// that renders the same on both platforms and animates as a string.

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { scrimPath } from './layout';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// How long the hole takes to travel from one target to the next. Short enough
// to feel like the same light moving, long enough to be followed.
const TRAVEL_MS = 260;
// The breath. Deliberately small: the spotlight should look alive, not like a
// warning light. The strong variant is for a step the runner has to act on.
const PULSE_MS = 1500;
// How many breaths, once, each time the light lands on a target.
const PULSE_COUNT = 2;
const PULSE_SOFT = 3;
const PULSE_STRONG = 6;

export default function Spotlight({
  rect,
  screen,
  color,
  dim = 'rgba(0,0,0,0.72)',
  strong = false,
  reduced = false,
}) {
  // The hole, as four numbers the UI thread can interpolate. Held separately
  // from the `rect` prop so a change can be ANIMATED into rather than applied.
  const x = useSharedValue(rect?.x ?? screen.width / 2);
  const y = useSharedValue(rect?.y ?? screen.height / 2);
  const w = useSharedValue(rect?.width ?? 0);
  const h = useSharedValue(rect?.height ?? 0);
  const r = useSharedValue(rect?.radius ?? 0);
  // 0 while there is no hole at all, which is what lets a step with no target
  // dim the whole screen without a degenerate zero-sized rectangle in the path.
  const open = useSharedValue(rect ? 1 : 0);
  const breath = useSharedValue(0);

  // First hole SNAPS, every hole after it TRAVELS. Appearing by growing out of
  // the middle of the screen would read as a portal opening rather than as a
  // light being pointed at something.
  const hadRect = useSharedValue(rect ? 1 : 0);

  useEffect(() => {
    if (!rect) {
      open.value = reduced ? 0 : withTiming(0, { duration: 160 });
      hadRect.value = 0;
      return;
    }
    const first = hadRect.value === 0;
    hadRect.value = 1;
    const ease = { duration: TRAVEL_MS, easing: Easing.out(Easing.cubic) };
    if (first || reduced) {
      x.value = rect.x;
      y.value = rect.y;
      w.value = rect.width;
      h.value = rect.height;
      r.value = rect.radius;
      open.value = reduced ? 1 : withTiming(1, { duration: 200 });
    } else {
      x.value = withTiming(rect.x, ease);
      y.value = withTiming(rect.y, ease);
      w.value = withTiming(rect.width, ease);
      h.value = withTiming(rect.height, ease);
      r.value = withTiming(rect.radius, ease);
      open.value = withTiming(1, { duration: 120 });
    }
  }, [rect, reduced, x, y, w, h, r, open, hadRect]);

  useEffect(() => {
    if (reduced) {
      breath.value = 0;
      return undefined;
    }
    // A PULSE, NOT A HEARTBEAT. Two breaths when the light lands on something
    // and then it holds still: a ring that bounces for as long as a card is
    // being read is the continuous motion the tutorial is meant to avoid.
    breath.value = 0;
    breath.value = withRepeat(
      withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin) }),
      PULSE_COUNT * 2,
      true
    );
    return () => cancelAnimation(breath);
  }, [reduced, breath, rect?.x, rect?.y, rect?.width, rect?.height]);

  // The inflation the breath applies, in points. Shared by the dim and the
  // ring so the two can never drift apart by a pixel.
  const swell = useDerivedValue(
    () => breath.value * (strong ? PULSE_STRONG : PULSE_SOFT) * open.value,
    [strong]
  );

  const scrimProps = useAnimatedProps(() => {
    if (open.value <= 0.001 || w.value <= 0 || h.value <= 0) {
      return { d: scrimPath(null, screen) };
    }
    const s = swell.value;
    return {
      d: scrimPath(
        {
          x: x.value - s,
          y: y.value - s,
          width: w.value + s * 2,
          height: h.value + s * 2,
          radius: r.value + s,
        },
        screen
      ),
    };
  });

  const ringProps = useAnimatedProps(() => {
    const s = swell.value;
    return {
      x: x.value - s,
      y: y.value - s,
      width: Math.max(0, w.value + s * 2),
      height: Math.max(0, h.value + s * 2),
      rx: Math.max(0, r.value + s),
      ry: Math.max(0, r.value + s),
      opacity: open.value * (strong ? 0.55 + breath.value * 0.45 : 0.4 + breath.value * 0.25),
    };
  });

  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width={screen.width}
      height={screen.height}
    >
      <AnimatedPath animatedProps={scrimProps} fill={dim} fillRule="evenodd" />
      {/* The glow. A stroke rather than a blur: the app's whole visual system
          is hard edges and flat fills, and a soft halo here would be the one
          gaussian thing on the screen. */}
      <AnimatedRect
        animatedProps={ringProps}
        fill="none"
        stroke={color}
        strokeWidth={strong ? 3 : 2}
      />
    </Svg>
  );
}
