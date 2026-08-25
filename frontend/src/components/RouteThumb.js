// RouteThumb — the claim as a drawing: the territory the run grew, with the
// route drawn INSIDE it. Shared between the feed (FeedCard) and the post-run
// summary card (ResultScreen), so "the run card on the home screen" and the
// card you see right after a run are literally the same drawing, not two
// components that happen to look similar.
//
// One shared projection for territory + route TOGETHER — fitted separately, a
// run would float somewhere over a claim it is supposed to sit inside.
//
// THE BOX HAS PAPER. It used to be a frame with nothing inside it, which was
// right when the card underneath was a neutral surface and wrong the day the
// feed started dealing every run card a flat saturated fill of its own: the
// route is drawn in the clan colour, the card became the clan colour, and a
// pink line on a pink card is a blank box. The stat tiles on the same card
// had already been given white paper for exactly this reason. So this box
// gets it too, and the route's ink is then judged against THAT rather than
// against whatever the card happens to be.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';

import { readableInk, withAlpha, useThemedStyles } from '../theme';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';

// The box's paper. A FIXED white, not the theme's card colour: this is a
// drawing on a page, it is dealt onto surfaces the theme does not own (a
// clan-coloured feed card), and the same run should not be a different
// picture in dark mode. Matches the stat tiles beside it in FeedCard.
const PAPER = '#FFFFFF';

// Virtual drawing box; the <Svg> scales it to whatever width it is given,
// aspect preserved.
export const THUMB_W = 300;
export const THUMB_H = 110;

export function makeProjection(layers, pad = 10, boxH = THUMB_H) {
  const all = layers.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((THUMB_W - pad * 2) / spanX, (boxH - pad * 2) / spanY);
  const offX = (THUMB_W - spanX * scale) / 2;
  const offY = (boxH - spanY * scale) / 2;
  return (points) => points.map(([lon, lat]) => [
    offX + (lon - minX) * scale,
    boxH - (offY + (lat - minY) * scale),
  ]);
}

// Whether a `{ rings, path }` pair has anything to draw — needed a layer up
// so a caller can decide its own layout (e.g. map alone vs. map beside a
// photo) before RouteThumb itself renders.
export function hasRouteData({ rings, path } = {}) {
  const filteredRings = (rings || []).filter((r) => r?.length >= 3);
  return filteredRings.length > 0 || (path?.length || 0) >= 2;
}

export const svgPoints = (points) => points
  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  .join(' ');

/**
 * `id`      seeds the frame's variant/pose so the same claim always draws the
 *           same hand-drawn box.
 * `compact` square (THUMB_W x THUMB_W) beside a photo, panoramic
 *           (THUMB_W x THUMB_H) running the full width alone.
 * `style`   layout for the OUTER box (margin, flex) — sizing itself is
 *           measured, not styled; see the note below.
 */
export default function RouteThumb({ id, rings, path, color, compact = false, style }) {
  const styles = useThemedStyles(makeStyles);
  // CSS `aspectRatio` used to size this box directly, and on at least some
  // devices it did not resolve against the parent's width the way a sibling
  // with no sizing at all (the caption frame right below this one) does —
  // the two frames read as different widths, and the route box read as
  // taller than its content, mostly blank underneath the drawing. Measuring
  // the box's own width and setting an explicit pixel height from it is the
  // same trick `Framed` itself already uses one layer in, and it can't
  // disagree with a plain block-width sibling the way an aspect-ratio
  // resolution edge case could.
  const [boxWidth, setBoxWidth] = useState(0);
  const filteredRings = (rings || []).filter((r) => r?.length >= 3);
  const line = (path?.length || 0) >= 2 ? path : null;
  if (!filteredRings.length && !line) return null;
  const boxH = compact ? THUMB_W : THUMB_H;
  // The run's own colour whenever it can be seen on the paper, and a dark ink
  // when it cannot — a pale yellow trail glow (ResultScreen passes the team's)
  // is invisible on white the same way pink was invisible on pink.
  const ink = readableInk(PAPER, { prefer: color });
  const project = makeProjection([...filteredRings, ...(line ? [line] : [])], 10, boxH);
  const projectedRings = filteredRings.map(project);
  const projectedLine = line ? project(line) : null;
  const pixelHeight = boxWidth ? boxWidth * (boxH / THUMB_W) : null;
  return (
    <View
      style={style}
      onLayout={(e) => setBoxWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {/* A DRAWN BOX on white paper: the ink is the edge, the paper is what
          the route is drawn on. `on` is the paper too, so the frame's own
          line is judged against what it actually sits on. */}
      <Framed
        frame={frameVariant('box', `route:${id}`)}
        fill={PAPER}
        on={PAPER}
        tint={withAlpha(color, 0.55)}
        weight={INK.thin}
        pose={framePose(`route:${id}`)}
        inset={false}
        // Before the outer box has measured itself, fall back to the
        // fixed-ratio style for one frame rather than collapsing to zero
        // height — `boxWidth` is set on the very next layout pass.
        style={pixelHeight ? { height: pixelHeight } : (compact ? styles.thumbCompact : styles.thumb)}
      >
        {/* height="100%", not the raw box pixels: the Svg fills whatever
            height the box above resolved to, edge to edge, no letterboxing. */}
        <Svg width="100%" height="100%" viewBox={`0 0 ${THUMB_W} ${boxH}`}>
          {projectedRings.map((ring, i) => (
            <Polygon
              key={i}
              points={svgPoints(ring)}
              fill={withAlpha(ink, 0.22)}
              stroke={ink}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          ))}
          {line && (
            <Polyline
              points={svgPoints(projectedLine)}
              fill="none"
              // Lighter than the territory outline so the route reads as the
              // thing inside the land, not as a second border around it.
              stroke={filteredRings.length ? withAlpha(ink, 0.75) : ink}
              strokeWidth={filteredRings.length ? 2 : 2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </Svg>
      </Framed>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  // First-frame-only fallbacks — see the comment above `boxWidth`.
  thumb: {
    aspectRatio: THUMB_W / THUMB_H,
    justifyContent: 'center',
  },
  thumbCompact: {
    aspectRatio: 1,
    justifyContent: 'center',
  },
});
