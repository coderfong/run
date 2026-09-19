// The image that leaves the app: three enormous numbers stacked down one side
// of the story, the route and the runner standing beside them, the wordmark
// underneath — on NOTHING.
//
// THREE THINGS. That is the whole card, and two passes got it there. The
// 2026-08-16 simplification took the territory headline (an eyebrow and a 44pt
// km²) off the top and capped the route's band. The 2026-08-24 pass took the
// LABELS off the numbers, put the numbers in one column at poster size, and
// stood the route in a column beside them instead of in a band above them —
// the layout of the reference card, where the figures are the poster and the
// route is the thing propping them up. Empty space on a sticker is not waste,
// it is the runner's own story showing through.
//
// The 2026-08-25 pass finished that job: the poster face is a heavy grotesque
// rather than a condensed one, the column reserves room for the
// ink outline so the numbers stop arriving with shaved edges, and the art
// column is measured against the STAT BLOCK — level with the numbers and hard
// up against them, instead of pinned to the top corner of the story.
//
// The mascot stayed. It stands ON the end of the route, anchored by the foot it
// runs on rather than by the middle of its own box — see MARK_FOOT.
//
// The card is a STICKER and only a sticker. It exports as a transparent PNG,
// and Instagram lays it over whatever the runner already has on their story.
// That is the whole point: their own selfie or photo is the background and
// PASER supplies the numbers. There used to be a background chooser here — a
// clan-coloured wash, or a photo picked out of the library. Both are gone: they
// competed with the runner's own story and turned a sticker into a slab.
//
// Two rules keep it honest:
//
//   1. CAPTURE-SAFE. `captureRef` rasterises what is on screen RIGHT NOW, so
//      nothing here may be a map view, an `expo-image`, or an animation. The
//      route is SVG and the mark is a plain RN `Image` on a bundled asset.
//   2. LEGIBLE ON ANYTHING. With no background of its own, every element has to
//      carry its own contrast — the text shadows and the route's dark
//      under-stroke are not decoration, they are what stops white on white.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import LogoRunner, { MARK_FEET, MARK_FOOT } from '../character/LogoRunner';
import TrailDecorations, { TRAIL_NONE } from './trailDecorations';
import { TRAIL_DECORATIONS_ENABLED } from '../../config/releaseFeatures';
import { NB, brand, fonts, nbTextOn, type, withAlpha } from '../../theme';
import HardShadow from '../ui/HardShadow';

// The canvas colour Instagram paints BEHIND the sticker, until the runner picks
// their own background. Never painted on the card itself, which is transparent
// all the way to its edges.
export const CARD_INK = '#07080A';

// ONE SHAPE, and only one: 9:16, the story canvas.
//
// There was a 1:1 "Post" beside it and it is gone. This card exists to land in
// an Instagram story as a sticker, and the square was never the same picture
// with a different crop — the safe areas, the route column and the stat block
// are all measured against the story's height, so the square quietly re-cut
// every one of them and shipped a second layout nobody was tuning.
// Everything else that takes the card (Save, Copy, the system sheet) now gets
// the story-shaped PNG too.
export const SHARE_FORMAT = {
  key: 'story',
  label: 'Story',
  ratio: 16 / 9,
  export: { width: 1080, height: 1920 },
};

// Instagram's own chrome (profile row up top, reply bar and share row along the
// bottom) covers roughly the first 11% and last 15% of a story.
const SAFE_TOP = 0.11;
const SAFE_BOTTOM = 0.15;
// Native SVG only needs enough vertices to preserve the route at share-card
// resolution. Keeping every recorder fix can create a multi-thousand-command
// path exactly when Continue mounts the share preview.
const MAX_DRAW_POINTS = 480;
// How much of the card the route is allowed to take in the STACKED layout
// (align: centre). Given more, the numbers end up sitting right under the line.
const ROUTE_SHARE = 0.3;

// SIDE BY SIDE — the shape the card was rebuilt to on 2026-08-24. The numbers
// take one column and the route + runner take the other, which is the poster
// layout the reference card uses: three huge figures stacked down the left and
// the run's own graphic standing beside them.
//
// The art column is the NARROWER of the two on purpose. A route projected into
// a box keeps its aspect ratio (projectGroups uses one scale for both axes), so
// a column much wider than it is tall wastes most of itself on air — and the
// numbers are the thing being posted.
//
// This is the FLOOR the numbers are sized against, not the final split: once
// the type has taken what it needs, whatever it did not use goes to the art,
// so the route and the runner end up right against the numbers instead of
// pinned to the far edge with a strip of nothing between.
//
// 0.46 until the poster face changed. A heavy grotesque sets a good third
// wider than the condensed one it replaced, so at the old split the numbers
// were running out of COLUMN before they reached the size VALUE_FOR_ROWS
// wanted for them — a card whose whole idea is one enormous type size was
// quietly drawing it 10% smaller. The type gets the width back and the art
// gets it returned the moment a card does not need it.
//
// 0.4 until the em table was found to be measuring the WRONG FACE (see EM).
// Against Inter's widths the numbers could never reach the size this split
// offered them, so handing the type more column looked free; with Poppins'
// real widths the same 0.4 drew them a fifth bigger than anybody asked for and
// took the difference out of the route. Back up to 0.44, which is the split
// where the figures grow enough to read as the poster they are and the route
// keeps a column worth projecting into.
const ART_COL = 0.44;
const COL_GAP = 8;
// How far the art column is held OFF the card's outer edge, on top of padX.
// The brackets live out there, and the route was drawing right up against the
// right-hand one — a squiggle apparently hooked onto the bracket's ink rather
// than a graphic standing in its own space. The numbers are already inset from
// their bracket by the same kind of margin; this gives the art the matching
// one on its side.
const ART_EDGE_U = 14;
// The art column is a tall rectangle rather than the full height of the card,
// for the same reason: a 1:3 slot draws a postage stamp in the middle of a lot
// of nothing.
const ART_ASPECT = 1.6;

// How thick the route draws, as a share of the card's width rather than a
// fixed size. A 5pt line on a 1080px export is a hair — on the exported PNG it
// came out visibly thinner than the type beside it, which is what made the
// route read as a diagram rather than as the subject. Strava's route is the
// heaviest mark on their card; this makes ours the same weight class as the
// numbers it sits above.
// Reduced from 7/15 to 4/10 for clearer, less thick appearance
const ROUTE_W = 4;
const ROUTE_UNDER_W = 10;

// The whole run is held between a pair of oversized square brackets, matching
// the reference's editorial poster treatment. Each bracket is drawn twice:
// black underneath for contrast on any Story photo, then solid white on top.
const BRACKET_W = 12;
const BRACKET_UNDER_W = 20;
const BRACKET_CAP_U = 20;
const BRACKET_PAD_U = 22;

// --- geometry ---------------------------------------------------------------

// Project every group through ONE shared bounding box, so the route and the
// territory it grew stay registered against each other.
function projectGroups(groups, w, h, pad) {
  const cleanGroups = groups.map((g) => ({
    ...g,
    points: (g.points || []).filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    ),
  }));
  const all = cleanGroups.flatMap((g) => g.points);
  if (all.length < 2) return groups.map(() => null);
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  all.forEach(([lon, lat]) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = Math.max((maxLon - minLon) * kx, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  // ONE scale for both axes — a route stretched to fill a box is not the shape
  // anybody ran.
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanY * scale) / 2;
  const at = ([lon, lat]) => [
    ox + (lon - minLon) * kx * scale,
    h - (oy + (lat - minLat) * scale),
  ];
  return cleanGroups.map((g) => {
    const pts = g.points || [];
    if (pts.length < 2) return null;
    const drawPts = pts.length <= MAX_DRAW_POINTS
      ? pts
      : Array.from({ length: MAX_DRAW_POINTS }, (_, i) =>
        pts[Math.round((i * (pts.length - 1)) / (MAX_DRAW_POINTS - 1))]
      );
    // Kept as points as well as as a path string: the trail decorations are
    // placed BY DISTANCE along the line, which a `d` string cannot answer.
    const xy = drawPts.map(at);
    let d = '';
    xy.forEach(([x, y], i) => {
      d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    return {
      d: g.close ? `${d}Z` : d.trim(),
      pts: xy,
      start: at(pts[0]),
      end: at(pts[pts.length - 1]),
    };
  });
}

// The recorder hands over `{latitude, longitude}` objects; the feed and the
// claim rings speak `[lon, lat]` pairs. The card is drawn from both — a run
// card opened off the home feed is the same component as the one the result
// screen mounts — so it takes either and says so in one place.
function lonLat(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  return [Number(p?.longitude), Number(p?.latitude)];
}

// --- formatting -------------------------------------------------------------

function km2(m2) {
  const v = (m2 || 0) / 1e6;
  return v >= 0.1 ? v.toFixed(2) : v.toFixed(3);
}

function paceLabel(distanceM, durationS) {
  if (!distanceM || distanceM < 50 || !durationS) return null;
  const secPerKm = durationS / (distanceM / 1000);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function durationLabel(durationS) {
  const total = Math.max(0, Math.round(durationS || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function paceStr(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Everything this run could put on a card, in Strava's order. A metric with no
// honest number for THIS run is dropped here rather than shown as a zero, which
// is also why the sheet's chips are built from this list: you cannot switch on
// an elevation the recorder never captured.
export function availableStats(run = {}) {
  // Result data may come back as numeric strings, and old persisted runs can
  // contain nulls. Normalise before formatting so the share stage can never
  // call a number method on an unexpected wire value.
  const consistencyMeasured =
    run.consistencySeconds !== null
    && run.consistencySeconds !== undefined
    && run.consistencySeconds !== ''
    && Number.isFinite(Number(run.consistencySeconds))
    && Number(run.consistencySeconds) >= 0;
  run = {
    ...run,
    distanceM: Number.isFinite(Number(run.distanceM)) ? Number(run.distanceM) : 0,
    durationS: Number.isFinite(Number(run.durationS)) ? Number(run.durationS) : 0,
    elevationM: Number.isFinite(Number(run.elevationM)) ? Number(run.elevationM) : 0,
    climbPerKm: Number.isFinite(Number(run.climbPerKm)) ? Number(run.climbPerKm) : 0,
    bestKmSeconds: Number.isFinite(Number(run.bestKmSeconds)) ? Number(run.bestKmSeconds) : 0,
    consistencySeconds: Number.isFinite(Number(run.consistencySeconds))
      ? Number(run.consistencySeconds)
      : 0,
    areaM2: Number.isFinite(Number(run.areaM2)) ? Number(run.areaM2) : 0,
  };
  const out = [
    { key: 'distance', label: 'Distance', value: ((run.distanceM || 0) / 1000).toFixed(2), unit: 'km' },
  ];
  const pace = paceLabel(run.distanceM, run.durationS);
  if (pace) out.push({ key: 'pace', label: 'Pace', value: pace, unit: '/km' });
  out.push({ key: 'time', label: 'Time', value: durationLabel(run.durationS) });
  if (run.elevationM > 0) {
    out.push({ key: 'elevation', label: 'Elev gain', value: String(Math.round(run.elevationM)), unit: 'm' });
  }
  if (run.climbPerKm > 0) {
    out.push({ key: 'climbPerKm', label: 'Climb / km', value: String(Math.round(run.climbPerKm)), unit: 'm/km' });
  }
  if (run.bestKmSeconds) {
    // "best/km" rather than "/km": with the labels off the card, a bare /km
    // under a pace of /km is two numbers claiming to be the same thing. The
    // unit is the only thing left that can tell them apart.
    out.push({ key: 'bestKm', label: 'Best km', value: paceStr(run.bestKmSeconds), unit: 'best/km' });
  }
  if (consistencyMeasured) {
    out.push({
      key: 'consistency',
      label: 'Consistency',
      value: `±${paceStr(run.consistencySeconds)}`,
      unit: '/km',
    });
  }
  if (run.areaM2 > 0) {
    out.push({ key: 'territory', label: 'Territory', value: km2(run.areaM2), unit: 'km²' });
  }
  return out;
}

// THREE NUMBERS. Distance, pace, time — the running card everyone already
// knows, and the exact three the reference layout stacks down the side.
//
// It was four (distance, time, elevation, territory) while the numbers lived in
// a 2x2 grid at the bottom of the card. Stacked one per line at poster size,
// four is a column that runs into the route and elevation is the least
// interesting thing anybody ran. Territory is still the number nobody else's
// running card has, but it is a chip now rather than a default: the card that
// posts without anyone touching a control is the plain running one.
export const DEFAULT_STATS = ['distance', 'pace', 'time'];


// The accents on offer. The clan colour leads (it is the runner's own), then a
// spread wide enough to sit on any photo — including ink, for a light one.
export const ACCENTS = [
  { key: 'white', color: '#FFFFFF' },
  { key: 'ink', color: '#0C0C10' },
  { key: 'pink', color: '#EC4899' },
  { key: 'teal', color: '#2DD4BF' },
  { key: 'violet', color: '#8B5CF6' },
  { key: 'lime', color: '#A3E635' },
  { key: 'gold', color: '#F5B32C' },
  { key: 'orange', color: '#FB6A34' },
];

// --- pieces -----------------------------------------------------------------

// --- the type scale ---------------------------------------------------------
//
// THE NUMBERS ARE THE CARD, and they have no labels over them any more.
//
// A 12pt "DISTANCE" above every figure was the last piece of caption-shaped
// furniture on here, and it was carrying no information: 18.23 KM cannot be
// mistaken for a duration and 4:56 /KM cannot be mistaken for anything at all.
// What it cost was a third of the height of every row and a second type size
// on a card whose whole idea is one enormous one. The unit says what the
// number is; the number gets the room the label was using.
//
// ONE SIZE FOR ALL OF THEM, picked so the LONGEST string fits the column. This
// is the difference between adopting the reference layout and merely gesturing
// at it: `fit` (still on underneath, as the backstop) shrinks each number
// independently, so a card with a sub-hour time and an over-hour time drew two
// different type sizes stacked on each other. Sizing the whole block to its
// widest member is what makes the column read as one poster.
//
// Indexed by how many numbers are on the card, in design units.
const VALUE_FOR_ROWS = [0, 78, 66, 54, 42, 34, 29];

// Tight, the way a poster stacks, but not touching: each row gets breathing
// room rather than the numbers reading as one fused block. Not tighter than
// about 1.1: a line box under that starts clipping caps on Android, which is a
// bug you only ever see on somebody else's phone.
const LINE_RATIO = 1.4;

// A last few percent of slack in the width budget.
const FIT_SAFETY = 0.97;

// How much of that width budget the art column has to treat as really taken.
//
// The em table above is a budget for SIZING, and a budget errs wide on
// purpose: guessing narrow crops glyphs. The SPLIT does not need that same
// insurance — being a few points out there only moves the route — so it pays
// the share the type actually draws. Paying the full padded figure twice is
// what walked the route across its own column and into the right bracket.
//
// 0.94 while the table was Inter's and over-budgeting Poppins by a fifth. Now
// that it measures the real face, the only slack left is the negative tracking
// the rows are set with (-0.02em a glyph, which raw advance widths know
// nothing about), so the reserve is nearly the whole estimate.
const TYPE_RESERVE = 0.97;

// The unit rides at the TOP of the digits, small and in caps — the reference's
// superscript KM. Set against the value's own size so it stays in proportion
// however far the block had to shrink.
const UNIT_RATIO = 0.3;
const UNIT_RISE = 0.16;
// The reference lettering is not merely bold: its figures are deliberately
// broad. Scale the complete value + unit lockup so both glyphs and their
// outline gain horizontal mass together, without faking width with tracking.
const TYPE_X_SCALE = 1.32;

// How wide a glyph sets in the poster face, in ems. This exists to CHOOSE a
// font size that will fit — `fit` still measures for real underneath — but it
// has to err WIDE, because an underestimate is what hands a too-big string to
// the fitter, and `adjustsFontSizeToFit` on a Text with an explicit lineHeight
// is exactly what was cropping the numbers.
//
// MEASURED FROM THE FACE THE CARD ACTUALLY SETS IN, which for a while it was
// not. These widths came out of
// `node_modules/@expo-google-fonts/poppins/900Black/Poppins_900Black.ttf`
// (hmtx / unitsPerEm 1000) — RUN_FONT is `fonts.hero`, Poppins Black.
//
// The table used to hold INTER Black's widths, left behind when the card moved
// off `fonts.poster`. Inter is the more even face: its '1' sets 0.645em where
// Poppins' sets 0.399em, so a clock like 1:30:01 was budgeted 4.13em and drew
// 3.38em. The type is sized by dividing the column by that estimate, so every
// number on the card was being drawn about a fifth smaller than the column it
// was given, and the art column was pushed right to make room for type that
// was never there.
//
// PROPORTIONAL WIDTHS ARE SAFE HERE, which is the fact the whole table rests
// on. `type.statHero` asks for tabular figures (fontVariant: ['tabular-nums']),
// and if the face answered, every digit would set at one width and a
// 1-heavy string would render WIDER than these entries — the underestimate
// that fires the fitter and crops glyphs. Poppins Black ships no `tnum`
// feature (its GSUB carries only Devanagari shaping plus ss01-ss04), so the
// request cannot apply and the digits are always these.
//
// IF THE POSTER FACE CHANGES AGAIN: re-measure this table in the same pass and
// re-check the new face for `tnum`. Both halves matter.
const EM = {
  '0': 0.662, '1': 0.399, '2': 0.566, '3': 0.615, '4': 0.704,
  '5': 0.660, '6': 0.633, '7': 0.512, '8': 0.657, '9': 0.597,
  '.': 0.319, ':': 0.319, "'": 0.265, '"': 0.490, ' ': 0.170, '/': 0.399,
  '²': 0.422, '±': 0.551,
  // The units are the only letters on the card and they are drawn uppercase,
  // so these are caps.
  B: 0.684, E: 0.556, H: 0.755, K: 0.755, M: 0.951, S: 0.625, T: 0.616,
};
// Anything not in the table, which should be nothing: W is the widest glyph
// Poppins Black has, so an unlisted character is over-budgeted rather than
// under — the safe direction, since under is what crops.
const EM_DEFAULT = 1.1;
function emWidth(s) {
  let w = 0;
  // Uppercased to match the unit's own textTransform — 'km' is drawn as 'KM',
  // and lowercase widths would have measured a string the card never renders.
  for (const ch of String(s).toUpperCase()) w += EM[ch] === undefined ? EM_DEFAULT : EM[ch];
  return w;
}

// What one stat costs across, value plus its raised unit, in ems of the value.
function statEm(stat) {
  return emWidth(stat.value) + (stat.unit ? emWidth(stat.unit) * UNIT_RATIO + 0.08 : 0);
}

// Air between the last number and the wordmark. This was a bare `14 * u`
// written out at three separate call sites — the stat block's own bottom, the
// runner's floor, and the reserve the route is measured against — so the three
// could drift apart and the runner could end up standing in the gap.
const STATS_TO_MARK_U = 24;

// Alignment, as the one thing the layout still needs it for. There was a
// FLEX_ALIGN beside this for the cross-axis of a stat's own column; the stats
// are single rows now, so justify is all that is left.
const ROW_JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

// Text tone for clean text without outlines
const TONE = {
  text: '#FFFFFF',
  unit: 'rgba(255,255,255,0.96)',
};

// Poppins Black has the wide, rounded, sports-poster silhouette in the visual
// reference. Keep this local to the share sticker so changing the type here
// cannot quietly restyle the rest of the app.
const RUN_FONT = fonts.hero;

// One number, drawn as big as its column allows.
//
// No label, no box, no rule under it — a figure, its unit raised at the
// shoulder, with clean text without outlines for a modern look.
function Stat({ value, unit, size, lineH, u, tone, align, color }) {
  const unitSize = size * UNIT_RATIO;
  return (
    // STRETCHED and justified rather than aligned: the number needs a box it
    // can be too big for, or `fit` has nothing to measure against and a long
    // duration simply runs out past the column into the route.
    <View
      style={{
        alignSelf: 'stretch',
        height: lineH,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: ROW_JUSTIFY[align],
        paddingHorizontal: 8 * u,
        overflow: 'visible',
      }}
    >
      <View
        testID={`share-stat-lockup-${value}`}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          transform: [{ scaleX: TYPE_X_SCALE }],
          transformOrigin: align === 'right' ? 'right' : align === 'left' ? 'left' : 'center',
        }}
      >
        {/* Clean text without outlines */}
        <Text
          style={[
            type.statHero,
            {
              fontFamily: RUN_FONT,
              fontSize: size,
              lineHeight: lineH,
              letterSpacing: -0.02 * size,
              color: color || tone.text,
            },
          ]}
          align={align}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {value}
        </Text>
        {!!unit && (
          <Text
            style={{
              fontFamily: RUN_FONT,
              fontSize: unitSize,
              lineHeight: unitSize * 1.15,
              letterSpacing: 0.2 * u,
              textTransform: 'uppercase',
              color: tone.unit,
              marginLeft: 2 * u,
              marginTop: lineH * UNIT_RISE,
            }}
          >
            {unit}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * @param {object}   props
 * @param {number}   props.width         rendered width in dp
 * @param {object}   props.team          clan colours {fill, stroke, glow}
 * @param {object}   props.run           {distanceM, durationS, areaM2, elevationM, climbPerKm, consistencySeconds, claimed}
 * @param {Array}    props.path          recorded route [{latitude, longitude}]
 * @param {Array}    props.rings         claimed/claimable rings [[[lon,lat], …]]
 * @param {string}   props.accent        accent colour; defaults to the clan's
 * @param {'left'|'center'|'right'} props.align
 * @param {string[]} props.stats         which metrics to show (keys)
 * @param {boolean}  props.showRoute     draw the route at all
 * @param {string}   props.trail         decoration growing out of the route;
 *                                       ignored while TRAIL_DECORATIONS_ENABLED
 *                                       is false
 * @param {object}   props.equipped      the avatar, running at the route's end
 * @param {boolean}  props.showCharacter
 * @param {boolean}  props.flip          face the other way
 */
export default function RunShareCard({
  width,
  team,
  run = {},
  path = [],
  rings = null,
  accent,
  // LEFT, and it now means more than which way the type is ragged: `align` is
  // the card's LAYOUT. Left and right stand the numbers in a column down one
  // side with the route and the runner beside them, which is the poster shape
  // the card was rebuilt to; centre keeps the older stacked arrangement, art
  // in a band across the top with the numbers under it.
  align = 'left',
  stats: statKeys = DEFAULT_STATS,
  showRoute = true,
  trail: wantedTrail = TRAIL_NONE,
  equipped = null,
  showCharacter = true,
  flip = false,
  cardRef,
}) {
  // The one gate that matters: parked means parked, whatever a caller asks
  // for. See TRAIL_DECORATIONS_ENABLED.
  const trail = TRAIL_DECORATIONS_ENABLED ? wantedTrail : TRAIL_NONE;
  const height = width * SHARE_FORMAT.ratio;
  const u = width / 360; // one design unit — every size below is in these

  const glow = accent || team?.glow || brand.pink;

  const padX = 26 * u;
  const padTop = height * SAFE_TOP;
  const padBottom = height * SAFE_BOTTOM;

  // No fill of any kind, so the export keeps its alpha and Instagram lays it
  // over the runner's own selfie.
  const tone = TONE;

  // THREE THINGS AND NOTHING ELSE: the numbers, the route, the wordmark.
  //
  // The territory headline that used to sit at the top — the eyebrow and the
  // big km² — is gone. Area is a number among the others when it is asked for,
  // so the ground is said once rather than twice, and losing that block is most
  // of what makes the card read as simple.
  //
  // Chosen order is the run's own order, not the tap order — a card whose
  // numbers rearrange as you toggle them is a card you cannot aim.
  const stats = availableStats(run).filter((s) => statKeys.includes(s.key));
  // The badge's REAL height, not a guess at it: 3u of stroke top and bottom,
  // 6u of padding each side of an 18u line, and 3u of hard drop hanging below.
  // It was 26 while the signature was a line of text, and every measurement
  // below is taken from it — so the stale number was quietly letting the stat
  // block sit on top of the wordmark. Re-measured when the wordmark grew to
  // match the numbers; keep the two in step.
  const signatureH = 46 * u;

  // --- the two columns ------------------------------------------------------
  //
  // SIDE BY SIDE is the card: numbers down one side, route and runner down the
  // other. `align` picks which side the numbers take. Centre is the older
  // stacked shape, kept for anyone who wants their numbers down the middle of
  // their own story rather than out of the way of a face.
  //
  // The two-up stat GRID is gone with it. Numbers at poster size go one per
  // line, always — a pair sharing a line at 54u is two numbers neither of
  // which is readable, and the grid only ever existed because the type was
  // small enough to fit two of it.
  const sideBySide = align !== 'center';
  // Is there anything to put in the art column at all? A declined claim, a
  // recorder that logged one point, or the Route chip switched off all end the
  // same way — and an empty column beside the numbers is just a card with half
  // its width missing, so the type takes the lot instead.
  const drawable =
    (path?.length || 0) >= 2 || (rings?.[0]?.length || 0) >= 3;
  const hasArt = showRoute && drawable;
  const splitCols = sideBySide && hasArt;
  const inner = width - padX * 2;
  const typeW = splitCols ? inner - inner * ART_COL - COL_GAP * u : inner;

  // ONE SIZE for every number on the card, chosen so the WIDEST of them fits
  // the column it has to live in. See VALUE_FOR_ROWS: the base is how big the
  // type may be for this many rows, and the column is how big it may be given
  // what the run actually reads.
  const base = (VALUE_FOR_ROWS[stats.length] || VALUE_FOR_ROWS[VALUE_FOR_ROWS.length - 1]) * u;
  const widestEm = stats.reduce((m, s) => Math.max(m, statEm(s)), 1);
  const emPerLine = widestEm;
  const valueSize = Math.min(base, (typeW * FIT_SAFETY) / emPerLine);
  const lineH = valueSize * LINE_RATIO;
  const statsH = stats.length * lineH;

  // What the numbers ACTUALLY take across, which is usually less than the
  // column they were offered — the type is capped by VALUE_FOR_ROWS long
  // before it runs out of width. The art gets the difference (see ART_COL), so
  // "beside the numbers" means beside them rather than somewhere off to the
  // right of them.
  const typeUsed = splitCols
    ? Math.min(inner - COL_GAP * u, valueSize * emPerLine * TYPE_X_SCALE * TYPE_RESERVE)
    : typeW;
  // The art keeps clear of the bracket on its own side; the width it gives up
  // for that comes out of the column, not out of the route's size, because the
  // reserve above hands back more than this costs.
  const artEdge = splitCols ? ART_EDGE_U * u : 0;
  const artW = splitCols
    ? Math.max(width * 0.12, inner - typeUsed - COL_GAP * u - artEdge)
    : width;

  // The numbers sit above the wordmark and the art is measured against them.
  const statsBottom = padBottom + signatureH + STATS_TO_MARK_U * u;
  const statsTop = height - statsBottom - statsH;
  const typeLeft = splitCols && align === 'right' ? width - padX - typeW : padX;

  // The art column runs the height of the card between the safe areas, and
  // takes a squarish box out of the middle of it — a route projected into a
  // tall slot keeps its own aspect and draws a stamp in a lot of nothing.
  // Stacked, it keeps the capped band it has always had: the route no longer
  // takes every pixel the furniture does not, because on a sticker the space
  // left over is not waste, it is the runner's own story showing through.
  const bandTop = padTop;
  const bandH = Math.max(0, height - padBottom - signatureH - 10 * u - padTop);
  const stackedFree = height - padTop - (statsBottom + statsH) - 16 * u;
  const artH = splitCols
    ? Math.max(height * 0.16, Math.min(bandH, artW * ART_ASPECT))
    : Math.max(height * 0.16, Math.min(stackedFree, height * ROUTE_SHARE));
  // LEVEL WITH THE NUMBERS, which is the whole claim the side-by-side layout
  // makes. The art box used to be placed against the top safe area (a share of
  // whatever the furniture left over), and on a 9:16 story that stood the route
  // and the runner up in the corner with the numbers a long way below them:
  // two unrelated things on a diagonal rather than one row. It shares the stat
  // block's centre line now, and only slides off it when the card runs out of
  // room top or bottom.
  const artFloor = Math.max(bandTop, height - padBottom - signatureH - artH);
  const artTop = splitCols
    ? Math.max(bandTop, Math.min(artFloor, statsTop + statsH / 2 - artH / 2))
    // Centred in the space it was given, so the gap above the route and the
    // gap down to the numbers are the same gap.
    : padTop + Math.max(0, (stackedFree - artH) / 2);
  // Whichever side the art lands on is the side it has to keep off the bracket,
  // so the extra inset goes on its OUTER edge — left when the numbers are
  // right-aligned, right when they are not.
  const artLeft = splitCols
    ? (align === 'right' ? padX + artEdge : width - padX - artEdge - artW)
    : 0;
  // Breathing room inside the art box. The narrow column cannot afford the
  // 26u the full-width band used — it would be a fifth of the column on each
  // side — so it scales with the box it is padding.
  const artPad = Math.max(8 * u, Math.min(26 * u, artW * 0.1));
  const shapes = useMemo(() => {
    const groups = [];
    const outer = (rings?.[0] || []).filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
    if (outer.length >= 3) groups.push({ points: outer, close: true, kind: 'territory' });
    const routePoints = (path || [])
      .map(lonLat)
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (routePoints.length >= 2) {
      groups.push({
        points: routePoints,
        close: false,
        kind: 'route',
      });
    }
    const projected = projectGroups(groups, artW, artH, artPad);
    return groups.map((g, i) => ({ ...g, ...(projected[i] || {}) })).filter((g) => g.d);
  }, [rings, path, artW, artH, artPad]);

  const territory = shapes.find((s) => s.kind === 'territory');
  const route = shapes.find((s) => s.kind === 'route');

  // The runner is the PASER mark itself, wearing the player's head, and it runs
  // where they stopped: feet on the route's end dot, the one point on the card
  // that means anything. Clamped so a run that finished at an edge doesn't post
  // half a figure.
  // Sized against the COLUMN it stands in, not just the card. At a flat 0.21 of
  // the width the figure was two thirds as wide as the whole art column and
  // stood over its own route rather than on it. With no route at all it is the
  // subject rather than a detail on one, so it gets the whole band.
  // Increased size for better visibility
  const runnerSize = !hasArt
    ? width * 0.52
    : splitCols
      ? Math.min(width * 0.28, artW * 0.8)
      : width * 0.28;
  const runner = (() => {
    if (!showCharacter || !equipped) return null;
    // NOTHING TO STAND ON. The route is off (the sheet's Route chip does
    // exactly this) or there was never one to draw, so the figure stands in
    // the middle of the space the route would have had. It used to keep
    // standing wherever the INVISIBLE line ended, which put a mascot at a
    // random point of somebody's story with nothing to explain it.
    if (!hasArt) {
      return {
        left: (width - runnerSize) / 2,
        top: artTop + Math.max(0, (artH - runnerSize) / 2),
      };
    }
    if (!route) return null;
    // The mark's feet are not at the bottom edge of its square, so the drop is
    // measured to the soles rather than to the image.
    const wanted = artTop + route.end[1] - runnerSize * MARK_FEET + 3 * u;
    // A route that finished high or low would otherwise put the figure off the
    // top of the card or through the numbers. Vertical room is whatever is left
    // between them; if there is none, the top of that gap wins.
    //
    // Side by side the numbers are NOT under the runner, they are beside it, so
    // the floor drops to the wordmark — a route that ends low can stand its
    // figure level with the bottom number instead of being shoved up the card.
    const ceiling = padTop;
    const floor = splitCols
      ? height - (padBottom + signatureH) - runnerSize - 6 * u
      : height - (padBottom + signatureH + STATS_TO_MARK_U * u + statsH) - runnerSize - 6 * u;
    // ACROSS is the same question as down, and it was being answered with half
    // the box — which is not where the figure's foot is. The mark is a running
    // pose: the foot on the ground sits about two thirds of the way across its
    // square (MARK_FOOT), so centring the box on the end dot stood the runner a
    // clear stride to the RIGHT of the line. Anchor the foot instead, and
    // mirror the anchor when the figure is flipped, because `flip` mirrors the
    // whole box.
    const footX = flip ? 1 - MARK_FOOT : MARK_FOOT;
    // ACROSS, the figure is kept to its OWN COLUMN give or take a stride.
    // It used to be clamped only to the card, which was harmless while the art
    // sat up in the corner on its own — now that the box stands level with the
    // numbers, a route ending against the inner edge would walk the mascot
    // right across the figures.
    //
    // The licence is HALF THE FIGURE, not a few points, and that is the whole
    // care needed here: the foot is anchored to the end dot (see MARK_FOOT and
    // the test that pins it), so a tight fence would silently unstick the
    // runner from the end of its own route — which is the one thing on this
    // card that means anything — every time somebody finished a lap near the
    // inside edge. Half a figure of overhang never happens by accident and
    // still catches the case worth catching.
    const stride = runnerSize * 0.5;
    const minLeft = splitCols ? Math.max(4 * u, artLeft - stride) : 4 * u;
    const maxLeft = splitCols
      ? Math.min(width - runnerSize - 4 * u, artLeft + artW - runnerSize + stride)
      : width - runnerSize - 4 * u;
    return {
      // `route.end` is in the ART BOX's own pixels — the box is no longer the
      // whole card, so its offset has to come back in here.
      left: Math.max(minLeft, Math.min(maxLeft, artLeft + route.end[0] - runnerSize * footX)),
      top: floor > ceiling ? Math.max(ceiling, Math.min(floor, wanted)) : ceiling,
    };
  })();

  // One frame around the visible stats and visible route rather than around
  // the route's taller layout slot. The mascot may overlap the frame, like a
  // sticker breaking its border; it must not make the brackets grow longer.
  const contentTops = [statsTop];
  const contentBottoms = [statsTop + statsH];
  const visibleArtY = shapes.flatMap((shape) =>
    (shape.pts || []).map((point) => point[1]).filter(Number.isFinite)
  );
  if (hasArt && visibleArtY.length) {
    contentTops.push(artTop + Math.min(...visibleArtY));
    contentBottoms.push(artTop + Math.max(...visibleArtY));
  }
  const bracketTop = Math.max(padTop, Math.min(...contentTops) - BRACKET_PAD_U * u);
  const bracketLimit = height - padBottom - signatureH - 8 * u;
  const bracketBottom = Math.min(
    bracketLimit,
    Math.max(...contentBottoms) + BRACKET_PAD_U * u
  );
  const bracketLeft = 10 * u;
  const bracketRight = width - 10 * u;
  const bracketCap = BRACKET_CAP_U * u;
  // Brackets removed for cleaner look
  const leftBracket = null;
  const rightBracket = null;

  return (
    <View
      ref={cardRef}
      collapsable={false}
      style={{
        width,
        height,
        // Transparent, always: the export has to keep its alpha or Instagram
        // gets a slab to drag around instead of a sticker.
        backgroundColor: 'transparent',
        overflow: 'hidden',
      }}
    >

      {/* Editorial square brackets removed for cleaner look */}
      {/* <Svg
        testID="share-bracket-frame"
        accessibilityLabel="Square brackets around run stats and route"
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0 }}
        pointerEvents="none"
      >
        {[leftBracket, rightBracket].map((d) => (
          <Path
            key={`under:${d}`}
            d={d}
            fill="none"
            stroke={tone.ink}
            strokeWidth={BRACKET_UNDER_W * u}
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        ))}
        {[leftBracket, rightBracket].map((d) => (
          <Path
            key={`white:${d}`}
            d={d}
            fill="none"
            stroke={tone.text}
            strokeWidth={BRACKET_W * u}
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        ))}
      </Svg> */}

      {/* --- the route: a column beside the numbers, not the whole card ---

              Hidden rather than unmounted when the Route chip is off: the
              layout above has already given its width back to the type, and
              tearing the SVG down and rebuilding it is the sort of churn the
              capture step has to wait out. */}
      <View
        style={{
          position: 'absolute',
          left: artLeft,
          top: artTop,
          width: artW,
          height: artH,
          opacity: hasArt ? 1 : 0,
        }}
      >
        <Svg width={artW} height={artH}>
          {territory && (
            <>
              {/* The ground is the one thing on this card Strava has no
                  equivalent for, and at 40% alpha it was the faintest mark on
                  it — a wash the eye skipped straight over on the way to the
                  route. It gets the same treatment as everything else here: an
                  ink edge under a solid one, so the shape survives whatever it
                  is laid over. The FILL stays translucent on purpose; that is
                  the runner's own photo showing through their land. */}
              <Path
                d={territory.d}
                fill="none"
                stroke={tone.ink}
                strokeWidth={9 * u}
                strokeLinejoin="round"
              />
              <Path
                d={territory.d}
                fill={withAlpha(glow, 0.26)}
                stroke={glow}
                strokeWidth={4 * u}
                strokeLinejoin="round"
              />
            </>
          )}
          {route && (
            <>
              {/* The under-stroke is the route's own legibility: on a sticker
                  there is nothing behind it, so a bare white line disappears
                  the moment it crosses something pale. */}
              {/* Opaque ink, not 40% black. A translucent under-stroke is a
                  grey halo, and a grey halo over a photo is the soft hedge
                  this card gave up everywhere else — the numbers next to it
                  carry a hard ink outline, so the route carrying a smudge was
                  the one element still solving legibility the old way. */}
              <Path
                d={route.d}
                fill="none"
                stroke={tone.ink}
                strokeWidth={ROUTE_UNDER_W * u}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={route.d}
                fill="none"
                stroke={tone.text}
                strokeWidth={ROUTE_W * u}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Over the line, under the dots: the trail is decorated, but
                  where the run started and where it ended still win.

                  PARKED — `TRAIL_DECORATIONS_ENABLED` is false, so `trail` is
                  pinned to none and nothing draws here. The component, its
                  shapes and its placement maths are kept whole for whenever it
                  is switched back on. */}
              <TrailDecorations points={route.pts} decoration={trail} color={glow} u={u} />
              {/* Ringed in ink, like every other mark here. A bare white dot
                  on a pale photo is a hole in the line. */}
              <Circle
                cx={route.start[0]}
                cy={route.start[1]}
                r={8 * u}
                fill={tone.text}
                stroke={tone.ink}
                strokeWidth={3 * u}
              />
              <Circle
                cx={route.end[0]}
                cy={route.end[1]}
                r={8 * u}
                fill={glow}
                stroke={tone.ink}
                strokeWidth={3 * u}
              />
            </>
          )}
        </Svg>
      </View>

      {/* --- the runner: the PASER mark, wearing the player's own head --- */}
      {runner && (
        <View
          testID="share-route-runner"
          style={{ position: 'absolute', left: runner.left, top: runner.top }}
          pointerEvents="none"
        >
          <LogoRunner equipped={equipped} size={runnerSize} color={tone.text} flip={flip} />
        </View>
      )}

      {/* --- the numbers: ONE COLUMN, one per line, stacked tight. The two-up
              grid is gone with the labels — a pair of poster-sized figures
              sharing a line is two numbers neither of which is readable. --- */}
      <View
        style={{
          position: 'absolute',
          left: typeLeft,
          width: typeW,
          bottom: statsBottom,
          height: statsH,
        }}
      >
        {stats.map(({ key, label, ...stat }) => (
          // The ground is the one number Strava does not have, so it is the one
          // that wears the accent. It also gives the accent swatches something
          // to do now that the big coloured headline is gone.
          //
          // `label` is destructured off and dropped on purpose: the sheet's
          // chips still need a human name for every metric, the card does not
          // draw one any more, and passing it through would have Stat quietly
          // accept a prop it never renders.
          <Stat
            key={key}
            {...stat}
            size={valueSize}
            lineH={lineH}
            u={u}
            tone={tone}
            align={align}
            color={key === 'territory' ? glow : undefined}
          />
        ))}
      </View>

      {/* --- signature. THE WORDMARK ALONE — no mark beside it, no handle, no
              clan, no date. Every one of those was noise on somebody's own
              story, where the handle is already at the top of the screen and
              the date is today. --- */}
      <View
        testID="share-signature"
        style={{
          position: 'absolute',
          left: padX,
          right: padX,
          bottom: padBottom,
          flexDirection: 'row',
          alignItems: 'center',
          // The PASER stamp is the sign-off for the whole story and remains
          // centred even when the runner moves the stats left or right.
          justifyContent: 'center',
        }}
      >
        {/* THE SIGNATURE IS A BADGE NOW — a solid block of the run's own accent,
            squared off, with a heavy stroke and a hard offset drop.

            This is the one place on the card where a block is right rather than
            a betrayal of the sticker. The rule the card is built on is that it
            must not become a SLAB — a full-bleed panel that covers the runner's
            own photo — and a signature the size of a word does not do that. It
            is the same shape as the badges on the reference sheet, it is the
            only element here that is pure PASER rather than pure run, and a
            solid block is the one treatment that is unmistakably ours whatever
            it lands on.

            HardShadow rather than a shadow style: this view gets rasterised
            into the exported PNG, and Android would drop a style shadow
            entirely, so half the runners would post a badge with no depth. */}
        <HardShadow
          offset={3 * u}
          color={NB.ink}
          radius={0}
          style={{ alignSelf: 'center' }}
        >
          <View
            style={{
              backgroundColor: glow,
              borderWidth: 3 * u,
              borderColor: NB.ink,
              paddingHorizontal: 14 * u,
              paddingVertical: 6 * u,
            }}
          >
            <Text
              style={{
                // THE SAME FACE AND THE SAME RHYTHM as the numbers above it,
                // which is the point: the wordmark and the figures have to
                // read as one piece of lettering rather than as a logo pasted
                // under a card. It follows the share card's local poster face
                // and stays tightly tracked, because
                // letterspacing heavy enough to be noticed is what made it
                // look like a different typeface the last time.
                fontFamily: RUN_FONT,
                fontSize: 18 * u,
                letterSpacing: 1 * u,
                // Judged against the badge fill: `glow` is the clan colour or
                // the accent, so it can arrive as anything from pale teal to
                // deep purple, and a fixed white wordmark disappears on half of
                // them. This is the whole reason nbTextOn exists.
                color: nbTextOn(glow),
              }}
            >
              {brand.name}
            </Text>
          </View>
        </HardShadow>
      </View>
    </View>
  );
}
