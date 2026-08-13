// Framed — wraps anything in a hand-drawn box.
//
// `ArtFrame` needs to be told how big to draw, because it is absolutely
// positioned and measures nothing. Almost every caller does not KNOW: a panel
// is as tall as its text, a chip as wide as its label. So this measures itself
// and hands the size down, which turns the frame into something you can put
// round arbitrary content without doing layout maths at the call site.
//
// The frame draws OVER the content, not under it — the ink is a border and a
// border sits on the edge of the box, not behind it. The padding that keeps
// content clear of that ink comes from the frame's measured LINE THICKNESS, per
// side, and this is the part that used to be wrong: it padded by the nine slice
// inset instead, which is a much bigger number and a different measurement
// entirely. On the banner that meant 30pt of dead space under every one; on the
// label, where the inset happened to run the other way, it meant a heading sat
// on top of its own outline. See `framePadding`.
//
// Padding is computed at scale 1 even though the frame may fit itself down to
// something finer. That is deliberate, and it is what stops the two from
// chasing each other: padding decides the size, the size decides the scale, and
// if the scale then decided the padding the layout would never settle. Erring
// on the generous side costs a few points of air and cannot overlap.

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import ArtFrame from '../../ui/ArtFrame';
import { INK, framePadding, weightScale } from '../../ui/frameRegistry';
import { readableInk, toon, useTheme } from '../../theme';

// The two inks a drawn box is allowed to be when its own choice will not show.
// Not `colors.text`: this is a LINE, and the theme's text colours are tuned for
// type on a surface rather than for a 5pt stroke over a clan colour.
const DARK_INK = toon.ink;
const LIGHT_INK = '#F4F4F7';

/**
 * The ink a frame should actually draw with.
 *
 * Exported and pure so the rule can be tested without rendering: the whole
 * point is that it is decidable from the two colours, and a frame that vanishes
 * is not something a snapshot would catch.
 *
 * `surface` is what the line sits on. `scheme` is the fallback when there is no
 * surface to judge against — which is the case that used to fail silently: with
 * no tint at all the frame drew its art's own near-black blue, so every
 * unstyled box was invisible the moment the app went dark.
 */
export function frameInkFor({ tint, surface, scheme }) {
  if (surface) return readableInk(surface, { prefer: tint, dark: DARK_INK, light: LIGHT_INK });
  if (tint) return tint;
  return scheme === 'dark' ? LIGHT_INK : DARK_INK;
}

/**
 * `frame`   which box: 'panel', 'card', 'label', 'banner', 'badge', 'bubble'…
 * `inset`   EXTRA padding inside the ink clearance. A number, or false to lay
 *           out edge to edge and handle the clearance yourself.
 * `tint`    ink colour. KEPT whenever it is legible against what the line is
 *           drawn on, and swapped for a light or dark ink when it is not —
 *           see `frameInkFor`. Left off, the frame takes the theme's ink.
 * `on`      what the line sits on, when that is not the fill: a scene, a
 *           coloured card, a photo. Defaults to `fill`, which is right for
 *           almost every box, because the ink of a filled box mostly runs
 *           against its own paper.
 * `fill`    paints the inside of the box. Off by default, so a framed heading
 *           sits on the page rather than on a card of its own.
 * `weight`  how thick the line comes out, IN POINTS, whichever drawing is
 *           behind it. This is the knob to reach for: the pack's nine boxes
 *           were drawn at wildly different sizes, so asking for a scale means
 *           asking for a different line on every frame. See `weightScale`.
 *           Pass `weight={false}` for the art at its own size.
 * `scale`   a multiplier ON TOP of the weight, for the rare caller that wants
 *           one box heavier than its neighbours without restating the number.
 * `pose`    one of the three hand-redrawn still poses.
 * `boil`    animate the three drawings. Off by default; see ArtFrame.
 */
export default function Framed({
  frame = 'panel',
  tint,
  on,
  fill,
  weight = INK.base,
  scale = 1,
  opacity = 1,
  pose = 0,
  boil = false,
  inset,
  style,
  contentStyle,
  children,
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { scheme } = useTheme();
  const ink = frameInkFor({ tint, surface: on ?? fill, scheme });

  // Weight is a property of the DRAWING, not of the box, so resolving it here
  // cannot feed back into layout the way a size-derived scale would: padding
  // decides the size, the size decides how far ArtFrame has to fit the frame
  // DOWN, and none of that changes the number below.
  const drawScale = useMemo(
    () => scale * weightScale(frame, weight),
    [frame, scale, weight]
  );

  const pad = inset === false
    ? null
    : framePadding(frame, typeof inset === 'number' ? inset : 2, drawScale);

  return (
    <View
      style={style}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        // Rounded: a fractional layout width would re-render this on every
        // pass as the measurement jitters in the last decimal place.
        const next = { width: Math.round(width), height: Math.round(height) };
        setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
      }}
    >
      {/* Paper behind, ink in front. See ArtFrame's `layer`. */}
      {fill ? (
        <ArtFrame
          name={frame}
          layer="paper"
          width={size.width}
          height={size.height}
          fill={fill}
          scale={drawScale}
          opacity={opacity}
          pose={pose}
          boil={boil}
        />
      ) : null}
      <View style={[pad, contentStyle]}>{children}</View>
      <ArtFrame
        name={frame}
        width={size.width}
        height={size.height}
        tint={ink}
        scale={drawScale}
        opacity={opacity}
        pose={pose}
        boil={boil}
      />
    </View>
  );
}
