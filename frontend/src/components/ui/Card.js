// Card — the one elevated surface. Light: white + soft card shadow, no
// border. Dark: raised surface step, no shadow, no border (constitution:
// never border + shadow together; dark uses surface steps for depth).
//
// `frame` swaps that quiet surface for a HAND-DRAWN box (assets/frames). The
// two are alternatives, not layers: a framed card drops its radius, its shadow
// AND its background, because the frame brings all three of its own. The ink is
// the edge, and the frame's paper layer is the fill — cut from the outline's own
// silhouette, so it stops exactly where the line does.
//
// That last part used to be a fudge. The card painted its own rectangle behind
// the frame and kept a border radius purely to stop the corners of that
// rectangle poking out past the wobbly ink. It mostly worked, and it meant a
// framed card was always two shapes that had to be kept in agreement. The paper
// layer is the actual answer, so the fill, the radius and the fudge all go.

import React, { useState } from 'react';
import { View } from 'react-native';

import { darkColors, radius, shadow, space, useTheme } from '../../theme';
import { PressableScale } from '../../ui/motion';
import ArtFrame from '../../ui/ArtFrame';
import { INK, framePadding, getFrame, weightScale } from '../../ui/frameRegistry';

export default function Card({
  children,
  dark = false,
  padded = true,
  onPress,
  frame,
  frameTint,
  // Points of line, not a multiplier on whichever drawing turned up — see
  // `weightScale`. A card and the button under it are the same pen now.
  frameWeight = INK.base,
  frameScale = 1,
  framePose = 0,
  frameBoil = false,
  style,
  ...rest
}) {
  const { colors, scheme } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const isDark = dark || scheme === 'dark';
  const spec = frame ? getFrame(frame) : null;
  const fill = dark ? darkColors.card : colors.card;
  const drawScale = frame ? frameScale * weightScale(frame, frameWeight) : frameScale;

  const surface = spec ? {
    // No background and no radius: the frame's paper is the fill, and it is
    // already the right shape. A rectangle here would sit UNDER the paper and
    // show at the corners, which is the exact problem the paper layer exists
    // to solve.
    // Padded to clear the LINE, per side, which is not the same number as the
    // nine slice inset — see `framePadding`. The extra is small because a drawn
    // box is already visually generous: the ink itself reads as padding.
    ...(padded ? framePadding(frame, space.sm, drawScale) : null),
  } : {
    backgroundColor: fill,
    borderRadius: radius.card,
    padding: padded ? space.lg : 0,
    ...(isDark ? {} : shadow.card),
  };

  const onLayout = spec
    ? (event) => {
      const { width, height } = event.nativeEvent.layout;
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    }
    : undefined;

  // Two halves of one frame, sandwiching the content: the paper is the card's
  // surface and belongs behind the text, the ink is its edge and belongs in
  // front. Both are absolutely positioned over the whole card, so the order
  // they appear in here is the whole of the stacking.
  const sheet = (layer) => (spec ? (
    <ArtFrame
      name={frame}
      layer={layer}
      width={size.width}
      height={size.height}
      tint={frameTint || colors.textMuted}
      fill={fill}
      scale={drawScale}
      opacity={0.9}
      pose={framePose}
      boil={frameBoil}
    />
  ) : null);

  const Box = onPress ? PressableScale : View;
  return (
    <Box
      style={[surface, style]}
      onPress={onPress}
      onLayout={onLayout}
      {...rest}
    >
      {sheet('paper')}
      {children}
      {sheet('ink')}
    </Box>
  );
}
