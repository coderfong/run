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

/**
 * `frame`   which box: 'panel', 'card', 'label', 'banner', 'badge', 'bubble'…
 * `inset`   EXTRA padding inside the ink clearance. A number, or false to lay
 *           out edge to edge and handle the clearance yourself.
 * `tint`    ink colour. Defaults to the art's own flat blue.
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
        tint={tint}
        scale={drawScale}
        opacity={opacity}
        pose={pose}
        boil={boil}
      />
    </View>
  );
}
