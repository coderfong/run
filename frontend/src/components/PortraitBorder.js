// PortraitBorder — a level-tier frame drawn AROUND a character portrait. Wraps
// a CharacterBust (or any circular child) and paints an SVG ring on top whose
// colour/gradient/glow comes from the player's border tier (config/progression).
//
// Fully code-drawn — no art assets. Premium tiers (gradient + glow) get a soft
// halo underneath and a gradient stroke. Pass `tier` (a BORDER_TIERS entry) or
// `level` (we derive the tier).

import React from 'react';
import { Image, View } from 'react-native';
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

  // Real ring art when the tier has it. `hole` is the art's inner opening as a
  // fraction of its square canvas (measured by scripts/slice-borders.py).
  //
  // Two things matter here, and getting either wrong wrecks the layout:
  //  1. HOLE_FLOOR caps how far the ring can scale up. Ornate tiers have a
  //     small opening (mythic 0.487), and size/0.487 made a 104px portrait
  //     wear a 213px wreath that swallowed the level text beside it.
  //  2. The wrapper is sized to the RING, not the portrait, so the badge
  //     reserves its real footprint instead of silently overlapping whatever
  //     is above and below it.
  const artTier = BORDER_ART[t.key];
  if (artTier) {
    // Exact fit first: at this ring size the opening is precisely `size`, so
    // the portrait fills it whatever the tier's frame thickness.
    const ringSize = size / artTier.hole;
    // Then bound the footprint. Ornate tiers have a small opening (mythic
    // 0.487 → a 213px wreath around a 104px bust) which swallowed the level
    // text beside it. Scale the WHOLE badge — ring and portrait together — so
    // the fit is preserved and only the footprint shrinks. Clamping ringSize
    // alone would leave the bust poking over the frame's inner edge.
    const outer = Math.min(ringSize, size * 1.5);
    const scale = outer / ringSize;
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
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale }],
          }}
        >
          {children}
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
