// What the WORLD does, drawn from primitives.
//
// This layer exists because the honest answer to "why does every capture look
// the same" was never "not enough sprites". What tells a viewer that a meteor
// is coming is not a fireball: it is a shadow spreading on the ground under
// people who are looking up at it. What tells them a dragon passed is a shape
// crossing the dirt. What makes an explosion have an aftermath is dust that
// arrives and then CLEARS.
//
// None of that is art. All of it is a shape, a colour and a curve — so it is
// drawn here with react-native-svg and Reanimated, costs nothing to ship,
// cannot fail to load, has no licence attached, and is tinted from the live
// palette so it works in both themes.
//
// Every primitive follows the same contract: it is handed a resolved screen
// point, a size, a duration and a play token, it runs once, and it is removed
// by the player when its duration is up. Nothing here holds state between
// plays and nothing here can outlive a style.

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ENVIRONMENT } from './choreography';
import { CAPTURE_LAYER } from './layers';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedG = Animated.createAnimatedComponent(G);

// Which primitives sit under the cast and which pass in front of it.
const AIR_KINDS = new Set([
  ENVIRONMENT.FLASH,
  ENVIRONMENT.DARKEN,
  ENVIRONMENT.DUST,
  ENVIRONMENT.WIND,
  ENVIRONMENT.SHADOW_SWEEP,
]);

export const isAirEnvironment = (kind) => AIR_KINDS.has(kind);

/**
 * Linear 0..1 over the step's own duration.
 *
 * Deliberately unshaped: every primitive below shapes it itself, because the
 * curve IS the character. A shadow that grows linearly is a lift; a shadow
 * that grows on an ease-in is something falling.
 */
function useProgress(duration, playToken, still = false) {
  const progress = useSharedValue(0);
  useEffect(() => {
    // `still` is the reduced-motion form: the primitive is INFORMATION, so it
    // arrives fully formed and does not travel. A shadow that appears tells
    // you something is above you; a shadow that spreads across the screen is
    // the large-field movement the setting exists to suppress.
    if (still) {
      progress.value = 0.72;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: Math.max(80, duration || 600),
      easing: Easing.linear,
    });
  }, [duration, playToken, progress, still]);
  return progress;
}

// Deterministic per step, so a replay of the same claim cracks the same way.
function seeded(seed) {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function seedOf(text) {
  let hash = 0x811c9dc5;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Ground primitives
// ---------------------------------------------------------------------------

/**
 * Something above you, getting closer.
 *
 * Eases IN, because a falling object covers more ground per frame the nearer it
 * gets. This one primitive is most of what makes Meteor Claim read as a meteor
 * before any fire is on screen.
 */
function ShadowPatch({ step, point, playToken }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const props = useAnimatedProps(() => {
    const t = progress.value * progress.value;
    const rx = Math.max(0.01, step.size * 0.5 * (0.16 + 0.84 * t));
    return {
      rx,
      ry: Math.max(0.01, rx * 0.52),
      opacity: (step.opacity ?? 0.5) * Math.min(1, progress.value * 3),
    };
  });
  return (
    <AnimatedEllipse cx={point.x} cy={point.y} fill="#000" animatedProps={props} />
  );
}

/** Something passing overhead: the shape crosses the ground and is gone. */
function ShadowSweep({ step, point, bounds, playToken }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const span = (bounds?.width || 320) + step.size * 2;
  const props = useAnimatedProps(() => {
    const t = progress.value;
    const dir = step.reverse ? -1 : 1;
    return {
      cx: point.x + dir * (t - 0.5) * span,
      // Fades in and out at the edges rather than popping at the screen border.
      opacity: (step.opacity ?? 0.42) * Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
    };
  });
  return (
    <AnimatedEllipse
      cy={point.y}
      rx={step.size * 0.6}
      ry={step.size * 0.26}
      fill="#000"
      animatedProps={props}
    />
  );
}

/**
 * Fissures crawling out from a point, and staying.
 *
 * Distinct from the reveal canvas's own cracks: these run BEFORE the ground
 * changes hands, which is the beat where an impact has damaged the territory
 * but not yet taken it.
 */
function GroundCracks({ step, point, tint, ink, playToken, seedKey }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const count = step.count || 6;
  const reach = step.size * 0.5;
  const paths = useMemo(() => {
    const random = seeded(seedOf(seedKey));
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + random() * 0.6;
      const length = reach * (0.65 + random() * 0.5);
      const kink = angle + (random() - 0.5) * 0.55;
      return [
        `M${point.x},${point.y}`,
        `L${point.x + Math.cos(kink) * length * 0.5},${point.y + Math.sin(kink) * length * 0.5 * 0.7}`,
        `L${point.x + Math.cos(angle) * length},${point.y + Math.sin(angle) * length * 0.7}`,
      ].join(' ');
    });
  }, [count, point.x, point.y, reach, seedKey]);

  const props = useAnimatedProps(() => ({
    strokeDashoffset: reach * 2 * (1 - Math.min(1, progress.value * 1.25)),
    strokeOpacity: Math.min(1, progress.value * 4),
  }));

  return (
    <G>
      {paths.map((d, i) => (
        <AnimatedPath
          key={`crack-${i}`}
          d={d}
          fill="none"
          stroke={step.glow ? tint : ink}
          strokeWidth={step.glow ? 4 : 2.5}
          strokeLinecap="round"
          strokeDasharray={reach * 2}
          animatedProps={props}
        />
      ))}
    </G>
  );
}

/**
 * The claim colour coming up THROUGH the cracks, before the reveal.
 *
 * The beat that says the ground is already changing hands underneath, which is
 * what turns a reveal from an announcement into a consequence.
 */
function GlowSeams({ step, point, tint, playToken, seedKey }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const count = step.count || 6;
  const reach = step.size * 0.5;
  const paths = useMemo(() => {
    const random = seeded(seedOf(seedKey));
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + random() * 0.6;
      const length = reach * (0.65 + random() * 0.5);
      const kink = angle + (random() - 0.5) * 0.55;
      return [
        `M${point.x},${point.y}`,
        `L${point.x + Math.cos(kink) * length * 0.5},${point.y + Math.sin(kink) * length * 0.5 * 0.7}`,
        `L${point.x + Math.cos(angle) * length},${point.y + Math.sin(angle) * length * 0.7}`,
      ].join(' ');
    });
  }, [count, point.x, point.y, reach, seedKey]);

  // Swells and holds rather than pulsing: light rising from under the ground,
  // not a flashing sign.
  const props = useAnimatedProps(() => {
    const t = progress.value;
    return { strokeWidth: 2 + 7 * t, strokeOpacity: 0.25 + 0.6 * t };
  });

  return (
    <G>
      {paths.map((d, i) => (
        <AnimatedPath
          key={`seam-${i}`}
          d={d}
          fill="none"
          stroke={tint}
          strokeLinecap="round"
          animatedProps={props}
        />
      ))}
    </G>
  );
}

/** Slabs of ground lifting and dropping back. */
function GroundRise({ step, point, tint, ink, playToken, seedKey }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const slabs = useMemo(() => {
    const random = seeded(seedOf(seedKey));
    return Array.from({ length: step.count || 4 }, (_, i) => {
      const angle = (i / (step.count || 4)) * Math.PI * 2 + random() * 0.4;
      const radius = step.size * (0.16 + random() * 0.3);
      const w = step.size * (0.18 + random() * 0.16);
      return {
        x: point.x + Math.cos(angle) * radius - w / 2,
        y: point.y + Math.sin(angle) * radius * 0.7,
        w,
        h: w * 0.6,
        lift: 8 + random() * 12,
      };
    });
  }, [point.x, point.y, seedKey, step.count, step.size]);

  return (
    <G>
      {slabs.map((slab, i) => (
        <RisingSlab key={`slab-${i}`} slab={slab} progress={progress} tint={tint} ink={ink} />
      ))}
    </G>
  );
}

/** One slab. Its own component so each gets its own animated props hook. */
function RisingSlab({ slab, progress, tint, ink }) {
  const props = useAnimatedProps(() => {
    const t = progress.value;
    // Up quickly, hang, then slam back down on the last quarter.
    const lift = t < 0.72 ? Math.min(1, t / 0.34) : 1 - (t - 0.72) / 0.28;
    return { y: slab.y - slab.lift * Math.max(0, lift), opacity: 0.85 };
  });
  return (
    <AnimatedRect
      x={slab.x}
      width={slab.w}
      height={slab.h}
      rx={3}
      fill={tint}
      fillOpacity={0.5}
      stroke={ink}
      strokeWidth={1.5}
      animatedProps={props}
    />
  );
}

/**
 * A band travelling across the territory: a breath weapon, a wave, a wall of
 * something. The one primitive with a real spatial direction, so a sweep can
 * arrive at one side of a scene and reach people in the order they are stood.
 */
function SweepBand({ step, point, bounds, tint, playToken }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const width = bounds?.width || 320;
  const height = bounds?.height || 480;
  const thickness = step.thickness || Math.max(60, step.size * 0.45);
  const vertical = step.axis === 'y';
  const travel = (vertical ? height : width) + thickness * 2;

  // Written as two branches rather than a computed key: this runs as a worklet
  // on the UI thread, and a literal property name is the version that is
  // obviously correct there.
  const props = useAnimatedProps(() => {
    const t = progress.value;
    const dir = step.reverse ? -1 : 1;
    const offset = (t - 0.5) * travel * dir;
    const opacity = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * (step.opacity ?? 0.7);
    if (vertical) return { y: point.y + offset - thickness / 2, opacity };
    return { x: point.x + offset - thickness / 2, opacity };
  });

  return (
    <AnimatedRect
      x={vertical ? 0 : 0}
      y={vertical ? 0 : 0}
      width={vertical ? width : thickness}
      height={vertical ? thickness : height}
      fill={step.color || tint}
      animatedProps={props}
    />
  );
}

/** A line of light stepping down the claim. Quantised, so it reads as machine. */
function Scanline({ step, point, bounds, tint, playToken }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const steps = step.steps || 8;
  const height = bounds?.height || 480;
  const width = bounds?.width || 320;
  const span = step.size * 1.4;

  const props = useAnimatedProps(() => {
    const quantised = Math.floor(progress.value * steps) / steps;
    return {
      y: point.y - span / 2 + quantised * span,
      opacity: 0.9 * (1 - Math.max(0, progress.value - 0.85) / 0.15),
    };
  });

  return (
    <AnimatedRect x={0} width={width} height={Math.max(2, height * 0.008)} fill={tint} animatedProps={props} />
  );
}

/** Streaks pulling inward, and a horizon closing. A well, before anyone reacts. */
function PullField({ step, point, tint, playToken, seedKey }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const spokes = useMemo(() => {
    const random = seeded(seedOf(seedKey));
    return Array.from({ length: step.count || 10 }, (_, i) => ({
      angle: (i / (step.count || 10)) * Math.PI * 2 + random() * 0.3,
      phase: random(),
    }));
  }, [seedKey, step.count]);
  const reach = step.size * 0.6;

  const ringProps = useAnimatedProps(() => ({
    r: Math.max(0.01, reach * (1 - progress.value * 0.75)),
    strokeOpacity: 0.5 * progress.value,
  }));

  return (
    <G>
      {spokes.map((spoke, i) => (
        <PullSpoke key={`spoke-${i}`} spoke={spoke} point={point} reach={reach} progress={progress} tint={tint} />
      ))}
      <AnimatedCircle cx={point.x} cy={point.y} fill="none" stroke={tint} strokeWidth={2} animatedProps={ringProps} />
    </G>
  );
}

function PullSpoke({ spoke, point, reach, progress, tint }) {
  const props = useAnimatedProps(() => {
    // Each streak runs its own loop offset, so the field churns instead of
    // marching in step.
    const t = (progress.value + spoke.phase) % 1;
    const outer = reach * (1 - t);
    const inner = Math.max(2, outer - reach * 0.22);
    return {
      x1: point.x + Math.cos(spoke.angle) * outer,
      y1: point.y + Math.sin(spoke.angle) * outer * 0.75,
      x2: point.x + Math.cos(spoke.angle) * inner,
      y2: point.y + Math.sin(spoke.angle) * inner * 0.75,
      strokeOpacity: 0.7 * Math.sin(Math.PI * t),
    };
  });
  return <AnimatedLine stroke={tint} strokeWidth={2.5} strokeLinecap="round" animatedProps={props} />;
}

// ---------------------------------------------------------------------------
// Air primitives
// ---------------------------------------------------------------------------

/** One frame of light. The cheapest possible impact, and the most effective. */
function Flash({ step, playToken }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    // Instant on, quick decay. A flash with a fade-in is a lamp.
    const value = t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 0.92);
    return { opacity: (step.opacity ?? 0.75) * value * value };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: step.color || '#FFFFFF' }, style]}
    />
  );
}

/** The scene dims. Anticipation with no movement in it at all. */
function Darken({ step, playToken }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const style = useAnimatedStyle(() => ({
    opacity: (step.opacity ?? 0.3) * Math.sin(Math.PI * Math.min(1, Math.max(0, progress.value))),
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.darken, style]} />
  );
}

/**
 * A veil that arrives and then CLEARS.
 *
 * The consequence primitive. An impact whose smoke never lifts has no
 * aftermath, it just ends — and the claim underneath is revealed to nobody.
 */
function Dust({ step, point, playToken, seedKey }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const puffs = useMemo(() => {
    const random = seeded(seedOf(seedKey));
    return Array.from({ length: step.count || 7 }, () => ({
      angle: random() * Math.PI * 2,
      radius: step.size * (0.1 + random() * 0.42),
      size: step.size * (0.18 + random() * 0.24),
      drift: 0.6 + random() * 0.9,
    }));
  }, [seedKey, step.count, step.size]);

  return (
    <G>
      {puffs.map((puff, i) => (
        <DustPuff key={`puff-${i}`} puff={puff} point={point} progress={progress} color={step.color} />
      ))}
    </G>
  );
}

function DustPuff({ puff, point, progress, color }) {
  const props = useAnimatedProps(() => {
    const t = progress.value;
    // Billows out over the first third, then thins to nothing.
    const spread = Math.min(1, t * 3);
    return {
      cx: point.x + Math.cos(puff.angle) * puff.radius * spread * puff.drift,
      cy: point.y + Math.sin(puff.angle) * puff.radius * 0.6 * spread * puff.drift - t * 14,
      r: Math.max(0.01, puff.size * (0.5 + spread * 0.9)),
      opacity: 0.5 * Math.max(0, 1 - Math.max(0, t - 0.25) / 0.75),
    };
  });
  return <AnimatedCircle fill={color || '#B9B2A8'} animatedProps={props} />;
}

/** Streaks pushing one way. Wind off a banner, blast off an explosion. */
function Wind({ step, bounds, tint, playToken, seedKey }) {
  const progress = useProgress(step.duration, playToken, step.still);
  const width = bounds?.width || 320;
  const height = bounds?.height || 480;
  const streaks = useMemo(() => {
    const random = seeded(seedOf(seedKey));
    return Array.from({ length: step.count || 9 }, () => ({
      y: random() * height,
      length: 30 + random() * 70,
      phase: random(),
      speed: 0.7 + random() * 0.6,
    }));
  }, [height, seedKey, step.count]);

  return (
    <G>
      {streaks.map((streak, i) => (
        <WindStreak
          key={`wind-${i}`}
          streak={streak}
          width={width}
          progress={progress}
          tint={step.color || tint}
          reverse={step.reverse}
        />
      ))}
    </G>
  );
}

function WindStreak({ streak, width, progress, tint, reverse }) {
  const props = useAnimatedProps(() => {
    const t = (progress.value * streak.speed + streak.phase) % 1;
    const dir = reverse ? -1 : 1;
    const x = reverse ? width - t * (width + streak.length) : t * (width + streak.length) - streak.length;
    return {
      x1: x,
      x2: x + streak.length * dir,
      strokeOpacity: 0.55 * Math.sin(Math.PI * t),
    };
  });
  return <AnimatedLine y1={streak.y} y2={streak.y} stroke={tint} strokeWidth={2} strokeLinecap="round" animatedProps={props} />;
}

// ---------------------------------------------------------------------------

const PRIMITIVES = {
  [ENVIRONMENT.SHADOW]: ShadowPatch,
  [ENVIRONMENT.SHADOW_SWEEP]: ShadowSweep,
  [ENVIRONMENT.CRACKS]: GroundCracks,
  [ENVIRONMENT.GLOW_SEAMS]: GlowSeams,
  [ENVIRONMENT.RISE]: GroundRise,
  [ENVIRONMENT.SWEEP_BAND]: SweepBand,
  [ENVIRONMENT.SCANLINE]: Scanline,
  [ENVIRONMENT.PULL_FIELD]: PullField,
  [ENVIRONMENT.FLASH]: Flash,
  [ENVIRONMENT.DARKEN]: Darken,
  [ENVIRONMENT.DUST]: Dust,
  [ENVIRONMENT.WIND]: Wind,
};

// Full-screen views rather than SVG shapes: a raster the size of the map for
// one primitive is cheaper as a plain layer than as vector work.
const OVERLAY_KINDS = new Set([ENVIRONMENT.FLASH, ENVIRONMENT.DARKEN]);

/**
 * Draws whichever world primitives are live right now.
 *
 * `items` are already-resolved steps from CaptureStylePlayer: each carries its
 * screen point, so this component never touches the anchor vocabulary and
 * cannot disagree with the effect or the character that shares its beat.
 */
export default function EnvironmentLayer({ items = [], bounds, tint, ink, playToken = 0, air = false }) {
  const shown = items.filter((item) => isAirEnvironment(item.kind) === air);
  if (!shown.length) return null;

  const overlays = shown.filter((item) => OVERLAY_KINDS.has(item.kind));
  const vectors = shown.filter((item) => !OVERLAY_KINDS.has(item.kind));

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { zIndex: air ? CAPTURE_LAYER.ENVIRONMENT_AIR : CAPTURE_LAYER.ENVIRONMENT_GROUND },
      ]}
    >
      {vectors.length ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {vectors.map((item) => {
            const Primitive = PRIMITIVES[item.kind];
            if (!Primitive) return null;
            return (
              <Primitive
                key={item.key}
                step={item}
                point={item.point}
                bounds={bounds}
                tint={tint}
                ink={ink}
                playToken={playToken}
                seedKey={item.key}
              />
            );
          })}
        </Svg>
      ) : null}

      {overlays.map((item) => {
        const Primitive = PRIMITIVES[item.kind];
        if (!Primitive) return null;
        return <Primitive key={item.key} step={item} playToken={playToken} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  darken: { backgroundColor: '#05070C' },
});
