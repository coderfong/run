// PortraitBorder — a level-tier frame drawn AROUND a character portrait. Wraps
// a CharacterBust (or any circular child) and paints an SVG ring on top whose
// colour/gradient/glow comes from the player's border tier (config/progression).
//
// Fully code-drawn — no art assets. Premium tiers (gradient + glow) get a soft
// halo underneath and a gradient stroke. Pass `tier` (a BORDER_TIERS entry) or
// `level` (we derive the tier).

import React from 'react';
import { View } from 'react-native';
import { Image } from '../ui/image';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { borderForLevel, borderByKey } from '../config/progression';
import { BORDER_ART } from '../config/borderArt';

export default function PortraitBorder({ tier, level, borderKey, size = 72, width, children, style }) {
  const t = tier || (borderKey ? borderByKey(borderKey) : borderForLevel(level || 0));
  const w = width || Math.max(2, Math.round(size * 0.055));
  const isGradient = Array.isArray(t.ring);
  const stops = isGradient ? t.ring : [t.ring, t.ring];
  const r = size / 2 - w / 2;
  const gid = `pb-${t.key}-${size}`;

  // Real ring art when the tier has it. `hole`/`cx`/`cy` describe the circle
  // that covers the art's inner opening, as fractions of its square canvas
  // (measured by scripts/measure-border-holes-3.py).
  //
  // Three things matter here, and getting any of them wrong wrecks the badge:
  //  1. The opening is NOT concentric with the canvas. Prismatic's crystal
  //     crown and mythic's flame sit above the band, pushing the ring to the
  //     bottom of its square (prismatic's opening centres at cy 0.576). Laying
  //     the portrait out centred left a crescent of background showing along
  //     the bottom of the frame — so the portrait is positioned on `cx`/`cy`,
  //     not on the middle of the art.
  //  2. `hole` covers the opening rather than fitting inside it, so the
  //     portrait's rim reaches the band's inner edge at its widest point and
  //     tucks under the frame everywhere else. The ring composites ON TOP, so
  //     that overlap is invisible and the gap cannot come back.
  //  3. The wrapper is sized to the RING, not the portrait, so the badge
  //     reserves its real footprint instead of silently overlapping whatever
  //     is above and below it.
  const artTier = BORDER_ART[t.key];
  if (artTier) {
    // Exact fit first: at this ring size the opening is precisely `size`, so
    // the portrait fills it whatever the tier's frame thickness.
    const ringSize = size / artTier.hole;
    // Then bound the footprint. Ornate tiers have a small opening (onyx 0.62 →
    // a 167px frame around a 104px bust) which crowded the level text beside
    // it. Scale the WHOLE badge — ring and portrait together — so the fit is
    // preserved and only the footprint shrinks. Clamping ringSize alone would
    // leave the bust poking over the frame's inner edge.
    const outer = Math.min(ringSize, size * 1.5);
    const scale = outer / ringSize;
    // Fall back to the canvas centre if the config predates the cx/cy pass —
    // that is the old, slightly-off placement rather than a NaN layout.
    const cx = artTier.cx ?? 0.5;
    const cy = artTier.cy ?? 0.5;
    return (
      <View
        style={[
          { width: outer, height: outer, alignItems: 'center', justifyContent: 'center' },
          style,
        ]}
      >
        <View
          style={{
            width: ringSize,
            height: ringSize,
            transform: [{ scale }],
          }}
        >
          {/* A `size` box seated on the opening's centre. Children smaller than
              the opening (RewardArt shows the ring around a bare disc) stay
              centred in it rather than pinned to its top-left. */}
          <View
            style={{
              position: 'absolute',
              left: cx * ringSize - size / 2,
              top: cy * ringSize - size / 2,
              width: size,
              height: size,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {children}
          </View>
          <Image
            source={artTier.src}
            style={{ position: 'absolute', width: ringSize, height: ringSize }}
            resizeMode="contain"
            fadeDuration={0}
            pointerEvents="none"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {children}
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', left: 0, top: 0 }}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            {stops.map((c, i) => (
              <Stop key={i} offset={`${(i / Math.max(1, stops.length - 1)) * 100}%`} stopColor={c} stopOpacity="1" />
            ))}
          </LinearGradient>
        </Defs>
        {/* soft halo for premium tiers */}
        {t.glow && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={isGradient ? t.ring[t.ring.length - 1] : t.ring}
            strokeWidth={w * 2.2}
            strokeOpacity={0.28}
            fill="none"
          />
        )}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${gid})`} strokeWidth={w} fill="none" />
      </Svg>
    </View>
  );
}
