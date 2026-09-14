// The tier's world, as a window across a rank ceremony (the promotion and the
// demotion both).
//
// IT SITS ABOVE THE BADGE, NEVER BEHIND IT. The promotion used to stand the
// runner's portrait in the middle of this band, on the idea that the
// illustration's own runner should hide behind yours. What that actually did
// was cover the one picture each tier has: a promotion to Gold showed your own
// face in a gold frame with a strip of coins either side, and none of the
// scene. Nothing is drawn on top of the art now.
//
// AT THE ART'S OWN 16:9 (config/rankArt.js), not a letterbox cut from it. The
// crop only existed to tuck that runner's head under the badge, and it threw
// away the top of every scene with it; Mythic's crown sat inside the strip it
// lost.
//
// FEATHERED AT THE TOP AND BOTTOM EDGES ONLY, into the page's own ink, so the
// band reads as a window rather than a photograph laid on the screen. The
// middle used to carry a wash of the ink as well, for type that read over it,
// and no type reads over it now. The feather is kept short because the scenes
// run close to their edges: Gold's crown near the top, the watchers along the
// foot of Mythic.

import React from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { RANK_ART_ASPECT, rankArt } from '../../config/rankArt';
import { Image } from '../../ui/image';

/**
 * @param {string} tierKey  whose world
 * @param {string} ink      the page colour the edges fade into
 * @param {number} width    the band's width; its height follows the art
 * @param {object} style    the ceremony's animated style (they fade it in)
 */
export default function RankWorld({ tierKey, ink, width, style }) {
  const art = rankArt(tierKey);
  // No art in the build: no band, and the ceremony is the badge on its own,
  // which is what it was before there were illustrations.
  if (!art) return null;

  const height = Math.round(width / RANK_ART_ASPECT);
  const fade = `rankworld-${tierKey}`;
  return (
    <Animated.View style={[{ width, height }, style]} pointerEvents="none">
      <Image
        source={art.source}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        transition={0}
        accessible={false}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ink} stopOpacity="1" />
            <Stop offset="0.04" stopColor={ink} stopOpacity="0.35" />
            <Stop offset="0.1" stopColor={ink} stopOpacity="0" />
            <Stop offset="0.9" stopColor={ink} stopOpacity="0" />
            <Stop offset="0.96" stopColor={ink} stopOpacity="0.35" />
            <Stop offset="1" stopColor={ink} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill={`url(#${fade})`} />
      </Svg>
    </Animated.View>
  );
}
