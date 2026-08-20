// The image that leaves the app, built to Strava's shape: a route, four
// numbers under it and the wordmark at the bottom — on NOTHING.
//
// THREE THINGS. That is the whole card, and the simplification on 2026-08-16
// is what got it there: the territory headline (an eyebrow and a 44pt km²) came
// off the top, area moved into the numbers where it is said once instead of
// twice, and the route stopped taking every pixel the furniture did not and now
// gets a capped band. Empty space on a sticker is not waste — it is the
// runner's own story showing through.
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
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import LogoRunner, { MARK_FEET, MARK_FOOT } from '../character/LogoRunner';
import TrailDecorations, { TRAIL_NONE } from './trailDecorations';
import { TRAIL_DECORATIONS_ENABLED } from '../../config/releaseFeatures';
import { NB, brand, fonts, nbTextOn, type, withAlpha } from '../../theme';
import OutlinedText from '../ui/OutlinedText';
import HardShadow from '../ui/HardShadow';

// The canvas colour Instagram paints BEHIND the sticker, until the runner picks
// their own background. Never painted on the card itself, which is transparent
// all the way to its edges.
export const CARD_INK = '#07080A';

// ONE SHAPE, and only one: 9:16, the story canvas.
//
// There was a 1:1 "Post" beside it and it is gone. This card exists to land in
// an Instagram story as a sticker, and the square was never the same picture
// with a different crop — the safe areas, the route band and the two-up stat
// grid are all measured against the story's height, so the square quietly
// re-cut every one of them and shipped a second layout nobody was tuning.
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
// How much of the card the route is allowed to take. Given more, the numbers
// end up sitting right under the line.
const ROUTE_SHARE = 0.3;

// How thick the route draws, as a share of the card's width rather than a
// fixed size. A 5pt line on a 1080px export is a hair — on the exported PNG it
// came out visibly thinner than the type beside it, which is what made the
// route read as a diagram rather than as the subject. Strava's route is the
// heaviest mark on their card; this makes ours the same weight class as the
// numbers it sits above.
const ROUTE_W = 7;
const ROUTE_UNDER_W = 15;

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
  run = {
    ...run,
    distanceM: Number.isFinite(Number(run.distanceM)) ? Number(run.distanceM) : 0,
    durationS: Number.isFinite(Number(run.durationS)) ? Number(run.durationS) : 0,
    elevationM: Number.isFinite(Number(run.elevationM)) ? Number(run.elevationM) : 0,
    bestKmSeconds: Number.isFinite(Number(run.bestKmSeconds)) ? Number(run.bestKmSeconds) : 0,
    avgSpeedKmh: Number.isFinite(Number(run.avgSpeedKmh)) ? Number(run.avgSpeedKmh) : 0,
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
  if (run.bestKmSeconds) {
    out.push({ key: 'bestKm', label: 'Best km', value: paceStr(run.bestKmSeconds), unit: '/km' });
  }
  if (run.avgSpeedKmh) {
    out.push({ key: 'avgSpeed', label: 'Avg speed', value: run.avgSpeedKmh.toFixed(1), unit: 'km/h' });
  }
  if (run.areaM2 > 0) {
    out.push({ key: 'territory', label: 'Territory', value: km2(run.areaM2), unit: 'km²' });
  }
  return out;
}

// What a card shows before anyone touches anything: Strava's three, plus the
// ground — the one number Strava does not have. Pace came out when the card was
// simplified; it is still a chip, it is just not on by default, because four
// numbers is a 2x2 block and five is a block with a gap in it.
export const DEFAULT_STATS = ['distance', 'time', 'elevation', 'territory'];


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

// Label over value, the way Strava stacks them. White with a shadow, so it
// survives whatever photo ends up underneath.
//
// The row these sit in has a FIXED height (STAT_ROW_U) that the route's band is
// measured against — a stat block that grows without the route shrinking is how
// a long route ends up drawn straight through the numbers.
//
// It is deliberately taller than the type in it. Four numbers sit two above and
// two below, and at the old 46 the first row's digits ran straight into the
// second row's label — two rows that read as one block of text. The extra
// height IS the gap between them; each pair gets its own line.
//
// 82, up from 62, and that is the single biggest thing separating this card
// from Strava's. Theirs gives three numbers most of the height of the story
// and lets them breathe; ours packed four into a block the size of a caption
// and parked it in a corner, so the card read as a footer stuck to somebody's
// photo rather than as the thing being posted. The type below grew with it —
// the extra row height is the air the bigger digits need, not padding.
const STAT_ROW_U = 82;

// The type inside a stat, in design units. Pulled out of the component because
// the row height above has to be chosen against them: LABEL_U + VALUE_LINE_U
// plus the gaps is what one stat actually occupies, and a row shorter than
// that is how the first row's digits end up touching the second row's label.
const LABEL_U = 12;
const VALUE_U = 38;
const VALUE_LINE_U = 44;
const UNIT_U = 15;

// Air between the last number and the wordmark. This was a bare `14 * u`
// written out at three separate call sites — the stat block's own bottom, the
// runner's floor, and the reserve the route is measured against — so the three
// could drift apart and the runner could end up standing in the gap.
const STATS_TO_MARK_U = 24;

// Alignment, as the two things a layout needs it for.
const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };
const ROW_JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

// How hard the type has to fight whatever ends up behind it.
//
// There IS no background — the type may land on a pale sky or a white t-shirt,
// where translucent labels simply vanish. So everything is fully opaque and
// carries a tight shadow that reads as an outline rather than a glow.
//
// WHITE, always. There used to be a second tone here — ink type carrying a
// white halo, offered as a Light/Dark switch on the sheet — and it was cut:
// black type on a sticker with no background of its own is the one combination
// that disappears, and nobody wanted it over their own story anyway.
// NEO-BRUTALIST, and not only for the look: this style's two devices are the
// exact answer to the problem above. A blurred halo protects type by fading
// into whatever is behind it, which is a hedge — on a busy photo it turns to
// mush. A hard black STROKE round the glyphs cannot be argued with, and a
// solid block with a stroke round it is legible over literally anything. The
// sticker was already solving "readable on anything" the soft way; this solves
// it the loud way and gets the design for free.
//
// The numbers and the wordmark are drawn with `OutlinedText`, which stacks
// eight offset copies to make a real outline. The small LABELS are not: an
// eight-copy ring at 10pt closes up the counters, so they keep a shadow —
// offset on both axes with zero blur, which is the hard-drop recipe applied to
// type rather than to a box.
const TONE = {
  text: '#FFFFFF',
  label: 'rgba(255,255,255,0.98)',
  unit: 'rgba(255,255,255,0.96)',
  ink: NB.ink,
  shadow: NB.ink,
  radius: 0,
};

function Stat({ label, value, unit, u, tone, align, color }) {
  // Anton throughout (fonts.poster), where this used to be Poppins Black. The
  // card is rasterised once and never counts up, so the tabular figures the
  // old Space Grotesk was chosen for do not matter — what matters is that the
  // exported card reads as athletic rather than kiddy, and Poppins Black's
  // round caps were the kiddy part. Anton is the tall condensed poster face
  // Strava uses; the neo-brutalist ink stroke round it does the rest.
  const hard = {
    textShadowColor: tone.shadow,
    textShadowOffset: { width: 1.5 * u, height: 1.5 * u },
    textShadowRadius: 0,
  };
  return (
    <View style={{ flex: 1, alignItems: FLEX_ALIGN[align] }}>
      <Text
        style={[
          type.labelSm,
          {
            fontFamily: fonts.poster,
            fontSize: LABEL_U * u,
            letterSpacing: 1.1 * u,
            color: tone.label,
            marginBottom: 3 * u,
            ...hard,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {/* STRETCHED, and justified rather than aligned. The row used to size
          itself to its own content, which meant the number had no box to be
          too big for — a 38u "1:38:22" simply ran out past the half-width cell
          it lives in and, on a two-up grid, straight into the number beside
          it. Giving the row the cell's full width is what makes `fit` below
          able to do anything at all. */}
      <View
        style={{
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: ROW_JUSTIFY[align],
        }}
      >
        {/* A real stroke, not a shadow. This is the number somebody screenshots
            and it has to survive a white t-shirt behind it. */}
        <OutlinedText
          style={[
            type.statHero,
            {
              fontFamily: fonts.poster,
              fontSize: VALUE_U * u,
              lineHeight: VALUE_LINE_U * u,
              color: color || tone.text,
            },
          ]}
          outline={tone.ink}
          // The stroke grows WITH the type. Held at 2u it thinned out as the
          // digits got bigger, which is the opposite of what a heavier number
          // needs — the outline is the card's whole answer to landing on a
          // white t-shirt, so it has to stay proportional to what it is
          // outlining.
          width={2.6 * u}
          align={align}
          // The long-run insurance. Four numbers at this size fit their half
          // of the card comfortably — until a run passes an hour and `time`
          // becomes "1:38:22", or passes ten and becomes "10:05:33". Rather
          // than sizing every number for the longest string anybody might ever
          // run, the one that gets long shrinks to fit its own cell. `fit`
          // applies to the outline ring too, so the stroke shrinks with it.
          fit
          minimumFontScale={0.62}
          containerStyle={{ flexShrink: 1 }}
        >
          {value}
        </OutlinedText>
        {!!unit && (
          <Text
            style={[
              type.statSm,
              {
                fontFamily: fonts.poster,
                fontSize: UNIT_U * u,
                color: tone.unit,
                marginLeft: 4 * u,
                // Sits on the value's baseline rather than floating off the
                // bottom of its box — measured off the line box now that the
                // two differ by more than a couple of points.
                marginBottom: 6 * u,
                ...hard,
              },
            ]}
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
 * @param {object}   props.run           {distanceM, durationS, areaM2, elevationM, claimed}
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
  // CENTRED, like the card this one is measured against. Strava runs one
  // centred column down the middle of the story and the wordmark under it, and
  // that single axis is most of why theirs reads as a poster and ours read as
  // a caption pinned to the bottom-left corner. Left and right are still on
  // the sheet for anyone who wants the numbers out of the way of a face.
  align = 'center',
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

  // THREE THINGS AND NOTHING ELSE: the route, the numbers, the wordmark. That
  // is the Strava shape and it is what this card is now.
  //
  // The territory headline that used to sit at the top — the eyebrow and the
  // big km² — is gone. Area is one of the four numbers instead, so it is said
  // once rather than twice, and losing the block is most of what makes the card
  // read as simple.
  //
  // Chosen order is the run's own order, not the tap order — a card whose
  // numbers rearrange as you toggle them is a card you cannot aim.
  const stats = availableStats(run).filter((s) => statKeys.includes(s.key));
  // The badge's REAL height, not a guess at it: 3u of stroke top and bottom,
  // 6u of padding each side of a 15u line, and 3u of hard drop hanging below.
  // It was 26 while the signature was a line of text, and every measurement
  // below is taken from it — so the stale number was quietly letting the stat
  // block sit on top of the wordmark.
  const signatureH = 40 * u;
  // How many numbers sit on a line. TWO or fewer get a line each, Strava-style —
  // a card with just distance and time reads better as two full-width rows than
  // as one cramped pair sharing a line. Three or more go two-up, because past
  // that a single column would push the numbers off the bottom of the card.
  const perRow = stats.length <= 2 ? 1 : 2;
  const statRows = Math.ceil(stats.length / perRow);
  const statsH = statRows * STAT_ROW_U * u;
  const bottomBlock = padBottom + signatureH + STATS_TO_MARK_U * u + statsH;
  // The route no longer takes every pixel the furniture does not. It gets a
  // BAND, capped at a share of the card, and whatever is left over stays empty
  // — on a sticker that space is not waste, it is the runner's own story
  // showing through. A route drawn as large as the card allows is the single
  // thing that made this look like a poster instead of a sticker.
  const free = height - padTop - bottomBlock - 16 * u;
  const artH = Math.max(height * 0.16, Math.min(free, height * ROUTE_SHARE));
  // Centred in the space it was given, so the gap above the route and the gap
  // down to the numbers are the same gap.
  const artTop = padTop + Math.max(0, (free - artH) / 2);
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
    const projected = projectGroups(groups, width, artH, 26 * u);
    return groups.map((g, i) => ({ ...g, ...(projected[i] || {}) })).filter((g) => g.d);
  }, [rings, path, width, artH, u]);

  const territory = shapes.find((s) => s.kind === 'territory');
  const route = shapes.find((s) => s.kind === 'route');

  // The runner is the PASER mark itself, wearing the player's head, and it runs
  // where they stopped: feet on the route's end dot, the one point on the card
  // that means anything. Clamped so a run that finished at an edge doesn't post
  // half a figure.
  const runnerSize = width * 0.21;
  const runner = (() => {
    if (!showCharacter || !equipped || !route) return null;
    // The mark's feet are not at the bottom edge of its square, so the drop is
    // measured to the soles rather than to the image.
    const wanted = artTop + route.end[1] - runnerSize * MARK_FEET + 3 * u;
    // A route that finished high or low would otherwise put the figure off the
    // top of the card or through the numbers. Vertical room is whatever is left
    // between them; if there is none, the top of that gap wins.
    const ceiling = padTop;
    const floor = height - (padBottom + signatureH + STATS_TO_MARK_U * u + statsH) - runnerSize - 6 * u;
    // ACROSS is the same question as down, and it was being answered with half
    // the box — which is not where the figure's foot is. The mark is a running
    // pose: the foot on the ground sits about two thirds of the way across its
    // square (MARK_FOOT), so centring the box on the end dot stood the runner a
    // clear stride to the RIGHT of the line. Anchor the foot instead, and
    // mirror the anchor when the figure is flipped, because `flip` mirrors the
    // whole box.
    const footX = flip ? 1 - MARK_FOOT : MARK_FOOT;
    return {
      left: Math.max(
        4 * u,
        Math.min(width - runnerSize - 4 * u, route.end[0] - runnerSize * footX)
      ),
      top: floor > ceiling ? Math.max(ceiling, Math.min(floor, wanted)) : ceiling,
    };
  })();

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

      {/* --- the route: a band, not the whole card --- */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: artTop,
          width,
          height: artH,
          opacity: showRoute ? 1 : 0,
        }}
      >
        <Svg width={width} height={artH}>
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
          style={{ position: 'absolute', left: runner.left, top: runner.top }}
          pointerEvents="none"
        >
          <LogoRunner equipped={equipped} size={runnerSize} color={tone.text} flip={flip} />
        </View>
      )}

      {/* --- the numbers, in a two-up grid across the bottom. One row of four
              collided the moment a pace and a duration sat side by side. --- */}
      <View
        style={{
          position: 'absolute',
          left: padX,
          right: padX,
          bottom: padBottom + signatureH + STATS_TO_MARK_U * u,
          flexDirection: 'row',
          flexWrap: 'wrap',
          height: statsH,
        }}
      >
        {stats.map(({ key, ...stat }) => (
          // The ground is the one number Strava does not have, so it is the one
          // that wears the accent. It also gives the accent swatches something
          // to do now that the big coloured headline is gone.
          <View
            key={key}
            style={{
              // One per line at two or fewer (see perRow), two-up beyond that.
              // A single metric already got the whole row this way; now a pair
              // does too, so distance-and-time stack like Strava rather than
              // splitting one line down the middle.
              width: perRow === 1 ? '100%' : '50%',
              height: STAT_ROW_U * u,
            }}
          >
            <Stat
              {...stat}
              u={u}
              tone={tone}
              align={align}
              color={key === 'territory' ? glow : undefined}
            />
          </View>
        ))}
      </View>

      {/* --- signature. THE WORDMARK ALONE — no mark beside it, no handle, no
              clan, no date. Every one of those was noise on somebody's own
              story, where the handle is already at the top of the screen and
              the date is today. --- */}
      <View
        style={{
          position: 'absolute',
          left: padX,
          right: padX,
          bottom: padBottom,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: ROW_JUSTIFY[align],
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
                fontFamily: fonts.poster,
                fontSize: 15 * u,
                letterSpacing: 2.6 * u,
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
