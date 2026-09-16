// BuyProSheet — the PASER PRO paywall (auto renewing subscription).
//
// Replaces BuyPassSheet, which sold the old one-time lifetime unlock. That
// product is retired: it is no longer offered anywhere, but anyone who holds
// it keeps it forever and this sheet says so instead of trying to sell them
// something they already have.
//
// ONE SHEET, MANY ARGUMENTS. `context` (a key from config/proContexts.js)
// swaps the title, the subtitle, the perk list and the button, so the runner
// who just tapped "Vulnerable territories" is answered about THAT rather than
// being handed a generic feature list. What it never swaps is the price block
// and everything below it. Screens do not render this directly any more —
// src/pro/ProProvider.js mounts the only instance and opens it via
// `openPaywall(context)`.
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
import { applyProEntitlement, invalidateAfterEntitlementChange } from '../api/cache';
import { EVENTS, track } from '../analytics';
import { PLANS, PRO_MONTHLY, PRO_PRODUCTS } from '../config/pro';
import { proContext } from '../config/proContexts';
import { useAccent } from '../hooks/useAccent';
import usePro from '../hooks/usePro';
import { useStoreAvailable } from '../pro/storeAvailable';
import { finishPurchase, fetchProductPrices, restorePurchases, storeSubscribe } from '../iap';
import { brand, NB, nbInk, nbRadius, radius, space, tintOn, useTheme, useThemedType } from '../theme';
import { toast } from '../ui/toast';
import AppIcon from './AppIcon';
import { HardShadow, Row, Sheet } from './ui';
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
 *
 * `context` picks the pitch (config/proContexts.js) and tags the funnel.
 * `automatic` only ever reaches analytics: it says whether PASER opened this
 * or the runner did, which is the difference between a prompt and an answer.
 */
export default function BuyProSheet({
  visible,
  onClose,
  onPurchased,
  status,
  context,
  automatic = false,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const accent = useAccent();
  const { pro } = usePro();
  const entitlement = status || pro;
  const pitch = proContext(context);
  const [plan, setPlan] = useState(PRO_MONTHLY);
  const [prices, setPrices] = useState({});
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Whether a transaction could actually complete. The sheet OPENS whenever
  // PRO is present in the build (see ProProvider.openPaywall) so the pitch can
  // always be read; this is only about whether the button at the bottom of it
  // is a real button. With the store not yet live it says so, plainly, instead
  // of looking live and then failing — which is both the honest thing to show
  // a store reviewer and the difference between "not yet" and "broken".
  const canSell = useStoreAvailable();

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

  // Every funnel event carries the same three properties, so the analytics
  // side of this component is one object rather than a repeated literal that
  // eventually disagrees with itself.
  const funnel = (extra) => ({
    source: pitch.source,
    context: pitch.key,
    trigger: automatic ? 'automatic' : 'user',
    plan,
    ...extra,
  });

  const subscribe = async () => {
    if (busy) return;
    setBusy(true);
    track(EVENTS.PURCHASE_START, funnel());
    try {
      const { receipt, platform, purchase } = await storeSubscribe(plan);
      // The backend must credit it BEFORE the transaction is finished. An
      // unfinished transaction stays queued and replays, so a failure here
      // is recoverable; finishing first and then failing loses a purchase
      // that has already been paid for.
      const entitlement = await api.subscribePro(plan, receipt, platform);
      await finishPurchase(purchase, { isConsumable: false });
      // /subscribe returns the final server entitlement. Publish it directly
      // so every mounted lock opens now, without depending on a second GET.
      applyProEntitlement(entitlement);
      track(EVENTS.PURCHASE_SUCCESS, funnel());
      // No toast: the sheet closes and ProProvider raises the full-screen
      // welcome (src/components/ProWelcome.js), which is the confirmation now.
      onPurchased?.();
      onClose?.();
    } catch (e) {
      // Cancelled is NOT a failure and must not be counted as one: a purchase
      // failure rate that silently includes everybody who changed their mind
      // reads as a broken store.
      track(
        e?.cancelled ? EVENTS.PAYWALL_DISMISS : EVENTS.PURCHASE_FAILURE,
        funnel(e?.cancelled ? { at: 'store_sheet' } : { reason: String(e?.status || 'error') })
      );
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
          track(EVENTS.RESTORE_SUCCESS, funnel({ plan: 'premium_pass' }));
          onPurchased?.({ restored: true });
          onClose?.();
          return;
        }
        toast.error('No previous purchase found for this account.');
        return;
      }
      const entitlement = await api.syncPro(owned.map((p) => ({
        product_id: p.productId, receipt: p.purchaseToken, platform: Platform.OS,
      })));
      for (const p of owned) await finishPurchase(p, { isConsumable: false });
      applyProEntitlement(entitlement);
      track(EVENTS.RESTORE_SUCCESS, funnel());
      onPurchased?.({ restored: true });
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
        {pitch.perks.map(([icon, label]) => (
          <Perk key={icon} icon={icon} label={label} colors={colors} type={type} />
        ))}
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      {/* The context's own headline. A runner who tapped a padlocked map layer
          gets answered about the map; one who walked in through the Profile
          hub gets the general pitch. Both are this component. */}
      <Text style={[type.heading, { marginBottom: 4 }]}>{pitch.title}</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
        {pitch.subtitle}
      </Text>
      {/* The promise that makes the rest of it acceptable, and it is never
          contextual: whatever brought them here, nothing they can do today
          gets taken away. */}
      {pitch.key !== 'default' ? (
        <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md }]}>
          Running, claiming and your place on the board stay free.
        </Text>
      ) : null}

      {entitlement?.in_grace ? (
        <View style={[styles.notice, { backgroundColor: colors.card, borderColor: brand.pink }]}>
          <Text style={[type.bodySmBold, { color: colors.text }]}>
            Your last payment did not go through. PRO keeps working for a few days while your store retries it.
          </Text>
        </View>
      ) : null}

      {pitch.perks.map(([icon, label]) => (
        <Perk key={icon} icon={icon} label={label} colors={colors} type={type} />
      ))}

      <Row gap={space.md} align="stretch" style={{ marginTop: space.sm }}>
        {PLANS.map((p) => {
          const on = p.id === plan;
          // The rest of the app draws its boxes the neo-brutalist way — a heavy
          // ink stroke and a hard, zero-blur offset drop — so this picker does
          // too, instead of the flat card with a thin coloured hairline it used
          // to be. Selection is told the same way a pressed button is told
          // apart from a flat field: the chosen plan is a RAISED block in the
          // accent (stroke + hard drop), the other sits flush with no drop.
          //
          // OPAQUE, and that is the whole point of `tintOn` rather than
          // `withAlpha` here. HardShadow paints its drop as a solid block the
          // full size of the card and offsets it — so it is directly BEHIND
          // the card, not only along two edges. A translucent fill let that
          // near-black block through, and the selected plan (the monthly one,
          // by default, on first open) rendered as a dark slab with unreadable
          // text on it: the one plan the runner is being asked to read.
          const fill = on
            ? tintOn(colors.card, accent, scheme === 'dark' ? 0.22 : 0.14)
            : colors.card;
          return (
            <HardShadow
              key={p.id}
              radius={nbRadius.sm}
              offset={on ? NB.offsetSm : 0}
              accent={accent}
              on={fill}
              style={{ flex: 1 }}
            >
              <TouchableOpacity
                onPress={() => setPlan(p.id)}
                disabled={busy || restoring}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.label}, ${priceFor(p)} per ${p.period}`}
                style={[
                  styles.plan,
                  { backgroundColor: fill, borderColor: nbInk(scheme, fill) },
                ]}
              >
                <Text style={[type.bodySmBold, { color: colors.text }]}>{p.label}</Text>
                <Text style={[type.heading, { color: colors.text }]}>{priceFor(p)}</Text>
                <Text style={[type.caption, { color: colors.textDim }]}>per {p.period}</Text>
                {p.badge ? (
                  <Text style={[type.caption, { color: colors.textMuted }]}>{p.badge}</Text>
                ) : null}
              </TouchableOpacity>
            </HardShadow>
          );
        })}
      </Row>

      {/* The context may rename the action ("Unlock Territory Planner") but it
          can never drop the price off it. Guideline 3.1.2 wants the cost in
          front of the runner before the purchase, and a button that says only
          "Unlock" on a subscription is the exact pattern review rejects. */}
      <ToonButton
        title={
          !canSell
            ? 'Coming soon'
            : busy
              ? 'Activating…'
              : `${pitch.cta || 'Subscribe'} for ${priceFor(selected)} per ${selected.period}`
        }
        onPress={subscribe}
        disabled={!canSell || busy || restoring}
        style={{ marginTop: space.md }}
      />

      {!canSell ? (
        <Text
          style={[type.caption, { color: colors.textMuted, textAlign: 'center', marginTop: space.sm }]}
        >
          Subscriptions are not open yet. Everything above is what PASER PRO
          will include.
        </Text>
      ) : null}

      <Disclosure
        colors={colors}
        type={type}
        price={priceFor(selected)}
        period={selected.period}
      />

      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <TouchableOpacity
          onPress={restore}
          disabled={!canSell || restoring || busy}
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
  plan: { flex: 1, borderRadius: nbRadius.sm, borderWidth: NB.stroke, padding: space.md, gap: 2 },
  notice: { borderRadius: radius.card, borderWidth: 2, padding: space.md, marginBottom: space.sm },
});
