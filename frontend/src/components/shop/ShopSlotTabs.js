// The shop's category tabs: hats, glasses, tops, shoes.
//
// WHY THIS REPLACED THE RARITY SECTIONS. The stock was grouped under four
// headed bands — COMMON, RARE, EPIC, LEGENDARY — which sounds organised and
// browses badly. Twelve items split four ways is one to five tiles per band,
// so most of the page was section furniture, and worse, rarity is the wrong
// axis: nobody arrives at a shop wanting "something epic", they arrive wanting
// A HAT. Grouping by quality makes you scan all four bands to find out whether
// there are any hats today.
//
// Rarity did not go anywhere. It was never only in those headers: it is the
// colour of every tile's frame, and it is spelled out on the item you select.
// What it stopped being is the thing you navigate by.
//
// A TAB PER SLOT THAT HAS STOCK, and never an empty one — the rotation only
// ever holds a handful of slots, and a row of tabs leading to empty shelves is
// a row of dead ends. "All" leads, so the default is still the whole shop.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '../../ui/motion';
import { NB, nbInk, nbRadius, nbTextOn, space, useTheme, useThemedType } from '../../theme';

export const ALL_SLOTS = '__all__';

/**
 * @param {Array<{key:string,label:string,count:number}>} tabs
 * @param {string}   value     the selected slot key, or ALL_SLOTS
 * @param {Function} onChange
 * @param {string}   accent    the tint the active tab is filled with
 */
export default function ShopSlotTabs({ tabs, value, onChange, accent, style }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  if (!tabs?.length) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
      // Nested in the shop's vertical scroller.
      directionalLockEnabled
      nestedScrollEnabled
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        const fill = active ? accent : colors.cardAlt;
        return (
          <PressableScale
            key={tab.key}
            onPress={() => onChange?.(tab.key)}
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${tab.label}, ${tab.count} ${tab.count === 1 ? 'item' : 'items'}`}
            style={[
              styles.tab,
              { backgroundColor: fill, borderColor: nbInk(scheme, fill) },
            ]}
          >
            <Text style={[type.captionMedium, { color: active ? nbTextOn(accent) : colors.text }]}>
              {tab.label}
            </Text>
            <View
              style={[
                styles.count,
                { backgroundColor: active ? nbTextOn(accent) : colors.card },
              ]}
            >
              <Text
                style={[
                  styles.countText,
                  { color: active ? accent : colors.textMuted },
                ]}
              >
                {tab.count}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, paddingVertical: 2 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: nbRadius.pill,
    borderWidth: NB.strokeThin,
  },
  count: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: nbRadius.pill,
    alignItems: 'center',
  },
  countText: { fontSize: 11, fontWeight: '800' },
});
