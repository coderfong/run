// BuyPassSheet — the premium pass unlock (real-money IAP, one-time).
//
// Same defensive store layer as BuyEnergySheet: no store SDK is installed yet
// (see the note there — react-native-iap when billing gets wired), so
// storePurchase returns null and the backend credits directly while
// settings.iap_verify_receipts is off. Register 'premium_pass' in App Store
// Connect / Play Console alongside the energy packs.

import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Sheet, Button, Row } from './ui';
import AppIcon from './AppIcon';
import { toast } from '../ui/toast';

const PRICE = '$4.99';
const GOLD = '#eab308';

const PERKS = [
  ['lootbox', 'Rarer lootboxes on every box tier'],
  ['energy', '+25 to 50 energy on every other tier'],
  ['award', 'Yours forever. The ladder never resets'],
];

async function storePurchase(/* productId */) {
  return null;
}

export default function BuyPassSheet({ visible, onClose, onPurchased }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const [busy, setBusy] = useState(false);

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let receipt = null;
      try { receipt = await storePurchase('premium_pass'); } catch (e) {
        toast.error(e.message || 'Purchase failed'); setBusy(false); return;
      }
      await api.purchasePass(receipt, Platform.OS);
      toast.success('Premium pass activated!');
      onPurchased?.();
      onClose?.();
    } catch (e) {
      toast.error(e.status === 501 ? 'Purchases aren’t live yet.' : (e.message || 'Could not complete purchase'));
    } finally {
      setBusy(false);
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
        title={busy ? 'Activating…' : `Activate · ${PRICE}`}
        variant="gradient"
        onPress={buy}
        disabled={busy}
        style={{ marginTop: space.sm }}
      />
      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <Text style={[type.caption, { color: colors.textDim }]}>A single purchase. No subscription.</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  perk: { borderRadius: radius.card, padding: space.md, marginBottom: space.sm },
});

export { GOLD };
