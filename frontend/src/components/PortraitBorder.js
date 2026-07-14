// PortraitBorder — a level-tier frame drawn AROUND a character portrait. Wraps
// a CharacterBust (or any circular child) and paints an SVG ring on top whose
// colour/gradient/glow comes from the player's border tier (config/progression).
//
// Fully code-drawn — no art assets. Premium tiers (gradient + glow) get a soft
// halo underneath and a gradient stroke. Pass `tier` (a BORDER_TIERS entry) or
// `level` (we derive the tier).

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { borderForLevel, borderByKey } from '../config/progression';

export default function PortraitBorder({ tier, level, borderKey, size = 72, width, children, style }) {
  const t = tier || (borderKey ? borderByKey(borderKey) : borderForLevel(level || 0));
  const w = width || Math.max(2, Math.round(size * 0.055));
  const isGradient = Array.isArray(t.ring);
  const stops = isGradient ? t.ring : [t.ring, t.ring];
  const r = size / 2 - w / 2;
  const gid = `pb-${t.key}-${size}`;

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
