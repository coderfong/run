// ParallaxScene — a pixel-art landscape drawn as its separate layers, each
// swaying at its own rate.
//
// The pack ships one opaque sky plus a handful of transparent overlays that
// composite back into the flat picture. Drawing them apart costs four extra
// textures and buys the thing a flat background can never have: depth that
// responds to nothing, quietly, forever. The clouds drift, the trees lean, the
// birds cross; the sky does not move because sky does not.
//
// IT SWAYS, IT DOES NOT SCROLL. A scroll has to loop, a loop needs art that
// tiles horizontally, and this art makes no such promise — a seam sliding
// through the treeline every few seconds is far worse than a gentler effect.
// So each layer eases back and forth over a few pixels on its own clock, and is
// drawn wider than the box so the travel never exposes an edge.
//
// A LANDSCAPE IN A PORTRAIT BOX. The art is 16:9 and a phone is not, so the
// scene is pinned to the BOTTOM at its own aspect and the sky above it is
// continued as flat colour, read off the art by the installer. That is the same
// trick the hand-drawn night stage uses, for the same reason: covering the box
// instead would throw away most of the width and put the horizon somewhere
// behind whatever is docked at the bottom of the screen.
//
// Reduced motion parks every layer at its midpoint. The scene stays; only the
// drift stops.

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from '../ui/image';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '../ui/motion';
import { SCENES, sceneLayerSources } from '../config/scenes';

// How much wider than the box each layer is drawn, so a swaying layer never
// pulls its own edge into view. Has to beat twice the largest amplitude in the
// manifest with room to spare.
const OVERDRAW = 1.16;

function Layer({ source, drift, width, height, playing }) {
  const reduced = useReduceMotion();
  // 0 → 1 → 0. Read as a signed offset in the style below, so a layer's rest
  // position is the middle of its travel rather than one end of it.
  const phase = useSharedValue(0.5);
  const still = reduced || !playing || !drift.seconds || !drift.amplitude;
  const travel = drift.amplitude * width;

  useEffect(() => {
    cancelAnimation(phase);
    if (still) {
      phase.value = 0.5;
      return undefined;
    }
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(1, {
        duration: drift.seconds * 1000,
        // Sinusoidal, so the layer slows into each turn instead of bouncing
        // off it. A linear sway reads as a slide with a hiccup at both ends.
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
    return () => cancelAnimation(phase);
  }, [drift.amplitude, drift.seconds, phase, still]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (phase.value - 0.5) * 2 * travel }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image
        source={source}
        style={{
          position: 'absolute',
          bottom: 0,
          left: (width - width * OVERDRAW) / 2,
          width: width * OVERDRAW,
          height: height * OVERDRAW,
        }}
        resizeMode="stretch"
        fadeDuration={0}
      />
    </Animated.View>
  );
}

/**
 * `scene`   a key from config/scenes (currently 'nature5').
 * `width`   the box to fill. Required — the scene measures nothing.
 * `height`  the box's height. The art is hung from the bottom of it and the
 *           remainder above is filled with the scene's own sky colour.
 * `playing` false parks the drift. Tie it to screen focus; a backdrop swaying
 *           behind a screen nobody is on is battery spent on nothing.
 */
export default function ParallaxScene({ scene = 'nature5', width, height, playing = true, style }) {
  const spec = SCENES[scene];
  const sources = useMemo(() => sceneLayerSources(scene), [scene]);
  if (!spec || !width || !height || !sources.length) return null;

  // The art's own shape at this width. Never taller than the box: a scene that
  // overflowed upward would push its horizon off the top instead of leaving
  // sky, which is the one thing the flat fill above it is there to provide.
  const artHeight = Math.min(height, width / spec.aspect);

  return (
    <View
      pointerEvents="none"
      style={[{ width, height, backgroundColor: spec.sky, overflow: 'hidden' }, style]}
    >
      <View style={{ position: 'absolute', left: 0, bottom: 0, width, height: artHeight }}>
        {sources.map((source, i) => (
          <Layer
            key={spec.layers[i].index}
            source={source}
            drift={spec.layers[i]}
            width={width}
            height={artHeight}
            playing={playing}
          />
        ))}
      </View>
    </View>
  );
}
