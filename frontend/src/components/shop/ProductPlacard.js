// ProductPlacard — what the shopkeeper hands you once you have picked
// something up: name, rarity, price, Buy. Docked to the bottom of the
// SCREEN rather than placed inside the scene's own coordinate system — the
// try-on mirror and the product itself already live at the counter, in the
// painting; this is the one piece of the moment that is native UI by
// necessity (it has to hold real text at a legible size on every phone), so
// it sits where native UI belongs, close enough to the counter to read as
// "the shopkeeper is showing you this" rather than "a detail page opened".
//
// THE BUY BUTTON IS THE ONLY THING THAT SPENDS COINS. Selecting a product
// never does — see ShopScreen's purchase flow, unchanged by this redesign.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { PartThumb } from '../character/CharacterRig';
import AppIcon from '../AppIcon';
import GameAnimation, { AnimationStack } from '../GameAnimation';
import { RARITY_COLOR, RARITY_LABEL } from '../RewardArt';
import { SLOT_LABEL } from './shopDialogue';
import { Button, Card, Row } from '../ui';
import { Reveal, useReduceMotion } from '../../ui/motion';
import { space, useTheme, useThemedType, withAlpha } from '../../theme';

const FX_SIZE = 120;

export default function ProductPlacard({
  item,
  cat,
  affordable,
  coins,
  pending,
  celebrating,
  purchaseTick,
  onBuy,
  onClose,
  // The screen's own safe-area bottom inset. This dock is position:absolute
  // against the screen edge (not laid out inside a ScrollView the way the
  // old below-the-fold panel was), so it has to pay for the home indicator
  // itself or it renders flush under it on a notched phone.
  bottomInset = 0,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const tint = RARITY_COLOR[item.rarity] || colors.border;
  const rare = item.rarity && item.rarity !== 'common';

  const status = item.owned ? 'Owned' : `${item.price} coins`;
  const short = !item.owned && !affordable && coins != null
    ? `${Number(item.price - coins).toLocaleString()} coins short. Run to earn more.`
    : null;

  return (
    <Reveal from="up" duration={220} style={[styles.dock, { bottom: bottomInset + space.sm }]}>
      <Card style={styles.card}>
        <View style={styles.fxAnchor} pointerEvents="none">
          {celebrating ? (
            <AnimationStack
              names={rare ? ['rewardBurst', 'confettiBurst'] : ['confettiBurst']}
              size={FX_SIZE}
              trigger={purchaseTick}
            />
          ) : null}
        </View>

        <View style={styles.row}>
          <View
            style={[
              styles.chip,
              { backgroundColor: withAlpha(tint, 0.18), borderColor: withAlpha(tint, 0.6) },
            ]}
          >
            <PartThumb slot={item.slot} item={cat} size={44} />
          </View>

          <View style={styles.info}>
            <Text style={type.bodyBold} numberOfLines={1}>
              {cat?.label || item.item_id}
            </Text>
            <Row gap={6} style={{ alignItems: 'center' }}>
              <View style={[styles.rarityDot, { backgroundColor: tint }]} />
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {`${RARITY_LABEL[item.rarity] || item.rarity} ${(SLOT_LABEL[item.slot] || item.slot).toLowerCase()}`}
              </Text>
            </Row>
            <Row gap={4} style={{ alignItems: 'center' }}>
              {!item.owned ? <AppIcon name="coin" size={13} /> : null}
              <Text
                style={[
                  type.captionMedium,
                  { color: item.owned || affordable ? colors.textMuted : colors.danger },
                ]}
              >
                {status}
              </Text>
            </Row>
            {short ? (
              <Text style={[type.caption, { color: colors.danger }]} numberOfLines={1}>
                {short}
              </Text>
            ) : null}
          </View>

          {!reduced ? (
            <GameAnimation
              name="coinSpin"
              size={34}
              trigger={purchaseTick}
              visible={celebrating}
              style={styles.coinFx}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close item details"
            hitSlop={10}
            style={styles.close}
          >
            <Text style={[type.captionMedium, { color: colors.textDim }]}>Close</Text>
          </TouchableOpacity>
          <Button
            title={item.owned ? 'Owned' : affordable ? `Buy for ${item.price}` : 'Not enough coins'}
            size="sm"
            full={false}
            variant={item.owned || !affordable ? 'secondary' : 'gradient'}
            loading={pending}
            disabled={item.owned || !affordable || pending}
            onPress={onBuy}
          />
        </View>
      </Card>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: space.gutter, right: space.gutter },
  card: { gap: space.sm, paddingVertical: space.sm },
  fxAnchor: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: FX_SIZE,
    height: FX_SIZE,
    marginLeft: -FX_SIZE / 2,
    marginTop: -FX_SIZE / 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  rarityDot: { width: 8, height: 8, borderRadius: 4 },
  coinFx: { position: 'absolute', right: -4, top: -10 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { paddingVertical: 6, paddingHorizontal: space.sm },
});
