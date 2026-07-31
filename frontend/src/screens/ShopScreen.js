// ShopScreen — spend coins on cosmetics, or buy coins with real money.
//
// Two halves:
//   * coin packs (real-money IAP, products mirror COIN_PRODUCTS in coins.py)
//   * the cosmetics catalogue, filtered by slot, priced BY THE SERVER
//
// Prices and the owned flag come from GET /me/coins — never computed here. The
// client showing a price is cosmetic; the server charges what its own
// catalogue says, so a tampered client just gets a 402.
//
// PASER PRO exclusives are absent by design: shop_catalog.py omits them, so
// they can't be bought with coins at any price.

import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useAvatar } from '../state/avatar';
import { brand, radius, space, useTheme, useThemedType, withAlpha } from '../theme';
import { Card, Row, Screen, Skeleton, Pill } from '../components/ui';
import { PartThumb } from '../components/character/CharacterRig';
import { getItem, SLOTS } from '../config/cosmetics';
import { RARITY_COLOR } from '../components/RewardArt';
import AppIcon from '../components/AppIcon';
import { toast } from '../ui/toast';

const PACK_PRICE = {
  coins_pouch: '$0.99',
  coins_sack: '$1.99',
  coins_chest: '$4.99',
  coins_vault: '$9.99',
};

// Pack tile art. Keys mirror COIN_PRODUCTS in backend/app/coins.py; the pile
// grows with the price so the tiers read at a glance.
const PACK_ICON = {
  coins_pouch: 'coin-pouch',
  coins_sack: 'coin-sack',
  coins_chest: 'coin-chest',
  coins_vault: 'coin-vault',
};

// Same deliberate no-op as BuyEnergySheet: no store SDK is installed, and
// Metro resolves imports at build time so we can't require() one defensively.
// Returning null means "no store", which the backend accepts only while
// receipt verification is off (dev). See docs/RELEASE_V2.md.
async function storePurchase(/* productId */) {
  return null;
}

function CoinBalance({ coins }) {
  const type = useThemedType();
  return (
    <Row gap={6} style={styles.balance}>
      <AppIcon name="coin" size={20} />
      <Text style={[type.bodyBold, { color: '#eab308' }]}>{coins}</Text>
    </Row>
  );
}

export default function ShopScreen() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { refreshUnlocks } = useAvatar();
  const [data, setData] = useState(null);
  const [slot, setSlot] = useState('headwear');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.shop()); } catch { setData(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    if (!data?.items) return [];
    return data.items
      .filter((i) => i.slot === slot)
      .sort((a, b) => Number(a.owned) - Number(b.owned) || a.price - b.price);
  }, [data, slot]);

  const buy = async (item) => {
    if (busy) return;
    setBusy(item.item_id);
    try {
      const res = await api.buyCosmetic(item.item_id);
      toast.success(`Bought ${getItem(item.slot, item.item_id)?.label || item.item_id}`);
      setData((d) => (d ? {
        ...d,
        coins: res.coins,
        items: d.items.map((i) => (i.item_id === item.item_id ? { ...i, owned: true } : i)),
      } : d));
      refreshUnlocks?.();
    } catch (e) {
      if (e.status === 402) toast.error('Not enough coins');
      else if (e.status === 409) toast.error('You already own that');
      else toast.error(e.message || 'Could not buy that');
    } finally {
      setBusy(null);
    }
  };

  const buyCoins = async (pack) => {
    if (busy) return;
    setBusy(pack.product_id);
    try {
      const receipt = await storePurchase(pack.product_id);
      const res = await api.purchaseCoins(pack.product_id, receipt, Platform.OS);
      toast.success(`+${pack.coins} coins`);
      setData((d) => (d ? { ...d, coins: res.coins } : d));
    } catch (e) {
      toast.error(e.status === 402 ? 'Purchases aren’t live yet.'
        : (e.message || 'Could not complete purchase'));
    } finally {
      setBusy(null);
    }
  };

  if (data === false) {
    return <Screen center><Text style={type.body}>Couldn’t load the shop.</Text></Screen>;
  }
  if (!data) {
    return (
      <Screen>
        <Skeleton width="100%" height={90} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={320} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={type.title}>Shop</Text>
        <CoinBalance coins={data.coins} />
      </Row>

      {/* coin packs */}
      <Card style={{ marginTop: space.md }}>
        <Text style={[type.bodyBold, { marginBottom: space.sm }]}>Get coins</Text>
        <View style={styles.packRow}>
          {(data.packs || []).map((p) => (
            <TouchableOpacity
              key={p.product_id}
              style={[styles.pack, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}
              onPress={() => buyCoins(p)}
              disabled={!!busy}
              accessibilityRole="button"
              accessibilityLabel={`Buy ${p.coins} coins`}
            >
              <AppIcon name={PACK_ICON[p.product_id] || 'coin'} size={40} />
              <Text style={[type.bodyBold, { marginTop: 2 }]}>{p.coins}</Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {PACK_PRICE[p.product_id] || ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[type.caption, { color: colors.textMuted, marginTop: space.sm }]}>
          You also earn coins for every run and every level.
        </Text>
      </Card>

      {/* slot filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: space.md }}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
      >
        {SLOTS.map((s) => (
          <TouchableOpacity key={s.key} onPress={() => setSlot(s.key)} accessibilityRole="button">
            <Pill
              label={s.label}
              color={slot === s.key ? brand.pink : colors.textMuted}
              variant={slot === s.key ? 'solid' : 'outline'}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* items */}
      <View style={styles.grid}>
        {shown.map((item) => {
          const cat = getItem(item.slot, item.item_id);
          const tint = RARITY_COLOR[item.rarity] || colors.border;
          const afford = data.coins >= item.price;
          return (
            <TouchableOpacity
              key={item.item_id}
              style={[
                styles.cell,
                { backgroundColor: colors.card, borderColor: item.owned ? colors.border : tint },
                item.owned && { opacity: 0.55 },
              ]}
              onPress={() => !item.owned && buy(item)}
              disabled={item.owned || !!busy}
              accessibilityRole="button"
              accessibilityLabel={`${cat?.label || item.item_id}, ${item.owned ? 'owned' : `${item.price} coins`}`}
            >
              <PartThumb slot={item.slot} item={cat} equipped={{}} size={54} />
              <Text style={[type.caption, { textAlign: 'center' }]} numberOfLines={1}>
                {cat?.label || item.item_id}
              </Text>
              {item.owned ? (
                <Text style={[type.caption, { color: colors.textMuted }]}>Owned</Text>
              ) : (
                <Row gap={4}>
                  <AppIcon name="coin" size={14} />
                  <Text style={[type.captionMedium, { color: afford ? colors.text : colors.textDim }]}>
                    {busy === item.item_id ? '…' : item.price}
                  </Text>
                </Row>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  balance: { alignItems: 'center' },
  packRow: { flexDirection: 'row', gap: 8 },
  pack: {
    flex: 1, alignItems: 'center', paddingVertical: space.md,
    borderRadius: radius.card, borderWidth: 1,
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    marginTop: space.md,
  },
  cell: {
    width: '31.5%', alignItems: 'center', gap: 4, paddingVertical: space.md,
    borderRadius: radius.card, borderWidth: 1.5, marginBottom: space.md,
  },
});
