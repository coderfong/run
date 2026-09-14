// RewardArt — draws a pass reward as ITSELF.
//
// The rule: a tier never shows a stand-in. A wood border shows the wood
// border, a Crown shows the crown art off the character sheet. The only
// glyphs left are for rewards that genuinely have no object yet (FX, which
// has no art in the repo).
//
// Every kind draws to the SAME box, edge to edge. They used to be scaled
// individually (a chest at 0.86, an energy bolt at 0.62), which is why a
// ladder of them read as a jumble of big and small tiles.
//
// Rewards arrive from /me/progression as { kind, key, label }:
//   cosmetic   key = "<slot>:<id>"  → the real item art from the catalogue
//   border     key = tier key       → the real PortraitBorder ring
//   lootbox    key = rarity         → the gift box
//   energy     key = "+25"          → the energy sticker
//   energy_cap key = "+5"           → the energy sticker, capped

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gift } from 'lucide-react-native';

import { toonType, useTheme } from '../theme';
import AppIcon from './AppIcon';
import Chest from './lootbox/Chest';
import PortraitBorder from './PortraitBorder';
import { PartThumb } from './character/CharacterRig';
import { getItem } from '../config/cosmetics';

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

// Cosmetic sources share a square canvas, but the painted area differs by
// slot (glasses and shoes occupy much less of it than hair or a jacket). These
// restrained optical corrections make the *visible object* read at one size
// without changing the tile or clipping the more expansive rewards.
const COSMETIC_PREVIEW_SCALE = {
  face: 1,
  hair: 1.04,
  headwear: 1.08,
  glasses: 1.28,
  top: 1.1,
  bottom: 1.16,
  footwear: 1.22,
  accessory: 1.08,
};

export default function RewardArt({ reward, size = 56, equipped, accent = '#ec4899', animated = false }) {
  const { colors } = useTheme();
  if (!reward) return null;
  const { kind, key } = reward;

  if (kind === 'cosmetic') {
    const ref = parseItemKey(key);
    const item = ref && getItem(ref.slot, ref.id);
    if (item) {
      const previewScale = COSMETIC_PREVIEW_SCALE[ref.slot] || 1;
      return (
        <View style={[styles.cosmeticFrame, { width: size, height: size }]}>
          <View style={{ transform: [{ scale: previewScale }] }}>
            <PartThumb slot={ref.slot} item={item} size={size} />
          </View>
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

  if (kind === 'lootbox') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Chest width={size} rarity="common" />
      </View>
    );
  }

  if (kind === 'energy' || kind === 'energy_cap') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name="energy" size={size * 0.86} />
        <Text style={[toonType.label, styles.energyText, { color: colors.text }]}>{key}</Text>
      </View>
    );
  }

  // FX has no art in the repo yet — see docs/ONBOARDING_ASSETS.md §7.

  return <Gift size={size * 0.6} color={accent} strokeWidth={2} />;
}

const styles = StyleSheet.create({
  cosmeticFrame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  borderCore: { position: 'absolute' },
  energyText: { position: 'absolute', bottom: -2, fontSize: 12 },
});
