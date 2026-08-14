// A solid black stage behind the character cutscene — not another
// choreography environment primitive, on purpose. See the note on
// CAPTURE_LAYER.CUTSCENE_BACKDROP in effects/layers.js: EnvironmentLayer's
// "ground" instance renders INSIDE CaptureStylePlayer, whose own container
// carries FOREGROUND_FX so its air-level primitives (flash, dust) can cover
// the cast — which means anything drawn there, however "ground-level" it is
// nominally meant to be, actually paints ABOVE the characters. A full-screen
// opaque view is the one ground primitive where that mistake is impossible to
// miss, so this is a real sibling of CaptureCast instead, given its own
// zIndex that is genuinely compared against CHARACTER.
//
// Active for exactly the character-performance portion of the cutscene
// (`isEncounterPhase`) and not a moment longer: it fades out as the phase
// machine reaches TERRITORY_REVEAL, so the ground actually changing colour
// plays against the real scene, not hidden under black until the end.

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CAPTURE_LAYER } from '../../effects/layers';

const FADE_IN_MS = 200;
const FADE_OUT_MS = 280;

export default function CutsceneBackdrop({ active, playToken, reducedMotion = false }) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = active ? 1 : 0;
      return;
    }
    opacity.value = withTiming(active ? 1 : 0, {
      duration: active ? FADE_IN_MS : FADE_OUT_MS,
      easing: active ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
    });
  }, [active, playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: '#000000', zIndex: CAPTURE_LAYER.CUTSCENE_BACKDROP },
        style,
      ]}
    />
  );
}
