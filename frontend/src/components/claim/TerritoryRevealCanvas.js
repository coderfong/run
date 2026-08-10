// The reveal itself: the claimed polygon wiping outward from the exact point
// the runner picked on their route.
//
// Built on react-native-svg (already native in this build) rather than Skia,
// so it needs no new dev build. Four things happen at once:
//
//   1. a circle mask grows from the claim point, uncovering the fill;
//   2. the outline traces itself via a dash offset;
//   3. a ripple ring races ahead of the fill;
//   4. the finished outline pulses once as it hands off to the map layer.
//
// ...and then a fifth, over the top of all of them: the whole thing plays
// BIG AND CENTRED and only afterwards settles onto its real position.
//
// The reveal used to draw at whatever size the polygon happened to project to.
// That is correct and unreadable: the claim is the payoff of the entire run,
// and it was landing as a modest outline somewhere off to one side of a map,
// at whatever scale the camera had chosen. The capture encounter next to it
// plays at full size in the middle of the screen, and the reveal now matches
// it — the shape blows up to fill the view, the reveal plays there, and the
// shape then flies down onto the ground it belongs to just before the real
// Mapbox layer takes over.
//
// The transform is on a plain RN view rather than on the SVG group: an RN
// transform is composited on the UI thread and needs no per-frame re-layout of
// the vector tree, and it means the SVG keeps its own untouched coordinate
// space so the mask, the trace and the projected claim point all still agree.
//
// Coordinates here are SCREEN pixels, already projected by geometry.js. The
// camera must be still — see the note there.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ringsPerimeter, ringsToPath, maxRadiusFromPoint } from './geometry';
import { timingFor } from './timing';

// How much of the view the shape is blown up to fill. Short of 1 on both axes
// because the outline, its glow and the ripple all live OUTSIDE the polygon's
// own bounding box, and a shape scaled to the exact edges loses them.
const HERO_FILL_X = 0.82;
const HERO_FILL_Y = 0.68;
// Never shrink a claim that already fills the view, and never magnify a tiny
// one so far that the map underneath stops being recognisable ground.
const HERO_MIN = 1;
const HERO_MAX = 3.2;

/**
 * Where the shape has to go to read as "big and centred", as an RN transform.
 *
 * RN scales about a view's own centre, so translating the centroid to the
 * middle of the view means undoing where the scale has already thrown it:
 * a point p lands at viewCentre + s*(p - viewCentre), so the correction is
 * -s*(centroid - viewCentre). At s = 1 that is zero, which is exactly the
 * identity transform the settled state needs.
 */
function heroTransform(rings, bounds) {
  if (!bounds?.width || !bounds?.height) return { scale: 1, dx: 0, dy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  rings.forEach((ring) =>
    ring.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    })
  );
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return { scale: 1, dx: 0, dy: 0 };

  const scale = Math.max(
    HERO_MIN,
    Math.min(HERO_MAX, (bounds.width * HERO_FILL_X) / w, (bounds.height * HERO_FILL_Y) / h)
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale,
    dx: -scale * (cx - bounds.width / 2),
    dy: -scale * (cy - bounds.height / 2),
  };
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

let clipSeq = 0;

export default function TerritoryRevealCanvas({
  rings,
  claimPoint,
  fillColor,
  strokeColor,
  bounds,
  reduced = false,
  playToken = 0,
}) {
  const d = useMemo(() => ringsToPath(rings), [rings]);
  const perimeter = useMemo(() => ringsPerimeter(rings), [rings]);
  const maxRadius = useMemo(() => maxRadiusFromPoint(rings, claimPoint), [rings, claimPoint]);
  const hero = useMemo(() => heroTransform(rings, bounds), [rings, bounds]);
  // Unique per mount: two <Svg> trees sharing a clip id would fight over it.
  const clipId = useRef(`claim-reveal-${(clipSeq += 1)}`).current;

  const fill = useSharedValue(0);
  const trace = useSharedValue(0);
  const ripple = useSharedValue(0);
  const pulse = useSharedValue(0);
  // 0 = blown up and centred, 1 = sitting on its real ground. Starts settled
  // so that a reveal with no bounds to work from, or one under Reduce Motion,
  // is exactly the reveal this component always was.
  const settle = useSharedValue(1);

  useEffect(() => {
    fill.value = 0;
    trace.value = 0;
    ripple.value = 0;
    pulse.value = 0;

    if (reduced) {
      // Reduced motion: no sweep, no ripple, no flight — the shape simply
      // arrives, in place.
      settle.value = 1;
      fill.value = withTiming(1, { duration: 180 });
      trace.value = withTiming(1, { duration: 180 });
      return;
    }

    fill.value = withTiming(1, { duration: 820, easing: Easing.out(Easing.cubic) });
    trace.value = withDelay(90, withTiming(1, { duration: 720, easing: Easing.inOut(Easing.quad) }));
    ripple.value = withDelay(40, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    pulse.value = withDelay(
      800,
      withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) })
      )
    );

    // The flight home. It has to be FINISHED before the controller switches
    // the permanent Mapbox layer on, or the real polygon appears at map scale
    // underneath an overlay still drawing it at hero scale — two copies of the
    // same ground, different sizes. The controller gives the reveal `T.reveal`
    // before that handoff, so the flight is timed to land inside it with room
    // to spare rather than sharing the handoff window.
    const T = timingFor(false);
    if (hero.scale > 1.01) {
      settle.value = 0;
      settle.value = withDelay(
        Math.round(T.reveal * 0.5),
        withTiming(1, { duration: Math.round(T.reveal * 0.34), easing: Easing.inOut(Easing.cubic) })
      );
    } else {
      // Already filling the view: there is nothing to fly back from, and
      // animating a scale of 1.004 would only add a wobble.
      settle.value = 1;
    }
  }, [playToken, reduced, fill, trace, ripple, pulse, settle, hero.scale]);

  // Hero → identity. Interpolated by hand rather than via `interpolate` so the
  // relationship between the scale and the translation stays visible: they are
  // not two independent tweens, the translation is only correct for the scale
  // it is paired with (see heroTransform).
  const heroStyle = useAnimatedStyle(() => {
    const s = hero.scale + (1 - hero.scale) * settle.value;
    return {
      transform: [
        { translateX: hero.dx * (1 - settle.value) },
        { translateY: hero.dy * (1 - settle.value) },
        { scale: s },
      ],
    };
  });

  // The growing mask. `r` can't go to 0 — react-native-svg treats a 0-radius
  // clip circle as "no clip" on some platforms, which would flash the whole
  // polygon on frame one.
  const maskProps = useAnimatedProps(() => ({
    r: Math.max(0.01, maxRadius * fill.value),
  }));

  // Belt and braces: if a platform declines to redraw an animated clip path,
  // the fill still fades in rather than popping.
  const fillGroupProps = useAnimatedProps(() => ({
    opacity: Math.min(1, fill.value * 3),
  }));

  const traceProps = useAnimatedProps(() => ({
    strokeDashoffset: perimeter * (1 - trace.value),
  }));

  const rippleProps = useAnimatedProps(() => ({
    r: Math.max(0.01, 10 + maxRadius * 0.72 * ripple.value),
    strokeOpacity: 0.7 * (1 - ripple.value),
  }));

  const pulseProps = useAnimatedProps(() => ({
    strokeWidth: 3 + pulse.value * 10,
    strokeOpacity: 0.9 * pulse.value,
  }));

  if (!d) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, heroStyle]} pointerEvents="none">
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <ClipPath id={clipId}>
          <AnimatedCircle cx={claimPoint.x} cy={claimPoint.y} animatedProps={maskProps} />
        </ClipPath>
      </Defs>

      {/* the ground itself, uncovered by the growing circle */}
      <AnimatedG clipPath={`url(#${clipId})`} animatedProps={fillGroupProps}>
        <Path d={d} fill={fillColor} fillOpacity={0.42} fillRule="evenodd" />
      </AnimatedG>

      {/* the border drawing itself on */}
      <AnimatedPath
        d={d}
        fill="none"
        stroke={strokeColor}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={perimeter}
        animatedProps={traceProps}
      />

      {/* one heartbeat as the real map layer takes over */}
      <AnimatedPath
        d={d}
        fill="none"
        stroke={strokeColor}
        strokeLinejoin="round"
        animatedProps={pulseProps}
      />

      {/* the shockwave, running ahead of the fill */}
      {!reduced && (
        <AnimatedCircle
          cx={claimPoint.x}
          cy={claimPoint.y}
          fill="none"
          stroke={strokeColor}
          strokeWidth={3}
          animatedProps={rippleProps}
        />
      )}
    </Svg>
    </Animated.View>
  );
}
