// Card — the one elevated surface, and now the app's canonical neo-brutalist
// box: a heavy stroke with a hard zero-blur drop offset down-right. Both are
// picked against the card's own fill rather than off the scheme, so the same
// component reads correctly on paper, on the dark page, and as a `dark` card
// inside the light scheme. See `toonSurface`.
//
// The old rule here was "never border + shadow together, and dark gets depth
// from surface steps instead of shadows". That was written about SOFT shadows,
// which genuinely do nothing on a near-black page. This drop is a solid offset
// block in a saturated accent, so neither half of it applies.
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
import { StyleSheet, View } from 'react-native';

import { darkColors, radius, space, toonSurface, useTheme } from '../../theme';
import { PressableScale, PressableShift } from '../../ui/motion';
import ArtFrame from '../../ui/ArtFrame';
import { INK, framePadding, getFrame, weightScale } from '../../ui/frameRegistry';
import { frameInkFor } from './Framed';
import HardShadow from './HardShadow';

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
  // Taken by name rather than left in `rest`: a framed card measures itself to
  // size its own artwork, and `rest` is spread AFTER that handler — so a caller
  // that wanted to know where its card landed would silently replace the
  // measurement and the frame would draw at zero by zero.
  onLayout: onLayoutProp,
  ...rest
}) {
  const { colors, scheme } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const spec = frame ? getFrame(frame) : null;
  const fill = dark ? darkColors.card : colors.card;
  // Only consulted on the unframed path. A framed card must NOT also get a
  // stroke and a drop: the frame is already the edge and already the depth, and
  // stacking the two gives a hand-drawn box with a machine-drawn box printed
  // just inside it. Frames and neo-brutalist strokes are alternatives, which is
  // the same rule this file already applies to the fill and the radius.
  const nb = toonSurface(colors, scheme, { on: fill });
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
    // The unframed card is now the neo-brutalist box: heavy stroke plus the hard
    // offset drop, which the HardShadow wrapper below paints rather than this
    // style. `on: fill` is what makes the stroke work in both schemes without a
    // branch here — it is chosen against the card's OWN surface, so a `dark`
    // card sitting in the light scheme gets the cream stroke it needs rather
    // than the black one the scheme would have picked.
    ...nb.outline,
  };

  const onLayout = (spec || onLayoutProp)
    ? (event) => {
      if (spec) {
        const { width, height } = event.nativeEvent.layout;
        const next = { width: Math.round(width), height: Math.round(height) };
        setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
      }
      onLayoutProp?.(event);
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
      // Judged against the card's own paper, so a clan tint that would vanish
      // on white (or the muted line that would vanish on a dark card) is
      // swapped for an ink that shows. See `frameInkFor`.
      tint={frameInkFor({ tint: frameTint || colors.textMuted, surface: fill, scheme })}
      fill={fill}
      scale={drawScale}
      opacity={0.9}
      pose={framePose}
      boil={frameBoil}
    />
  ) : null);

  if (spec) {
    const Box = onPress ? PressableScale : View;
    return (
      <Box style={[surface, style]} onPress={onPress} onLayout={onLayout} {...rest}>
        {sheet('paper')}
        {children}
        {sheet('ink')}
      </Box>
    );
  }

  // The unframed card, wrapped in its own hard shadow.
  //
  // HardShadow rather than `nb.shadow` for the same two reasons Button uses it:
  // Android cannot render a zero-blur offset drop from style props at all, and
  // a pressable card has to slide INTO a shadow that stays put — an iOS layer
  // shadow travels with its layer, so the press would move card and shadow
  // together and never land.
  //
  // `style` has to be split for this. Anything that positions the card in its
  // parent (margins, absolute placement, self-alignment) belongs on the WRAPPER,
  // or the shadow block is measured against a box that has already been moved
  // and lands somewhere the card is not. Everything else — padding, fills,
  // radius — stays on the card itself. Callers pass both: a `marginBottom` on
  // every feed row, and Crossroads positions its settings card absolutely.
  const [outer, inner] = splitPlacement(style);
  const Box = onPress ? PressableShift : View;
  return (
    <HardShadow
      offset={nb.offset}
      radius={radius.card}
      on={fill}
      style={outer}
    >
      <Box
        style={[surface, inner]}
        offset={onPress ? nb.offset : undefined}
        onPress={onPress}
        onLayout={onLayout}
        {...rest}
      >
        {children}
      </Box>
    </HardShadow>
  );
}

// Style keys that place a box in its PARENT rather than describe the box. These
// move to the shadow wrapper; everything else stays on the card.
const PLACEMENT = new Set([
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'right', 'bottom', 'left', 'start', 'end',
  'alignSelf', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'zIndex',
]);

function splitPlacement(style) {
  const flat = StyleSheet.flatten(style);
  if (!flat) return [null, null];
  const outer = {};
  const inner = {};
  Object.keys(flat).forEach((key) => {
    (PLACEMENT.has(key) ? outer : inner)[key] = flat[key];
  });
  return [outer, inner];
}
