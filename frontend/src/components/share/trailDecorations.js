// What grows along a shared route: flowers, grass, little trees — the things
// that turn a bare line into somebody's own trail.
//
// SIDE ON, NOT FROM ABOVE. The route is a map, but these are not map symbols
// lying flat on it: each one is rooted on the line and SPROUTS UP out of it,
// drawn the way you would see it standing there. That is why nothing here turns
// to follow the direction of travel — things grow towards the top of the card
// whichever way the runner was going — and why each one carries a contact
// shadow where it meets the line, leans a few degrees off vertical, and is
// drawn nearest-last so the ones lower down the card overlap the ones behind.
//
// CAPTURE-SAFE, like everything else on the card: react-native-svg primitives
// and nothing else. No images, no animation, no map view — see the two rules at
// the top of RunShareCard.js.
//
// Every shape is drawn in the SAME box: 20 wide, 20 tall, with the ORIGIN AT
// ITS ROOT — x spans -10..10 and the thing grows from y=0 up to y=-20. So one
// <G> transform per mark plants it, leans it and sizes it, and a new decoration
// is a shape in that box plus a line in TRAIL_DECORATIONS.

import React from 'react';
import { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

// The card has no background, so a mark can land on a white t shirt or a night
// sky. Each one carries its own dark edge for exactly the reason the route
// carries its under stroke.
const OUTLINE = 'rgba(0,0,0,0.55)';
const EDGE = 1.2; // in the box's own units, so it scales with the mark
const CORE = '#FFFFFF';
// Where it meets the line. Not a real cast shadow — just enough contact for the
// thing to read as standing on the route rather than floating over it.
const SHADE = 'rgba(0,0,0,0.28)';

// Stems, canopies and caps keep their own natural colours; the accent is spent
// on the part that is meant to be looked at (the bloom, the cap, the flame).
// A green-stemmed flower in whatever colour the runner picked reads as a
// flower; an entirely pink one reads as a smudge.
const LEAF = '#5FB463';
const LEAF_DARK = '#3F8C4A';
const TRUNK = '#7A5230';
const CREAM = '#F4E7D2';

// Never more than this many, however long the run was: past it the marks stop
// reading as a planted trail and start reading as a dotted line.
const MAX_MARKS = 16;

function star(points, outer, inner, cy = 0) {
  let d = '';
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

const Shadow = ({ rx = 4.6 }) => <Ellipse cy={0} rx={rx} ry={rx * 0.32} fill={SHADE} />;

// A stem is drawn twice, dark under light, the same trick that keeps the route
// itself visible on a pale background.
const Stem = ({ d, width = 1.8, color = LEAF_DARK }) => (
  <>
    <Path d={d} fill="none" stroke={OUTLINE} strokeWidth={width + 1.6} strokeLinecap="round" />
    <Path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
  </>
);

const HEART = 'M0 4.3C-4.2 1.1 -4.7 -2 -2.4 -3.3C-1.05 -4.05 0 -3.1 0 -2.05C0 -3.1 1.05 -4.05 2.4 -3.3C4.7 -2 4.2 1.1 0 4.3Z';

// Each shape is a function of the accent colour, so the trail belongs to the
// same card as the headline number.
const SHAPES = {
  flower: (color) => [
    <Shadow key="sh" rx={4.4} />,
    <Stem key="stem" d="M0 -0.6C-2.2 -5.6 2 -9 0.4 -13.2" />,
    <Ellipse
      key="leaf"
      cx={-3.6}
      cy={-6.6}
      rx={3}
      ry={1.5}
      fill={LEAF}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      transform="rotate(-26 -3.6 -6.6)"
    />,
    <G key="bloom" transform="translate(0.4 -15.2)">
      {[0, 1, 2, 3, 4].map((i) => (
        <Ellipse
          key={i}
          cx={0}
          cy={-3.2}
          rx={2.3}
          ry={3.3}
          fill={color}
          stroke={OUTLINE}
          strokeWidth={EDGE}
          transform={`rotate(${i * 72})`}
        />
      ))}
      <Circle r={2} fill={CORE} stroke={OUTLINE} strokeWidth={EDGE} />
    </G>,
  ],
  grass: (color) => [
    <Shadow key="sh" rx={5} />,
    <Stem key="b1" d="M0 -0.4Q-2.4 -8 -5.6 -12.4" width={1.7} />,
    <Stem key="b2" d="M0 -0.4Q0.4 -9 -1.4 -16.4" width={1.9} />,
    <Stem key="b3" d="M0 -0.4Q1.6 -8.4 2.6 -14.2" width={1.7} color={LEAF} />,
    <Stem key="b4" d="M0 -0.4Q3.4 -6 6.2 -10.6" width={1.5} color={LEAF} />,
    <Circle key="bud" cx={-1.4} cy={-16.8} r={1.7} fill={color} stroke={OUTLINE} strokeWidth={EDGE} />,
  ],
  mushroom: (color) => [
    <Shadow key="sh" rx={4.8} />,
    <Rect
      key="stalk"
      x={-2.4}
      y={-10}
      width={4.8}
      height={10}
      rx={1.9}
      fill={CREAM}
      stroke={OUTLINE}
      strokeWidth={EDGE}
    />,
    <Path
      key="cap"
      d="M-8.6 -9C-8.6 -16.2 -4.6 -19.4 0 -19.4C4.6 -19.4 8.6 -16.2 8.6 -9C4.4 -7.4 -4.4 -7.4 -8.6 -9Z"
      fill={color}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      strokeLinejoin="round"
    />,
    <Circle key="d1" cx={-3.4} cy={-13.4} r={1.5} fill={CORE} opacity={0.9} />,
    <Circle key="d2" cx={2.6} cy={-15.2} r={1.2} fill={CORE} opacity={0.9} />,
    <Circle key="d3" cx={4.2} cy={-11.4} r={0.9} fill={CORE} opacity={0.9} />,
  ],
  tree: (color) => [
    <Shadow key="sh" rx={5.4} />,
    <Rect
      key="trunk"
      x={-1.7}
      y={-7}
      width={3.4}
      height={7}
      rx={0.8}
      fill={TRUNK}
      stroke={OUTLINE}
      strokeWidth={EDGE}
    />,
    <Path
      key="c1"
      d="M0 -12.6L7.8 -5.4L-7.8 -5.4Z"
      fill={LEAF_DARK}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      strokeLinejoin="round"
    />,
    <Path
      key="c2"
      d="M0 -16.2L6.4 -9.6L-6.4 -9.6Z"
      fill={LEAF}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      strokeLinejoin="round"
    />,
    <Path
      key="c3"
      d="M0 -19.6L5 -13.6L-5 -13.6Z"
      fill={LEAF}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      strokeLinejoin="round"
    />,
    <Circle key="fruit" cx={2.8} cy={-11.2} r={1.4} fill={color} stroke={OUTLINE} strokeWidth={EDGE} />,
  ],
  heart: (color) => [
    <Shadow key="sh" rx={3.6} />,
    <Stem key="stem" d="M0 -0.6C0.8 -4 -0.8 -6.4 0 -9.4" width={1.6} />,
    <G key="heart" transform="translate(0 -13.6) scale(1.5)">
      <Path d={HEART} fill={color} stroke={OUTLINE} strokeWidth={EDGE / 1.5} strokeLinejoin="round" />
    </G>,
  ],
  star: (color) => [
    <Shadow key="sh" rx={3.6} />,
    <Stem key="stem" d="M0 -0.6C-0.8 -4 0.8 -6.4 0 -9.6" width={1.6} color="#B9C2CC" />,
    <Path
      key="star"
      d={star(5, 6.6, 2.9, -15.2)}
      fill={color}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      strokeLinejoin="round"
    />,
    <Circle key="glint" cx={-1.8} cy={-16.6} r={1.1} fill={CORE} opacity={0.85} />,
  ],
  flame: (color) => [
    <Shadow key="sh" rx={4.6} />,
    <Path
      key="f"
      d="M0 -19.4C4.4 -14.2 7.4 -10.8 7.4 -6.6C7.4 -2.6 4.1 0 0 0C-4.1 0 -7.4 -2.6 -7.4 -6.6C-7.4 -9.6 -5.6 -11.8 -3.5 -14C-3.2 -11.2 -2 -9.9 -0.6 -9.5C-1.7 -12.9 -1.4 -15.9 0 -19.4Z"
      fill={color}
      stroke={OUTLINE}
      strokeWidth={EDGE}
      strokeLinejoin="round"
    />,
    <Circle key="core" cx={0} cy={-4.4} r={2.4} fill={CORE} opacity={0.85} />,
  ],
  // The one that does not stand on the line: sparks lifting off it.
  sparkle: (color) => {
    const spark = 'M0 -6.4C0.8 -2.2 2.2 -0.8 6.4 0C2.2 0.8 0.8 2.2 0 6.4C-0.8 2.2 -2.2 0.8 -6.4 0C-2.2 -0.8 -0.8 -2.2 0 -6.4Z';
    return [
      <G key="a" transform="translate(0 -15.4) scale(1.15)">
        <Path d={spark} fill={color} stroke={OUTLINE} strokeWidth={EDGE} strokeLinejoin="round" />
      </G>,
      <G key="b" transform="translate(-5 -8.4) scale(0.75)">
        <Path d={spark} fill={color} stroke={OUTLINE} strokeWidth={EDGE * 1.3} strokeLinejoin="round" />
      </G>,
      <G key="c" transform="translate(4.4 -4.2) scale(0.55)">
        <Path d={spark} fill={CORE} stroke={OUTLINE} strokeWidth={EDGE * 1.8} strokeLinejoin="round" />
      </G>,
    ];
  },
};

// `size` is the mark's HEIGHT in the card's design units — these are things
// standing up, so height is the dimension that matters. `spacing` is how much
// route one of them wants to itself (a tree needs more room than a tuft of
// grass), and `lean` is how far off vertical it is allowed to tilt: a row of
// perfectly upright plants looks stamped, a row leaning 30° looks blown over.
export const TRAIL_DECORATIONS = [
  { key: 'none', label: 'None' },
  { key: 'flower', label: 'Flowers', size: 34, spacing: 60, lean: 11 },
  { key: 'grass', label: 'Grass', size: 26, spacing: 44, lean: 9 },
  { key: 'mushroom', label: 'Mushrooms', size: 27, spacing: 52, lean: 7 },
  { key: 'tree', label: 'Trees', size: 40, spacing: 74, lean: 5 },
  { key: 'heart', label: 'Hearts', size: 30, spacing: 56, lean: 10 },
  { key: 'star', label: 'Stars', size: 31, spacing: 58, lean: 10 },
  { key: 'flame', label: 'Fire', size: 28, spacing: 54, lean: 6 },
  { key: 'sparkle', label: 'Sparks', size: 27, spacing: 46, lean: 12 },
];

export const TRAIL_NONE = 'none';

export function trailSpec(key) {
  return TRAIL_DECORATIONS.find((d) => d.key === key) || null;
}

/**
 * Where things grow: evenly spaced by DISTANCE ALONG the route, not by point
 * index — a recorder samples by time, so index spacing bunches everything up
 * wherever the runner slowed down.
 *
 * `depth` is 0 for the mark furthest up the card and 1 for the one nearest the
 * bottom. The component sizes and stacks by it, which is the whole difference
 * between a side-on trail and a row of flat symbols.
 *
 * @param {Array<[number, number]>} points  the projected route, in card pixels
 * @param {object} spec  one entry from TRAIL_DECORATIONS
 * @param {number} u     the card's design unit
 * @returns {Array<{x: number, y: number, rot: number, depth: number}>}
 */
export function trailMarks(points, spec, u = 1) {
  if (!spec || spec.key === TRAIL_NONE) return [];
  const pts = (points || []).filter(
    (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );
  if (pts.length < 2) return [];

  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (!Number.isFinite(len) || len <= 0) continue;
    segs.push({ from: pts[i - 1], to: pts[i], len, at: total });
    total += len;
  }
  if (!segs.length || total <= 0) return [];

  const spacing = Math.max(8, (spec.spacing || 50) * u);
  // At least one: a lap of the block is still somebody's run, and a trail with
  // nothing growing on it is the control doing nothing.
  const count = Math.max(1, Math.min(MAX_MARKS, Math.round(total / spacing)));

  const out = [];
  for (let i = 1; i <= count; i += 1) {
    // Interior fractions only — the ends of the route already carry the start
    // dot, the finish dot and the runner standing on it.
    const want = (total * i) / (count + 1);
    const seg = segs.find((s) => want <= s.at + s.len) || segs[segs.length - 1];
    const t = seg.len ? Math.max(0, Math.min(1, (want - seg.at) / seg.len)) : 0;
    // Seeded off the index rather than Math.random, so the preview and the
    // captured PNG are the same picture — capture re-renders the card.
    const lean = (((i * 37) % 21) / 10 - 1) * (spec.lean || 0);
    out.push({
      x: seg.from[0] + (seg.to[0] - seg.from[0]) * t,
      y: seg.from[1] + (seg.to[1] - seg.from[1]) * t,
      rot: lean,
      depth: 0,
    });
  }

  // Near the bottom of the card is near the viewer. A flat route gets a flat
  // depth of 1 rather than a divide by zero.
  const ys = out.map((m) => m.y);
  const top = Math.min(...ys);
  const span = Math.max(...ys) - top;
  out.forEach((m) => { m.depth = span > 0 ? (m.y - top) / span : 1; });
  return out;
}

/**
 * The marks themselves. Renders INSIDE the card's <Svg>, over the route line
 * and under its start/finish dots.
 */
export default function TrailDecorations({ points, decoration, color, u = 1 }) {
  const spec = trailSpec(decoration);
  if (!spec || spec.key === TRAIL_NONE || !SHAPES[spec.key]) return null;
  const marks = trailMarks(points, spec, u);
  if (!marks.length) return null;
  const base = (spec.size * u) / 20;
  return (
    <G>
      {marks
        // Painter's order: what is lower on the card is in front, so it is
        // drawn last and overlaps whatever is standing behind it.
        .map((m, i) => ({ ...m, i }))
        .sort((a, b) => a.y - b.y)
        .map((m) => {
          // The same size everywhere reads as a sticker sheet. Nearer marks are
          // bigger, which is all the perspective a 9:16 sticker needs.
          const scale = base * (0.86 + 0.28 * m.depth);
          return (
            <G
              key={m.i}
              transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)}) rotate(${m.rot.toFixed(1)}) scale(${scale.toFixed(3)})`}
            >
              {SHAPES[spec.key](color)}
            </G>
          );
        })}
    </G>
  );
}
