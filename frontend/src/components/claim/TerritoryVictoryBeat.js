// The victory beat — the runner standing on the ground they just took, before
// the numbers arrive.
//
// Uses the full CharacterRig (not a bust) because this beat calls the app's
// existing celebration: `rig.play('celebrate')`. The rig no-ops that under
// Reduce Motion on its own, so this component does not special-case it.
//
// The label reuses TerritoryStealBanner's visual language — outlined toon text
// and the steal glyph — rather than the banner itself. The full bomb-and-blast
// playout stays exclusively in ClaimPayoff, so a steal is never announced
// twice with two competing banners.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { toon, toonType } from '../../theme';
import { CAPTURE_LAYER } from '../../effects/layers';
import AppIcon from '../AppIcon';
import { AnimationStack } from '../GameAnimation';
import CharacterRig from '../character/CharacterRig';
import { OutlinedText } from '../ui';
import { withFace } from './expressions';
import { ringsToPath } from './geometry';
import { timingFor } from './timing';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const RIG_SIZE = 54;
const FX_SIZE = 170;
// The rig draws its body plus headroom for tall hair.
const RIG_HEIGHT = RIG_SIZE * 2.58 * 1.14;

/**
 * Which headline this claim earned. Empty ground is never "stolen" — there was
 * nobody to steal it from.
 */
export function victoryLabel(claim) {
  const victims = claim?.victims || [];
  const taken = victims.filter((v) => !v.defended);
  if (taken.length > 0) return 'TERRITORY STOLEN';
  if (victims.length > 0) return 'TERRITORY CAPTURED';
  return 'NEW TERRITORY';
}

// The shields are deliberately absent. A red shield over a claim you just WON
// reads as a warning — as if something had gone wrong or the ground were about
// to be taken back — which is the opposite of what this beat is for. The
// impact and the smoke already say "this was taken off somebody"; the badge
// on top only muddied it.
function victoryEffects(label) {
  if (label === 'TERRITORY STOLEN') return ['impactRed', 'smokePuff'];
  if (label === 'TERRITORY CAPTURED') return ['impactGold', 'bubbleBurst'];
  return ['victoryRays', 'bubbleBurst'];
}

export default function TerritoryVictoryBeat({
  visible,
  attacker,
  rings,
  claimScreenPoint,
  bounds,
  label,
  strokeColor = '#EC4899',
  reducedMotion = false,
  playToken = 0,
  onComplete,
}) {
  const T = timingFor(reducedMotion);
  const rigRef = useRef(null);
  const timers = useRef(new Set());
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const drop = useSharedValue(reducedMotion ? 0 : -46);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const opacity = useSharedValue(0);
  const labelScale = useSharedValue(0.7);
  const labelOpacity = useSharedValue(0);
  const pulse = useSharedValue(0);

  const outlinePath = useMemo(() => (rings ? ringsToPath(rings) : null), [rings]);

  useEffect(() => {
    if (!visible) return undefined;

    const track = (id) => { timers.current.add(id); return id; };
    const clearTimers = () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
    clearTimers();

    const landAt = reducedMotion ? 90 : 260;

    opacity.value = withTiming(1, { duration: 110 });
    labelOpacity.value = 0;
    labelScale.value = 0.7;
    pulse.value = 0;

    if (reducedMotion) {
      drop.value = 0;
      squashX.value = 1;
      squashY.value = 1;
    } else {
      // 1 + 2. drop onto the front of the territory and land with a squash
      drop.value = withSequence(
        withTiming(0, { duration: landAt, easing: Easing.in(Easing.quad) }),
        withSpring(0, { damping: 12, stiffness: 300, mass: 0.5 })
      );
      squashX.value = withDelay(
        landAt,
        withSequence(
          withTiming(1.18, { duration: 80 }),
          withSpring(1, { damping: 12, stiffness: 300, mass: 0.45 })
        )
      );
      squashY.value = withDelay(
        landAt,
        withSequence(
          withTiming(0.82, { duration: 80 }),
          withSpring(1, { damping: 12, stiffness: 300, mass: 0.45 })
        )
      );
    }

    // 3 + 4 + 5. border pulse, the app's own celebration, victory face
    track(setTimeout(() => {
      rigRef.current?.play('celebrate');
      pulse.value = withSequence(
        withTiming(1, { duration: 130 }),
        withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) })
      );
    }, landAt));

    // 6. the headline
    track(setTimeout(() => {
      labelOpacity.value = withTiming(1, { duration: 120 });
      labelScale.value = reducedMotion
        ? withTiming(1, { duration: 120 })
        : withSequence(
            withTiming(1.12, { duration: 130 }),
            withSpring(1, { damping: 13, stiffness: 260, mass: 0.45 })
          );
    }, landAt + 60));

    // 7. hold, then hand over to the payoff
    track(setTimeout(() => completeRef.current?.(), T.victoryBeat));

    return clearTimers;
  }, [visible, playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach(clearTimeout);
      set.clear();
    };
  }, []);

  const rigStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: drop.value },
      { scaleX: squashX.value },
      { scaleY: squashY.value },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ scale: labelScale.value }],
  }));

  const pulseProps = useAnimatedProps(() => ({
    strokeWidth: 2 + pulse.value * 9,
    strokeOpacity: 0.85 * pulse.value,
  }));

  const equipped = useMemo(() => withFace(attacker, 'victory'), [attacker]);

  if (!visible || !claimScreenPoint) return null;

  // Stand on the front (lower) portion of the territory, clamped so the
  // character and the label never leave the map card.
  const maxY = bounds?.height ? bounds.height - 12 : Infinity;
  const maxX = bounds?.width ? bounds.width - 70 : Infinity;
  const footY = Math.min(claimScreenPoint.y + 34, maxY);
  const centerX = Math.min(Math.max(claimScreenPoint.x, 70), maxX);
  const fxLeft = Math.max(0, Math.min(centerX - FX_SIZE / 2, (bounds?.width || FX_SIZE) - FX_SIZE));
  const fxTop = Math.max(0, footY - FX_SIZE + 20);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: CAPTURE_LAYER.VICTORY }]}>
      {/* 3. one pulse of the territory border, drawn from the same projected
          rings the reveal used */}
      {outlinePath && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <AnimatedPath
            d={outlinePath}
            fill="none"
            stroke={strokeColor}
            strokeLinejoin="round"
            animatedProps={pulseProps}
          />
        </Svg>
      )}

      <AnimationStack
        names={victoryEffects(label)}
        size={FX_SIZE}
        trigger={playToken}
        style={[styles.fxAnchor, { left: fxLeft, top: fxTop }]}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.rigAnchor,
          { left: centerX - RIG_SIZE / 2, top: footY - RIG_HEIGHT },
          rigStyle,
        ]}
      >
        <CharacterRig ref={rigRef} equipped={equipped} size={RIG_SIZE} />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[styles.label, { top: Math.max(8, footY - RIG_HEIGHT - 34) }, labelStyle]}
      >
        <OutlinedText style={[toonType.label, styles.labelText]} outline={toon.ink} width={2}>
          {label}
        </OutlinedText>
        {label === 'TERRITORY STOLEN' && <AppIcon name="steal" size={15} style={styles.labelIcon} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fxAnchor: { position: 'absolute' },
  rigAnchor: { position: 'absolute' },
  label: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelText: { color: '#fff' },
  labelIcon: { marginLeft: 6 },
});
