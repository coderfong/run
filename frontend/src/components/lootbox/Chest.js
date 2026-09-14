// The chest. Drawn, not shipped.
//
// WHY IT IS VECTOR AND NOT ART. Four rarities times a shut and an open pose is
// eight bitmaps, and this app is already over the OTA asset ceiling — every
// new PNG is another reason a JS-only change needs a full native build. It is
// also the wrong tool: the whole point of the gamble is that the box CHANGES
// RARITY WHILE YOU WATCH, and a crossfade between two bitmaps is a dissolve,
// not a recolour. Here the rarity is a fill, so it can be animated between
// values and the gold furniture stays exactly where it was.
//
// THE GOLD IS CONSTANT, THE PANELS ARE THE RARITY. Both halves of the
// reference use the same yellow banding on a coloured body, which is what
// makes the upgrade legible: the object is obviously the same object, and only
// the material changed. Recolouring the whole chest would read as a different
// chest arriving.
//
// THE LID IS TWO FLAT DRAWINGS, AND NOTHING HERE IS 3D. It used to be one lid
// hinged with `rotateX` under a `perspective`, pivoted by a transformOrigin
// string built from the width: `${width / 2}px ${lidH}px`. React Native reads
// that string with /\d+(?:%|px)/, whole numbers only, so any fractional size
// was shredded into a garbage origin. On a 393pt iPhone "121.83px 101.89px"
// became [83, 0, 89418181818182]; that z, multiplied through the perspective,
// put every point of the lid behind the camera, and the gamble drew a base
// with nothing on it. Other widths drew the lid, then flung it to infinity the
// moment it opened. No width ever got a working hinge.
//
// Seen square on, a lid swinging back is its front face flattening into the
// seam and then its hollow rising out of the same line, so that is what is
// drawn: `ChestLid`, squashed onto its bottom edge, then `ChestLidInside`,
// grown up from it. Both are plain 2D scales pivoted by a translate / scale /
// translate sandwich, which every renderer agrees on. Never hand these a
// transformOrigin string; if a pivot ever needs one, pass numbers in an array.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

// The rarity palette. `body` is the panel inside the gold, `shade` is the same
// panel where the lid shadows the base, and `page` is the full bleed
// background the gamble screen floods behind everything.
//
// Taken off the reference rather than from the app's own rarity tints: those
// are chosen to sit as small chips inside a dark card, and the same values
// blown up to a whole screen are muddy. These are the saturated flats the
// reference uses at full size.
export const CHEST_COLORS = {
  common: { page: '#8FA6BC', body: '#5E7F9E', shade: '#4A6883', deep: '#3A5268', ink: '#22323F' },
  rare: { page: '#3FC5EE', body: '#1B9FD6', shade: '#1385BA', deep: '#0E6A96', ink: '#07425E' },
  epic: { page: '#A45FEF', body: '#7E38D2', shade: '#6A2BB6', deep: '#54219B', ink: '#2E0A55' },
  legendary: { page: '#FFB020', body: '#F08A00', shade: '#D07400', deep: '#A85B00', ink: '#5E3300' },
};

// The furniture. One yellow for every rarity, deliberately.
const GOLD = '#FFC93C';
const GOLD_DARK = '#E8A61E';
const GOLD_LIGHT = '#FFE07A';
const CLASP_FACE = '#FFF6DC';

export function chestColors(rarity) {
  return CHEST_COLORS[rarity] || CHEST_COLORS.common;
}

// The drawing is authored at this size and scaled by the caller, so every
// coordinate below can stay a whole number.
const W = 220;
const LID_H = 92;
const BASE_H = 88;
// The lid thrown open. Shorter than the shut lid, because it leans back past
// upright and is seen a little foreshortened.
const INSIDE_H = 78;
// The opening the panels frame, which is where the light comes out.
const MOUTH_W = 168;

/**
 * Every measurement a caller needs to stack or hinge the pieces, at `width`.
 * `height` is the shut chest; the lid thrown open stands inside the same box.
 */
export function chestSize(width) {
  const k = width / W;
  const lidH = k * LID_H;
  const baseH = k * BASE_H;
  return { lidH, baseH, insideH: k * INSIDE_H, mouthW: k * MOUTH_W, height: lidH + baseH };
}

/**
 * A four pointed sparkle, the reference's one decorative mark.
 *
 * Concave sides, not a star polygon: the curves are what make it read as a
 * glint rather than as a badge.
 */
export function Sparkle({ size = 18, color = '#ffffff', style, opacity = 1 }) {
  return (
    <Svg width={size} height={size} viewBox="-10 -10 20 20" style={style} opacity={opacity}>
      <Path
        d="M0 -10 Q1.6 -1.6 10 0 Q1.6 1.6 0 10 Q-1.6 1.6 -10 0 Q-1.6 -1.6 0 -10 Z"
        fill={color}
      />
    </Svg>
  );
}

/** The lid's face, hinged at its bottom edge. */
function Lid({ width, rarity }) {
  const c = chestColors(rarity);
  const height = (width / W) * LID_H;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${W} ${LID_H}`}>
      <Defs>
        <LinearGradient id="lidGold" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={GOLD_LIGHT} />
          <Stop offset="1" stopColor={GOLD} />
        </LinearGradient>
      </Defs>
      {/* Outer gold dome. The top corners are the only round ones — the bottom
          edge is the seam and has to sit flat on the base. */}
      <Path
        d={`M 10 ${LID_H} L 10 44 Q 10 10 44 10 L 176 10 Q 210 10 210 44 L 210 ${LID_H} Z`}
        fill="url(#lidGold)"
      />
      {/* The rarity panel, inset so the gold reads as a frame around it. */}
      <Path
        d={`M 26 ${LID_H} L 26 48 Q 26 26 48 26 L 172 26 Q 194 26 194 48 L 194 ${LID_H} Z`}
        fill={c.body}
      />
      {/* The vertical strap over the crown of the lid. */}
      <Path d={`M 96 12 L 124 12 L 124 ${LID_H} L 96 ${LID_H} Z`} fill={GOLD} />
      <Path d={`M 96 12 L 124 12 L 124 22 L 96 22 Z`} fill={GOLD_LIGHT} />
      {/* The band along the seam, which is what the clasp hangs off. */}
      <Rect x="10" y={LID_H - 22} width="200" height="22" fill={GOLD} />
      <Rect x="10" y={LID_H - 22} width="200" height="6" fill={GOLD_LIGHT} />
    </Svg>
  );
}

/**
 * The shut lid and the clasp that hangs off its seam, as one piece.
 *
 * Its box is exactly the lid (`lidH` tall); the clasp overhangs the base below
 * it. So a caller hinging it on its bottom edge is hinging it on the seam.
 */
export function ChestLid({ width, rarity }) {
  const { lidH } = chestSize(width);
  const claspSize = width * 0.2;
  return (
    <View style={{ width, height: lidH }}>
      <Lid width={width} rarity={rarity} />
      <View style={[styles.piece, { left: width / 2 - claspSize / 2, top: lidH - claspSize * 0.62 }]}>
        <Clasp width={width} />
      </View>
    </View>
  );
}

/**
 * The lid thrown open: its hollow, framed by the rim, standing on the hinge.
 *
 * The rim is lit from BELOW, because the light is coming out of the chest.
 * That is what stops it reading as the shut lid in a darker colour.
 */
export function ChestLidInside({ width, rarity }) {
  const c = chestColors(rarity);
  const { insideH } = chestSize(width);
  const H = INSIDE_H;
  return (
    <Svg width={width} height={insideH} viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <LinearGradient id="rimLit" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={GOLD_DARK} />
          <Stop offset="1" stopColor={GOLD_LIGHT} />
        </LinearGradient>
        <LinearGradient id="hollow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.ink} />
          <Stop offset="1" stopColor={c.deep} />
        </LinearGradient>
      </Defs>
      {/* The clasp, pointing up off what is now the far edge. */}
      <Rect x="99" y="0" width="22" height="16" rx="6" fill={GOLD_DARK} />
      <Path
        d={`M 10 ${H} L 10 32 Q 10 8 34 8 L 186 8 Q 210 8 210 32 L 210 ${H} Z`}
        fill="url(#rimLit)"
      />
      <Path
        d={`M 24 ${H} L 24 36 Q 24 22 38 22 L 182 22 Q 196 22 196 36 L 196 ${H} Z`}
        fill="url(#hollow)"
      />
    </Svg>
  );
}

/** The body, and the lit lip of its mouth once the lid is off it. */
export function ChestBase({ width, rarity, open }) {
  const c = chestColors(rarity);
  const height = (width / W) * BASE_H;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${W} ${BASE_H}`}>
      <Defs>
        <LinearGradient id="mouth" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.ink} />
          <Stop offset="1" stopColor={c.deep} />
        </LinearGradient>
      </Defs>
      {/* Gold shell. */}
      <Path
        d={`M 10 0 L 210 0 L 210 ${BASE_H - 12} Q 210 ${BASE_H} 198 ${BASE_H}
            L 22 ${BASE_H} Q 10 ${BASE_H} 10 ${BASE_H - 12} Z`}
        fill={GOLD}
      />
      {/* The panel, or the open mouth once the lid has come off. An open chest
          showing its own front panel would look shut with the top removed. */}
      <Rect x="26" y="6" width="168" height={BASE_H - 24} fill={c.shade} />
      <Rect x="96" y="6" width="28" height={BASE_H - 24} fill={GOLD} />
      {open ? <Rect x="26" y="0" width="168" height="10" rx="5" fill="#FFF6DC" /> : null}
      {/* Feet. */}
      <Rect x="30" y={BASE_H - 14} width="42" height="14" fill={GOLD_DARK} />
      <Rect x="148" y={BASE_H - 14} width="42" height="14" fill={GOLD_DARK} />
      <Rect x="10" y={BASE_H - 18} width="200" height="8" fill={GOLD_DARK} />
    </Svg>
  );
}

/** The clasp: gold plate, pale shield face. Rides the lid's seam. */
function Clasp({ width }) {
  const size = width * 0.2;
  return (
    <Svg width={size} height={size} viewBox="0 0 44 44">
      <Path d="M 6 4 L 38 4 Q 44 4 44 10 L 44 30 Q 44 40 22 44 Q 0 40 0 30 L 0 10 Q 0 4 6 4 Z" fill={GOLD} />
      <Path d="M 11 10 L 33 10 Q 36 10 36 14 L 36 27 Q 36 34 22 37 Q 8 34 8 27 L 8 14 Q 8 10 11 10 Z" fill={CLASP_FACE} />
    </Svg>
  );
}

/**
 * The whole chest, standing still: shut, or open with its lid thrown back.
 *
 * `width` sizes everything; the drawing's own proportions do the rest. The
 * gamble does not use this: it stacks the pieces above itself so it can swing
 * the lid between them. Icons and rows use this.
 */
export default function Chest({ width = 240, rarity = 'common', open = false, style }) {
  const { lidH, insideH, height } = chestSize(width);

  return (
    <View style={[{ width, height }, style]}>
      {/* The open lid stands BEHIND the base: its hinge is the back edge. */}
      {open ? (
        <View style={[styles.piece, { left: 0, top: lidH - insideH }]}>
          <ChestLidInside width={width} rarity={rarity} />
        </View>
      ) : null}
      <View style={[styles.piece, { left: 0, top: lidH }]}>
        <ChestBase width={width} rarity={rarity} open={open} />
      </View>
      {!open ? (
        <View style={[styles.piece, { left: 0, top: 0 }]}>
          <ChestLid width={width} rarity={rarity} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute' },
});
