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
// TWO SVGS, NOT ONE. The lid is its own element so it can be hinged with a
// plain `rotateX` on its container — no animated SVG props, no platform
// branch, and `transformOrigin` puts the pivot on the seam where the hinge
// actually is. One SVG with an animated <G> would have meant driving matrix
// props from a worklet for a rotation a View does natively.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
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

/** The lid, hinged at its bottom edge. */
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

/** The body, and the dark interior that shows once the lid is off it. */
function Base({ width, rarity, open }) {
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
 * The whole chest.
 *
 * `width` sizes everything; the drawing's own proportions do the rest.
 * `open` swaps the base's panel for its interior — the LIFT itself is the
 * caller's, because only the caller knows how the lid should leave.
 * `lidStyle` is where that animation is applied, and it is applied to a view
 * whose origin is already on the hinge.
 */
export default function Chest({ width = 240, rarity = 'common', open = false, lidStyle, style }) {
  const lidH = (width / W) * LID_H;
  const baseH = (width / W) * BASE_H;
  const claspSize = width * 0.2;

  return (
    <View style={[{ width, height: lidH + baseH }, style]}>
      {/* Base first: the lid draws over it, and when the lid rotates back it
          has to pass BEHIND nothing at all. */}
      <View style={[styles.base, { top: lidH }]}>
        <Base width={width} rarity={rarity} open={open} />
      </View>

      {/* transformOrigin on the seam, so a rotateX hinges the lid instead of
          spinning it about its own middle. */}
      <Animated.View
        style={[
          styles.lid,
          { width, height: lidH, transformOrigin: `${width / 2}px ${lidH}px` },
          lidStyle,
        ]}
        pointerEvents="none"
      >
        <Lid width={width} rarity={rarity} />
        <View style={[styles.clasp, { left: width / 2 - claspSize / 2, top: lidH - claspSize * 0.62 }]}>
          <Clasp width={width} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { position: 'absolute', left: 0 },
  lid: { position: 'absolute', left: 0, top: 0 },
  clasp: { position: 'absolute' },
});
