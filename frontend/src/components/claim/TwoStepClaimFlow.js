// Two-step claim planning flow: PLACE then ROTATE
//
// This replaces the confusing simultaneous placement+rotation with a clear
// 2-step process that first-time users can understand without instructions.
//
// STEP 1: PLACE - Move the claim along your run route
// STEP 2: ROTATE - Turn the claim to choose your land
// THEN: CLAIM

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';
import Animated, {
  useSharedValue,
  withSpring,
  withTiming,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';

import { CharacterBust } from '../character/CharacterRig';
import { Framed } from '../ui';
import {
  dialPointForHeading,
  headingFromDialPoint,
  turnFromRun,
} from './placement';
import { space, toon, toonRadius, useTheme, useThemedStyles, withAlpha, type, radius, NB, nbInk } from '../../theme';
import { haptic, PressableScale } from '../../ui/motion';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';

// Export step constants for map visualization
export const CLAIM_STEPS = {
  PLACE: 'place',
  ROTATE: 'rotate',
};

// Local fallbacks if theme imports fail
const safeType = type || {
  caption: { fontSize: 11, fontWeight: '500' },
  bodySm: { fontSize: 13, fontWeight: '400' },
  bodySmBold: { fontSize: 13, fontWeight: '600' },
  headlineSm: { fontSize: 16, fontWeight: '600' },
  statSm: { fontSize: 14, fontWeight: '600' },
};

const safeRadius = radius || {
  md: 8,
  pill: 20,
};

const safeNB = NB || {
  strokeThin: 1,
};

const safeNbInk = nbInk || (() => '#ffffff'); // Default to white for dark theme

// Territory has one unit everywhere. Extra precision keeps small steals
// meaningful without making the player mentally convert square metres.
export function landStr(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} km²`;
}

// Internal reference to exported constants
const STEPS = CLAIM_STEPS;

// What each move is called, in the order the server classifies them.
const ACTION_LABEL = {
  empty: 'Claim open ground',
  reinforce: 'Reinforce your land',
  attack: 'Attack rival',
  fortified: 'Storm a defended border',
};

function GroundMetric({ label, value, color, dim }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.metric, { borderLeftColor: color }, dim && styles.metricDim]}>
      <Text style={[styles.metricLabel, dim && { color: D.textDim }]} numberOfLines={1}>{label}</Text>
      <Text
        style={[styles.metricValue, { color: dim ? D.textDim : D.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// STEP 1: PLACE - Route-constrained placement with clear handle
// ---------------------------------------------------------------------------

function PlacementStep({ t, baseT, accent, onChange, onCommit, onInteractionChange, disabled, path }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const tRef = useRef(t);
  tRef.current = t;

  // Animate handle on first appearance to show it's interactive
  const handleOffset = useSharedValue(0);
  const handleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: handleOffset.value }],
  }));

  useEffect(() => {
    // One-time animation to show the handle is draggable
    handleOffset.value = withSpring(15, { damping: 15 }, () => {
      handleOffset.value = withSpring(0, { damping: 15 });
    });
  }, []);

  const pick = useCallback(
    (x, commit) => {
      const w = widthRef.current;
      if (w <= 0) return;
      let next = Math.max(0, Math.min(1, x / w));
      // Magnetism at the resting pose
      if (baseT != null && Math.abs(next - baseT) * w < 8) {
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

  const handleAt = width * Math.max(0, Math.min(1, t));

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepNumber}>STEP 1 OF 2</Text>
        <Text style={styles.stepTitle}>PLACE</Text>
        <Text style={styles.stepSubtitle}>Move along your route</Text>
      </View>

      <View style={styles.railWrap}>
        <View style={styles.railLabels}>
          <Text style={styles.railEnd}>START</Text>
          <Text style={styles.railEnd}>FINISH</Text>
        </View>
        <View
          style={styles.railTouch}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          {...responder.panHandlers}
        >
          <View style={styles.railTrack} pointerEvents="none" />
          <View
            pointerEvents="none"
            style={[styles.railFill, { width: handleAt, backgroundColor: withAlpha(accent, 0.5) }]}
          />
          {baseT != null && width > 0 && (
            <View
              pointerEvents="none"
              style={[styles.restNotch, { left: width * baseT - 1, backgroundColor: D.textDim }]}
            />
          )}
          {width > 0 && (
            <Animated.View
              style={[
                styles.handle,
                { left: handleAt - HANDLE / 2, borderColor: accent, backgroundColor: toon.ink },
                handleAnimatedStyle,
              ]}
              pointerEvents="none"
            >
              <View style={[styles.handleCore, { backgroundColor: accent }]} />
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// STEP 2: ROTATE - Clear rotation control with ring
// ---------------------------------------------------------------------------

const DIAL = 88;
const DIAL_R = DIAL / 2 - 12;

function RotationStep({ deg, accent, onChange, onCommit, onInteractionChange, disabled }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const centre = DIAL / 2;
  const degRef = useRef(deg);
  degRef.current = deg;

  // Animate rotation on first appearance to show it's interactive
  const rotationOffset = useSharedValue(0);
  const rotationAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotationOffset.value}deg` }],
  }));

  useEffect(() => {
    // One-time animation to show rotation is possible
    rotationOffset.value = withTiming(10, { duration: 200 }, () => {
      rotationOffset.value = withTiming(0, { duration: 200 });
    });
  }, []);

  const pick = useCallback(
    (x, y, commit) => {
      const dx = x - centre;
      const dy = y - centre;
      if (Math.hypot(dx, dy) < 10) return;
      let next = headingFromDialPoint(x, y, centre, centre);
      // Gentle snapping at 15° increments
      let snapped = false;
      for (const mark of [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]) {
        if (Math.abs(((next - mark + 540) % 360) - 180) < 5) {
          next = mark;
          snapped = true;
          break;
        }
      }
      if (snapped && Math.round(next) !== Math.round(degRef.current)) haptic.light();
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
          onInteractionChange?.(true);
          pick(e.nativeEvent.locationX, e.nativeEvent.locationY, false);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
        onPanResponderRelease: (e) => {
          pick(e.nativeEvent.locationX, e.nativeEvent.locationY, true);
          onInteractionChange?.(false);
        },
        onPanResponderTerminate: () => {
          onCommit?.(degRef.current);
          onInteractionChange?.(false);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [disabled, onCommit, onInteractionChange, pick]
  );

  const [needleX, needleY] = dialPointForHeading(deg, DIAL_R);
  const nx = centre + needleX;
  const ny = centre + needleY;

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepNumber}>STEP 2 OF 2</Text>
        <Text style={styles.stepTitle}>ROTATE</Text>
        <Text style={styles.stepSubtitle}>Turn to choose your land</Text>
      </View>

      <View style={styles.rotationContainer}>
        <Animated.View style={rotationAnimatedStyle}>
          <View
            style={styles.dialTouch}
            accessibilityLabel="Claim rotator"
            {...responder.panHandlers}
          >
            <Svg width={DIAL} height={DIAL}>
              <Circle cx={centre} cy={centre} r={DIAL_R} fill="none" stroke={D.border} strokeWidth={2} />
              <G>
                {[0, 45, 90, 135, 180, 225, 270, 315].map((m) => {
                  const r = ((m + 90) * Math.PI) / 180;
                  const inner = m % 90 === 0 ? DIAL_R - 7 : DIAL_R - 4;
                  return (
                    <Line
                      key={m}
                      x1={centre + Math.cos(r) * inner}
                      y1={centre - Math.sin(r) * inner}
                      x2={centre + Math.cos(r) * DIAL_R}
                      y2={centre - Math.sin(r) * DIAL_R}
                      stroke={m === 0 ? accent : D.border}
                      strokeWidth={m === 0 ? 2.5 : 1.5}
                    />
                  );
                })}
              </G>
              <Line
                x1={centre}
                y1={centre}
                x2={nx}
                y2={ny}
                stroke={accent}
                strokeWidth={3}
                strokeLinecap="round"
              />
              <Circle cx={nx} cy={ny} r={7} fill={toon.ink} stroke={accent} strokeWidth={2.5} />
              <Circle cx={centre} cy={centre} r={3.5} fill={accent} />
            </Svg>
          </View>
        </Animated.View>
        
        <View style={styles.rotationIcon}>
          <Text style={styles.rotationIconText}>↻</Text>
        </View>
      </View>
    </View>
  );
}

const HANDLE = 32;

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

/**
 * @param pose      {t, deg} — the live pose, owned by the screen
 * @param onPose    (pose, {commit}) — commit is false mid-drag, true on release
 * @param placement the breakdown for (roughly) this pose; may lag a drag
 * @param stale     true while a fresher breakdown is in flight
 * @param onStepChange callback when step changes (for map visualization)
 */
export default function TwoStepClaimFlow({
  options,
  pose,
  onPose,
  placement,
  stale,
  team,
  onInteractionChange,
  disabled,
  onStepChange,
}) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const p = placement;
  const baseT = typeof options?.base_t === 'number' ? options.base_t : 0.5;

  // State machine for 2-step flow
  const [currentStep, setCurrentStep] = useState(CLAIM_STEPS.PLACE);
  const [savedPose, setSavedPose] = useState(pose);

  // Notify parent of step changes for map visualization
  useEffect(() => {
    onStepChange?.(currentStep, pose);
  }, [currentStep, pose, onStepChange]);

  const setT = useCallback((t) => onPose({ ...pose, t }, { commit: false }), [onPose, pose]);
  const commitT = useCallback((t) => onPose({ ...pose, t }, { commit: true }), [onPose, pose]);
  const setDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: false }), [onPose, pose]);
  const commitDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: true }), [onPose, pose]);

  // Navigation between steps
  const goToNextStep = useCallback(() => {
    haptic.medium();
    setSavedPose(pose);
    setCurrentStep(CLAIM_STEPS.ROTATE);
  }, [pose]);

  const goToPreviousStep = useCallback(() => {
    haptic.light();
    setCurrentStep(CLAIM_STEPS.PLACE);
  }, []);

  // What this pose would WIN
  const gained = (p?.new_m2 || 0) + (p?.enemy_m2 || 0) + (p?.ally_m2 || 0);
  const totalGain = gained > 0 ? landStr(gained) : '0.000 km²';

  return (
    <View>
      {/* Live claim preview - always visible */}
      <Framed
        frame={frameVariant('box', 'ground-score')}
        tint={team.glow}
        fill={D.cardAlt}
        weight={INK.thin}
        pose={framePose('ground-score')}
        inset={space.xs}
        style={[styles.breakdownFrame, stale && styles.breakdownStale]}
        contentStyle={styles.breakdown}
      >
        <GroundMetric label="NEW" value={landStr(p?.new_m2)} color={team.glow} dim={!p?.new_m2} />
        <GroundMetric label="ENEMY" value={landStr(p?.enemy_m2)} color={D.danger} dim={!p?.enemy_m2} />
        <GroundMetric label="YOURS" value={landStr(p?.mine_m2)} color={withAlpha(team.glow, 0.5)} dim={!p?.mine_m2} />
        <GroundMetric label="GAIN" value={totalGain} color={team.glow} dim={!gained} />
      </Framed>

      {/* Step-specific controls */}
      {currentStep === STEPS.PLACE ? (
        <>
          <PlacementStep
            t={pose.t}
            baseT={baseT}
            accent={team.glow}
            onChange={setT}
            onCommit={commitT}
            onInteractionChange={onInteractionChange}
            disabled={disabled}
          />
          <PressableScale
            disabled={disabled}
            onPress={goToNextStep}
            accessibilityRole="button"
            accessibilityLabel="Next step: rotate claim"
            style={styles.nextButton}
          >
            <Text style={styles.nextButtonText}>NEXT: ROTATE  →</Text>
          </PressableScale>
        </>
      ) : (
        <>
          <RotationStep
            deg={pose.deg}
            accent={team.glow}
            onChange={setDeg}
            onCommit={commitDeg}
            onInteractionChange={onInteractionChange}
            disabled={disabled}
          />
          <View style={styles.rotationButtons}>
            <PressableScale
              onPress={goToPreviousStep}
              accessibilityRole="button"
              accessibilityLabel="Back to placement"
              style={[styles.backButton, styles.secondaryButton]}
            >
              <Text style={styles.backButtonText}>BACK TO PLACE</Text>
            </PressableScale>
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STYLES
// ---------------------------------------------------------------------------

const makeStyles = (theme) => ({
  stepContainer: {
    marginTop: space.md,
  },
  stepHeader: {
    marginBottom: space.sm,
  },
  stepNumber: {
    fontSize: 11,
    fontWeight: '500',
    color: theme.textMuted,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 2,
  },
  stepSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: theme.textMuted,
  },
  
  // Rail styles
  railWrap: {
    marginTop: space.sm,
  },
  railLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  railEnd: {
    ...safeType.caption,
    color: theme.textMuted,
  },
  railTouch: {
    height: 48,
    position: 'relative',
  },
  railTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 23,
    height: 2,
    backgroundColor: theme.border,
  },
  railFill: {
    position: 'absolute',
    left: 0,
    top: 23,
    height: 2,
  },
  restNotch: {
    position: 'absolute',
    top: 19,
    width: 2,
    height: 10,
  },
  handle: {
    position: 'absolute',
    top: 8,
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  // Rotation styles
  rotationContainer: {
    alignItems: 'center',
    marginTop: space.sm,
    position: 'relative',
  },
  dialTouch: {
    width: DIAL,
    height: DIAL,
  },
  rotationIcon: {
    position: 'absolute',
    right: -10,
    top: '50%',
    marginTop: -12,
  },
  rotationIconText: {
    fontSize: 20,
    color: theme.textMuted,
  },
  
  // Breakdown
  breakdownFrame: {
    marginBottom: space.md,
  },
  breakdownStale: {
    opacity: 0.6,
  },
  breakdown: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: 3,
    paddingLeft: space.xs + 2,
  },
  metricDim: {
    opacity: 0.5,
  },
  metricLabel: {
    ...safeType.caption,
    color: theme.textMuted,
    marginBottom: 2,
  },
  metricValue: {
    ...safeType.statSm,
    color: theme.text,
  },
  
  // Buttons
  // A secondary control: CLAIM HERE below is the one primary action, and a
  // full-width NEXT bar right above it read as a second, competing CTA.
  nextButton: {
    marginTop: space.xs,
    marginBottom: space.md,
    alignSelf: 'flex-end',
    backgroundColor: 'transparent',
    borderWidth: safeNB.strokeThin,
    borderColor: theme.border,
    borderRadius: safeRadius.pill,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  nextButtonText: {
    ...safeType.bodySmBold,
    color: theme.text,
    letterSpacing: 0.6,
  },
  rotationButtons: {
    marginTop: space.sm,
    marginBottom: space.md,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  backButton: {
    flex: 1,
    backgroundColor: theme.cardAlt,
    borderWidth: safeNB.strokeThin,
    borderColor: safeNbInk(),
    borderRadius: safeRadius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    alignItems: 'center',
  },
  backButtonText: {
    ...safeType.bodySmBold,
    color: theme.textMuted,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
  },
});