// BuyEnergySheet — the energy + coins refill shop (real-money IAP,
// consumables — bought again every time the player runs out).

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { api } from '../api/client';
import { brand, radius, space, useTheme, useThemedType } from '../theme';
import { Sheet } from './ui';
import AppIcon from './AppIcon';
import { toast } from '../ui/toast';
import { finishPurchase, fetchProductPrices, storePurchase } from '../iap';

const PACKS = [
  { id: 'energy_refill_small', label: '+50 energy', price: '$0.99' },
  { id: 'energy_pack_large', label: '+150 energy', price: '$1.99' },
  { id: 'energy_refill_full', label: 'Full refill', price: '$2.99' },
];

// Mirrors COIN_PRODUCTS in backend/app/coins.py. Prices must match the App
// Store tiers or the sheet advertises a number Apple doesn't charge — the
// live `fetchProductPrices` call below is what actually keeps that true;
// these strings are only the fallback shown before it answers.
const COIN_PACKS = [
  { id: 'coins_pouch', coins: 500, price: '$0.99', icon: 'coin-pouch' },
  { id: 'coins_sack', coins: 1200, price: '$1.99', icon: 'coin-sack' },
  { id: 'coins_chest', coins: 3000, price: '$4.99', icon: 'coin-chest' },
  { id: 'coins_vault', coins: 6500, price: '$9.99', icon: 'coin-vault' },
];

const ALL_PRODUCT_IDS = [...PACKS, ...COIN_PACKS].map((p) => p.id);

export default function BuyEnergySheet({ visible, onClose, onPurchased }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const [busy, setBusy] = useState(null);
  const [prices, setPrices] = useState({});

  // Only once the sheet actually opens — RN's <Modal> (what Sheet wraps)
  // keeps children mounted while closed, so this can't run on mount without
  // touching the store connection every time this screen merely renders.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchProductPrices(ALL_PRODUCT_IDS)
      .then((live) => { if (!cancelled) setPrices(live); })
      .catch(() => {}); // store unreachable — the packs' own fallback prices stay up
    return () => { cancelled = true; };
  }, [visible]);

  const priceFor = (pack) => prices[pack.id] || pack.price;

  const buy = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    try {
      const { receipt, platform, purchase } = await storePurchase(pack.id);
      const res = await api.purchaseEnergy(pack.id, receipt, platform);
      // Consumable: finished as CONSUMED so the same pack can be bought
      // again next time the player runs low, unlike the one-time pass.
      await finishPurchase(purchase, { isConsumable: true });
      toast.success(`Energy topped up to ${res.energy.energy}/${res.energy.energy_max}`);
      onPurchased?.();
      onClose?.();
    } catch (e) {
      if (e?.cancelled) return;
      toast.error(e.status === 501 ? 'Purchases aren’t live yet.' : (e.message || 'Could not complete purchase'));
    } finally {
      setBusy(null);
    }
  };

  const buyCoins = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    try {
      const { receipt, platform, purchase } = await storePurchase(pack.id);
      // The response's `coins` is the new BALANCE, not the amount just
      // added — the pack's own known amount is what belongs in "+N coins".
      await api.purchaseCoins(pack.id, receipt, platform);
      await finishPurchase(purchase, { isConsumable: true });
      toast.success(`+${pack.coins} coins`);
      onPurchased?.();
      onClose?.();
    } catch (e) {
      if (e?.cancelled) return;
      toast.error(e.status === 402 ? 'Purchases aren’t live yet.'
        : (e.message || 'Could not complete purchase'));
    } finally {
      setBusy(null);
    }
  };

  // Both currencies in one sheet: they're both real-money IAP, and splitting
  // them across two screens made "get more of the thing I ran out of" a
  // navigation puzzle.
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[type.heading, { marginBottom: 4 }]}>Get more</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
        Energy powers territory claims and refills on its own over time. Coins
        buy cosmetics in the shop. You also earn them every run and level.
      </Text>

      <Text style={[type.bodySmBold, { color: colors.textMuted, marginBottom: space.sm }]}>
        ENERGY
      </Text>
      {PACKS.map((pack) => (
        <TouchableOpacity
          key={pack.id}
          style={[styles.row, { backgroundColor: colors.card }]}
          onPress={() => buy(pack)}
          disabled={!!busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${pack.label} for ${priceFor(pack)}`}
        >
          <AppIcon name="energy" size={22} />
          <Text style={[type.bodyBold, { flex: 1 }]}>{pack.label}</Text>
          <View style={[styles.price, { backgroundColor: brand.pink }]}>
            <Text style={[type.bodySmBold, { color: '#fff' }]}>{busy === pack.id ? '…' : priceFor(pack)}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={[type.bodySmBold, { color: colors.textMuted, marginTop: space.lg, marginBottom: space.sm }]}>
        COINS
      </Text>
      {COIN_PACKS.map((pack) => (
        <TouchableOpacity
          key={pack.id}
          style={[styles.row, { backgroundColor: colors.card }]}
          onPress={() => buyCoins(pack)}
          disabled={!!busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${pack.coins} coins for ${priceFor(pack)}`}
        >
          <AppIcon name={pack.icon} size={26} />
          <Text style={[type.bodyBold, { flex: 1 }]}>{pack.coins.toLocaleString()} coins</Text>
          <View style={[styles.price, { backgroundColor: '#eab308' }]}>
            <Text style={[type.bodySmBold, { color: '#fff' }]}>{busy === pack.id ? '…' : priceFor(pack)}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderRadius: radius.card, padding: space.lg, marginBottom: space.sm,
  },
  price: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6, minWidth: 64, alignItems: 'center' },
});
