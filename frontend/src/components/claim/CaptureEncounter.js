// The clash: what direct character contact looks like when it lands.
//
// This file used to be the universal pre-animation. Every claim, whatever its
// style, opened here: the attacker slid in from the left, sized up whoever was
// standing there, dashed, knocked them spinning, and the style's own event
// then played over an empty field. Fifteen styles, one encounter, and rivals
// who were removed from the scene before the thing that took their ground had
// started.
//
// Its responsibility is now much smaller, and it is no longer in charge of
// when. A style asks for contact with a `contact` step (only a DUEL may — see
// validateChoreography), the player fires it at the moment the style chose, and
// what arrives here is the flourish AT the point of contact: the impact burst,
// the speed streaks behind the runner, and the `onImpact` callback.
//
// The BODIES are not here any more. CaptureCast owns one rig per character for
// the whole cutscene, and the dash and the fall are ordinary actor beats the
// duel styles author like any other beat — which is what lets Sword Slash keep
// a clash while Meteor Claim cannot accidentally inherit one.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CAPTURE_LAYER } from '../../effects/layers';
import { useTheme, useThemedStyles } from '../../theme';
import EffectPlayer from '../../effects/EffectPlayer';

// The box the flourish is laid out in, centred on the contact point.
const SCENE = { width: 224, height: 148 };

// How long after mounting the contact reads as landed. The style has already
// timed its dash to arrive here, so this is the width of the hit itself rather
// than a schedule anybody waits on.
const IMPACT_AT = 120;
const CLEAR_AT = 620;

// Keep the flourish inside the map card so nothing is clipped by its edges.
function clampOrigin(point, bounds) {
  if (!bounds?.width || !bounds?.height) return point;
  const halfW = SCENE.width / 2;
  const halfH = SCENE.height / 2;
  // A map card narrower than the scene can't satisfy both margins — centring
  // is the least-bad answer, and Math.max keeps the range non-inverted.
  const minX = Math.min(halfW + 6, bounds.width / 2);
  const maxX = Math.max(minX, bounds.width - halfW - 6);
  const minY = Math.min(halfH + 6, bounds.height / 2);
  const maxY = Math.max(minY, bounds.height - halfH - 6);
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  };
}

function CaptureEncounter({
  visible,
  variant = 'grin-knock',
  // Where the contact happens. Defaults to the claim point, but a duel style
  // aims it at the rival it is actually crossing.
  claimScreenPoint,
  contactPoint,
  bounds,
  onImpact,
  onComplete,
  reducedMotion = false,
  playToken = 0,
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  // Callbacks change identity every render in the parent; refs keep the
  // timeline effect from re-running (and re-firing impact) because of it.
  const impactRef = useRef(onImpact);
  const completeRef = useRef(onComplete);
  impactRef.current = onImpact;
  completeRef.current = onComplete;

  const timers = useRef(new Set());
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const streakOpacity = useSharedValue(0);
  const [impactFx, setImpactFx] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;
    clearTimers();
    streakOpacity.value = 0;

    if (!reducedMotion) {
      // Behind the runner, and gone almost immediately. A streak that outlives
      // the hit reads as a smear rather than speed.
      streakOpacity.value = withSequence(
        withTiming(1, { duration: 60 }),
        withTiming(0, { duration: 240 })
      );
    }

    const hit = setTimeout(() => {
      timers.current.delete(hit);
      setImpactFx((token) => token + 1);
      impactRef.current?.();
    }, reducedMotion ? 40 : IMPACT_AT);
    timers.current.add(hit);

    const done = setTimeout(() => {
      timers.current.delete(done);
      completeRef.current?.();
    }, reducedMotion ? 160 : CLEAR_AT);
    timers.current.add(done);

    return clearTimers;
  }, [visible, playToken, reducedMotion, clearTimers, streakOpacity]);

  const streakStyle = useAnimatedStyle(() => ({ opacity: streakOpacity.value }));

  const point = contactPoint || claimScreenPoint;
  if (!visible || !point) return null;

  const origin = clampOrigin(point, bounds);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.scene,
        { left: origin.x - SCENE.width / 2, top: origin.y - SCENE.height / 2 },
      ]}
    >
      {impactFx > 0 ? (
        <EffectPlayer
          effect="seedance_brawl_clash"
          size={variant === 'chomp' ? 120 : 138}
          playToken={impactFx}
          reducedMotion={reducedMotion}
          style={styles.impactEffect}
        />
      ) : null}

      {!reducedMotion && (
        <Animated.View style={[styles.streaks, streakStyle]} pointerEvents="none">
          <View style={[styles.streak, { top: 6, width: 26, backgroundColor: colors.text }]} />
          <View style={[styles.streak, { top: 18, width: 38, backgroundColor: colors.text }]} />
          <View style={[styles.streak, { top: 30, width: 20, backgroundColor: colors.text }]} />
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  scene: {
    position: 'absolute',
    zIndex: CAPTURE_LAYER.FOREGROUND_FX,
    width: SCENE.width,
    height: SCENE.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  impactEffect: { position: 'absolute', zIndex: 2 },
  streaks: {
    position: 'absolute',
    left: SCENE.width / 2 - 74,
    top: SCENE.height / 2 - 20,
    width: 44,
    height: 44,
  },
  streak: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    opacity: 0.8,
  },
});

// Memoized for the same reason as CaptureStylePlayer (see that file's note).
export default React.memo(CaptureEncounter);
