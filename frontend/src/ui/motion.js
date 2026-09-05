// Motion + haptics primitives. Every animated flourish in the app goes
// through here so Reduce Motion is respected in exactly one place.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Dimensions, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { brand, radius, useTheme } from '../theme';
import { STAGGER_CAP, STAGGER_MS } from '../theme/motion';

// Re-export haptics from the theme module so both import paths work.
export { haptic } from '../theme/haptics';

// ---------------------------------------------------------------------------
// staggerDelay — the one place list entrances get their timing. Capped so a
// hundred-row leaderboard doesn't take three seconds to finish arriving.
// ---------------------------------------------------------------------------

export function staggerDelay(index, base = 0) {
  return base + Math.min(index, STAGGER_CAP) * STAGGER_MS;
}

// Rows past the cap are the ones you only ever meet by scrolling, and a row
// fading in under your thumb reads as lag rather than as polish. Virtualized
// lists use this to animate the first screenful and render the rest flat.
export function shouldStagger(index) {
  return index < STAGGER_CAP;
}

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
// Reveal — the standard entrance for screen elements: a clean fade in (no
// bounce). Wrap anything; stagger with `delay`. Renders statically under
// Reduce Motion. `from` kept for API compatibility; all variants now fade.
// ---------------------------------------------------------------------------

export function Reveal({ delay = 0, from = 'down', duration = 340, children, style, ...rest }) {
  const reduced = useReduceMotion();
  const anim =
    from === 'up' ? FadeInUp : from === 'none' ? FadeIn : FadeInDown;
  return (
    <Animated.View
      entering={reduced ? undefined : anim.delay(delay).duration(duration).easing(Easing.out(Easing.quad))}
      style={style}
      {...rest}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// ScreenIn — a whole screen arriving as ONE fade instead of in pieces.
//
// Reveal staggers elements that are already there. This is for the other case:
// a screen whose content cannot be drawn until something lands (the map style,
// the first page of data), where the honest options are a half-built screen
// that fills in piecemeal or a hold followed by a single clean fade up. The
// second one is what reads as the app arriving rather than assembling.
//
// Children RENDER the whole time — only the opacity is held at zero — so
// layout, measurement and the map's own load all happen behind the fade and
// nothing is waiting on the reveal to start working.
//
// `timeoutMs` is the reason this is safe to gate a whole screen on: a `ready`
// that never turns true (a map event that doesn't fire, a fetch that hangs)
// would otherwise leave someone staring at the background colour. The guard
// shows the screen anyway. It is a floor, not a target — reaching it means the
// content faded in mid-build, which is still better than a blank page.
//
// `armed` starts the guard's clock. It matters for a tab screen, because the
// tabs all MOUNT at launch (App.js preloads them) and are looked at much
// later: measuring the wait from mount would burn the guard while the screen
// is still off-screen, and the reveal would play to nobody. Arm on focus and
// the guard measures the wait somebody is actually sitting through.
//
// The reveal plays ONCE. A screen re-fading every time its data refreshes is
// a flicker, not an entrance.
// ---------------------------------------------------------------------------

export function ScreenIn({
  ready = true,
  armed = true,
  duration = 420,
  delay = 0,
  timeoutMs = 1400,
  style,
  children,
  ...rest
}) {
  const reduced = useReduceMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  const [expired, setExpired] = useState(false);
  const played = useRef(false);

  useEffect(() => {
    if (reduced || !armed || ready || played.current) return undefined;
    const t = setTimeout(() => setExpired(true), timeoutMs);
    return () => clearTimeout(t);
  }, [armed, ready, reduced, timeoutMs]);

  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      return;
    }
    if (played.current || !(ready || (armed && expired))) return;
    played.current = true;
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.quad) })
    );
  }, [ready, armed, expired, reduced, delay, duration, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[style, fade]} {...rest}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// useArrival / Arrival — covering the skeleton-to-data swap.
//
// ScreenIn is for content that can be HELD until it is whole. Most screens
// can't be: they show placeholder blocks so the page has a shape while the
// request is out, and then hard-swap to the real thing. The swap is the ugly
// part — grey slabs replaced by dense cards in a single frame, which reads as
// a jolt however fast the network was.
//
// The pair below fades that content up over the page instead. It is a dissolve
// rather than a true crossfade: the placeholder leaves and the content ramps up
// from the same background it was drawn on. Overlapping the two would mean
// keeping a positioned ghost of the placeholder alive through the swap, and no
// screen here is laid out such that that ghost would land where its original
// sat.
//
// The point of `useArrival` is that the fade only happens where somebody was
// actually kept waiting. Most visits hit the response cache (see api/cache.js)
// and draw real content on the first frame — there is no jump to cover there,
// and fading in content that was already in hand is exactly the "everything is
// always loading" look the cache was built to get rid of. Hold the hook where
// the loading flag lives (above the early return, so it survives both
// branches) and hand its answer to the wrapper.
//
//   const arriving = useArrival(loading);
//   if (loading) return <Screen>{placeholders}</Screen>;
//   return <Arrival active={arriving} style={{ flex: 1 }}><Screen>…</Screen></Arrival>;
// ---------------------------------------------------------------------------

export function useArrival(loading) {
  // A latch, deliberately written during render: it has to be true on the very
  // render that flips `loading` off, which a state update is a frame too late
  // for. Idempotent — re-rendering with the same input can only re-set it.
  const waited = useRef(false);
  if (loading) waited.current = true;
  return waited.current;
}

export function Arrival({
  active = true,
  duration = 280,
  delay = 0,
  style,
  children,
  ...rest
}) {
  const reduced = useReduceMotion();
  const skip = !active || reduced;
  const opacity = useSharedValue(skip ? 1 : 0);

  useEffect(() => {
    if (skip) {
      opacity.value = 1;
      return;
    }
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.quad) })
    );
  }, [skip, delay, duration, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[style, fade]} {...rest}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Confetti — a one-shot celebration burst. Renders `count` pieces that fall
// and drift with a little spin, then fade. Absolutely positioned; drop it in
// an overlay. No-op under Reduce Motion. pointerEvents none — never blocks.
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = [brand.pink, brand.purple, brand.teal, '#fbbf24', '#22c55e', '#3b82f6'];

function ConfettiPiece({ delay, startX, color, size, spin }) {
  const p = useSharedValue(0);
  const { height } = Dimensions.get('window');
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 1500 + Math.random() * 900, easing: Easing.out(Easing.quad) }));
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.15 ? p.value / 0.15 : 1 - Math.max(0, (p.value - 0.7) / 0.3),
    transform: [
      { translateY: p.value * (height * 0.9) },
      { translateX: Math.sin(p.value * Math.PI * 2) * 26 },
      { rotate: `${p.value * spin}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', top: -20, left: startX, width: size, height: size * 1.6, borderRadius: 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export function Confetti({ count = 26 }) {
  const reduced = useReduceMotion();
  const { width } = Dimensions.get('window');
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        delay: Math.random() * 350,
        startX: Math.random() * width,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 6,
        spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
      })),
    [count, width]
  );
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      {/* `key` is passed explicitly, not spread: React 19 no longer lifts a
          `key` out of a spread, so this list used to render unkeyed. */}
      {pieces.map(({ id, ...p }) => (
        <ConfettiPiece key={id} {...p} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// MascotLoader — a PASER runner bobbing on a light squircle. Used for full
// screen loading. Seated on white so the black-outlined art reads on the dark
// background; the bob is a gentle infinite ease. Static under Reduce Motion.
// ---------------------------------------------------------------------------

export function MascotLoader({ source, size = 132 }) {
  const reduced = useReduceMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(withTiming(1, { duration: 720, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduced, t]);

  const bob = useAnimatedStyle(() => ({ transform: [{ translateY: -10 * t.value }] }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.Image source={source} style={[{ width: size, height: size }, bob]} resizeMode="contain" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PressableScale — the standard button press affordance (scale 0.97).
// ---------------------------------------------------------------------------

export function PressableScale({
  children,
  style,
  containerStyle,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  scaleTo = 0.97,
  onHoverIn,
  onHoverOut,
  ...rest
}) {
  const reduced = useReduceMotion();
  const scale = useSharedValue(1);
  const hovered = useRef(false);
  const pressed = useRef(false);
  useEffect(() => {
    if (reduced || disabled) scale.value = 1;
    return () => cancelAnimation(scale);
  }, [reduced, disabled, scale]);

  // useAnimatedStyle keeps the shared-value read on the UI thread —
  // reading `scale` inline in the render would trip Reanimated strict mode.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      style={containerStyle}
      onPressIn={(event) => {
        pressed.current = true;
        if (!reduced) scale.value = withSpring(scaleTo, { damping: 20, stiffness: 300 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.current = false;
        if (!reduced) scale.value = withSpring(hovered.current ? 1.025 : 1, { damping: 20, stiffness: 300 });
        onPressOut?.(event);
      }}
      onHoverIn={(event) => {
        hovered.current = true;
        if (!reduced && !disabled && !pressed.current) scale.value = withSpring(1.025, { damping: 20, stiffness: 300 });
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        hovered.current = false;
        if (!reduced && !pressed.current) scale.value = withSpring(1, { damping: 20, stiffness: 300 });
        onHoverOut?.(event);
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
// PressableShift — the neo-brutalist press.
//
// A box with a hard offset shadow is drawn as though it sits ABOVE the page by
// exactly that offset. Pressing it should put it down: the box slides into the
// shadow's place and the shadow collapses to nothing, so the whole thing lands
// flush. Releasing lifts it back. It is the one interaction that makes the
// style feel physical rather than decorative, and it is the reason the shadow
// is worth having on a button at all.
//
// The shadow half is the caller's job — `shift` is exported as a shared value
// through the render prop so a HardShadow can collapse in step. A caller that
// only wants the movement ignores it.
//
// Scale is deliberately NOT applied. Scaling a box with a 3pt stroke scales the
// stroke too, so the outline visibly thins under the thumb, which is the exact
// opposite of what a heavy-stroke style should advertise when touched.
// ---------------------------------------------------------------------------

export function PressableShift({
  children,
  style,
  containerStyle,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  // How far the box travels. Match it to its shadow's offset, or the box lands
  // somewhere its shadow was not and the press reads as a wobble.
  offset = 4,
  ...rest
}) {
  const reduced = useReduceMotion();
  const down = useSharedValue(0);

  // Timing, not spring: the box is meant to LAND. A spring overshoots past
  // flush and bounces back out of the shadow it just filled.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: down.value * offset },
      { translateY: down.value * offset },
    ],
  }));

  return (
    <Pressable
      style={containerStyle}
      onPressIn={(event) => {
        if (!reduced) down.value = withTiming(1, { duration: 60 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduced) down.value = withTiming(0, { duration: 90 });
        onPressOut?.(event);
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
// Bar — a progress track whose fill EASES to its new value instead of jumping.
// Energy draining on a claim and XP landing after a run are the two moments
// where the game pays you back, and a bar that snaps throws that away.
//
// The fill is animated in pixels off a measured track rather than as a
// percentage string: percentage widths interpolate fine, but scaling a rounded
// fill distorts its corners at low values and a measured width keeps the cap
// perfectly round at 3% and at 97%.
//
// `animateOnMount` fills from empty on first paint — right for a screen you
// arrive at to see what you earned, wrong for a HUD chip that is simply always
// on screen (that one should only move when the number moves).
//
// KEEP BORDERS OFF `trackStyle`. The measured layout width is the BORDER box,
// so an outlined track makes every fill run long by twice the border. Put the
// border (and the radius and overflow) on a wrapper and pass the Bar
// `StyleSheet.absoluteFill` as its track — see ProgressTrack in components/ui/
// toon.js. That is also how to stack two fills in one track (ClubScreen's
// GoalBar): a plain outer track, two absoluteFill Bars inside it.
// ---------------------------------------------------------------------------

export function Bar({
  pct,
  trackStyle,
  fillStyle,
  durationMs = 520,
  delay = 0,
  animateOnMount = false,
  children,
}) {
  const reduced = useReduceMotion();
  const [trackW, setTrackW] = useState(0);
  const target = Math.max(0, Math.min(1, Number(pct) || 0));
  const progress = useSharedValue(animateOnMount && !reduced ? 0 : target);
  const mounted = useRef(false);

  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (reduced || (first && !animateOnMount)) {
      progress.value = target;
      return;
    }
    progress.value = withDelay(
      first ? delay : 0,
      withTiming(target, { duration: durationMs, easing: Easing.out(Easing.cubic) })
    );
  }, [target, reduced, durationMs, delay, animateOnMount, progress]);

  const fill = useAnimatedStyle(() => ({ width: trackW * progress.value }));

  return (
    <View
      style={trackStyle}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      pointerEvents="none"
    >
      {/* `children` is for fills that are painted rather than coloured — a
          gradient, say. It rides inside the animated box, so it stretches with
          the fill instead of being clipped to a static width. */}
      <Animated.View style={[fillStyle, fill]}>{children}</Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SteppedBar — a fill that runs through SEVERAL passes of the same track.
//
// `Bar` eases to one value, which is everything a meter needs. A level bar is
// not a meter: XP that carries you past a threshold has to fill the track,
// empty it, and keep going, and the number above it has to tick over in the gap
// — one continuous move that happens to cross a boundary, not a jump to a
// percentage. Splitting it into steps is what makes the level-up watchable
// instead of implied.
//
// `steps` is [{ from, to, ms }] in track fractions; it must be memoised, since
// a new array restarts the run. `onStep(i)` fires as each one begins — that is
// where the caller re-labels the level. Reduce Motion lands on the last step's
// value with no movement at all.
//
// The border-box trap on `Bar` applies here for the same reason: keep the
// outline on a wrapper and pass `StyleSheet.absoluteFill` as the track.
// ---------------------------------------------------------------------------

export function SteppedBar({
  steps,
  delay = 0,
  trackStyle,
  fillStyle,
  onStep,
  // Optional shared value to drive alongside the fill, so a caller can hang its
  // own animated text off the same progress without a second timing.
  progress,
  children,
}) {
  const reduced = useReduceMotion();
  const [trackW, setTrackW] = useState(0);
  const internal = useSharedValue(0);
  const p = progress || internal;
  // Held in a ref so re-labelling on a step can't itself restart the run.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  useEffect(() => {
    if (!steps?.length) return undefined;
    const last = steps[steps.length - 1];
    if (reduced) {
      p.value = last.to;
      onStepRef.current?.(steps.length - 1);
      return undefined;
    }
    let cancelled = false;
    const advance = (i) => {
      if (cancelled || i >= steps.length) return;
      const s = steps[i];
      onStepRef.current?.(i);
      // Intermediate passes run flat: easing out of every one of them would
      // make a two-level gain read as two separate fills.
      const easing = i === steps.length - 1 ? Easing.out(Easing.cubic) : Easing.linear;
      p.value = s.from;
      p.value = withDelay(
        i === 0 ? delay : 0,
        withTiming(s.to, { duration: s.ms, easing }, (finished) => {
          'worklet';
          if (finished) runOnJS(advance)(i + 1);
        })
      );
    };
    advance(0);
    return () => {
      cancelled = true;
    };
  }, [steps, reduced, delay, p]);

  const fill = useAnimatedStyle(() => ({ width: trackW * p.value }));

  return (
    <View
      style={trackStyle}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      pointerEvents="none"
    >
      <Animated.View style={[fillStyle, fill]}>{children}</Animated.View>
    </View>
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

export function CountUpText({
  value,
  // Where the count STARTS. Omitted, it behaves as it always has: from zero on
  // mount, and onward from wherever it sits when the value changes. Given, each
  // run is a fresh count from that number — a level bar's "XP into this level"
  // restarts at the boundary rather than counting on from the level below.
  from,
  durationMs = 1100,
  delay = 0,
  format = defaultFormat,
  style,
  ...rest
}) {
  const reduced = useReduceMotion();
  const progress = useSharedValue(reduced ? value : from ?? 0);

  useEffect(() => {
    if (reduced) {
      progress.value = value;
    } else {
      if (from != null) progress.value = from;
      progress.value = withDelay(
        delay,
        withTiming(value, {
          duration: durationMs,
          easing: Easing.out(Easing.cubic),
        })
      );
    }
  }, [value, from, delay, reduced, durationMs, progress]);

  const animatedProps = useAnimatedProps(() => ({
    text: format(progress.value),
    defaultValue: format(progress.value),
  }));

  // A TextInput carries no intrinsic content width, so one dropped into a row
  // either collapses or eats the row depending on what the parent does — which
  // is why this was only ever safe on a full-width hero number. An invisible
  // Text holding the FINAL value now reserves exactly the box the finished
  // number needs and the animated input paints inside it, so this drops in
  // anywhere a Text would go. The Text is also what screen readers get: the
  // settled value, not a control mid-tick.
  return (
    <View style={{ position: 'relative' }}>
      <Text style={[style, { opacity: 0 }]} numberOfLines={1}>
        {format(value)}
      </Text>
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[
          StyleSheet.absoluteFill,
          { padding: 0, includeFontPadding: false, textAlignVertical: 'center' },
          style,
        ]}
        animatedProps={animatedProps}
        {...rest}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — pulsing placeholder block for loading lists/maps.
// ---------------------------------------------------------------------------

// A slow breath — "this is waiting for you", said without words. The pass
// ladder uses it in place of a CLAIM label on every unclaimed tier: fifty
// little pink pills reading CLAIM is a wall of text, one collectible gently
// swelling is an invitation. Holds still under Reduce Motion.
export function Pulse({ children, active = true, min = 1, max = 1.07, durationMs = 900, style }) {
  const reduced = useReduceMotion();
  const scale = useSharedValue(min);

  useEffect(() => {
    if (!active || reduced) {
      scale.value = min;
      return;
    }
    scale.value = withRepeat(
      withTiming(max, { duration: durationMs, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [active, durationMs, max, min, reduced, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

// ---------------------------------------------------------------------------
// Pop — a one-shot spring scale, fired whenever `trigger` changes.
//
// The counterpart to `Pulse`, and the distinction is the whole point: Pulse
// breathes forever and means "this is waiting for you"; Pop happens once and
// means "this just changed". A level chip rolling over from 2 to 3, a coin
// payout landing — both are events, and an event that arrives by fading in at
// a constant speed does not read as an event.
//
// A spring rather than a timing curve, and deliberately under-damped: the
// overshoot past 1 and the settle back IS the pop. A critically damped spring
// to the same place is a fast fade with extra steps.
//
// Fires on mount as well as on change, because the first value of `trigger` is
// itself the first event — a payout row that mounts is a payout arriving. Pass
// a `trigger` that never changes to get exactly one pop and no more.
// ---------------------------------------------------------------------------

export function Pop({ trigger = 0, from = 0.72, delay = 0, children, style, ...rest }) {
  const reduced = useReduceMotion();
  const scale = useSharedValue(reduced ? 1 : from);

  useEffect(() => {
    if (reduced) {
      scale.value = 1;
      return;
    }
    scale.value = from;
    scale.value = withDelay(delay, withSpring(1, { damping: 9, stiffness: 220, mass: 0.7 }));
  }, [trigger, delay, from, reduced, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[style, animated]} {...rest}>
      {children}
    </Animated.View>
  );
}

export function Skeleton({ width = '100%', height = 16, style, dark = false }) {
  const reduced = useReduceMotion();
  // Read the LIVE palette. This used to take the static `colors` export, which
  // is the dark palette whatever the scheme is — so on light mode every loading
  // placeholder painted as a near-black slab and the screen read as broken
  // rather than as loading.
  const { colors: themed } = useTheme();
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
          backgroundColor: dark ? 'rgba(255,255,255,0.08)' : themed.bgElevated,
        },
        pulse,
        style,
      ]}
    />
  );
}
