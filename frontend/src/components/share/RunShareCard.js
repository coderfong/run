// The image that leaves the app, built to Strava's shape: a route, four
// numbers under it and the wordmark at the bottom — on NOTHING.
//
// THREE THINGS. That is the whole card, and the simplification on 2026-08-16
// is what got it there: the territory headline (an eyebrow and a 44pt km²) came
// off the top, area moved into the numbers where it is said once instead of
// twice, the route stopped taking every pixel the furniture did not and now
// gets a capped band, and the runner figure starts switched off. Empty space on
// a sticker is not waste — it is the runner's own story showing through.
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

import React, { useEffect, useMemo } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import LogoRunner, { MARK_FEET } from '../character/LogoRunner';
import TrailDecorations, { TRAIL_NONE } from './trailDecorations';
import { TRAIL_DECORATIONS_ENABLED } from '../../config/releaseFeatures';
import { brand, type, withAlpha } from '../../theme';
import { SHARE_DEBUG_FLAGS, shareCrumb } from '../../utils/shareDebugFlags';

// The canvas colour Instagram paints BEHIND the sticker, until the runner picks
// their own background. Never painted on the card itself, which is transparent
// all the way to its edges.
export const CARD_INK = '#07080A';

export const SHARE_FORMATS = {
  story: { key: 'story', label: 'Story', ratio: 16 / 9, export: { width: 1080, height: 1920 } },
  square: { key: 'square', label: 'Square', ratio: 1, export: { width: 1080, height: 1080 } },
};

// Instagram's own chrome (profile row up top, reply bar and share row along the
// bottom) covers roughly the first 11% and last 15% of a story.
const STORY_SAFE_TOP = 0.11;
const STORY_SAFE_BOTTOM = 0.15;
// Native SVG only needs enough vertices to preserve the route at share-card
// resolution. Keeping every recorder fix can create a multi-thousand-command
// path exactly when Continue mounts the share preview.
const MAX_DRAW_POINTS = 480;
// How much of the card the route is allowed to take. The same share in both
// formats: the square's numbers sat right under the line when it was given
// more, and "the route is smaller" is not a thing that should depend on which
// shape you picked.
const ROUTE_SHARE = 0.3;

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
const STAT_ROW_U = 62;

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
const TONE = {
  text: '#FFFFFF',
  label: 'rgba(255,255,255,0.98)',
  unit: 'rgba(255,255,255,0.96)',
  shadow: 'rgba(0,0,0,0.85)',
  radius: 5,
};

function Stat({ label, value, unit, u, tone, align, color }) {
  return (
    <View style={{ flex: 1, alignItems: FLEX_ALIGN[align] }}>
      <Text
        style={[
          type.labelSm,
          {
            fontSize: 10 * u,
            letterSpacing: 0.9 * u,
            color: tone.label,
            textShadowColor: tone.shadow,
            textShadowRadius: tone.radius * u,
            marginBottom: 1 * u,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text
          style={[
            type.statHero,
            {
              fontSize: 27 * u,
              lineHeight: 32 * u,
              color: color || tone.text,
              textShadowColor: tone.shadow,
              textShadowRadius: tone.radius * u,
            },
          ]}
        >
          {value}
        </Text>
        {!!unit && (
          <Text
            style={[
              type.statSm,
              {
                fontSize: 12 * u,
                color: tone.unit,
                textShadowColor: tone.shadow,
                textShadowRadius: tone.radius * u,
                marginLeft: 2 * u,
                marginBottom: 4 * u,
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
 * @param {'story'|'square'} props.format
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
  format = 'story',
  width,
  team,
  run = {},
  path = [],
  rings = null,
  accent,
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
  const spec = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const height = width * spec.ratio;
  const u = width / 360; // one design unit — every size below is in these
  const story = spec.key === 'story';

  const glow = accent || team?.glow || brand.pink;

  const padX = 26 * u;
  const padTop = story ? height * STORY_SAFE_TOP : 24 * u;
  const padBottom = story ? height * STORY_SAFE_BOTTOM : 24 * u;

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
  const signatureH = 26 * u;
  const statRows = Math.ceil(stats.length / 2);
  const statsH = statRows * STAT_ROW_U * u;
  const bottomBlock = padBottom + signatureH + 14 * u + statsH;
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
  useEffect(() => {
    shareCrumb('RunShareCard mounted', { ...SHARE_DEBUG_FLAGS });
  }, []);

  const runnerSize = width * 0.21;
  const runner = (() => {
    // The rig spent months as the prime suspect for the crash-on-open and was
    // never it: the sheet still died with this whole card unmounted. The real
    // cause was an `undefined` brand icon in RunShareSheet.js. The flag stays
    // as a way to take the avatar out from the device, but it is ON.
    if (!SHARE_DEBUG_FLAGS.runner) return null;
    if (!showCharacter || !equipped || !route) return null;
    // The mark's feet are not at the bottom edge of its square, so the drop is
    // measured to the soles rather than to the image.
    const wanted = artTop + route.end[1] - runnerSize * MARK_FEET + 3 * u;
    // A route that finished high or low would otherwise put the figure off the
    // top of the card or through the numbers. Vertical room is whatever is left
    // between them; if there is none, the top of that gap wins.
    const ceiling = padTop;
    const floor = height - (padBottom + signatureH + 14 * u + statsH) - runnerSize - 6 * u;
    return {
      left: Math.max(6 * u, Math.min(width - runnerSize - 6 * u, route.end[0] - runnerSize / 2)),
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
        {SHARE_DEBUG_FLAGS.cardSvg && <Svg width={width} height={artH}>
          {territory && (
            <Path
              d={territory.d}
              fill={withAlpha(glow, 0.18)}
              stroke={withAlpha(glow, 0.4)}
              strokeWidth={3 * u}
              strokeLinejoin="round"
            />
          )}
          {route && (
            <>
              {/* The under-stroke is the route's own legibility: on a sticker
                  there is nothing behind it, so a bare white line disappears
                  the moment it crosses something pale. */}
              <Path
                d={route.d}
                fill="none"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth={11 * u}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={route.d}
                fill="none"
                stroke={tone.text}
                strokeWidth={5 * u}
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
              <Circle cx={route.start[0]} cy={route.start[1]} r={7 * u} fill={tone.text} />
              <Circle cx={route.end[0]} cy={route.end[1]} r={7 * u} fill={glow} />
            </>
          )}
        </Svg>}
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
          bottom: padBottom + signatureH + 14 * u,
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
              // One chosen metric gets the whole row — half a row with nothing
              // beside it reads as a layout that lost something.
              width: stats.length === 1 ? '100%' : '50%',
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
        <Text
          style={[
            type.labelSm,
            {
              fontSize: 15 * u,
              letterSpacing: 2.6 * u,
              color: tone.text,
              textShadowColor: tone.shadow,
              textShadowRadius: tone.radius * u,
            },
          ]}
        >
          {brand.name}
        </Text>
      </View>
    </View>
  );
}
