// ShopProductCard: one item of stock in the storefront grid.
//
// CALM ON PURPOSE. The movie above is busy with colour, so the cards are
// warm white with a thin Water Point blue outline and nothing else: the art
// is the loudest thing on each card. No hard neo-brutalist shadow and no
// per-rarity fill; rarity is one small dot in the art's corner and is spelled
// out on the placard once the item is picked.
//
// THREE STATES, NEVER COLOUR ALONE: a price (coin + number), "Owned" (tick +
// word, art dimmed a touch) and "Equipped" (tick + word, a heavier outline).
// Selected is a heavier blue outline and a deeper blue behind the art.

import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { PartThumb } from '../character/CharacterRig';
import AppIcon from '../AppIcon';
import { RARITY_COLOR } from '../RewardArt';
import { PressableScale } from '../../ui/motion';
import { fonts, useTheme, useThemedType, withAlpha } from '../../theme';

const ShopProductCard = memo(function ShopProductCard({
  item,
  width,
  accent,
  selected,
  equipped,
  disabled,
  onSelect,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const name = item.cat?.label || item.item_id;
  const art = width - 16;
  const artH = Math.round(art * 0.78);
  const tint = RARITY_COLOR[item.rarity] || colors.border;
  const status = equipped ? 'equipped' : item.owned ? 'owned' : `${item.price} coins`;

  return (
    <PressableScale
      onPress={() => onSelect(item.item_id)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={`${name}, ${item.rarity}, ${status}`}
      accessibilityHint={item.owned ? undefined : 'Shows this item on your runner and the buy button'}
      style={[
        styles.card,
        {
          width,
          backgroundColor: colors.card,
          borderColor: selected ? accent : equipped ? colors.ink : withAlpha(accent, 0.35),
          borderWidth: selected || equipped ? 2.5 : 1.5,
        },
      ]}
    >
      <View style={[styles.art, { height: artH, backgroundColor: withAlpha(accent, selected ? 0.16 : 0.07) }]}>
        <View style={{ opacity: item.owned && !selected ? 0.55 : 1 }}>
          <PartThumb slot={item.slot} item={item.cat} size={artH - 8} />
        </View>
        <View style={[styles.rarity, { backgroundColor: tint }]} />
      </View>

      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>

      {item.owned ? (
        <View style={styles.status}>
          <Check size={12} color={equipped ? colors.text : colors.textMuted} strokeWidth={3} />
          <Text style={[type.captionMedium, { color: equipped ? colors.text : colors.textMuted }]}>
            {equipped ? 'Equipped' : 'Owned'}
          </Text>
        </View>
      ) : (
        <View style={styles.status}>
          <AppIcon name="coin" size={14} />
          <Text style={[type.captionMedium, styles.price, { color: colors.text }]}>
            {Number(item.price).toLocaleString()}
          </Text>
        </View>
      )}
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 8,
    alignItems: 'center',
  },
  art: {
    alignSelf: 'stretch',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rarity: { position: 'absolute', top: 6, left: 6, width: 7, height: 7, borderRadius: 4 },
  name: { marginTop: 6, fontFamily: fonts.semibold, fontSize: 13, textAlign: 'center', alignSelf: 'stretch' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, minHeight: 18 },
  price: { fontVariant: ['tabular-nums'] },
});

export default ShopProductCard;
