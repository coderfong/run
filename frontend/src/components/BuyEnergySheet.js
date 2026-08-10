// BuyEnergySheet — the energy refill shop (real-money IAP).
//
// Products mirror ENERGY_PRODUCTS in routes/progression.py. The store layer is
// loaded defensively: if `expo-in-app-purchases` isn't installed / configured
// (dev, Expo Go), we fall back to crediting straight through the backend (which
// accepts unverified purchases while settings.iap_verify_receipts is off), so
// the whole flow is testable before store setup.
//
// TODO(prod): install & configure expo-in-app-purchases, register these product
// ids in App Store Connect / Play Console, turn on backend receipt verification,
// and pass the real transaction receipt to api.purchaseEnergy().

import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { api } from '../api/client';
import { brand, radius, space, useTheme, useThemedType } from '../theme';
import { Sheet } from './ui';
import AppIcon from './AppIcon';
import { toast } from '../ui/toast';

const PACKS = [
  { id: 'energy_refill_small', label: '+50 energy', price: '$0.99' },
  { id: 'energy_pack_large', label: '+150 energy', price: '$1.99' },
  { id: 'energy_refill_full', label: 'Full refill', price: '$2.99' },
];

// Mirrors COIN_PRODUCTS in backend/app/coins.py. Prices must match the App
// Store tiers or the sheet advertises a number Apple doesn't charge.
const COIN_PACKS = [
  { id: 'coins_pouch', coins: 500, price: '$0.99', icon: 'coin-pouch' },
  { id: 'coins_sack', coins: 1200, price: '$1.99', icon: 'coin-sack' },
  { id: 'coins_chest', coins: 3000, price: '$4.99', icon: 'coin-chest' },
  { id: 'coins_vault', coins: 6500, price: '$9.99', icon: 'coin-vault' },
];

// No store SDK is installed yet, so we can't reference one: Metro resolves
// imports at BUILD time, and a require() of a missing package is a bundling
// error (try/catch doesn't help). Note `expo-in-app-purchases` is deprecated and
// removed from modern Expo SDKs — use `react-native-iap` (or `expo-iap`) when
// you wire real billing, then do the purchase here and return its receipt.
//
// Returning null means "no store": the backend credits the pack directly while
// settings.iap_verify_receipts is false, so the whole flow is testable in dev.
async function storePurchase(/* productId */) {
  return null;
}

export default function BuyEnergySheet({ visible, onClose, onPurchased }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const [busy, setBusy] = useState(null);

  const buy = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    try {
      let receipt = null;
      try { receipt = await storePurchase(pack.id); } catch (e) {
        toast.error(e.message || 'Purchase failed'); setBusy(null); return;
      }
      const res = await api.purchaseEnergy(pack.id, receipt, Platform.OS);
      toast.success(`Energy topped up to ${res.energy.energy}/${res.energy.energy_max}`);
      onPurchased?.();
      onClose?.();
    } catch (e) {
      // 501 = receipt verification not wired yet (prod guard).
      toast.error(e.status === 501 ? 'Purchases aren’t live yet.' : (e.message || 'Could not complete purchase'));
    } finally {
      setBusy(null);
    }
  };

  const buyCoins = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    try {
      const receipt = await storePurchase(pack.id);
      const res = await api.purchaseCoins(pack.id, receipt, Platform.OS);
      toast.success(`+${pack.coins} coins`);
      onPurchased?.();
      onClose?.();
    } catch (e) {
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
          accessibilityLabel={`${pack.label} for ${pack.price}`}
        >
          <AppIcon name="energy" size={22} />
          <Text style={[type.bodyBold, { flex: 1 }]}>{pack.label}</Text>
          <View style={[styles.price, { backgroundColor: brand.pink }]}>
            <Text style={[type.bodySmBold, { color: '#fff' }]}>{busy === pack.id ? '…' : pack.price}</Text>
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
          accessibilityLabel={`${pack.coins} coins for ${pack.price}`}
        >
          <AppIcon name={pack.icon} size={26} />
          <Text style={[type.bodyBold, { flex: 1 }]}>{pack.coins.toLocaleString()} coins</Text>
          <View style={[styles.price, { backgroundColor: '#eab308' }]}>
            <Text style={[type.bodySmBold, { color: '#fff' }]}>{busy === pack.id ? '…' : pack.price}</Text>
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
