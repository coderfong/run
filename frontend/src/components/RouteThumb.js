// RouteThumb — the claim as a drawing: the territory the run grew, with the
// route drawn INSIDE it. Shared between the feed (FeedCard) and the post-run
// summary card (ResultScreen), so "the run card on the home screen" and the
// card you see right after a run are literally the same drawing, not two
// components that happen to look similar.
//
// One shared projection for territory + route TOGETHER — fitted separately, a
// run would float somewhere over a claim it is supposed to sit inside.

import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';

import { withAlpha, useTheme, useThemedStyles } from '../theme';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';

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
 */
export default function RouteThumb({ id, rings, path, color, compact = false, style }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const filteredRings = (rings || []).filter((r) => r?.length >= 3);
  const line = (path?.length || 0) >= 2 ? path : null;
  if (!filteredRings.length && !line) return null;
  const boxH = compact ? THUMB_W : THUMB_H;
  const project = makeProjection([...filteredRings, ...(line ? [line] : [])], 10, boxH);
  const projectedRings = filteredRings.map(project);
  const projectedLine = line ? project(line) : null;
  return (
    // A DRAWN BOX, not a grey plate — see the note this carried in FeedCard
    // before the extraction: the frame gives the route an edge without a
    // second surface colour under it.
    <Framed
      frame={frameVariant('box', `route:${id}`)}
      on={colors.card}
      tint={withAlpha(color, 0.55)}
      weight={INK.thin}
      pose={framePose(`route:${id}`)}
      inset={false}
      style={[compact ? styles.thumbCompact : styles.thumb, style]}
    >
      {/* height="100%", not the raw box pixels: the box is locked to the
          viewBox's own aspect ratio, so this fills it edge to edge with no
          "meet" letterboxing. */}
      <Svg width="100%" height="100%" viewBox={`0 0 ${THUMB_W} ${boxH}`}>
        {projectedRings.map((ring, i) => (
          <Polygon
            key={i}
            points={svgPoints(ring)}
            fill={withAlpha(color, 0.22)}
            stroke={color}
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
            stroke={filteredRings.length ? withAlpha(color, 0.75) : color}
            strokeWidth={filteredRings.length ? 2 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </Svg>
    </Framed>
  );
}

const makeStyles = () => StyleSheet.create({
  thumb: {
    // Locking the box to the viewBox's own ratio is what makes it fill edge
    // to edge with no letterboxing on any card wider than THUMB_W.
    aspectRatio: THUMB_W / THUMB_H,
    justifyContent: 'center',
  },
  thumbCompact: {
    aspectRatio: 1,
    justifyContent: 'center',
  },
});
