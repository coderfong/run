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
import { useReduceMotion } from '../ui/motion';
import AppIcon from './AppIcon';
import GameAnimation from './GameAnimation';
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

export default function RewardArt({ reward, size = 56, equipped, accent = '#ec4899', animated = false }) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  if (!reward) return null;
  const { kind, key } = reward;

  if (kind === 'cosmetic') {
    const ref = parseItemKey(key);
    const item = ref && getItem(ref.slot, ref.id);
    if (item) {
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <PartThumb slot={ref.slot} item={item} size={size} />
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
    // ONE chest for every rarity — the animated gift box, drawn at full tile
    // size and NOTHING else. It used to sit inside a rarity-coloured ring;
    // that ring read as a box drawn around a box, and it shrank the art to
    // make room for itself. Rarity lives in the reveal and the label now.
    //
    // `animated` is off by default because the pass mounts twenty of these at
    // once in a plain ScrollView. The screen turns it on for the tiles worth
    // looking at; the rest hold frame one, which is a complete, readable box.
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <GameAnimation
          name="giftBox"
          size={size}
          loop={animated && !reduced}
          // Reduce Motion must not remove the chest — it IS the reward.
          still={!animated || reduced}
        />
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
  borderCore: { position: 'absolute' },
  energyText: { position: 'absolute', bottom: -2, fontSize: 12 },
});
