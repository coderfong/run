// The wallet: your coin balance, at the right end of the shop's header row.
//
// It lives in the header, not in the page, because it is the one number every
// tile is judged against, so it must never scroll away. It used to be a bar of
// its own under the native header, and it carried the selected item's price
// as well: a second strip of chrome between the title and the stall, repeating
// a price the item panel already states. The panel now says how far short you
// are (ShopScreen's SelectedProductPanel), so the purse only has to say what
// you have.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AppIcon from '../AppIcon';
import { CountUpText, PressableScale } from '../../ui/motion';
import { brand, fonts, nbInk, nbRadius, nbTextOn, space, useTheme, useThemedType, withAlpha } from '../../theme';

const GOLD = '#eab308';

/**
 * `coins` is null until the real balance lands. That is not the same as zero
 * and must not be drawn as zero: a placeholder 0 on a shop reads as "you are
 * broke", which is a worse lie than saying nothing yet.
 *
 * `fill`/`ink` fix the purse's look for a host that floats it over ART: the
 * shop's painted sky is the same in both schemes, so the purse on it is too,
 * the same call a panel header makes for its BackButton.
 */
export default function ShopWallet({ coins = null, onGetMore, fill, ink }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const surface = fill || colors.cardAlt;
  const line = ink || nbInk(scheme, surface);

  return (
    <View style={styles.row}>
      <View style={[styles.purse, { backgroundColor: surface, borderColor: line }]}>
        <AppIcon name="coin" size={20} />
        {coins == null ? (
          <Text style={[type.bodyBold, { color: ink ? withAlpha(ink, 0.45) : colors.textDim }]}>·</Text>
        ) : (
          // Counts to the balance a purchase left behind, rather than
          // swapping the number out behind the reveal. Spending is the one
          // thing this screen does, so it should be the thing you can watch.
          <CountUpText value={coins} durationMs={620} style={[type.bodyBold, { color: GOLD }]} />
        )}
      </View>

      {onGetMore ? (
        // A round PLUS on the purse, not a "Get coins" button off to the
        // side. Topping up belongs to the balance, and the label is still
        // spelled out for a screen reader: a bare "+" is a shape, not a word.
        <PressableScale
          onPress={onGetMore}
          scaleTo={0.92}
          accessibilityRole="button"
          accessibilityLabel="Get more coins"
          style={[styles.plus, { borderColor: ink || nbInk(scheme, brand.teal) }]}
        >
          <Text style={[styles.plusMark, { color: nbTextOn(brand.teal) }]}>+</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  purse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: nbRadius.pill,
    borderWidth: 2,
  },
  // Sized off the purse's own height so the two read as one control rather
  // than as a pill with a button parked beside it.
  plus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    backgroundColor: brand.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Nudged up: the glyph's own bearing sits it low in a circle this small.
  plusMark: { fontSize: 22, fontFamily: fonts.bold, lineHeight: 24, marginTop: -2 },
});
