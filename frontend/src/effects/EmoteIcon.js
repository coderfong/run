// One emote, held still.
//
// The emote art is a six frame loop, and most places that want an emote do NOT
// want it looping: a feed row can carry half a dozen reaction chips, a picker
// shows eight tiles at once, and a comment can have a sticker beside it. Run
// those as animations and a single screen is playing thirty sprite clocks off
// the frame callback to draw thirty things that are not moving in any way the
// eye is meant to follow.
//
// So this draws ONE frame as a plain clipped Image. No animation, no worklet,
// no reanimated at all — the cost is the same as any other small icon. The
// animated version (EffectPlayer via ReactionEffect) is kept for the moment a
// reaction is actually LEFT, which is the only time the motion means anything.

import React from 'react';
import { StyleSheet, View } from 'react-native';

// expo-image, like the rest of the app's art (see ui/image.js).
import { Image } from '../ui/image';
import { getEffect } from './effectRegistry';
import { getReactionEffect, REACTION_STILL_FRAME_INDEX } from './reactionRegistry';

/**
 * `reaction` a key from the reaction registry ('love', 'brutal', …).
 * `size`     the height to draw at; the width follows the frame's own shape
 *            rather than being forced square, so a pack with non-square cells
 *            is not squashed. The current sheets are 32x32, so it is a wash.
 * `frame`    override which frame is held. Defaults to the settled pose.
 */
export default function EmoteIcon({ reaction, size = 28, frame, style, opacity = 1 }) {
  const spec = getEffect(getReactionEffect(reaction));
  if (!spec?.source || !spec.frameWidth || !spec.frameHeight) return null;

  const index = Math.min(
    Math.max(0, Number.isInteger(frame) ? frame : REACTION_STILL_FRAME_INDEX),
    (spec.frameCount || 1) - 1
  );
  const columns = Math.max(1, spec.columns || 1);
  const scale = size / spec.frameHeight;
  const width = spec.frameWidth * scale;

  return (
    <View
      pointerEvents="none"
      style={[styles.window, { width, height: size, opacity }, style]}
    >
      <Image
        source={spec.source}
        resizeMode="stretch"
        fadeDuration={0}
        style={[
          styles.sheet,
          {
            width: columns * spec.frameWidth * scale,
            height: Math.max(1, spec.rows || 1) * spec.frameHeight * scale,
            transform: [
              { translateX: -(index % columns) * width },
              { translateY: -Math.floor(index / columns) * size },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  window: { overflow: 'hidden' },
  sheet: { position: 'absolute', left: 0, top: 0, imageRendering: 'pixelated' },
});
