// RewardArt — draws a pass reward as ITSELF.
//
// The rule: a tier never shows a stand-in. A wood border shows the wood
// border, a hexagon claim shows the real hexagon ring the claim engine
// stamps, a Crown shows the crown art off the character sheet. The only
// glyphs left are for rewards that genuinely have no object yet (FX, which
// has no art in the repo).
//
// Rewards arrive from /me/progression as { kind, key, label }:
//   cosmetic   key = "<slot>:<id>"  → the real item art from the catalogue
//   border     key = tier key       → the real PortraitBorder ring
//   shape      key = shape key      → the real claim polygon
//   lootbox    key = rarity         → per-rarity crate art
//   energy     key = "+25"          → the energy sticker
//   energy_cap key = "+5"           → the energy sticker, capped

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { Gift } from 'lucide-react-native';

import { toonType, useTheme } from '../theme';
import AppIcon, { ICONS } from './AppIcon';
import PortraitBorder from './PortraitBorder';
import { PartThumb } from './character/CharacterRig';
import { getItem } from '../config/cosmetics';
import { unitShape } from '../config/claimShapes';

// Rarity → the ring/tint a tile uses. Also what the lootbox art is keyed on.
export const RARITY_COLOR = {
  common: '#9CA3AF',
  rare: '#3B82F6',
  epic: '#A855F7',
  legendary: '#F5C451',
};

// "headwear:crown" → { slot, id }
function parseItemKey(key) {
  const [slot, id] = String(key || '').split(':');
  return slot && id ? { slot, id } : null;
}

// The real claim polygon, normalised into the tile's box.
function ShapeIcon({ shape, size, color }) {
  const pts = unitShape(shape) || [];
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(1e-6, Math.max(...xs) - minX);
  const h = Math.max(1e-6, Math.max(...ys) - minY);
  const s = Math.max(w, h);
  const pad = size * 0.12;
  const box = size - pad * 2;
  const d = pts
    .map(([x, y]) => `${pad + ((x - minX) / s) * box},${pad + ((y - minY) / s) * box}`)
    .join(' ');
  return (
    <Svg width={size} height={size}>
      <Polygon points={d} fill={`${color}33`} stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
    </Svg>
  );
}

export default function RewardArt({ reward, size = 56, equipped, accent = '#ec4899' }) {
  const { colors } = useTheme();
  if (!reward) return null;
  const { kind, key } = reward;

  if (kind === 'cosmetic') {
    const ref = parseItemKey(key);
    const item = ref && getItem(ref.slot, ref.id);
    if (item) {
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <PartThumb slot={ref.slot} item={item} equipped={equipped} size={size} />
        </View>
      );
    }
    return <Gift size={size * 0.6} color={accent} strokeWidth={2} />;
  }

  if (kind === 'border') {
    // The ring IS the reward — show it empty so the ring reads, not a face.
    return (
      <PortraitBorder borderKey={key} size={size}>
        <View
          style={[
            styles.borderCore,
            { width: size * 0.62, height: size * 0.62, borderRadius: size, backgroundColor: colors.cardAlt },
          ]}
        />
      </PortraitBorder>
    );
  }

  if (kind === 'shape') return <ShapeIcon shape={key} size={size} color={accent} />;

  if (kind === 'lootbox') {
    const tint = RARITY_COLOR[key] || RARITY_COLOR.common;
    // Real per-rarity crate art when it exists; the generic box + tint ring is
    // the fallback so an unknown rarity still renders something sensible.
    const rarityIcon = ICONS[`lootbox-${key}`] ? `lootbox-${key}` : null;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {!rarityIcon && (
          <View
            style={[
              styles.boxGlow,
              { width: size, height: size, borderRadius: size * 0.3, backgroundColor: `${tint}22`, borderColor: tint },
            ]}
          />
        )}
        <AppIcon name={rarityIcon || 'lootbox'} size={size * (rarityIcon ? 0.94 : 0.72)} />
      </View>
    );
  }

  if (kind === 'energy' || kind === 'energy_cap') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name="energy" size={size * 0.62} />
        <Text style={[toonType.label, styles.energyText, { color: colors.text }]}>{key}</Text>
      </View>
    );
  }

  // FX has no art in the repo yet — see docs/ONBOARDING_ASSETS.md §7.

  return <Gift size={size * 0.6} color={accent} strokeWidth={2} />;
}

const styles = StyleSheet.create({
  borderCore: { position: 'absolute' },
  boxGlow: { position: 'absolute', borderWidth: 2 },
  energyText: { position: 'absolute', bottom: -2, fontSize: 11 },
});
