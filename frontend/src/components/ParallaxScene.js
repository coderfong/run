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
// A LANDSCAPE IN A PORTRAIT BOX. The art is 16:9, a phone is about 9:19.5, and
// there is no arrangement that keeps all of both. Drawn at its own aspect the
// scene covers barely a quarter of the screen and everything above it is a flat
// slab of sky; filling more height means cropping width. There is no third
// option, so the scene says which it wants: `cover` is the fraction of the box
// height the art fills, and `focusX` is the part of the frame that survives the
// crop. The meadow crops left of centre because its trees are the only thing in
// it with a silhouette and they sit a third of the way across.
//
// Whatever is left above the art is filled with the art's own top colour, read
// off layer one by the installer, so the join never shows.
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

function Layer({ source, drift, box, travel, playing }) {
  const reduced = useReduceMotion();
  // 0 → 1 → 0. Read as a signed offset in the style below, so a layer's rest
  // position is the middle of its travel rather than one end of it.
  const phase = useSharedValue(0.5);
  const still = reduced || !playing || !drift.seconds || !drift.amplitude;

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
          left: box.left,
          width: box.width,
          height: box.height,
        }}
        resizeMode="stretch"
        fadeDuration={0}
      />
    </Animated.View>
  );
}

/**
 * Where the art is drawn inside the box, in points.
 *
 * Exported because this is the whole of the "landscape in a portrait box"
 * decision and it is much easier to hold to a rule in a test than by eye:
 *
 *   - the art fills at least `cover` of the box height;
 *   - it keeps its aspect exactly, so nothing is ever stretched;
 *   - it is wide enough that the sway can never pull an edge into view;
 *   - the crop it needs is taken around `focusX` rather than centred, and is
 *     clamped so the focal point cannot push an edge inside the box either.
 */
export function sceneBox({ width, height, aspect, cover = 0.58, focusX = 0.5, travel = 0 }) {
  const artHeight = Math.max(width / aspect, height * cover);
  // Wide enough for the crop AND for the drift. A layer that swayed further
  // than its own slack would show the box's background at the turn.
  const artWidth = Math.max(artHeight * aspect, width + travel * 2);
  const slack = artWidth - width;
  // `focusX` says which part of the art the crop keeps: 0 pins its left edge,
  // 1 its right, 0.5 centres. Then held back from both ends by `travel`, so the
  // sway always has somewhere to go — without that clamp a focus of 0 would
  // show the box's own background the first time the layer drifted right.
  const wanted = -slack * focusX;
  const left = Math.min(-travel, Math.max(-(slack - travel), wanted));
  return { left, width: artWidth, height: artWidth / aspect };
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
  // ONE box for every layer. They are the same picture cut into planes, so they
  // have to be drawn at the same size and offset or they stop lining up; only
  // the sway differs. The slack is sized for the busiest layer, which means
  // every quieter one has slack to spare.
  //
  // Amplitudes are fractions of the BOX width, here and in `Layer`. That has to
  // match: measuring travel against the (larger) art width in one place and the
  // box width in the other is how a layer ends up drifting further than the
  // slack that was reserved for it.
  const box = useMemo(() => {
    if (!spec || !width || !height) return null;
    const travel = Math.max(...spec.layers.map((l) => l.amplitude)) * width;
    return sceneBox({
      width, height, aspect: spec.aspect, cover: spec.cover, focusX: spec.focusX, travel,
    });
  }, [spec, width, height]);

  if (!spec || !box || !sources.length) return null;

  return (
    <View
      pointerEvents="none"
      style={[{ width, height, backgroundColor: spec.sky, overflow: 'hidden' }, style]}
    >
      {sources.map((source, i) => (
        <Layer
          key={spec.layers[i].index}
          source={source}
          drift={spec.layers[i]}
          box={box}
          travel={spec.layers[i].amplitude * width}
          playing={playing}
        />
      ))}
    </View>
  );
}
