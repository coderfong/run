// PitStopArt — the hydration station itself, drawn as vector art.
//
// THE FULL-SCENE LAYERS IN HERE NO LONGER RENDER. The stall is a painted
// illustration now, cut into two plates by scripts/install-pit-stop-art.py and
// laid down by PitStopScene, so `BackgroundLayer`, `TentLayer`,
// `BackWallLayer`, `CounterBaseLayer`, `CounterFrontLayer`, `BuntingArt` and
// `SignArt` are all dead — kept, like the towels and the cooler before them,
// because they are a complete drawing of this scene and cost nothing to leave
// exported. They are still authored against `SCENE`, which has since been
// re-measured against the painting, so any one of them brought back would need
// its geometry redone first.
//
// WHAT IS STILL LIVE is the second list below: the small props. The house
// style is flat matte fills inside a heavy black outline with no gradients,
// which is the one illustration style SVG reproduces exactly — so the bottle,
// the medal, the cup and the sparkles stay crisp at every width, cost no
// decode, and can be tinted from the palette instead of re-exported.
//
// Two kinds of component live here:
//   * full-scene layers  — retired, see above
//   * props              — authored in their OWN box, sized in the same units
//                          as their frame, so stroke weights match the rest
//                          of the scene once positioned
//
// Nothing here holds state or animates. Movement is applied by the wrappers
// in PitStopScene, which keeps this file a pure drawing.

import React, { memo } from 'react';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { PIT_STOP_COLORS as C, SCENE } from '../../config/pitStop';

// The one outline weight for the whole scene, in reference units.
const INK = 8;
const INK_THIN = 5;

const full = { width: '100%', height: '100%' };
const SCENE_BOX = `0 0 ${SCENE.width} ${SCENE.height}`;

// ---------------------------------------------------------------------------
// 01 — background
// ---------------------------------------------------------------------------

export const BackgroundLayer = memo(function BackgroundLayer() {
  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.skyTop} />
          <Stop offset="1" stopColor={C.skyBottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={SCENE.width} height={SCENE.height} fill="url(#sky)" />
      {/* Far side of the course: a low horizon and two soft crowd mounds, kept
          almost value-less so nothing competes with the crew. */}
      <Ellipse cx="250" cy="640" rx="360" ry="120" fill={C.wallShade} opacity={0.55} />
      <Ellipse cx="1330" cy="654" rx="330" ry="110" fill={C.wallShade} opacity={0.55} />
      <Rect x="0" y="700" width={SCENE.width} height={SCENE.height - 700} fill={C.wallShade} opacity={0.5} />
    </Svg>
  );
});

/**
 * A cloud on the far side of the course. Drawn in its own box so the scene can
 * scale and drift it, and kept close to the sky's own value — the sky is the
 * one place in the frame with no ink outline, and a cloud with an outline
 * there would read as a prop rather than as distance.
 */
export const CloudArt = memo(function CloudArt({ tint = C.fabricShade, opacity = 0.14 }) {
  return (
    <Svg {...full} viewBox="0 0 300 120" pointerEvents="none">
      <G opacity={opacity}>
        <Ellipse cx="96" cy="74" rx="92" ry="42" fill={tint} />
        <Ellipse cx="168" cy="56" rx="70" ry="50" fill={tint} />
        <Ellipse cx="226" cy="78" rx="64" ry="36" fill={tint} />
      </G>
    </Svg>
  );
});

/**
 * One pennant from the back-wall garland, hanging point-down from its own top
 * edge. Authored 66 wide so the triangle's shoulders sit under the cord the
 * scene draws, and given the scene's ink weight so it belongs to the tent
 * rather than floating in front of it.
 */
export const PennantArt = memo(function PennantArt({ color }) {
  return (
    <Svg {...full} viewBox="0 0 66 62" pointerEvents="none">
      <Polygon
        points="4,4 62,4 33,58"
        fill={color}
        stroke={C.ink}
        strokeWidth={INK_THIN}
        strokeLinejoin="round"
      />
    </Svg>
  );
});

/**
 * The cord the pennants hang from — a shallow catenary across the back wall.
 * Static: the flags carry the movement, and a cord that swings with them makes
 * the whole wall look like it is falling down.
 */
export const GarlandCordArt = memo(function GarlandCordArt({ x1, x2, y, sag }) {
  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      <Path
        d={`M ${x1} ${y} Q ${(x1 + x2) / 2} ${y + sag * 2} ${x2} ${y}`}
        fill="none"
        stroke={C.ink}
        strokeWidth="6"
        strokeLinecap="round"
      />
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// 02 — tent interior: canopy, valance, poles
// ---------------------------------------------------------------------------

const CANOPY = 'M -30 268 L -30 132 Q 768 34 1566 132 L 1566 268 Z';

export const TentLayer = memo(function TentLayer() {
  // Scallops along the bottom of the canopy, drawn as one path so the valance
  // reads as a single piece of fabric rather than a row of circles.
  const scallopW = 128;
  const scallops = [];
  for (let x = -30; x < 1566; x += scallopW) {
    scallops.push(`M ${x} 268 a ${scallopW / 2} ${scallopW / 2} 0 0 0 ${scallopW} 0`);
  }

  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      <Defs>
        <ClipPath id="canopyClip">
          <Path d={CANOPY} />
        </ClipPath>
      </Defs>

      {/* Poles first — the canopy sits on top of them. */}
      <Rect x="96" y="250" width="30" height={SCENE.height - 250} fill={C.fabricShade} stroke={C.ink} strokeWidth={INK} />
      <Rect x="1410" y="250" width="30" height={SCENE.height - 250} fill={C.fabricShade} stroke={C.ink} strokeWidth={INK} />

      {/* Canopy body + alternating hydration stripes. */}
      <Path d={CANOPY} fill={C.fabric} />
      <G clipPath="url(#canopyClip)">
        {Array.from({ length: 13 }, (_, i) => (
          <Rect
            key={i}
            x={-30 + i * 128}
            y="20"
            width="64"
            height="260"
            fill={i % 2 === 0 ? C.stripe : C.stripeAlt}
            opacity={i % 2 === 0 ? 0.9 : 0.55}
          />
        ))}
      </G>
      <Path d={CANOPY} fill="none" stroke={C.ink} strokeWidth={INK} />

      {/* Valance. */}
      <Path d={scallops.join(' ')} fill={C.fabric} stroke={C.ink} strokeWidth={INK} strokeLinejoin="round" />
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// 03 — back wall + shelves + wall furniture
// ---------------------------------------------------------------------------

export const BackWallLayer = memo(function BackWallLayer() {
  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      {/* The shaded inside face of the tent. */}
      <Path
        d="M 110 262 L 1426 262 L 1426 884 L 110 884 Z"
        fill={C.fabricShade}
        stroke={C.ink}
        strokeWidth={INK}
      />
      {/* Fabric falls in soft vertical folds. */}
      {[260, 470, 700, 940, 1180].map((x) => (
        <Line key={x} x1={x} y1="270" x2={x + 14} y2="876" stroke={C.fabricDeep} strokeWidth="14" opacity={0.7} />
      ))}

      {/* Two shelves of stock. */}
      <Shelf x={116} y={520} width={360} />
      <Shelf x={1064} y={520} width={360} />

      {/* Left shelf: electrolyte bottles + folded event shirts. The strip at
          x=116-200 is left clear for the stopwatch the scene stands there. */}
      <G>
        <ShelfBottle x={230} baseY={520} color={C.bottlePink} />
        <ShelfBottle x={286} baseY={520} color={C.bottleBlue} />
        <FoldedShirts x={342} baseY={520} />
      </G>

      {/* Right shelf: cup sleeves, beside the stopwatch icon the scene places
          at x=1064. Everything here stays left of x=1320 so the hanging medal
          has clear air to swing in. */}
      <G>
        <CupSleeve x={1180} baseY={520} />
        <CupSleeve x={1248} baseY={520} />
      </G>
    </Svg>
  );
});

function Shelf({ x, y, width }) {
  return (
    <G>
      <Rect x={x} y={y} width={width} height={18} rx={6} fill={C.board} stroke={C.ink} strokeWidth={INK_THIN} />
      <Rect x={x + 26} y={y + 18} width={16} height={34} fill={C.board} stroke={C.ink} strokeWidth={INK_THIN} />
      <Rect x={x + width - 42} y={y + 18} width={16} height={34} fill={C.board} stroke={C.ink} strokeWidth={INK_THIN} />
    </G>
  );
}

function ShelfBottle({ x, baseY, color }) {
  return (
    <G>
      <Rect x={x} y={baseY - 74} width={40} height={74} rx={12} fill={color} stroke={C.ink} strokeWidth={INK_THIN} />
      <Rect x={x + 12} y={baseY - 92} width={16} height={20} fill={C.paper} stroke={C.ink} strokeWidth={INK_THIN} />
      <Rect x={x + 6} y={baseY - 52} width={28} height={16} fill={C.paper} opacity={0.75} />
    </G>
  );
}

function FoldedShirts({ x, baseY }) {
  return (
    <G>
      {[0, 1, 2].map((i) => (
        <Rect
          key={i}
          x={x}
          y={baseY - 26 - i * 22}
          width={120}
          height={22}
          rx={6}
          fill={i === 1 ? C.stripe : C.paper}
          stroke={C.ink}
          strokeWidth={INK_THIN}
        />
      ))}
    </G>
  );
}

function CupSleeve({ x, baseY }) {
  return (
    <G>
      <Path
        d={`M ${x} ${baseY - 78} L ${x + 52} ${baseY - 78} L ${x + 44} ${baseY} L ${x + 8} ${baseY} Z`}
        fill={C.cup}
        stroke={C.ink}
        strokeWidth={INK_THIN}
      />
      <Line x1={x + 4} y1={baseY - 52} x2={x + 48} y2={baseY - 52} stroke={C.stripe} strokeWidth="10" />
    </G>
  );
}

// ---------------------------------------------------------------------------
// Wall furniture — the route board and a race bib, as their own props so they
// can be positioned from the layout table.
// ---------------------------------------------------------------------------

export const RouteBoardArt = memo(function RouteBoardArt() {
  return (
    <Svg {...full} viewBox="0 0 152 136" pointerEvents="none">
      <Rect x="4" y="4" width="144" height="128" rx="12" fill={C.board} stroke={C.ink} strokeWidth="6" />
      {/* A course line with a start dot and a finish flag. */}
      <Path
        d="M 26 104 C 52 104 44 62 72 62 C 100 62 92 34 122 34"
        fill="none"
        stroke={C.stripe}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="16 12"
      />
      <Circle cx="26" cy="104" r="10" fill={C.stripeAlt} stroke={C.ink} strokeWidth="5" />
      <Rect x="116" y="18" width="6" height="34" fill={C.paper} />
      <Polygon points="122,20 150,28 122,38" fill={C.paper} stroke={C.ink} strokeWidth="4" />
    </Svg>
  );
});

export const RaceBibArt = memo(function RaceBibArt() {
  return (
    <Svg {...full} viewBox="0 0 140 128" pointerEvents="none">
      <Rect x="8" y="10" width="124" height="108" rx="10" fill={C.paper} stroke={C.ink} strokeWidth="6" />
      {/* Bib furniture only — never a number. Live data is drawn in native UI. */}
      <Rect x="24" y="28" width="92" height="14" rx="7" fill={C.stripeAlt} />
      <Rect x="24" y="56" width="92" height="26" rx="8" fill={C.fabricShade} />
      <Rect x="24" y="94" width="60" height="10" rx="5" fill={C.fabricDeep} />
      {[26, 114].map((cx) => (
        <Circle key={cx} cx={cx} cy="22" r="6" fill={C.wallShade} />
      ))}
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// 04 / 12 — hanging props. Each is authored hanging FROM ITS TOP EDGE so the
// pivot wrapper in PitStopScene rotates it about the strap, not its middle.
// ---------------------------------------------------------------------------

export const HangingBottleArt = memo(function HangingBottleArt({ color = C.bottleTeal, height = 210 }) {
  const bodyTop = 62;
  return (
    <Svg {...full} viewBox={`0 0 74 ${height}`} pointerEvents="none">
      <Line x1="37" y1="0" x2="37" y2={bodyTop} stroke={C.ink} strokeWidth="6" />
      <Rect x="24" y={bodyTop - 16} width="26" height="18" rx="4" fill={C.paper} stroke={C.ink} strokeWidth="5" />
      <Rect x="6" y={bodyTop} width="62" height={height - bodyTop - 6} rx="22" fill={color} stroke={C.ink} strokeWidth="6" />
      <Rect x="14" y={bodyTop + 34} width="46" height="30" fill={C.paper} opacity={0.85} />
      <Line x1="20" y1={bodyTop + 20} x2="20" y2={height - 24} stroke={C.paper} strokeWidth="8" opacity={0.35} />
    </Svg>
  );
});

/**
 * A medal on a neck ribbon.
 *
 * THE STRAP IS TWO BANDS, NOT A WEDGE. It used to be a single filled triangle
 * from the rail down to the medal, which is the shape a ribbon's silhouette
 * encloses but not the shape a ribbon is — it read as a solid pink cone. The
 * open V between the two bands is the entire cue that this hangs from a neck
 * strap, so the gap has to stay clear all the way down to the disc.
 *
 * Both bands start on the same short segment at the rail, so their strokes
 * overlap there and read as the clasp. They run 6 units past the top of the
 * disc (y 132) so the disc covers their ends rather than leaving two cut edges
 * floating on it.
 */
const MEDAL_STRAP = {
  fill: C.stripeAlt,
  stroke: C.ink,
  strokeWidth: 6,
  strokeLinejoin: 'round',
};

export const HangingMedalArt = memo(function HangingMedalArt() {
  return (
    <Svg {...full} viewBox="0 0 96 232" pointerEvents="none">
      <Path d="M 42 6 L 54 6 L 34 138 L 16 138 Z" {...MEDAL_STRAP} />
      <Path d="M 42 6 L 54 6 L 80 138 L 62 138 Z" {...MEDAL_STRAP} />
      <Circle cx="48" cy="176" r="44" fill={C.gold} stroke={C.ink} strokeWidth="7" />
      <Circle cx="48" cy="176" r="24" fill="none" stroke={C.ink} strokeWidth="5" opacity={0.5} />
      <Path d="M 48 158 l 6 13 14 2 -10 10 3 14 -13 -7 -13 7 3 -14 -10 -10 14 -2 Z" fill={C.paper} opacity={0.9} />
    </Svg>
  );
});

/**
 * Front bunting — one strand of pennants strung along the canopy rail.
 *
 * Arched along the canopy roof rather than sagging through the middle of the
 * scene. The old downward curve still cut across the attendant's hair at
 * 320pt even though its endpoints were high; this upward arch leaves a clean
 * silhouette around all three crew members.
 */
const BUNTING_EDGE_Y = 180;
const BUNTING_ARCH = 92;

export const BuntingArt = memo(function BuntingArt() {
  const flags = [];
  const step = 118;
  for (let i = 0, x = -40; x < SCENE.width + 40; i += 1, x += step) {
    const lift = Math.sin((x / SCENE.width) * Math.PI) * BUNTING_ARCH;
    flags.push({ x, y: BUNTING_EDGE_Y - lift, key: i });
  }
  // A quadratic's midpoint is halfway between its endpoint and control-point
  // y values, hence the 2x lift in the control point below.
  const cord = `M -40 ${BUNTING_EDGE_Y} Q 768 ${BUNTING_EDGE_Y - BUNTING_ARCH * 2} ${SCENE.width + 40} ${BUNTING_EDGE_Y}`;
  const palette = [C.stripe, C.stripeAlt, C.gold, C.paper];

  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      <Path d={cord} fill="none" stroke={C.ink} strokeWidth="7" />
      {flags.map((f, i) => (
        <Polygon
          key={f.key}
          points={`${f.x},${f.y} ${f.x + 72},${f.y} ${f.x + 36},${f.y + 70}`}
          fill={palette[i % palette.length]}
          stroke={C.ink}
          strokeWidth="6"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
});

/** The station sign: a drawn cup-and-drop mark. No lettering — the name is
 *  native text in the header, so it stays translatable. */
export const SignArt = memo(function SignArt() {
  return (
    <Svg {...full} viewBox="0 0 292 168" pointerEvents="none">
      <Line x1="60" y1="0" x2="76" y2="26" stroke={C.ink} strokeWidth="7" />
      <Line x1="232" y1="0" x2="216" y2="26" stroke={C.ink} strokeWidth="7" />
      <Rect x="8" y="24" width="276" height="132" rx="20" fill={C.stripeAlt} stroke={C.ink} strokeWidth="8" />
      <Rect x="26" y="42" width="240" height="96" rx="12" fill={C.paper} />
      {/* cup */}
      <Path d="M 92 66 L 154 66 L 144 124 L 102 124 Z" fill={C.stripe} stroke={C.ink} strokeWidth="7" strokeLinejoin="round" />
      <Line x1="88" y1="82" x2="158" y2="82" stroke={C.ink} strokeWidth="6" />
      {/* drop */}
      <Path d="M 196 62 C 214 88 224 100 224 112 a 28 28 0 0 1 -56 0 c 0 -12 10 -24 28 -50 Z" fill={C.bottleBlue} stroke={C.ink} strokeWidth="7" strokeLinejoin="round" />
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// 05 / 11 — the counter
// ---------------------------------------------------------------------------

export const CounterBaseLayer = memo(function CounterBaseLayer() {
  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      {/* The top surface only. The front face is a separate, later layer so
          the crew can be sandwiched between them. */}
      <Path
        d={`M 20 ${SCENE.counterTop} L ${SCENE.width - 20} ${SCENE.counterTop} L ${SCENE.width - 20} ${SCENE.counterFront} L 20 ${SCENE.counterFront} Z`}
        fill={C.counterTop}
        stroke={C.ink}
        strokeWidth={INK}
      />
    </Svg>
  );
});

export const CounterFrontLayer = memo(function CounterFrontLayer() {
  const top = SCENE.counterFront;
  const W = SCENE.width;
  // The cloth hangs all the way to the bottom of the frame. A short skirt
  // over bare dark board left the lower third of the scene as dead space.
  const drops = [];
  for (let x = 88; x < W; x += 148) drops.push(x);

  return (
    <Svg {...full} viewBox={SCENE_BOX} pointerEvents="none">
      {/* Front face. */}
      <Rect x="20" y={top} width={W - 40} height={SCENE.height - top + 10} fill={C.counterFace} stroke={C.ink} strokeWidth={INK} />
      {/* Event dressing: a teal cloth with a purple stripe, then the station's
          drop mark repeated along it. */}
      <Rect x="20" y={top + 14} width={W - 40} height={SCENE.height - top} fill={C.counterSkirt} />
      <Rect x="20" y={top + 84} width={W - 40} height="26" fill={C.counterEdge} />
      <Line x1="20" y1={top + 14} x2={W - 20} y2={top + 14} stroke={C.ink} strokeWidth={INK_THIN} />
      <Line x1="20" y1={top + 84} x2={W - 20} y2={top + 84} stroke={C.ink} strokeWidth={INK_THIN} />
      <Line x1="20" y1={top + 110} x2={W - 20} y2={top + 110} stroke={C.ink} strokeWidth={INK_THIN} />
      {drops.map((x) => (
        <Path
          key={x}
          d={`M ${x} ${top + 150} c 12 18 20 27 20 35 a 20 20 0 0 1 -40 0 c 0 -8 8 -17 20 -35 Z`}
          fill={C.paper}
          opacity={0.85}
          stroke={C.ink}
          strokeWidth={INK_THIN}
          strokeLinejoin="round"
        />
      ))}
      {/* Lip highlight along the counter edge. */}
      <Rect x="20" y={top - 12} width={W - 40} height="14" fill={C.stripe} opacity={0.5} />
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// 06 / 11 — counter props
// ---------------------------------------------------------------------------

export const CoolerArt = memo(function CoolerArt() {
  return (
    <Svg {...full} viewBox="0 0 208 186" pointerEvents="none">
      <Rect x="14" y="40" width="180" height="140" rx="16" fill={C.cooler} stroke={C.ink} strokeWidth="8" />
      <Rect x="4" y="14" width="200" height="34" rx="14" fill={C.coolerLid} stroke={C.ink} strokeWidth="8" />
      <Rect x="88" y="0" width="32" height="20" rx="8" fill={C.coolerLid} stroke={C.ink} strokeWidth="6" />
      {/* Tap. */}
      <Rect x="86" y="120" width="36" height="26" rx="6" fill={C.board} stroke={C.ink} strokeWidth="6" />
      <Rect x="98" y="140" width="12" height="22" fill={C.board} stroke={C.ink} strokeWidth="5" />
      {/* Water window. */}
      <Rect x="36" y="66" width="60" height="40" rx="8" fill={C.paper} opacity={0.55} />
    </Svg>
  );
});

/** The cup the attendant offers across the counter. */
export const OfferCupArt = memo(function OfferCupArt() {
  return (
    <Svg {...full} viewBox="0 0 96 132" pointerEvents="none">
      <Path d="M 10 18 L 86 18 L 74 122 L 22 122 Z" fill={C.cup} stroke={C.ink} strokeWidth="8" strokeLinejoin="round" />
      <Path d="M 6 18 L 90 18" stroke={C.ink} strokeWidth="8" strokeLinecap="round" />
      {/* Water line + a highlight so it reads as full at a glance. */}
      <Path d="M 16 44 L 80 44 L 71 116 L 25 116 Z" fill={C.bottleBlue} opacity={0.55} />
      <Line x1="30" y1="58" x2="34" y2="106" stroke={C.paper} strokeWidth="8" opacity={0.55} />
    </Svg>
  );
});

export const TowelsArt = memo(function TowelsArt() {
  return (
    <Svg {...full} viewBox="0 0 224 150" pointerEvents="none">
      {[
        { x: 6, y: 74, fill: C.towel },
        { x: 118, y: 74, fill: C.towelAlt },
        { x: 62, y: 8, fill: C.paper },
      ].map((r, i) => (
        <G key={i}>
          <Rect x={r.x} y={r.y} width="100" height="68" rx="34" fill={r.fill} stroke={C.ink} strokeWidth="8" />
          <Circle cx={r.x + 34} cy={r.y + 34} r="16" fill="none" stroke={C.ink} strokeWidth="6" opacity={0.6} />
        </G>
      ))}
    </Svg>
  );
});

export const GelsArt = memo(function GelsArt() {
  return (
    <Svg {...full} viewBox="0 0 196 122" pointerEvents="none">
      <Rect x="6" y="34" width="184" height="84" rx="12" fill={C.board} stroke={C.ink} strokeWidth="8" />
      {[0, 1, 2, 3].map((i) => (
        <Rect
          key={i}
          x={20 + i * 44}
          y={6}
          width="34"
          height="62"
          rx="8"
          fill={i % 2 ? C.gel : C.stripeAlt}
          stroke={C.ink}
          strokeWidth="6"
        />
      ))}
    </Svg>
  );
});

export const FruitArt = memo(function FruitArt() {
  return (
    <Svg {...full} viewBox="0 0 132 104" pointerEvents="none">
      <Path d="M 6 62 a 60 40 0 0 0 120 0 Z" fill={C.paper} stroke={C.ink} strokeWidth="8" strokeLinejoin="round" />
      <Path d="M 22 60 C 30 22 62 8 84 12 C 66 26 60 44 58 60 Z" fill={C.fruit} stroke={C.ink} strokeWidth="7" strokeLinejoin="round" />
      <Path d="M 58 60 C 66 28 92 16 112 22 C 94 34 86 46 82 60 Z" fill={C.fruit} stroke={C.ink} strokeWidth="7" strokeLinejoin="round" />
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// 13 — effects
// ---------------------------------------------------------------------------

export const GlowArt = memo(function GlowArt({ color = C.glow }) {
  return (
    <Svg {...full} viewBox="0 0 200 200" pointerEvents="none">
      <Defs>
        <RadialGradient id="g" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity="0.95" />
          <Stop offset="0.55" stopColor={color} stopOpacity="0.35" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="100" cy="100" r="100" fill="url(#g)" />
    </Svg>
  );
});

/** A single four-point sparkle. */
export const SparkleArt = memo(function SparkleArt({ color = C.glow }) {
  return (
    <Svg {...full} viewBox="0 0 40 40" pointerEvents="none">
      <Path
        d="M 20 0 C 22 14 26 18 40 20 C 26 22 22 26 20 40 C 18 26 14 22 0 20 C 14 18 18 14 20 0 Z"
        fill={color}
      />
    </Svg>
  );
});

/** The legendary light column. Soft-edged, never a full-screen flash. */
export const LightColumnArt = memo(function LightColumnArt({ color = C.glowLegendary }) {
  return (
    <Svg {...full} viewBox="0 0 260 700" pointerEvents="none">
      <Defs>
        <LinearGradient id="col" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="0.55" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d="M 92 700 L 168 700 L 240 0 L 20 0 Z" fill="url(#col)" />
    </Svg>
  );
});
