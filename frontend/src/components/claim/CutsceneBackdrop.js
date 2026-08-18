// The stage a capture is played on: the contested map itself, pushed back.
//
// WAS a solid black full-screen view, and it was wrong in two separate ways.
//
// 1. It disconnected the animation from the thing being captured. The sequence
//    flew the camera to the contested polygon and then covered it, so the shape
//    the whole cutscene was about was not on screen while the cutscene played:
//    map, black void fight, map suddenly returns. Nothing in the middle looked
//    like it was happening anywhere.
//
// 2. It was drawn ABOVE the territory reveal. `CAPTURE_LAYER.CUTSCENE_BACKDROP`
//    was 24 and `TERRITORY_REVEAL` is 20, and the black was opaque, so the
//    ground changing hands — the payoff, the one beat the entire sequence
//    exists to deliver — was painted underneath a curtain. The curtain was
//    gated on a defender exit action, which every style fires several hundred
//    ms to two seconds AFTER its reveal cue, so by the time the map came back
//    the wipe had already finished and the territory just WAS a different
//    colour. That is most of "I cannot see how the attack caused the territory
//    to change": it did not visibly cause it, because it happened off camera.
//
// Now it is a scrim at `CAPTURE_LAYER.MAP_SCRIM` (18), UNDER the reveal. The
// map stays legible at roughly a third of its normal presence — enough to read
// as the streets being fought over, quiet enough that the characters and the
// one hero effect are unmistakably the subject — and the ground turns over ON
// TOP of it, in full strength, while the scrim is still down.
//
// The colour is the app's own darkest ink rather than pure black: over a dark
// map a pure-black wash is invisible, and over a light one it reads as a hole
// punched in the screen.

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CAPTURE_LAYER } from '../../effects/layers';

const FADE_IN_MS = 260;
const FADE_OUT_MS = 420;

// How much of the map is left readable underneath. 0.68 opacity leaves the
// contested shape at roughly 32% presence, inside the 20-35% the composition
// is designed around.
export const SCRIM_OPACITY = 0.68;
export const SCRIM_COLOR = '#05070C';

function CutsceneBackdrop({ active, playToken, reducedMotion = false, opacity: target = SCRIM_OPACITY }) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    const to = active ? target : 0;
    if (reducedMotion) {
      opacity.value = to;
      return;
    }
    opacity.value = withTiming(to, {
      duration: active ? FADE_IN_MS : FADE_OUT_MS,
      easing: active ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
    });
  }, [active, playToken, reducedMotion, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: SCRIM_COLOR, zIndex: CAPTURE_LAYER.MAP_SCRIM },
        style,
      ]}
    />
  );
}

// Memoized for the same reason as CaptureStylePlayer (see that file's note).
export default React.memo(CutsceneBackdrop);
