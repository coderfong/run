// BuyPassSheet — the premium pass unlock (real-money IAP, one-time).

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { api } from '../api/client';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Sheet, Button, Row } from './ui';
import AppIcon from './AppIcon';
import { toast } from '../ui/toast';
import { finishPurchase, fetchProductPrices, restorePurchases, storePurchase } from '../iap';

const PRODUCT_ID = 'premium_pass';
const FALLBACK_PRICE = '$4.99';
const GOLD = '#eab308';

const PERKS = [
  ['lootbox', 'Rarer lootboxes on every box tier'],
  ['energy', '+25 to 50 energy on every other tier'],
  ['award', 'Yours forever. The ladder never resets'],
];

export default function BuyPassSheet({ visible, onClose, onPurchased }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [price, setPrice] = useState(FALLBACK_PRICE);

  // Fetched only once the sheet actually opens — this can't run on mount,
  // since RN's <Modal> (what Sheet wraps) keeps its children mounted even
  // while closed, and touching the store connection here every time this
  // screen renders would be a very different cost to "when the shop opens".
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchProductPrices([PRODUCT_ID])
      .then((prices) => {
        if (!cancelled && prices[PRODUCT_ID]) setPrice(prices[PRODUCT_ID]);
      })
      .catch(() => {}); // store unreachable — the fallback price stays up
    return () => { cancelled = true; };
  }, [visible]);

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { receipt, platform, purchase } = await storePurchase(PRODUCT_ID);
      try {
        await api.purchasePass(receipt, platform);
      } catch (e) {
        // The store has the transaction; the backend hasn't credited it.
        // Do NOT finish it — an unfinished transaction stays queued and
        // replays (on iOS, every launch; on Android, on the next
        // `getAvailablePurchases`), so the retry above has something to
        // catch instead of the purchase being lost after being paid for.
        throw e;
      }
      await finishPurchase(purchase, { isConsumable: false });
      toast.success('Premium pass activated!');
      onPurchased?.();
      onClose?.();
    } catch (e) {
      if (e?.cancelled) return; // backed out of the system sheet — not a failure
      toast.error(e.status === 501 ? 'Purchases aren’t live yet.' : (e.message || 'Could not complete purchase'));
    } finally {
      setBusy(false);
    }
  };

  // Required by App Store review guideline 3.1.2 for a non-consumable: a way
  // to get back something already paid for without paying twice — a new
  // device, a reinstall, or this backend call failing after the store side
  // of a purchase already went through.
  const restore = async () => {
    if (restoring || busy) return;
    setRestoring(true);
    try {
      const purchases = await restorePurchases();
      const owned = (purchases || []).find((p) => p.productId === PRODUCT_ID);
      if (!owned) {
        toast.error('No previous purchase found for this account.');
        return;
      }
      await api.purchasePass(owned.purchaseToken, Platform.OS);
      await finishPurchase(owned, { isConsumable: false });
      toast.success('Premium pass restored!');
      onPurchased?.();
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not restore purchases');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[type.heading, { marginBottom: 4 }]}>Premium pass</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
        Unlock the gold track. A second reward on every level you've earned and every level to come.
      </Text>
      {PERKS.map(([icon, label]) => (
        <Row key={icon} gap={12} style={[styles.perk, { backgroundColor: colors.card }]}>
          <AppIcon name={icon} size={22} />
          <Text style={[type.bodySmBold, { flex: 1 }]}>{label}</Text>
        </Row>
      ))}
      <Button
        title={busy ? 'Activating…' : `Activate · ${price}`}
        variant="gradient"
        onPress={buy}
        disabled={busy || restoring}
        style={{ marginTop: space.sm }}
      />
      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <Text style={[type.caption, { color: colors.textDim }]}>A single purchase. No subscription.</Text>
        <TouchableOpacity
          onPress={restore}
          disabled={restoring || busy}
          style={{ marginTop: space.sm, padding: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
        >
          <Text style={[type.captionMedium, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
            {restoring ? 'Restoring…' : 'Restore purchases'}
          </Text>
        </TouchableOpacity>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  perk: { borderRadius: radius.card, padding: space.md, marginBottom: space.sm },
});

export { GOLD };
