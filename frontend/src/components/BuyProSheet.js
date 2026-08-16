// BuyProSheet — the PASER PRO paywall (auto renewing subscription).
//
// Replaces BuyPassSheet, which sold the old one-time lifetime unlock. That
// product is retired: it is no longer offered anywhere, but anyone who holds
// it keeps it forever and this sheet says so instead of trying to sell them
// something they already have.
//
// THE DISCLOSURE BLOCK IS NOT DECORATION. App Store review guideline 3.1.2
// requires a subscription paywall to state, in the binary and before the
// purchase, what the subscription is, how long a period lasts, what it costs,
// that it renews itself, how to stop it, and to carry working links to the
// terms and the privacy policy. A build without those is rejected, and PASER
// has already spent one rejection cycle on a permission prompt (5.1.1(iv)).
// Everything below `<Disclosure />` is there for that reason. Do not trim it
// to make the sheet shorter.

import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { api } from '../api/client';
import { invalidateAfterEntitlementChange } from '../api/cache';
import { PLANS, PRO_MONTHLY, PRO_PERKS, PRO_PRODUCTS } from '../config/pro';
import { useAccent } from '../hooks/useAccent';
import usePro from '../hooks/usePro';
import { finishPurchase, fetchProductPrices, restorePurchases, storeSubscribe } from '../iap';
import { brand, radius, space, useTheme, useThemedType } from '../theme';
import { toast } from '../ui/toast';
import AppIcon from './AppIcon';
import { Row, Sheet } from './ui';
import ToonButton from './ui/ToonButton';

const TERMS_URL = 'https://www.gameablestudios.com/terms';
const PRIVACY_URL = 'https://www.gameablestudios.com/privacy';

// Apple's standard EULA, which is what applies unless a custom one is filed
// in App Store Connect. A link here is required either way.
const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

/**
 * `status` is optional. Left off, the sheet asks for entitlement itself, so a
 * caller can never open a paywall that is out of step with what the account
 * actually holds — which is how somebody who already pays gets sold to twice.
 */
export default function BuyProSheet({ visible, onClose, onPurchased, status }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const accent = useAccent();
  const { pro } = usePro();
  const entitlement = status || pro;
  const [plan, setPlan] = useState(PRO_MONTHLY);
  const [prices, setPrices] = useState({});
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Only once the sheet actually opens — RN's <Modal> (what Sheet wraps)
  // keeps children mounted while closed, so a fetch on mount would touch the
  // store connection every time the screen behind it merely renders.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchProductPrices(PRO_PRODUCTS, { subscription: true })
      .then((live) => { if (!cancelled) setPrices(live); })
      .catch(() => {}); // store unreachable: the fallback prices stay up
    return () => { cancelled = true; };
  }, [visible]);

  const priceFor = (p) => prices[p.id] || p.fallbackPrice;
  const selected = PLANS.find((p) => p.id === plan) || PLANS[0];

  const subscribe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { receipt, platform, purchase } = await storeSubscribe(plan);
      // The backend must credit it BEFORE the transaction is finished. An
      // unfinished transaction stays queued and replays, so a failure here
      // is recoverable; finishing first and then failing loses a purchase
      // that has already been paid for.
      await api.subscribePro(plan, receipt, platform);
      await finishPurchase(purchase, { isConsumable: false });
      invalidateAfterEntitlementChange();
      toast.success('PASER PRO is active!');
      onPurchased?.();
      onClose?.();
    } catch (e) {
      if (e?.cancelled) return; // backed out of the system sheet: not a failure
      if (e?.status === 409) {
        toast.error('That subscription is already active on another account.');
      } else {
        toast.error(e.status === 501 ? 'Purchases aren’t live yet.' : (e.message || 'Could not complete purchase'));
      }
    } finally {
      setBusy(false);
    }
  };

  // Required by guideline 3.1.2: a way to get back something already paid for
  // without paying twice. A new device, a reinstall, or the backend call above
  // failing after the store side already went through.
  const restore = async () => {
    if (restoring || busy) return;
    setRestoring(true);
    try {
      const purchases = await restorePurchases();
      const owned = (purchases || []).filter((p) => PRO_PRODUCTS.includes(p.productId));
      if (!owned.length) {
        // The retired lifetime pass restores through its own endpoint, so a
        // long standing player finds nothing here and has to be sent there.
        const legacy = (purchases || []).find((p) => p.productId === 'premium_pass');
        if (legacy) {
          await api.purchasePass(legacy.purchaseToken, Platform.OS);
          await finishPurchase(legacy, { isConsumable: false });
          invalidateAfterEntitlementChange();
          toast.success('Your lifetime pass is back.');
          onPurchased?.();
          onClose?.();
          return;
        }
        toast.error('No previous purchase found for this account.');
        return;
      }
      await api.syncPro(owned.map((p) => ({
        product_id: p.productId, receipt: p.purchaseToken, platform: Platform.OS,
      })));
      for (const p of owned) await finishPurchase(p, { isConsumable: false });
      invalidateAfterEntitlementChange();
      toast.success('PASER PRO restored!');
      onPurchased?.();
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not restore purchases');
    } finally {
      setRestoring(false);
    }
  };

  // Somebody who bought the old permanent unlock. Nothing to sell here.
  if (entitlement?.lifetime) {
    return (
      <Sheet visible={visible} onClose={onClose}>
        <Text style={[type.heading, { marginBottom: 4 }]}>You have PASER PRO</Text>
        <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
          Your original pass covers everything PRO does, for as long as you play. There is nothing to renew and nothing to pay.
        </Text>
        {PRO_PERKS.map(([icon, label]) => (
          <Perk key={icon} icon={icon} label={label} colors={colors} type={type} />
        ))}
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[type.heading, { marginBottom: 4 }]}>PASER PRO</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
        Plan your ground, read your history, know your rivals. Every claim, every metre of land and every place on the board stays exactly as free as it is today.
      </Text>

      {entitlement?.in_grace ? (
        <View style={[styles.notice, { backgroundColor: colors.card, borderColor: brand.pink }]}>
          <Text style={[type.bodySmBold, { color: colors.text }]}>
            Your last payment did not go through. PRO keeps working for a few days while your store retries it.
          </Text>
        </View>
      ) : null}

      {PRO_PERKS.map(([icon, label]) => (
        <Perk key={icon} icon={icon} label={label} colors={colors} type={type} />
      ))}

      <Row gap={space.sm} style={{ marginTop: space.sm }}>
        {PLANS.map((p) => {
          const on = p.id === plan;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => setPlan(p.id)}
              disabled={busy || restoring}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${p.label}, ${priceFor(p)} per ${p.period}`}
              style={[
                styles.plan,
                { backgroundColor: colors.card, borderColor: on ? accent : colors.border },
              ]}
            >
              <Text style={[type.bodySmBold, { color: colors.text }]}>{p.label}</Text>
              <Text style={[type.heading, { color: colors.text }]}>{priceFor(p)}</Text>
              <Text style={[type.caption, { color: colors.textDim }]}>per {p.period}</Text>
              {p.badge ? (
                <Text style={[type.caption, { color: colors.textMuted }]}>{p.badge}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </Row>

      <ToonButton
        title={busy ? 'Activating…' : `Subscribe · ${priceFor(selected)} per ${selected.period}`}
        onPress={subscribe}
        disabled={busy || restoring}
        style={{ marginTop: space.md }}
      />

      <Disclosure
        colors={colors}
        type={type}
        price={priceFor(selected)}
        period={selected.period}
      />

      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <TouchableOpacity
          onPress={restore}
          disabled={restoring || busy}
          style={{ padding: 4 }}
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

function Perk({ icon, label, colors, type }) {
  return (
    <Row gap={12} style={[styles.perk, { backgroundColor: colors.card }]}>
      <AppIcon name={icon} size={22} />
      <Text style={[type.bodySmBold, { flex: 1 }]}>{label}</Text>
    </Row>
  );
}

// Guideline 3.1.2's required text. Worded per store because the account being
// charged and the place a subscription is cancelled are different on each,
// and telling somebody to look in the wrong settings screen is how a
// cancellation turns into a refund request.
function Disclosure({ colors, type, price, period }) {
  const store = Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account';
  const where = Platform.OS === 'ios'
    ? 'in your Apple ID settings'
    : 'in your Google Play subscriptions';
  const open = (url) => Linking.openURL(url).catch(() => {});
  return (
    <View style={{ marginTop: space.sm }}>
      <Text style={[type.caption, { color: colors.textDim, lineHeight: 16 }]}>
        {`PASER PRO costs ${price} per ${period}. It renews itself every ${period} and your ${store} is charged within 24 hours before each renewal, unless you turn renewal off at least 24 hours before the current period ends. You can turn it off at any time ${where}.`}
      </Text>
      <Row gap={space.sm} style={{ marginTop: space.xs, flexWrap: 'wrap' }}>
        <TouchableOpacity onPress={() => open(Platform.OS === 'ios' ? APPLE_EULA_URL : TERMS_URL)} accessibilityRole="link">
          <Text style={[type.caption, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
            Terms of use
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => open(PRIVACY_URL)} accessibilityRole="link">
          <Text style={[type.caption, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
            Privacy policy
          </Text>
        </TouchableOpacity>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  perk: { borderRadius: radius.card, padding: space.md, marginBottom: space.sm },
  plan: { flex: 1, borderRadius: radius.card, borderWidth: 2, padding: space.md, gap: 2 },
  notice: { borderRadius: radius.card, borderWidth: 2, padding: space.md, marginBottom: space.sm },
});
