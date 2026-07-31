// ShopScreen — a small, rotating storefront.
//
// Twelve items at a time on a 12-hour clock, not the whole 155-item
// catalogue: a shop you can exhaust in one sitting has no reason to be
// revisited, and everything looks equally unremarkable when it's all on
// display at once. The selection is derived from the window index server-side
// (coins.py) so it needs no state and can't drift between client and server.
//
// Prices come from the SERVER catalogue — the numbers here are decoration.
// Buying an item that has since rotated out returns 410, which is handled by
// reloading rather than by trusting the local list.
//
// Coin packs deliberately DON'T live here — they're real-money IAP and sit
// with the energy packs in one "Get more" sheet.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useAvatar } from '../state/avatar';
import { radius, space, useTheme, useThemedType, withAlpha } from '../theme';
import { Card, Row, Screen, Skeleton, Button } from '../components/ui';
import { PartThumb } from '../components/character/CharacterRig';
import { getItem } from '../config/cosmetics';
import { RARITY_COLOR } from '../components/RewardArt';
import AppIcon from '../components/AppIcon';
import BuyEnergySheet from '../components/BuyEnergySheet';
import { toast } from '../ui/toast';

function useCountdown(expiresAt) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => setLeft(Math.max(0, expiresAt * 1000 - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, text: `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` };
}

export default function ShopScreen() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { refreshUnlocks } = useAvatar();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [getMore, setGetMore] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.shop()); } catch { setData(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const { left, text: countdown } = useCountdown(data?.expires_at);
  // The window rolled over while the screen was open — pull the new lineup.
  useEffect(() => {
    if (data?.expires_at && left === 0) load();
  }, [left, data?.expires_at, load]);

  const items = data?.items || [];
  const coins = data?.coins ?? 0;

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
      else if (e.status === 410) { toast.error('That just rotated out'); load(); }
      else toast.error(e.message || 'Could not buy that');
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
        <Skeleton width="100%" height={72} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={360} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
    >
      {/* balance + top-up */}
      <Card style={styles.wallet}>
        <Row gap={8} style={{ alignItems: 'center', flex: 1 }}>
          <AppIcon name="coin" size={28} />
          <View>
            <Text style={[type.title, { color: '#eab308' }]}>{coins.toLocaleString()}</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              Earn coins on every run and level
            </Text>
          </View>
        </Row>
        <Button title="Get more" size="sm" full={false} onPress={() => setGetMore(true)} />
      </Card>

      {/* rotation clock */}
      <Row gap={6} style={styles.timer}>
        <AppIcon name="timer" size={16} />
        <Text style={[type.captionMedium, { color: colors.textMuted }]}>
          New items in {countdown}
        </Text>
      </Row>

      <View style={styles.grid}>
        {items.map((item) => {
          const cat = getItem(item.slot, item.item_id);
          const tint = RARITY_COLOR[item.rarity] || colors.border;
          const afford = coins >= item.price;
          return (
            <TouchableOpacity
              key={item.item_id}
              style={[
                styles.cell,
                { backgroundColor: colors.card, borderColor: item.owned ? colors.border : tint },
                item.owned && { opacity: 0.5 },
              ]}
              onPress={() => !item.owned && buy(item)}
              disabled={item.owned || !!busy}
              accessibilityRole="button"
              accessibilityLabel={`${cat?.label || item.item_id}, ${item.rarity}, ${item.owned ? 'owned' : `${item.price} coins`}`}
            >
              <View style={[styles.rarityTag, { backgroundColor: withAlpha(tint, 0.18) }]}>
                <Text style={[type.caption, { color: tint, fontSize: 9 }]}>
                  {item.rarity.toUpperCase()}
                </Text>
              </View>
              <PartThumb slot={item.slot} item={cat} equipped={{}} size={56} />
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

      <BuyEnergySheet
        visible={getMore}
        onClose={() => setGetMore(false)}
        onPurchased={load}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wallet: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  timer: { alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    marginTop: space.md,
  },
  cell: {
    width: '31.5%', alignItems: 'center', gap: 4, paddingTop: space.lg,
    paddingBottom: space.md, borderRadius: radius.card, borderWidth: 1.5,
    marginBottom: space.md,
  },
  rarityTag: {
    position: 'absolute', top: 6, alignSelf: 'center',
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill,
  },
});
