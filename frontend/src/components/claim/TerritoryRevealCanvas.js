// The reveal: the ground actually changing hands.
//
// This used to be one animation. `reveal(start, style)` took a name — radial,
// glitch — and the name was thrown away: every claim in the app's history was
// a circle mask growing from the claim point, an outline tracing itself, and a
// ripple running ahead. Fifteen capture styles, one turnover.
//
// It is now a family, parameterised by REVEAL_TRANSITIONS below. The knobs are
// deliberately about MOVEMENT rather than colour, because that is what tells
// two of these apart at arm's length:
//
//   wipe        how the uncovered region grows — out from a point, in from the
//               perimeter, across in a line, in quantised steps, or not at all
//   origin      where it grows FROM, so the turnover can start on the fist
//               that caused it rather than always in the middle
//   edge        what rides the front of the wipe (a hot rim, a frost rim, a
//               light line) — the single cheapest way to change its character
//   decoration  cracks, shards, petals, a glitch fringe
//   ripple      how many rings run ahead of it
//
// A freeze that shook would be a smash, and a shatter that crept would be a
// frost — so the easings and speeds are as load-bearing as the shapes.
//
// Built on react-native-svg (already native in this build) rather than Skia,
// so it needs no new dev build. And over the top of all of it: the whole thing
// plays BIG AND CENTRED and only afterwards settles onto its real position,
// because the claim is the payoff of the entire run and it was landing as a
// modest outline off to one side of a map.
//
// The hero transform is on a plain RN view rather than on the SVG group: an RN
// transform is composited on the UI thread and needs no per-frame re-layout of
// the vector tree, and it means the SVG keeps its own untouched coordinate
// space so the mask, the trace and the projected claim point all still agree.
//
// Coordinates here are SCREEN pixels, already projected by geometry.js. The
// camera must be still — see the note there.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
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
import { CAPTURE_LAYER } from '../../effects/layers';
import { REVEAL_TRANSITION } from '../../effects/choreography';

// How much of the view the shape is blown up to fill. Short of 1 on both axes
// because the outline, its glow and the ripple all live OUTSIDE the polygon's
// own bounding box, and a shape scaled to the exact edges loses them.
const HERO_FILL_X = 0.82;
const HERO_FILL_Y = 0.68;
// Never shrink a claim that already fills the view, and never magnify a tiny
// one so far that the map underneath stops being recognisable ground.
const HERO_MIN = 1;
const HERO_MAX = 3.2;

const BAND_COUNT = 14;
const CRACK_COUNT = 7;

// Transition-specific, not team-specific: a hot rim is hot whichever clan took
// the ground. Kept low-saturation enough to sit over a live map.
const EDGE_COLOR = {
  hot: '#FF8A3D',
  frost: '#9BE8FF',
  light: '#FFF3C4',
  void: '#C79BFF',
};

/**
 * The pack. Every field here is a MOVEMENT decision.
 *
 * `speed` multiplies the wipe's duration: under 1 is a snap, over 1 is a
 * creep. `settle` picks how the hero flight comes home — `implode` arrives
 * fast and hard because for that transition the flight IS the reveal.
 */
export const REVEAL_TRANSITIONS = Object.freeze({
  [REVEAL_TRANSITION.RADIAL]: {
    wipe: 'circle', speed: 1, easing: Easing.out(Easing.cubic),
    ripple: 1, edge: null, decoration: null, trace: 'with',
  },
  [REVEAL_TRANSITION.SHOCKWAVE]: {
    // The fastest wipe in the pack, with two rings ahead of it. Reads as the
    // ground being hit rather than filled.
    wipe: 'circle', speed: 0.55, easing: Easing.out(Easing.quad),
    ripple: 2, edge: 'hot', decoration: null, trace: 'with',
  },
  [REVEAL_TRANSITION.CRACK]: {
    // Fissures reach the boundary BEFORE the fill does, so the ground looks
    // broken open rather than washed over.
    wipe: 'circle', speed: 0.85, easing: Easing.out(Easing.cubic),
    ripple: 0, edge: null, decoration: 'cracks', trace: 'after',
  },
  [REVEAL_TRANSITION.FREEZE_SPREAD]: {
    // Slow, even, and completely still. No ripple: a freeze that pulsed would
    // be a blast.
    wipe: 'circle', speed: 1.7, easing: Easing.inOut(Easing.quad),
    ripple: 0, edge: 'frost', decoration: 'shards', trace: 'with',
  },
  [REVEAL_TRANSITION.BURN_SPREAD]: {
    // Accelerating, with a hot rim eating outward. The only wipe that eases
    // IN — fire takes hold slowly and then goes all at once.
    wipe: 'circle', speed: 1.1, easing: Easing.in(Easing.quad),
    ripple: 0, edge: 'hot', decoration: null, trace: 'with',
  },
  [REVEAL_TRANSITION.PERIMETER_BURN]: {
    // Inward from the border. The outline draws itself FIRST and the inside
    // floods afterwards, which is the opposite reading to everything else.
    wipe: 'shrink', speed: 1.3, easing: Easing.inOut(Easing.cubic),
    ripple: 0, edge: 'hot', decoration: null, trace: 'before',
  },
  [REVEAL_TRANSITION.DISSOLVE]: {
    // No front at all: the ground arrives in patches, in a scrambled order.
    wipe: 'bands', speed: 1.2, easing: Easing.linear,
    ripple: 0, edge: null, decoration: null, trace: 'after',
  },
  [REVEAL_TRANSITION.IMPLODE]: {
    // The fill is already there; the flight home is the whole event, and it
    // arrives hard.
    wipe: 'none', speed: 0.6, easing: Easing.in(Easing.cubic),
    ripple: 1, edge: 'void', decoration: null, trace: 'with', settle: 'implode',
  },
  [REVEAL_TRANSITION.BLOOM]: {
    // Overshoots and settles, with rings opening behind the front. Growth,
    // not impact.
    wipe: 'circle', speed: 1.4, easing: Easing.out(Easing.back(1.6)),
    ripple: 2, edge: null, decoration: 'petals', trace: 'with',
  },
  [REVEAL_TRANSITION.LIGHT_SWEEP]: {
    // A line crossing the shape, with the bright edge on the front. The only
    // wipe with a direction rather than a centre.
    wipe: 'linear', speed: 1, easing: Easing.inOut(Easing.cubic),
    ripple: 0, edge: 'light', decoration: null, trace: 'with',
  },
  [REVEAL_TRANSITION.CORRUPTION_SPREAD]: {
    // Quantised: the front jumps in blocks instead of growing, with a colour
    // fringe offset either side of the outline.
    wipe: 'stepped', speed: 1.1, easing: Easing.linear,
    ripple: 0, edge: null, decoration: 'glitch', trace: 'after', steps: 7,
  },
});

const transitionFor = (name) =>
  REVEAL_TRANSITIONS[name] || REVEAL_TRANSITIONS[REVEAL_TRANSITION.RADIAL];

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedG = Animated.createAnimatedComponent(G);

let clipSeq = 0;

function boundsOf(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  rings.forEach((ring) =>
    ring.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    })
  );
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

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
  const box = boundsOf(rings);
  if (!(box.width > 0) || !(box.height > 0)) return { scale: 1, dx: 0, dy: 0 };

  const scale = Math.max(
    HERO_MIN,
    Math.min(HERO_MAX, (bounds.width * HERO_FILL_X) / box.width, (bounds.height * HERO_FILL_Y) / box.height)
  );
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    scale,
    dx: -scale * (cx - bounds.width / 2),
    dy: -scale * (cy - bounds.height / 2),
  };
}

// Deterministic per reveal, so a replay of the same claim cracks the same way.
function seeded(seed) {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// One dissolve band
// ---------------------------------------------------------------------------

/**
 * A horizontal slice of the claim that fades in at its own moment.
 *
 * Its own component because each band needs its own animated props hook, and a
 * hook count that varies with the transition would break the rules of hooks.
 * Rendering a different SET of children per transition is fine; varying hooks
 * inside one component is not.
 */
function DissolveBand({ d, fillColor, clipId, y, height, at, progress }) {
  const props = useAnimatedProps(() => {
    // Each band opens over a quarter of the wipe, starting at its own offset.
    const local = Math.max(0, Math.min(1, (progress.value - at) / 0.28));
    return { opacity: local };
  });
  return (
    <AnimatedG animatedProps={props} clipPath={`url(#${clipId})`}>
      <Path d={d} fill={fillColor} fillOpacity={0.42} fillRule="evenodd" />
      <Rect x={-9999} y={y} width={19998} height={height} fill="none" />
    </AnimatedG>
  );
}

// ---------------------------------------------------------------------------

export default function TerritoryRevealCanvas({
  rings,
  claimPoint,
  fillColor,
  strokeColor,
  bounds,
  reduced = false,
  playToken = 0,
  // The choreography's cue. `transition` picks the family member, `origin` is
  // an already-resolved screen point (the caller resolves the anchor name with
  // the same resolver the effects use, so the wipe starts exactly where the
  // strike that caused it landed).
  transition = REVEAL_TRANSITION.RADIAL,
  origin = null,
  duration: revealDuration = null,
}) {
  const spec = transitionFor(transition);
  const d = useMemo(() => ringsToPath(rings), [rings]);
  const perimeter = useMemo(() => ringsPerimeter(rings), [rings]);
  const box = useMemo(() => boundsOf(rings || []), [rings]);
  const from = origin && Number.isFinite(origin.x) ? origin : claimPoint;
  const maxRadius = useMemo(() => maxRadiusFromPoint(rings, from), [rings, from]);
  const hero = useMemo(() => heroTransform(rings, bounds), [rings, bounds]);
  // Unique per mount: two <Svg> trees sharing a clip id would fight over it.
  const clipId = useRef(`claim-reveal-${(clipSeq += 1)}`).current;

  const fill = useSharedValue(0);
  const trace = useSharedValue(0);
  const ripple = useSharedValue(0);
  const ripple2 = useSharedValue(0);
  const pulse = useSharedValue(0);
  // 0 = blown up and centred, 1 = sitting on its real ground. Starts settled
  // so that a reveal with no bounds to work from, or one under Reduce Motion,
  // is exactly the reveal this component always was.
  const settle = useSharedValue(1);

  const bandLayout = useMemo(() => {
    if (spec.wipe !== 'bands' || !(box.height > 0)) return [];
    const random = seeded(playToken * 2654435761 + 7);
    const order = Array.from({ length: BAND_COUNT }, (_, i) => i);
    // Fisher-Yates, seeded: patches, not a top-to-bottom curtain.
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const height = box.height / BAND_COUNT;
    return order.map((slot, index) => ({
      key: slot,
      y: box.minY + slot * height,
      height: height + 0.5,
      at: (index / BAND_COUNT) * 0.72,
    }));
  }, [box.height, box.minY, playToken, spec.wipe]);

  const cracks = useMemo(() => {
    if (spec.decoration !== 'cracks' || !from) return [];
    const random = seeded(playToken * 40503 + 13);
    return Array.from({ length: CRACK_COUNT }, (_, i) => {
      const angle = (i / CRACK_COUNT) * Math.PI * 2 + random() * 0.5;
      const reach = maxRadius * (0.7 + random() * 0.45);
      // A fissure is not a ray: one kink, so it reads as a break.
      const midR = reach * 0.5;
      const kink = angle + (random() - 0.5) * 0.5;
      return [
        `M${from.x},${from.y}`,
        `L${from.x + Math.cos(kink) * midR},${from.y + Math.sin(kink) * midR}`,
        `L${from.x + Math.cos(angle) * reach},${from.y + Math.sin(angle) * reach}`,
      ].join(' ');
    });
  }, [from, maxRadius, playToken, spec.decoration]);

  useEffect(() => {
    fill.value = 0;
    trace.value = 0;
    ripple.value = 0;
    ripple2.value = 0;
    pulse.value = 0;

    if (reduced) {
      // Reduced motion: no sweep, no ripple, no flight — the shape arrives in
      // place. The transition still picks the easing, so a freeze still
      // arrives more gently than a shockwave; it just does not travel.
      settle.value = 1;
      fill.value = withTiming(1, { duration: spec.speed > 1.3 ? 260 : 180, easing: spec.easing });
      trace.value = withTiming(1, { duration: 180 });
      return;
    }

    const wipeMs = Math.round((revealDuration || 820) * spec.speed);

    fill.value = withTiming(1, { duration: wipeMs, easing: spec.easing });

    // Where the outline is drawn relative to the fill is part of the identity:
    // before it, the border is a fuse; after it, the ground was taken and then
    // marked.
    const traceMs = Math.round(wipeMs * 0.88);
    if (spec.trace === 'before') {
      trace.value = withTiming(1, { duration: traceMs, easing: Easing.inOut(Easing.quad) });
    } else if (spec.trace === 'after') {
      trace.value = withDelay(
        Math.round(wipeMs * 0.55),
        withTiming(1, { duration: traceMs * 0.7, easing: Easing.out(Easing.quad) })
      );
    } else {
      trace.value = withDelay(90, withTiming(1, { duration: traceMs, easing: Easing.inOut(Easing.quad) }));
    }

    if (spec.ripple > 0) {
      ripple.value = withDelay(40, withTiming(1, { duration: Math.round(wipeMs * 0.8), easing: Easing.out(Easing.cubic) }));
    }
    if (spec.ripple > 1) {
      ripple2.value = withDelay(
        Math.round(wipeMs * 0.28),
        withTiming(1, { duration: Math.round(wipeMs * 0.85), easing: Easing.out(Easing.cubic) })
      );
    }

    pulse.value = withDelay(
      Math.max(320, wipeMs - 20),
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
      const implode = spec.settle === 'implode';
      settle.value = withDelay(
        Math.round(T.reveal * (implode ? 0.22 : 0.5)),
        withTiming(1, {
          duration: Math.round(T.reveal * (implode ? 0.26 : 0.34)),
          easing: implode ? Easing.in(Easing.cubic) : Easing.inOut(Easing.cubic),
        })
      );
    } else {
      // Already filling the view: there is nothing to fly back from, and
      // animating a scale of 1.004 would only add a wobble.
      settle.value = 1;
    }
  }, [playToken, reduced, transition, revealDuration]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- the wipe ------------------------------------------------------------
  //
  // `r` can't go to 0 — react-native-svg treats a 0-radius clip circle as "no
  // clip" on some platforms, which would flash the whole polygon on frame one.

  const circleClipProps = useAnimatedProps(() => {
    const f = fill.value;
    const stepped = spec.wipe === 'stepped';
    // Quantised growth: the front jumps rather than travels.
    const q = stepped ? Math.ceil(f * spec.steps) / spec.steps : f;
    return { r: Math.max(0.01, maxRadius * q * (spec.wipe === 'shrink' ? 1 : 1)) };
  });

  // Inward from the perimeter: an outer box with a hole in it, the hole
  // closing. One path with two subpaths and evenodd, because a ClipPath's
  // children UNION rather than subtract.
  const shrinkClipProps = useAnimatedProps(() => {
    const r = Math.max(0.01, maxRadius * (1 - fill.value));
    const { x, y } = { x: from?.x || 0, y: from?.y || 0 };
    return {
      d: `M-9999,-9999 H9999 V9999 H-9999 Z `
        + `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 Z`,
    };
  });

  const linearClipProps = useAnimatedProps(() => {
    // Sweeps from the origin's side of the shape to the far side.
    const span = box.width + 40;
    return { x: box.minX - 20, y: box.minY - 20, width: Math.max(0.01, span * fill.value), height: box.height + 40 };
  });

  // Belt and braces: if a platform declines to redraw an animated clip path,
  // the fill still fades in rather than popping.
  const fillGroupProps = useAnimatedProps(() => ({
    opacity: spec.wipe === 'none' ? Math.min(1, fill.value * 4) : Math.min(1, fill.value * 3),
  }));

  const traceProps = useAnimatedProps(() => ({
    strokeDashoffset: perimeter * (1 - trace.value),
  }));

  const rippleProps = useAnimatedProps(() => ({
    r: Math.max(0.01, 10 + maxRadius * 0.72 * ripple.value),
    strokeOpacity: 0.7 * (1 - ripple.value),
  }));

  const ripple2Props = useAnimatedProps(() => ({
    r: Math.max(0.01, 10 + maxRadius * 0.9 * ripple2.value),
    strokeOpacity: 0.45 * (1 - ripple2.value),
  }));

  // The front of the wipe, wearing whatever the transition asked for.
  const edgeProps = useAnimatedProps(() => {
    const f = spec.wipe === 'shrink' ? 1 - fill.value : fill.value;
    return {
      r: Math.max(0.01, maxRadius * f),
      strokeOpacity: 0.85 * Math.sin(Math.PI * Math.min(1, Math.max(0, fill.value))),
    };
  });

  const linearEdgeProps = useAnimatedProps(() => {
    const span = box.width + 40;
    const x = box.minX - 20 + span * fill.value;
    return { x1: x, x2: x, strokeOpacity: 0.9 * (1 - Math.abs(fill.value * 2 - 1)) };
  });

  const crackProps = useAnimatedProps(() => ({
    // Fissures run ahead of the fill and stay.
    strokeDashoffset: maxRadius * 1.6 * (1 - Math.min(1, fill.value * 1.35)),
    strokeOpacity: Math.min(1, fill.value * 3),
  }));

  const glitchProps = useAnimatedProps(() => {
    const f = fill.value;
    // Two frames of jitter per step, so the fringe snaps with the wipe.
    const jitter = (Math.ceil(f * (spec.steps || 7)) % 2 === 0 ? 1 : -1) * 3;
    return { transform: [{ translateX: jitter }], strokeOpacity: 0.55 * (1 - f) };
  });

  const pulseProps = useAnimatedProps(() => ({
    strokeWidth: 3 + pulse.value * 10,
    strokeOpacity: 0.9 * pulse.value,
  }));

  if (!d) return null;

  const edgeColor = spec.edge ? EDGE_COLOR[spec.edge] : null;
  const clipUrl = `url(#${clipId})`;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { zIndex: CAPTURE_LAYER.TERRITORY_REVEAL }, heroStyle]}
      pointerEvents="none"
    >
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <ClipPath id={clipId}>
            {spec.wipe === 'shrink' ? (
              <AnimatedPath animatedProps={shrinkClipProps} clipRule="evenodd" />
            ) : spec.wipe === 'linear' ? (
              <AnimatedRect animatedProps={linearClipProps} />
            ) : spec.wipe === 'none' || spec.wipe === 'bands' ? (
              <Rect x={-9999} y={-9999} width={19998} height={19998} />
            ) : (
              <AnimatedCircle cx={from?.x || 0} cy={from?.y || 0} animatedProps={circleClipProps} />
            )}
          </ClipPath>
        </Defs>

        {/* the ground itself */}
        {spec.wipe === 'bands' ? (
          bandLayout.map((band) => (
            <DissolveBand
              key={band.key}
              d={d}
              fillColor={fillColor}
              clipId={clipId}
              y={band.y}
              height={band.height}
              at={band.at}
              progress={fill}
            />
          ))
        ) : (
          <AnimatedG clipPath={clipUrl} animatedProps={fillGroupProps}>
            <Path d={d} fill={fillColor} fillOpacity={0.42} fillRule="evenodd" />
          </AnimatedG>
        )}

        {/* fissures reaching for the boundary */}
        {spec.decoration === 'cracks' && !reduced && cracks.map((path, i) => (
          <AnimatedPath
            key={`crack-${i}`}
            d={path}
            fill="none"
            stroke={strokeColor}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={maxRadius * 1.6}
            animatedProps={crackProps}
          />
        ))}

        {/* the front of the wipe */}
        {edgeColor && spec.wipe !== 'linear' && !reduced && (
          <AnimatedCircle
            cx={from?.x || 0}
            cy={from?.y || 0}
            fill="none"
            stroke={edgeColor}
            strokeWidth={spec.edge === 'frost' ? 2.5 : 5}
            strokeDasharray={spec.decoration === 'shards' ? '10 7' : undefined}
            animatedProps={edgeProps}
          />
        )}
        {edgeColor && spec.wipe === 'linear' && !reduced && (
          <AnimatedPath
            d={`M0,${box.minY - 20} L0,${box.maxY + 20}`}
            stroke={edgeColor}
            strokeWidth={4}
            animatedProps={linearEdgeProps}
          />
        )}

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

        {/* the corruption fringe, offset off the real outline */}
        {spec.decoration === 'glitch' && !reduced && (
          <AnimatedG animatedProps={glitchProps}>
            <Path d={d} fill="none" stroke={EDGE_COLOR.void} strokeWidth={2} />
          </AnimatedG>
        )}

        {/* one heartbeat as the real map layer takes over */}
        <AnimatedPath
          d={d}
          fill="none"
          stroke={strokeColor}
          strokeLinejoin="round"
          animatedProps={pulseProps}
        />

        {/* rings running ahead of the fill */}
        {spec.ripple > 0 && !reduced && (
          <AnimatedCircle
            cx={from?.x || 0}
            cy={from?.y || 0}
            fill="none"
            stroke={strokeColor}
            strokeWidth={3}
            animatedProps={rippleProps}
          />
        )}
        {spec.ripple > 1 && !reduced && (
          <AnimatedCircle
            cx={from?.x || 0}
            cy={from?.y || 0}
            fill="none"
            stroke={spec.decoration === 'petals' ? strokeColor : (edgeColor || strokeColor)}
            strokeWidth={2}
            animatedProps={ripple2Props}
          />
        )}
      </Svg>
    </Animated.View>
  );
}
