// RouteThumb — the claim ON THE MAP: the ground the run took, drawn over a
// still frame of the streets it was taken from. Shared between the feed
// (FeedCard) and the post-run summary card (ResultScreen), so "the run card on
// the home screen" and the card you see right after a run are literally the
// same picture, not two components that happen to look similar.
//
// IT USED TO BE A DRAWING ON BLANK PAPER, and that was the problem: a claim is
// a route-shaped ribbon, so with nothing under it the card was a pale squiggle
// floating in a white box. You could not tell a park loop from a housing
// estate, or your own street from a city you have never run in. The shape only
// means something against the ground it was cut from.
//
// So the paper is a map now. The snapshot comes from the Static Images API
// (one HTTPS image, cached by URL) rather than a live Mapbox view: a feed is a
// scrolling list, and a live map per row is a native surface per row.
//
// THE DRAWING IS STILL OURS. Mapbox can stamp an overlay into the picture
// itself, and this deliberately does not ask it to — the claim is drawn here,
// in the run's own ink, which keeps the app's hand on the one thing the card is
// about AND keeps every runner's route on the device instead of in a third
// party's request log. What the snapshot's URL carries is a centre and a zoom,
// the same thing any map tile request carries.
//
// The two agree because they are fitted ONCE, together: `fitLayersToBox` picks
// the centre and zoom, the URL asks for that exact frame, and the same
// projector places every vertex. Fit them apart and the outline slides off its
// own streets.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';

import { readableInk, withAlpha, useTheme, useThemedStyles } from '../theme';
import { mapSurfaceFor } from '../config/map';
import { fitLayersToBox, staticMapUrl } from '../utils/staticMercator';
import { Image } from '../ui/image';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';

// The box's paper WHEN THERE IS NO MAP — no token configured, or the snapshot
// failed to load. A FIXED white, not the theme's card colour: this is a
// drawing on a page, it is dealt onto surfaces the theme does not own (a
// clan-coloured feed card), and the same run should not be a different
// picture in dark mode. Matches the stat tiles beside it in FeedCard.
const PAPER = '#FFFFFF';

// Ask the Static Images API for twice the box, at one zoom deeper. Identical
// ground, four times the pixels — a 300pt-wide card deserves more than 300
// pixels of map. See `staticMapUrl`.
const MAP_DETAIL = 2;

// Virtual drawing box; the <Svg> scales it to whatever width it is given,
// aspect preserved.
export const THUMB_W = 300;
export const THUMB_H = 110;
export const THUMB_H_LARGE = 180;

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
 * `large`   larger panoramic (THUMB_W x THUMB_H_LARGE) for prominent display
 * `style`   layout for the OUTER box (margin, flex) — sizing itself is
 *           measured, not styled; see the note below.
 */
export default function RouteThumb({ id, rings, path, color, compact = false, large = false, style }) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useTheme();
  // A snapshot that never arrives (offline, a dead token, a 4xx from a URL we
  // built wrong) must not cost the card its picture: fall back to the paper
  // drawing, which is what this component was before the map. Held as the URL
  // that failed rather than as a flag, so a DIFFERENT snapshot — the other
  // theme's style, or another run in a recycled row — still gets its try.
  const [failedUrl, setFailedUrl] = useState(null);
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
  const boxH = compact ? THUMB_W : (large ? THUMB_H_LARGE : THUMB_H);
  const layers = [...filteredRings, ...(line ? [line] : [])];

  // The frame the snapshot and the drawing SHARE. Projected in the virtual
  // drawing box's own units, which is also what the URL asks for (scaled up by
  // MAP_DETAIL, which buys pixels and not ground), so the two cannot disagree.
  const view = fitLayersToBox(layers, { width: THUMB_W, height: boxH }, { padding: 10, maxZoom: 17 });
  const snapshot = view
    ? staticMapUrl({ ...view, width: THUMB_W, height: boxH, scheme, detail: MAP_DETAIL })
    : null;
  const mapUrl = snapshot && snapshot !== failedUrl ? snapshot : null;

  // What the ink is judged against: the map's own ground once there is a map,
  // the white page when there is not. The run's own colour whenever it can be
  // seen there, and a contrasting ink when it cannot — a pale yellow trail glow
  // (ResultScreen passes the team's) is invisible on white the same way pink
  // was invisible on pink, and a dark ink vanishes into a dark basemap.
  const surface = mapUrl ? mapSurfaceFor(scheme) : PAPER;
  const ink = readableInk(surface, { prefer: color });
  // Mercator whenever the shape could be fitted, so the drawing sits on the
  // streets underneath; the flat lon/lat fit only as a last resort (it is what
  // the other drawings in the app still use, and at this scale the two are a
  // fraction of a pixel apart anyway).
  const project = view ? view.project : makeProjection(layers, 10, boxH);
  const projectedRings = filteredRings.map(project);
  const projectedLine = line ? project(line) : null;
  const pixelHeight = boxWidth ? boxWidth * (boxH / THUMB_W) : null;
  return (
    <View
      style={style}
      onLayout={(e) => setBoxWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {/* A DRAWN BOX around a picture: the ink is the edge, and what the claim
          is drawn on is the map inside it (white paper when there is none).
          `on` is that same surface, so the frame's own line is judged against
          what it actually sits on. */}
      <Framed
        frame={frameVariant('box', `route:${id}`)}
        fill={surface}
        on={surface}
        // Solid ink, the same edge as the stat tiles under it. A pale run
        // tint here made the box read as a faint hairline beside them.
        weight={INK.thin}
        pose={framePose(`route:${id}`)}
        inset={false}
        // Before the outer box has measured itself, fall back to the
        // fixed-ratio style for one frame rather than collapsing to zero
        // height — `boxWidth` is set on the very next layout pass.
        style={pixelHeight ? { height: pixelHeight } : (compact ? styles.thumbCompact : (large ? styles.thumbLarge : styles.thumb))}
        // The picture fills the frame, so the content layer has to BE the
        // frame: `flex: 1` gives the absolutely-placed snapshot a box to fill,
        // and clipping keeps it off the wobble the ink is about to draw.
        contentStyle={styles.canvas}
      >
        {mapUrl ? (
          <Image
            // Keyed on the URL so a theme change (a different style, so a
            // different snapshot) swaps the picture instead of keeping the
            // stale one under a component that never unmounted.
            key={mapUrl}
            source={{ uri: mapUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setFailedUrl(mapUrl)}
            // Decorative: the claim over it is what the card is telling you,
            // and it is already labelled by everything around it.
            accessible={false}
            transition={140}
          />
        ) : null}
        {/* height="100%", not the raw box pixels: the Svg fills whatever
            height the box above resolved to, edge to edge, no letterboxing. */}
        <Svg width="100%" height="100%" viewBox={`0 0 ${THUMB_W} ${boxH}`}>
          {/* A HALO under the ink, only over a map. A basemap is not one
              colour — a line that reads over grey tarmac can disappear into a
              park or a river — so every stroke gets the ground's own colour
              laid under it first, which is how a map label stays legible over
              anything. On paper the ink already has all the contrast it needs
              and this would just fatten it. */}
          {mapUrl ? (
            <>
              {projectedRings.map((ring, i) => (
                <Polygon
                  key={`halo-${i}`}
                  points={svgPoints(ring)}
                  fill="none"
                  stroke={withAlpha(surface, 0.7)}
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                />
              ))}
              {line && (
                <Polyline
                  points={svgPoints(projectedLine)}
                  fill="none"
                  stroke={withAlpha(surface, 0.7)}
                  strokeWidth={filteredRings.length ? 4.5 : 5.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </>
          ) : null}
          {projectedRings.map((ring, i) => (
            <Polygon
              key={i}
              points={svgPoints(ring)}
              // Deeper over a map than over paper: the ground under it is
              // already carrying detail, and a 22% wash over streets reads as
              // a smudge rather than as land somebody owns. Still translucent,
              // because seeing WHICH streets is the entire point of the map.
              fill={withAlpha(ink, mapUrl ? 0.34 : 0.22)}
              // A fine edge: the wash is what says "owned", and a heavy
              // outline read as a second frame drawn inside the map's own.
              stroke={ink}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ))}
          {line && (
            <Polyline
              points={svgPoints(projectedLine)}
              fill="none"
              // Softer ink than the territory's so the route reads as the
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
  // The frame's content layer. `flex: 1` so it fills the measured box (the
  // snapshot is absolutely placed against it), `overflow: hidden` so a square
  // picture cannot poke out past a hand-drawn edge that wanders inward.
  canvas: { flex: 1, overflow: 'hidden' },
  // First-frame-only fallbacks — see the comment above `boxWidth`.
  thumb: {
    aspectRatio: THUMB_W / THUMB_H,
    justifyContent: 'center',
  },
  thumbCompact: {
    aspectRatio: 1,
    justifyContent: 'center',
  },
  thumbLarge: {
    aspectRatio: THUMB_W / THUMB_H_LARGE,
    justifyContent: 'center',
  },
});
