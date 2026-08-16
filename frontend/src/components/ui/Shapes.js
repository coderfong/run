// Shapes — the brutalist sticker set, drawn rather than shipped.
//
// The style leans on a small vocabulary of flat marks: the starburst on a price
// tag, the four-point twinkle, the daisy, the bolt, the blob. They are the
// decorative half of neo-brutalism, and every one of them is the same recipe as
// the boxes — a FLAT SATURATED FILL with a HEAVY STROKE round it and no
// gradient anywhere. See the header of theme/nb.js.
//
// INLINE SVG, NOT ART. Three reasons, in order of how much they cost to get
// wrong:
//
//   OTA updates are blocked by the 1000-asset cap and the bundle is already
//   past it, so every new PNG is one more reason a JS-only change needs a full
//   native build. A shape that is geometry costs nothing.
//
//   These have to take a colour at the call site — a clan tint, an accent, the
//   ink judged against whatever they are dropped on. A PNG can be tinted, but
//   only as one flat colour, which loses the fill/stroke split the whole style
//   is built on.
//
//   They are drawn at wildly different sizes: 12pt beside a label, 120pt behind
//   an empty state. Raster art needs an @3x for the largest of those, and a
//   12pt one is that same file resampled.
//
// THE STROKE IS A POINT VALUE, not a viewBox number. This is the same rule the
// hand-drawn frames follow (see `weightScale` in ui/frameRegistry): an SVG
// stroke is expressed in user units, so a fixed `strokeWidth` renders hairline
// on a small shape and slab-heavy on a large one, and a row of mixed sizes
// stops looking like one pen. `weight` here is POINTS on screen, converted
// against the rendered size, so a 2pt mark is 2pt at every size.

import React from 'react';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';

import { NB, nbInk, useTheme } from '../../theme';

// Every shape is authored in a 0…100 box, so one conversion serves all of them.
export const BOX = 100;

/**
 * Stroke width in viewBox user units for a `weight` in POINTS at `size`.
 *
 * Exported because this is the arithmetic that goes wrong silently: get it
 * backwards and every shape still renders, just with a pen that changes
 * thickness depending on how big the mark is.
 */
export function strokeUnits(weight, size) {
  return (weight / size) * BOX;
}

// --- geometry helpers ------------------------------------------------------
//
// The radial shapes are computed rather than typed out as path data. A
// twelve-point burst is 24 coordinate pairs, and hand-written ones drift: the
// points end up not quite evenly spaced and the shape reads as a mistake rather
// than as a decision. Starting from -90 so every shape points UP, which is the
// only orientation any of them are ever wanted in.

function polar(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
}

// Alternating outer/inner radii around `n` points — a star, or a burst, or a
// gear, depending only on how many points and how deep the notches are.
function spikes(n, outer, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i += 1) {
    const [x, y] = polar(i % 2 ? inner : outer, (i * 180) / n);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * The arc radius that puts a petal's TIP exactly `tip` from the centre.
 *
 * Solved, not chosen, and this is the one piece of arithmetic in the file that
 * genuinely had to be: an arc bulges out well past the two points it is drawn
 * between, so the petal radius is nothing like the distance the petal reaches.
 * Picking a plausible-looking number put the daisy's tips at 64 in a box that
 * crops at 50, and every petal came out sliced flat — a hexagon with dents in
 * it. Nothing in the path data would have shown it, because the numbers that
 * overflow are the ones the arc computes and never writes down.
 *
 * With `h` the half-chord between adjacent ring points and `b` the bulge needed
 * beyond the chord's midpoint, `b = r + sqrt(r² - h²)` rearranges to the below.
 */
export function petalRadius(n, ring, tip = 50) {
  const h = ring * Math.sin(Math.PI / n);
  const b = tip - ring * Math.cos(Math.PI / n);
  return (b * b + h * h) / (2 * b);
}

// `n` petals, each an outward arc between two points on a circle of radius
// `ring`. One path, so the stroke runs round the whole flower instead of
// showing every petal's seam where it crosses its neighbour.
function petals(n, ring, tip = 50) {
  const petal = petalRadius(n, ring, tip).toFixed(2);
  const at = (i) => polar(ring, (i * 360) / n).map((v) => v.toFixed(2));
  const [x0, y0] = at(0);
  let d = `M${x0},${y0}`;
  for (let i = 1; i <= n; i += 1) {
    const [x, y] = at(i % n);
    // Large-arc, sweep 1: the MAJOR arc, so the petal bulges away from the
    // centre. Sweep 0 would tuck each one inward and give you a cog.
    d += ` A${petal},${petal} 0 1 1 ${x},${y}`;
  }
  return `${d} Z`;
}

// --- the set ---------------------------------------------------------------
//
// `stroked` shapes are a LINE, not an outlined area: they take the ink and no
// fill. The squiggle is the obvious one — a filled squiggle is a ribbon, which
// is a different mark entirely.

const SHAPE_DEFS = {
  // The price-tag burst. Twelve points, notched to about two thirds, which is
  // the depth where it stops reading as a gear and starts reading as a bang.
  burst: { polygon: () => spikes(12, 50, 33) },

  // Five points, notched hard. The classic.
  star: { polygon: () => spikes(5, 50, 21) },

  // Four points with concave sides — the twinkle that goes next to anything
  // being called new. Curves, not straight notches: straight ones give you a
  // compass rose.
  sparkle: {
    path: () => 'M50,0 Q57,43 100,50 Q57,57 50,100 Q43,57 0,50 Q43,43 50,0 Z',
  },

  // Ring at 30 and the petal radius solved so the tips land on the box edge.
  daisy: { path: () => petals(6, 30) },

  // Hand-authored, unlike the radial ones: the point of a blob is that it is
  // NOT regular, so there is nothing to compute. Four cubics with deliberately
  // mismatched control points.
  blob: {
    path: () =>
      'M52,1 C74,1 99,14 99,38 C99,60 88,68 88,80 C88,93 74,99 56,99'
      + ' C31,99 3,88 3,61 C3,38 14,31 14,20 C14,7 30,1 52,1 Z',
  },

  bolt: { polygon: () => '56,0 18,56 44,56 38,100 82,41 54,41' },

  arrow: { polygon: () => '0,33 57,33 57,7 100,50 57,93 57,67 0,67' },

  // A plus, not an x. Rotate it at the call site if you want the other one.
  cross: {
    polygon: () => '33,0 67,0 67,33 100,33 100,67 67,67 67,100 33,100 33,67 0,67 0,33 33,33',
  },

  disc: { circle: true },

  // Stroke only. The line is the shape.
  squiggle: {
    stroked: true,
    path: () => 'M0,62 Q17,10 33,62 T67,62 T100,62',
  },
};

export const SHAPES = Object.keys(SHAPE_DEFS);

/**
 * The resolved drawing for one mark, without rendering it:
 * `{ kind: 'polygon' | 'path' | 'circle', d, stroked }`.
 *
 * Exported for the tests. A shape whose geometry has a NaN in it renders as
 * NOTHING — no warning, no red box, just a gap where the mark was — so the
 * coordinates are worth asserting on directly rather than through a tree.
 */
export function shapeGeometry(name) {
  const def = SHAPE_DEFS[name];
  if (!def) return null;
  if (def.circle) return { kind: 'circle', d: null, stroked: false };
  if (def.polygon) return { kind: 'polygon', d: def.polygon(), stroked: false };
  return { kind: 'path', d: def.path(), stroked: !!def.stroked };
}

/**
 * One mark.
 *
 * `name`    a key from SHAPES.
 * `size`    rendered points, both axes.
 * `color`   the flat fill. Ignored by `squiggle`, which is a line.
 * `ink`     the stroke. Left off, it is judged against this shape's OWN fill,
 *           so a yellow burst gets a black edge and a purple one gets cream —
 *           the same contract every other neo-brutalist box in the app follows.
 * `on`      what the shape is sitting on, for the stroked shapes and for a
 *           `color` of 'transparent', where the fill is not what the edge is
 *           read against.
 * `weight`  stroke width in POINTS on screen, not in viewBox units.
 * `rotate`  degrees. Every shape is authored pointing up.
 */
export default function Shape({
  name,
  size = 24,
  color,
  ink,
  on,
  weight = NB.strokeThin,
  rotate = 0,
  style,
}) {
  const { colors, scheme } = useTheme();
  const def = SHAPE_DEFS[name];
  if (!def) return null;

  const fill = def.stroked ? 'none' : (color || colors.primary);
  // A shape with no fill of its own is really drawn on the page, so that is
  // what its edge has to be judged against.
  const edge = ink || nbInk(scheme, def.stroked || fill === 'transparent' ? on : fill);

  // Points to user units. The whole reason `weight` is not passed straight to
  // strokeWidth — see the file header.
  const sw = strokeUnits(weight, size);
  // A stroke straddles its path, so half of it falls OUTSIDE the authored box.
  // Growing the viewBox by that half on each side is what keeps a heavy mark
  // from being sliced flat on all four edges; sizing the geometry down instead
  // would make the shape shrink as the pen got heavier.
  const pad = sw / 2;
  const common = { fill, stroke: edge, strokeWidth: sw, strokeLinejoin: 'round' };

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`${-pad} ${-pad} ${BOX + sw} ${BOX + sw}`}
      style={[{ transform: [{ rotate: `${rotate}deg` }] }, style]}
      pointerEvents="none"
    >
      {def.circle ? (
        <Circle cx={50} cy={50} r={50} {...common} />
      ) : def.polygon ? (
        <Polygon points={def.polygon()} {...common} />
      ) : (
        <Path d={def.path()} {...common} strokeLinecap="round" />
      )}
    </Svg>
  );
}
