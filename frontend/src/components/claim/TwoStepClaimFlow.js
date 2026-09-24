// The post-run claim, in two steps and one decision.
//
//   STEP 1  Choose where   slide the territory along the run
//   STEP 2  Choose angle   turn it about its own centre
//   THEN    Claim          what you get, what it costs, the button
//
// Testers could not tell what anything on the old version controlled: a bare
// START/FINISH rail, an 88pt dial with no shape in it, four equal stats up
// top and a clan coloured button that read as disabled. The mechanic under it
// is unchanged (a rigid stamp, `placement.js`, the same pose sent to the
// server). What changed is that every control now says what it moves:
//
//   * each step is titled with the job and has one plain sentence under it;
//   * the rail is labelled "Position on your run";
//   * the dial DRAWS THE CLAIM ITSELF, turning as the map's copy turns, with
//     ↺ ↻ buttons beside it for anyone who does not want to drag;
//   * the numbers are one headline (what you gain) with the rest underneath,
//     and they sit next to the Claim button rather than above everything.
//
// The step is owned by the screen (`step` / `onStepChange`) because the map
// and the Claim footer both depend on it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import { ToonButton } from '../ui';
import EnergyMeter from '../EnergyMeter';
import { headingFromDialPoint, normaliseDeg, turnFromRun } from './placement';
import { brand, space, toon, useTheme, useThemedStyles, withAlpha, type } from '../../theme';
import { haptic, PressableScale, useReduceMotion } from '../../ui/motion';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { TARGET, useTutorialTarget } from '../../tutorial';

// ---------------------------------------------------------------------------
// Gesture hints (the tutorial's demo claim only)
// ---------------------------------------------------------------------------
//
// ONE small movement, once, before the runner has touched the control: the
// slider's thumb leans right and comes back; the dial rocks ↺ then ↻. It is
// the thumb and the drawing that move, never the pose: the claim on the map
// does not change, so nothing looks as if the app is placing it by itself.
// Off under Reduce Motion, and gone for good the moment the control is used.

const HINT_DELAY_MS = 500;

function useOnceHint({ enabled, reduced, amplitude, leg = 260 }) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!enabled || reduced) {
      cancelAnimation(v);
      v.value = 0;
      return undefined;
    }
    const ease = { duration: leg, easing: Easing.inOut(Easing.quad) };
    v.value = withDelay(
      HINT_DELAY_MS,
      withSequence(withTiming(amplitude, ease), withTiming(-amplitude * 0.5, ease), withTiming(0, ease))
    );
    return () => cancelAnimation(v);
  }, [enabled, reduced, amplitude, leg, v]);
  return v;
}

export const CLAIM_STEPS = {
  PLACE: 'place',
  ROTATE: 'rotate',
};

// Territory has one unit everywhere. Extra precision keeps small steals
// meaningful without making the player mentally convert square metres.
export function landStr(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} km²`;
}

// Same number, read aloud.
function landSpoken(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} square kilometres`;
}

// Below this a part of the breakdown is rounding, not land.
const TRACE_M2 = 1;

/**
 * What a placement would WIN, and the parts it is made of.
 *
 * `gain` is the formula the chooser has always shown as GAIN: open ground,
 * rival ground that falls, and clubmates' ground that joins your holding.
 * Ground you already hold is reinforcement, not gain, and rival ground that is
 * DEFENDED stays theirs, so neither counts.
 */
export function claimBreakdown(p) {
  const newM2 = p?.new_m2 || 0;
  const enemy = p?.enemy_m2 || 0;
  const ally = p?.ally_m2 || 0;
  return {
    gain: newM2 + enemy + ally,
    newM2,
    enemy,
    ally,
    mine: p?.mine_m2 || 0,
    defended: p?.defended_m2 || 0,
  };
}

/**
 * The Claim button's words. It names what the runner is about to receive,
 * never "here": gained ground when there is any, reinforcement when the whole
 * claim lands on their own land, and the land the run earned when there is no
 * breakdown yet to be more precise with.
 */
export function claimCtaLabel(p, earnedM2) {
  const b = claimBreakdown(p);
  if (p && b.gain >= TRACE_M2) return { title: `CLAIM ${landStr(b.gain)}`, spoken: `Claim ${landSpoken(b.gain)}` };
  if (p && b.mine >= TRACE_M2) return { title: `REINFORCE ${landStr(b.mine)}`, spoken: `Reinforce ${landSpoken(b.mine)} of your land` };
  return { title: `CLAIM ${landStr(earnedM2)}`, spoken: `Claim ${landSpoken(earnedM2)}` };
}

// ---------------------------------------------------------------------------
// First use coaching
// ---------------------------------------------------------------------------
//
// A line of help beside the control it is about, on the first claim this
// device has seen and never again. Not the tutorial overlay: that owns the
// practice run and speaks in full cards, and this only has to point.

const COACH_KEY = 'claim:coach:v1';

function useClaimCoach(enabled) {
  // null until the stored flag has been read: better to show nothing for a
  // frame than to flash help at somebody who has claimed fifty times.
  const [seen, setSeen] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    AsyncStorage.getItem(COACH_KEY)
      .then((v) => { if (alive) setSeen(v === '1'); })
      .catch(() => { if (alive) setSeen(true); });
    return () => { alive = false; };
  }, [enabled]);
  const done = useCallback(() => {
    setSeen(true);
    AsyncStorage.setItem(COACH_KEY, '1').catch(() => {});
  }, []);
  return { active: enabled && seen === false, done };
}

function CoachTip({ text, accent }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.coach, { borderColor: accent }]} accessibilityLiveRegion="polite">
      <Text style={styles.coachText}>{text}</Text>
      <View style={[styles.coachTail, { borderTopColor: accent }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step header
// ---------------------------------------------------------------------------

function StepHeader({ index, title, body, accent, right }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepTop}>
        <View style={styles.stepCount}>
          {[1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.stepPip,
                { backgroundColor: i <= index ? accent : withAlpha(D.textDim, 0.35) },
              ]}
            />
          ))}
          <Text style={styles.stepNumber}>STEP {index} OF 2</Text>
        </View>
        {right}
      </View>
      <Text style={styles.stepTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// STEP 1: where along the run
// ---------------------------------------------------------------------------

const HANDLE = 40;
const RAIL_H = 56;
const TRACK = 10;

function PositionRail({ t, baseT, accent, onChange, onCommit, onInteractionChange, disabled, coach, hint }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReduceMotion();
  const target = useTutorialTarget(TARGET.CLAIM_POSITION);
  const nudgeX = useOnceHint({ enabled: hint, reduced, amplitude: 18 });
  const hintStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudgeX.value }] }));
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const tRef = useRef(t);
  tRef.current = t;
  // Grabbing the handle and grabbing the track feel the same: the handle
  // follows the finger from wherever it lands, it never lags behind it.
  const pick = useCallback(
    (x, commit) => {
      const w = widthRef.current;
      if (w <= 0) return;
      let next = Math.max(0, Math.min(1, (x - HANDLE / 2) / Math.max(1, w - HANDLE)));
      // Magnetism at the resting pose, the run exactly where it was run.
      const usable = Math.max(1, w - HANDLE);
      if (baseT != null && Math.abs(next - baseT) * usable < 8) {
        if (Math.abs(tRef.current - baseT) > 1e-6) haptic.light();
        next = baseT;
      }
      onChange(next);
      if (commit) onCommit?.(next);
    },
    [baseT, onChange, onCommit]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onStartShouldSetPanResponderCapture: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponderCapture: () => !disabled,
        onPanResponderGrant: (e) => {
          onInteractionChange?.(true);
          pick(e.nativeEvent.locationX, false);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX, false),
        onPanResponderRelease: (e) => {
          pick(e.nativeEvent.locationX, true);
          onInteractionChange?.(false);
        },
        onPanResponderTerminate: () => {
          onCommit?.(tRef.current);
          onInteractionChange?.(false);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [disabled, onCommit, onInteractionChange, pick]
  );

  const usable = Math.max(0, width - HANDLE);
  const handleLeft = usable * Math.max(0, Math.min(1, t));
  const nudge = (d) => {
    const next = Math.max(0, Math.min(1, tRef.current + d));
    onChange(next);
    onCommit?.(next);
  };

  return (
    <View style={styles.railWrap} {...target} collapsable={false}>
      <Text style={styles.controlLabel}>Position on your run</Text>
      <View
        style={[styles.railTouch, coach && { backgroundColor: withAlpha(accent, 0.14) }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Claim position along run"
        accessibilityValue={{ text: `${Math.round(t * 100)} percent of the way from start to finish` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05)}
        {...responder.panHandlers}
      >
        <View
          pointerEvents="none"
          style={[styles.railTrack, { left: HANDLE / 2, right: HANDLE / 2, borderColor: toon.ink }]}
        />
        {width > 0 && (
          <View
            pointerEvents="none"
            style={[styles.railFill, { left: HANDLE / 2, width: handleLeft, backgroundColor: accent }]}
          />
        )}
        {/* the run as it was run: where the claim rests if left alone */}
        {baseT != null && width > 0 && (
          <View
            pointerEvents="none"
            style={[styles.restNotch, { left: HANDLE / 2 + usable * baseT - 1, backgroundColor: D.textDim }]}
          />
        )}
        {width > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.handle, { left: handleLeft, borderColor: toon.ink, backgroundColor: accent }, hintStyle]}
          >
            <Text style={styles.handleGlyph}>‹ ›</Text>
          </Animated.View>
        )}
      </View>
      <View style={styles.railEnds} pointerEvents="none">
        <Text style={styles.railEnd}>START</Text>
        <Text style={styles.railEnd}>FINISH</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// STEP 2: the angle
// ---------------------------------------------------------------------------

const DIAL = 150;
const DIAL_R = DIAL / 2 - 10;
const STEP_DEG = 15;
const SNAP_DEG = 4;

// The claim ring as a path inside the dial: flattened about its own centre,
// north up, scaled by its RADIUS rather than its bounding box so the drawing
// does not breathe as it turns.
function shapePath(ring, fit) {
  if (!ring || ring.length < 3) return null;
  let lon0 = 0;
  let lat0 = 0;
  for (const [lon, lat] of ring) { lon0 += lon; lat0 += lat; }
  lon0 /= ring.length;
  lat0 /= ring.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const pts = ring.map(([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0)]);
  const far = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
  if (!(far > 0)) return null;
  const k = fit / far;
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * k).toFixed(1)} ${(y * k).toFixed(1)}`).join(' ') + ' Z';
}

// The angle, in words. Positive turns anticlockwise (placement.js), which is
// left on a north up map.
function angleWords(deg) {
  const d = Math.round(turnFromRun(deg));
  if (d === 0) return 'As you ran it';
  return `Turned ${Math.abs(d)}° ${d > 0 ? 'left' : 'right'}`;
}

function RotateButton({ dir, onPress, disabled, accent }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={dir > 0 ? 'Rotate left' : 'Rotate right'}
      hitSlop={8}
      style={styles.rotateBtnWrap}
    >
      <View style={[styles.rotateBtn, { borderColor: toon.ink, backgroundColor: withAlpha(accent, 0.18) }]}>
        <Text style={styles.rotateGlyph}>{dir > 0 ? '↺' : '↻'}</Text>
      </View>
      <Text style={styles.rotateCaption}>{dir > 0 ? 'Left' : 'Right'}</Text>
    </PressableScale>
  );
}

function AngleDial({ deg, ring, accent, onChange, onCommit, onInteractionChange, disabled, coach, hint }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReduceMotion();
  const target = useTutorialTarget(TARGET.CLAIM_ROTATION);
  const rock = useOnceHint({ enabled: hint, reduced, amplitude: -14, leg: 300 });
  const rockStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rock.value}deg` }] }));
  const centre = DIAL / 2;
  const degRef = useRef(deg);
  degRef.current = deg;
  const grab = useRef(null);
  const tween = useRef(null);

  useEffect(() => () => { if (tween.current) cancelAnimationFrame(tween.current); }, []);

  // A drag TURNS the claim by as much as the finger turns about the centre.
  // It does not point: touching the rim at 3 o'clock must not throw the
  // shape a quarter turn before the finger has moved.
  const move = useCallback(
    (x, y, commit) => {
      const g = grab.current;
      if (!g) return;
      if (Math.hypot(x - centre, y - centre) < 12) return;
      const now = headingFromDialPoint(x, y, centre, centre);
      let next = normaliseDeg(g.deg + (now - g.at));
      let snapped = false;
      const mark = Math.round(next / STEP_DEG) * STEP_DEG;
      if (Math.abs(next - mark) < SNAP_DEG) {
        next = normaliseDeg(mark);
        snapped = true;
      }
      if (snapped && Math.round(next) !== Math.round(normaliseDeg(degRef.current))) haptic.light();
      onChange(next);
      if (commit) onCommit?.(next);
    },
    [centre, onChange, onCommit]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onStartShouldSetPanResponderCapture: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponderCapture: () => !disabled,
        onPanResponderGrant: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          grab.current = { at: headingFromDialPoint(x, y, centre, centre), deg: degRef.current || 0 };
          onInteractionChange?.(true);
        },
        onPanResponderMove: (e) => move(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
        onPanResponderRelease: (e) => {
          move(e.nativeEvent.locationX, e.nativeEvent.locationY, true);
          if (grab.current) onCommit?.(degRef.current);
          grab.current = null;
          onInteractionChange?.(false);
        },
        onPanResponderTerminate: () => {
          grab.current = null;
          onCommit?.(degRef.current);
          onInteractionChange?.(false);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [centre, disabled, move, onCommit, onInteractionChange]
  );

  // A button press turns to the next 15° mark, and is SEEN turning: a short
  // tween through the same onChange a drag uses, so the map shape and the
  // dial swing together, then one commit to price the result.
  const turn = useCallback(
    (dir) => {
      if (disabled) return;
      if (tween.current) cancelAnimationFrame(tween.current);
      const from = degRef.current || 0;
      const target = dir > 0
        ? Math.floor(from / STEP_DEG + 1e-6) * STEP_DEG + STEP_DEG
        : Math.ceil(from / STEP_DEG - 1e-6) * STEP_DEG - STEP_DEG;
      if (reduced) {
        const end = normaliseDeg(target);
        onChange(end);
        onCommit?.(end);
        return;
      }
      const start = Date.now();
      const ms = 180;
      const tick = () => {
        const k = Math.min(1, (Date.now() - start) / ms);
        const eased = 1 - (1 - k) * (1 - k);
        const now = from + (target - from) * eased;
        if (k < 1) {
          onChange(normaliseDeg(now));
          tween.current = requestAnimationFrame(tick);
        } else {
          tween.current = null;
          const end = normaliseDeg(target);
          onChange(end);
          onCommit?.(end);
        }
      };
      tick();
    },
    [disabled, onChange, onCommit, reduced]
  );

  const d = shapePath(ring, DIAL_R * 0.64);
  // The knob rides the rim at the claim's heading: 0 at the top, turning
  // with the shape.
  const rad = ((normaliseDeg(deg) + 90) * Math.PI) / 180;
  const kx = centre + Math.cos(rad) * DIAL_R;
  const ky = centre - Math.sin(rad) * DIAL_R;

  return (
    <View style={styles.dialBlock} {...target} collapsable={false}>
      <View style={styles.dialRow}>
        <RotateButton dir={1} onPress={() => turn(1)} disabled={disabled} accent={accent} />
        <View
          style={[styles.dialTouch, coach && { backgroundColor: withAlpha(accent, 0.16) }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Claim rotation"
          accessibilityValue={{ text: angleWords(deg) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => turn(e.nativeEvent.actionName === 'increment' ? -1 : 1)}
          {...responder.panHandlers}
        >
          <Animated.View pointerEvents="none" style={rockStyle}>
          <Svg width={DIAL} height={DIAL} pointerEvents="none">
            <Circle cx={centre} cy={centre} r={DIAL_R} fill={D.cardAlt} stroke={toon.ink} strokeWidth={3} />
            <Circle cx={centre} cy={centre} r={DIAL_R - 9} fill="none" stroke={withAlpha(D.textDim, 0.35)} strokeWidth={1} strokeDasharray="3 5" />
            <G>
              {Array.from({ length: 12 }, (_, i) => i * 30).map((m) => {
                const r = ((m + 90) * Math.PI) / 180;
                const inner = m % 90 === 0 ? DIAL_R - 8 : DIAL_R - 5;
                return (
                  <Line
                    key={m}
                    x1={centre + Math.cos(r) * inner}
                    y1={centre - Math.sin(r) * inner}
                    x2={centre + Math.cos(r) * DIAL_R}
                    y2={centre - Math.sin(r) * DIAL_R}
                    stroke={D.textDim}
                    strokeWidth={m % 90 === 0 ? 2 : 1}
                  />
                );
              })}
            </G>
            {/* the claim itself, turning as the map's copy turns */}
            {d && (
              <Path
                d={d}
                transform={`translate(${centre} ${centre})`}
                fill={withAlpha(accent, 0.45)}
                stroke={toon.ink}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            )}
            <Line x1={centre} y1={centre} x2={kx} y2={ky} stroke={accent} strokeWidth={2} strokeDasharray="4 4" />
            <Circle cx={centre} cy={centre} r={4} fill={toon.ink} />
            <Circle cx={kx} cy={ky} r={11} fill={accent} stroke={toon.ink} strokeWidth={2.5} />
          </Svg>
          </Animated.View>
        </View>
        <RotateButton dir={-1} onPress={() => turn(-1)} disabled={disabled} accent={accent} />
      </View>
      <Text style={styles.angleWords}>{angleWords(deg)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The summary that sits on the Claim button
// ---------------------------------------------------------------------------

function Part({ label, value, dim }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.part, dim && styles.partDim]}>
      <Text style={styles.partLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.partValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * What the runner gets, then what it costs. Rendered by the screen directly
 * above the Claim button, so the order down the sheet is the decision itself.
 *
 * `placement` may be null (the options never arrived): the summary then
 * falls back to the land the run earned and says only that energy is spent,
 * never a price it does not have.
 */
export function ClaimSummary({ placement, stale, accent, earnedM2, energyStatus, onEnergyPress, compact }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const p = placement;
  const b = claimBreakdown(p);
  // A claim that lands wholly on your own land wins nothing new; it
  // reinforces, and the headline says so instead of showing +0.
  const reinforceOnly = !!p && b.gain < TRACE_M2 && b.mine >= TRACE_M2;
  const headline = reinforceOnly ? b.mine : (p ? b.gain : earnedM2);
  // The parts only earn a line when they would say something the headline
  // does not: with no rivals, no clubmates and none of your own land under
  // it, "new land" IS the gain, and showing both was what made testers ask
  // what the difference was.
  const hasParts = p && (b.enemy >= TRACE_M2 || b.ally >= TRACE_M2 || b.mine >= TRACE_M2 || b.defended >= TRACE_M2);

  const cost = p?.energy_cost;
  const devFree = p?.applied_discounts?.includes('dev_account');
  const halfPrice = p?.applied_discounts?.includes('first_claim_of_day');
  const have = energyStatus?.energy ?? p?.energy_before;
  let costLine = 'Claiming spends energy.';
  let costSub = null;
  if (p && devFree) {
    costLine = 'This claim is free.';
  } else if (p && typeof cost === 'number') {
    costLine = cost > 0 ? `Claim cost: ${cost} energy` : 'This claim is free.';
    if (cost > 0 && typeof have === 'number') {
      costSub = have >= cost
        ? `You have ${have}. ${have - cost} left after.`
        : `You have ${have}.`;
    }
    if (halfPrice && cost > 0) costSub = `${costSub ? `${costSub} ` : ''}Half price, first claim today.`;
  }

  return (
    <View style={[styles.summary, stale && styles.summaryStale]}>
      <View style={styles.summaryTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryEyebrow}>{reinforceOnly ? 'YOU WILL REINFORCE' : "YOU'LL GAIN"}</Text>
          <Text
            style={[styles.summaryHeadline, { color: D.text }]}
            accessibilityLabel={`${reinforceOnly ? 'You will reinforce' : 'You will gain'} ${landSpoken(headline)}`}
          >
            +{landStr(headline)}
          </Text>
        </View>
        {!compact && energyStatus && (
          <EnergyMeter compact style={styles.summaryMeter} status={energyStatus} onPress={onEnergyPress} />
        )}
      </View>

      {hasParts && !compact && (
        <View style={styles.parts}>
          <Part label="New land" value={landStr(b.newM2)} dim={b.newM2 < TRACE_M2} />
          <Part label="From rivals" value={landStr(b.enemy)} dim={b.enemy < TRACE_M2} />
          <Part label="Already yours" value={landStr(b.mine)} dim={b.mine < TRACE_M2} />
        </View>
      )}
      {!compact && p && !hasParts && (
        <Text style={styles.summaryNote}>All open ground. No rival or own land under it.</Text>
      )}
      {!compact && b.ally >= TRACE_M2 && (
        <Text style={styles.summaryNote}>Includes {landStr(b.ally)} shared with your club.</Text>
      )}
      {!compact && b.defended >= TRACE_M2 && (
        <Text style={styles.summaryNote}>{landStr(b.defended)} of rival land is defended and stays theirs.</Text>
      )}

      {!compact && (
        <View style={styles.costRow}>
          <Text style={[styles.costBolt, { color: brand.pink }]}>⚡</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.costLine}>{costLine}</Text>
            {costSub && <Text style={styles.costSub}>{costSub}</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

/**
 * @param pose      {t, deg}, the live pose, owned by the screen
 * @param onPose    (pose, {commit}); commit is false mid drag, true on release
 * @param placement the breakdown for (roughly) this pose; may lag a drag
 * @param stale     true while a fresher breakdown is in flight
 * @param ring      the claim ring as placed right now, [lon, lat] pairs
 * @param step      CLAIM_STEPS value, owned by the screen
 * @param onStepChange (step) => void
 * @param coach     allow first use hints (off during the practice tutorial,
 *                  which has its own cards)
 */
export default function TwoStepClaimFlow({
  options,
  pose,
  onPose,
  placement,
  stale,
  team,
  ring,
  step = CLAIM_STEPS.PLACE,
  onStepChange,
  onInteractionChange,
  disabled,
  coach: coachEnabled = true,
  tutorial = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const nextTarget = useTutorialTarget(TARGET.CLAIM_NEXT);
  // Has the runner touched each control yet? The gesture hint plays only
  // before they have.
  const [turned, setTurned] = useState(false);
  const [touchedRail, setTouchedRail] = useState(false);
  const accent = team.glow;
  const baseT = typeof options?.base_t === 'number' ? options.base_t : 0.5;
  const coach = useClaimCoach(coachEnabled);
  // Which first use line is showing: before the rail is touched, straight
  // after it is, then the dial's.
  const [moved, setMoved] = useState(false);
  const [watchTip, setWatchTip] = useState(false);
  useEffect(() => {
    if (!watchTip) return undefined;
    const id = setTimeout(() => setWatchTip(false), 2600);
    return () => clearTimeout(id);
  }, [watchTip]);

  const setT = useCallback((t) => onPose({ ...pose, t }, { commit: false }), [onPose, pose]);
  const commitT = useCallback(
    (t) => {
      onPose({ ...pose, t }, { commit: true });
      if (!moved) {
        setMoved(true);
        if (coach.active) setWatchTip(true);
      }
    },
    [coach.active, moved, onPose, pose]
  );
  const setDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: false }), [onPose, pose]);
  const commitDeg = useCallback(
    (deg) => {
      onPose({ ...pose, deg }, { commit: true });
      setTurned(true);
      // Both controls have now been used once: that is the lesson.
      if (coach.active) coach.done();
    },
    [coach, onPose, pose]
  );
  // A hand on either control ends its hint at once, before any commit.
  const onControl = useCallback(
    (on) => {
      if (on && step === CLAIM_STEPS.ROTATE) setTurned(true);
      if (on && step !== CLAIM_STEPS.ROTATE) setTouchedRail(true);
      onInteractionChange?.(on);
    },
    [onInteractionChange, step]
  );

  const b = claimBreakdown(placement);

  if (step === CLAIM_STEPS.ROTATE) {
    return (
      <View>
        <StepHeader
          index={2}
          accent={accent}
          title="Choose angle"
          body="Rotate to lock in your claim."
        />
        {coach.active && <CoachTip text="Drag the dial or tap an arrow to rotate it." accent={accent} />}
        <AngleDial
          deg={pose.deg}
          ring={ring}
          accent={accent}
          onChange={setDeg}
          onCommit={commitDeg}
          onInteractionChange={onControl}
          disabled={disabled}
          coach={coach.active}
          hint={tutorial && !turned}
        />
        {/* Not in the demo: it teaches one way through, and a way back to
            step one would leave its angle card pointing at nothing. */}
        {!tutorial && (
          <PressableScale
            onPress={() => onStepChange?.(CLAIM_STEPS.PLACE)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Change position"
            hitSlop={10}
            style={styles.backLink}
          >
            <Text style={styles.backLinkText}>← Change position</Text>
          </PressableScale>
        )}
      </View>
    );
  }

  return (
    <View>
      <StepHeader
        index={1}
        accent={accent}
        title="Choose where"
        body="Move your claim along your run."
      />
      {coach.active && !moved && <CoachTip text="Slide to move your claim along your run." accent={accent} />}
      {coach.active && watchTip && <CoachTip text="Watch the shape move on the map." accent={accent} />}
      <PositionRail
        t={pose.t}
        baseT={baseT}
        accent={accent}
        onChange={setT}
        onCommit={commitT}
        onInteractionChange={onControl}
        disabled={disabled}
        coach={coach.active && !moved}
        hint={tutorial && !moved && !touchedRail}
      />
      <View style={[styles.liveGain, stale && styles.summaryStale]}>
        <Text style={styles.liveGainLabel}>You'll gain</Text>
        <Text style={styles.liveGainValue}>
          {placement ? `+${landStr(b.gain)}` : '·'}
        </Text>
      </View>
      <View {...nextTarget} collapsable={false} style={styles.nextWrap}>
        <ToonButton
          title="NEXT: CHOOSE ANGLE →"
          accessibilityLabel="Choose angle"
          onPress={() => onStepChange?.(CLAIM_STEPS.ROTATE)}
          disabled={disabled}
          size="sm"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// STYLES
// ---------------------------------------------------------------------------

const makeStyles = (theme) => ({
  // step header
  stepHeader: { marginBottom: space.sm },
  stepTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  stepCount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepPip: { width: 18, height: 5, borderRadius: 3 },
  stepNumber: { ...type.caption, color: theme.textMuted, letterSpacing: 0.8, marginLeft: 4 },
  stepTitle: { fontSize: 22, fontWeight: '800', color: theme.text, marginBottom: 2 },
  stepBody: { ...type.bodySm, color: theme.textMuted },

  // coach
  coach: {
    alignSelf: 'flex-start',
    borderWidth: 2,
    borderRadius: 10,
    backgroundColor: theme.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  coachText: { ...type.bodySmBold, color: theme.text },
  coachTail: {
    position: 'absolute',
    bottom: -8,
    left: 18,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  // position rail
  railWrap: { marginTop: 2 },
  controlLabel: { ...type.bodySmBold, color: theme.text, marginBottom: 2 },
  railTouch: { height: RAIL_H, justifyContent: 'center', borderRadius: 14 },
  railTrack: {
    position: 'absolute',
    top: RAIL_H / 2 - TRACK / 2,
    height: TRACK,
    borderRadius: TRACK / 2,
    borderWidth: 2,
    backgroundColor: theme.cardAlt,
  },
  railFill: {
    position: 'absolute',
    top: RAIL_H / 2 - TRACK / 2 + 1,
    height: TRACK - 2,
    borderRadius: TRACK / 2,
  },
  restNotch: { position: 'absolute', top: RAIL_H / 2 - 9, width: 2, height: 18 },
  handle: {
    position: 'absolute',
    top: RAIL_H / 2 - HANDLE / 2,
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGlyph: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', marginTop: -2 },
  railEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  railEnd: { ...type.caption, color: theme.textMuted, letterSpacing: 0.8 },

  liveGain: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  liveGainLabel: { ...type.bodySm, color: theme.textMuted },
  liveGainValue: { fontSize: 18, fontWeight: '800', color: theme.text },
  nextWrap: { marginTop: space.sm },

  // angle dial
  dialBlock: { alignItems: 'center', marginTop: 2 },
  dialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  dialTouch: { width: DIAL, height: DIAL, borderRadius: DIAL / 2 },
  rotateBtnWrap: { alignItems: 'center' },
  rotateBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateGlyph: { fontSize: 26, fontWeight: '800', color: theme.text, marginTop: -2 },
  rotateCaption: { ...type.caption, color: theme.textMuted, marginTop: 4 },
  angleWords: { ...type.bodySmBold, color: theme.text, marginTop: 4 },
  backLink: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  backLinkText: { ...type.bodySmBold, color: theme.textMuted, textDecorationLine: 'underline' },

  // summary
  summary: {
    borderTopWidth: 1,
    borderTopColor: withAlpha(theme.textDim, 0.3),
    paddingTop: space.sm,
    marginTop: space.xs,
  },
  summaryStale: { opacity: 0.6 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  summaryEyebrow: { ...type.caption, color: theme.textMuted, letterSpacing: 0.8 },
  summaryHeadline: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  summaryMeter: { width: 124 },
  parts: { flexDirection: 'row', gap: space.sm, marginTop: 6 },
  part: { flex: 1 },
  partDim: { opacity: 0.5 },
  partLabel: { ...type.caption, color: theme.textMuted },
  partValue: { ...type.bodySmBold, color: theme.text },
  summaryNote: { ...type.caption, color: theme.textMuted, marginTop: 4 },
  costRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: space.sm },
  costBolt: { fontSize: 16, lineHeight: 20 },
  costLine: { ...type.bodySmBold, color: theme.text },
  costSub: { ...type.caption, color: theme.textMuted },
});
