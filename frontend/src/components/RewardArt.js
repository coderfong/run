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
import INK_BOUNDS from '../config/itemInkBounds.json';

// Rarity → the ring/tint a tile uses. Also what the lootbox art is keyed on.
export const RARITY_COLOR = {
  common: '#9CA3AF',
  rare: '#3B82F6',
  epic: '#A855F7',
  legendary: '#F5C451',
};

// ...and the word for it. A colour is not a label: the reveal says "EPIC".
export const RARITY_LABEL = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

// "headwear:crown" → { slot, id }
function parseItemKey(key) {
  const [slot, id] = String(key || '').split(':');
  return slot && id ? { slot, id } : null;
}

// ---------------------------------------------------------------------------
// FITTING THE DRAWING, NOT THE CANVAS
//
// This used to zoom每 slot by a fixed amount (footwear 1.22, glasses 1.28...)
// inside a frame with `overflow: hidden`, and the two halves of that fought
// each other: the art is not drawn to one margin. Some cuts fill their canvas
// edge to edge (o45t is 99% by 100% of it), so any zoom above 1 took the
// sleeves off. Others sit in a corner (o36t's jacket is in the lower left 60%),
// so they arrived small AND off centre. A pair of shoes is a wide strip in a
// tall box, which is a third shape again.
//
// scripts/measure-item-bounds.js measures every drawing once and writes
// itemInkBounds.json. Here that box is scaled to fill the tile and shifted so
// its middle is the tile's middle. Nothing is clipped, because by construction
// the drawing lands inside the tile.
// ---------------------------------------------------------------------------

// How much of the tile the drawing fills along its longer side.
const INK_FILL = 0.84;
// The ceiling on that zoom. A few cuts are a small drawing on a big canvas,
// and the sources are only a few hundred pixels wide: past about two and a
// half times, a reveal card starts showing the pixels.
const MAX_ZOOM = 2.5;

/**
 * Where to put a cosmetic so its drawing fills the tile.
 *
 * Returns `{ zoom, cx, cy }`: draw PartThumb at `size * zoom`, then offset it
 * so the drawing's centre (cx, cy, as fractions of that bigger box) sits on the
 * tile's centre. Null for an item that was never measured, which means "draw
 * the canvas as it is" — the safe fallback, never a crop.
 */
export function inkFit(slot, id) {
  const bounds = INK_BOUNDS[`${slot}:${id}`];
  if (!bounds) return null;
  const [x0, y0, x1, y1] = bounds;
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span > 0)) return null;
  return { zoom: Math.min(MAX_ZOOM, INK_FILL / span), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export default function RewardArt({ reward, size = 56, equipped, accent = '#ec4899', animated = false }) {
  const { colors } = useTheme();
  if (!reward) return null;
  const { kind, key } = reward;

  if (kind === 'cosmetic') {
    const ref = parseItemKey(key);
    const item = ref && getItem(ref.slot, ref.id);
    if (item) {
      const fit = inkFit(ref.slot, item.id);
      if (!fit) {
        return (
          <View style={[styles.cosmeticFrame, { width: size, height: size }]}>
            <PartThumb slot={ref.slot} item={item} size={size} crisp />
          </View>
        );
      }
      const drawn = size * fit.zoom;
      return (
        <View style={[styles.cosmeticFrame, { width: size, height: size }]}>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: size / 2 - fit.cx * drawn,
              top: size / 2 - fit.cy * drawn,
            }}
          >
            <PartThumb slot={ref.slot} item={item} size={drawn} crisp />
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
  // No `overflow: hidden` here any more. The fit above keeps the drawing
  // inside the tile, and clipping is what used to cut the wide pieces off.
  cosmeticFrame: { alignItems: 'center', justifyContent: 'center' },
  borderCore: { position: 'absolute' },
  energyText: { position: 'absolute', bottom: -2, fontSize: 12 },
});
