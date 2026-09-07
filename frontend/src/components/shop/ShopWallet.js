// The wallet, pinned to the top of the shop and never scrolled away.
//
// WHY IT MOVED. It used to be a card in the page flow, sitting UNDER the
// selected item's panel — so the moment you scrolled down to the stock, both
// the price you were considering and the balance you would pay it from left
// the screen together. The panel's own note says the adjacency is the point
// ("this costs 240" only means something next to "you have 180"), and then the
// layout threw that adjacency away as soon as you started browsing.
//
// Every shop worth copying pins its currency. It is the one number you are
// doing arithmetic against on every single tile, so it belongs in the chrome
// rather than in the content.
//
// IT SHOWS THE PRICE TOO, WHEN THERE IS ONE. With something selected the bar
// carries `cost` and turns the balance into a sum you can read at a glance:
// what you have, what it costs, and — the part that actually decides the tap —
// whether you can afford it. Unaffordable is stated in words, not just in a
// dimmed button somewhere further down the page.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AppIcon from '../AppIcon';
import { Button } from '../ui';
import { CountUpText } from '../../ui/motion';
import { NB, nbInk, nbRadius, space, useTheme, useThemedType, withAlpha } from '../../theme';

const GOLD = '#eab308';

/**
 * `coins` is null until the real balance lands. That is not the same as zero
 * and must not be drawn as zero: a placeholder 0 on a shop reads as "you are
 * broke", which is a worse lie than saying nothing yet.
 */
export default function ShopWallet({ coins = null, cost = null, affordable = true, onGetMore, top = 0 }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();

  // Short is deliberate: this bar is above the shop for its whole life, so
  // every point of height it takes is a point of stock nobody can see.
  const short = cost == null;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: top + space.sm,
          backgroundColor: colors.bg,
          borderBottomColor: nbInk(scheme, colors.bg),
        },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.purse,
            { backgroundColor: colors.cardAlt, borderColor: nbInk(scheme, colors.cardAlt) },
          ]}
        >
          <AppIcon name="coin" size={22} />
          {coins == null ? (
            <Text style={[type.bodyBold, { color: colors.textDim }]}>·</Text>
          ) : (
            // Counts to the balance a purchase left behind, rather than
            // swapping the number out behind the reveal. Spending is the one
            // thing this screen does, so it should be the thing you can watch.
            <CountUpText value={coins} durationMs={620} style={[type.bodyBold, { color: GOLD }]} />
          )}
        </View>

        {!short ? (
          <View style={styles.sum}>
            <Text style={[type.caption, { color: colors.textMuted }]}>Price</Text>
            <View style={styles.priceRow}>
              <AppIcon name="coin" size={16} />
              <Text
                style={[
                  type.bodyBold,
                  { color: affordable ? colors.text : colors.danger },
                ]}
              >
                {Number(cost).toLocaleString()}
              </Text>
            </View>
          </View>
        ) : null}

        {onGetMore ? (
          <Button title="Get coins" size="sm" full={false} onPress={onGetMore} />
        ) : null}
      </View>

      {!short && !affordable ? (
        <Text style={[type.caption, styles.short, { color: colors.danger }]}>
          {`${Number(cost - coins).toLocaleString()} coins short. Run to earn more.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: space.gutter,
    paddingBottom: space.sm,
    borderBottomWidth: NB.strokeThin,
    zIndex: 5,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  purse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: nbRadius.pill,
    borderWidth: 2,
  },
  sum: { flex: 1, alignItems: 'flex-end' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  short: { marginTop: 4, textAlign: 'right' },
});
