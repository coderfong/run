// iap.js — the real store client behind BuyProSheet and BuyEnergySheet.
//
// expo-iap, not react-native-iap: this is an Expo managed-workflow project
// (EAS builds, Expo Dev Client), and react-native-iap v14+ explicitly does
// not support that setup — only bare React Native. expo-iap is the same
// OpenIAP spec (same product ids, same purchase shape), built for exactly
// this project's setup.
//
// A NEW NATIVE MODULE. Like every native dependency this app has added
// before, it needs a fresh dev-client / EAS build before any of this runs —
// Fast Refresh alone will not pick it up, and Expo Go can't run it at all.
//
// The backend side of this (app/iap.py) verifies whatever `receipt` these
// functions hand back: on iOS that's the StoreKit 2 signed transaction
// (verified locally against Apple's own root certificate), on Android the
// Play Billing purchase token (verified against the Android Publisher API).
// Both arrive here under the same field name — `purchase.purchaseToken` — the
// OpenIAP spec's "unified purchase token".

import { Platform } from 'react-native';
import {
  ErrorCode,
  finishTransaction,
  fetchProducts,
  getActiveSubscriptions,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases as restorePurchasesNative,
} from 'expo-iap';

// Shared by every caller, so two sheets open in the same session (unlikely,
// but the picker → buy flow makes it possible) do not each try to open their
// own store connection.
let connected = null;

function ensureConnection() {
  if (!connected) {
    connected = initConnection().catch((e) => {
      connected = null; // a failed attempt must not poison every retry after it
      throw e;
    });
  }
  return connected;
}

function receiptFrom(purchase) {
  return purchase?.purchaseToken || null;
}

/**
 * Buy one product. Resolves once the STORE confirms the purchase; the caller
 * still owns sending the receipt to the backend and then calling
 * `finishPurchase` — never the other way round, see there.
 *
 * `type` is 'in-app' for the one-time products (energy, coins, the retired
 * pass) and 'subs' for PASER PRO. It is not cosmetic: the stores treat a
 * subscription as a different kind of transaction, and asking for one with
 * the wrong type fails at the store rather than here.
 *
 * Rejects with a plain Error. `error.cancelled` is true when the person
 * backed out of the system sheet, which callers should treat as silent
 * rather than as a failure worth a toast.
 */
export function purchaseProduct(productId, { type = 'in-app', subscriptionOffers } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      updateSub.remove();
      errorSub.remove();
    };
    // A StoreKit/Play Billing connection can replay OTHER unfinished
    // transactions from a previous session the moment it opens — a purchase
    // that succeeded but never got finished because the app died before
    // `finishPurchase` ran. Filtering by product id is what stops one of
    // those from being mistaken for the purchase this call actually asked
    // for; it is left in the queue for `restorePurchases` to pick up instead.
    const updateSub = purchaseUpdatedListener((purchase) => {
      const matches = purchase.productId === productId || purchase.ids?.includes(productId);
      if (!matches || settled) return;
      settled = true;
      cleanup();
      resolve(purchase);
    });
    const errorSub = purchaseErrorListener((error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error(error.message || 'Purchase failed');
      err.cancelled = error.code === ErrorCode.UserCancelled;
      reject(err);
    });

    ensureConnection()
      .then(() => requestPurchase({
        type,
        request: {
          apple: { sku: productId },
          google: {
            skus: [productId],
            // Play REQUIRES the offer token for a subscription — a base plan
            // can carry several offers (intro price, free trial) and the store
            // will not pick one for us. iOS ignores this entirely.
            ...(subscriptionOffers ? { subscriptionOffers } : {}),
          },
        },
      }))
      // requestPurchase's own result is not the outcome (see the listeners
      // above) — this catch is only for a SYNCHRONOUS failure to even start
      // the flow (not connected, bad sku, store unreachable).
      .catch((e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      });
  });
}

/**
 * Finalize a transaction. Call this ONLY after the backend has credited the
 * purchase (or reported it as already-redeemed) — finishing it first and
 * having the backend call fail afterward loses the transaction for good:
 * the store no longer has it queued to retry, and the player paid for
 * nothing. `isConsumable` is false for a subscription and for the retired
 * pass (and any non-consumable), true for energy/coin packs, which have to be
 * finished as consumed so the same SKU can be bought again.
 */
export async function finishPurchase(purchase, { isConsumable }) {
  await finishTransaction({ purchase, isConsumable });
}

/**
 * The shape BuyEnergySheet actually wants: buy the product,
 * hand back what the backend's `/*\/purchase` endpoints take. The purchase
 * itself rides along too, since the caller needs it again for
 * `finishPurchase` once the backend confirms.
 */
export async function storePurchase(productId) {
  const purchase = await purchaseProduct(productId);
  const receipt = receiptFrom(purchase);
  if (!receipt) throw new Error('The store did not return a purchase token');
  return { receipt, platform: Platform.OS, purchase };
}

/**
 * Store-formatted prices for a set of product ids, keyed by id — e.g.
 * `{ premium_pass: '$4.99' }`, already localized to the storefront the
 * device is signed into. Callers should fall back to a static price on
 * failure (offline, store unreachable) rather than blocking the sheet from
 * opening at all.
 *
 * Pass `{ subscription: true }` for PRO. Subscriptions live in a separate
 * catalogue on both stores, so asking for them as 'in-app' returns nothing
 * at all rather than erroring — which looks exactly like "offline" and would
 * silently leave the paywall showing its fallback price forever.
 */
export async function fetchProductPrices(skus, { subscription = false } = {}) {
  if (!skus?.length) return {};
  await ensureConnection();
  const products = await fetchProducts({ skus, type: subscription ? 'subs' : 'in-app' });
  const out = {};
  for (const p of products || []) out[p.id] = p.displayPrice;
  if (__DEV__) logPriceLookup(skus, products, out);
  return out;
}

/**
 * Why the sheets show a fallback price. Dev builds only.
 *
 * A sku the store does not know about is omitted from the answer rather than
 * erroring, and the callers deliberately swallow failures so the sheet still
 * opens — so an empty result and a working store look identical on screen,
 * and the fallback price silently stands in for a number nobody checked.
 * This says which ids came back, in which currency, and which did not.
 *
 * Run it on a DEV CLIENT ON A REAL DEVICE signed into a Sandbox Apple Account.
 * The simulator has no store, and a TestFlight build has no console — see
 * `docs/APP_STORE.md` for reading the same thing off a TestFlight build.
 */
function logPriceLookup(skus, products, out) {
  const found = products || [];
  for (const p of found) {
    console.log(`[iap] ${p.id} = ${p.displayPrice} (${p.currency ?? 'currency not reported'})`);
  }
  const missing = skus.filter((s) => !out[s]);
  if (!missing.length) return;
  console.warn(
    `[iap] the store returned nothing for ${missing.join(', ')} — the sheet is ` +
      'showing its hardcoded fallback price for these, which is not necessarily ' +
      'what Apple would charge. Usual causes, in the order worth checking: the ' +
      'Paid Apps agreement is not active in Agreements, Tax, and Banking; the ' +
      'product is still in Missing Metadata; the id differs from the one in ' +
      'config/pro.js or BuyEnergySheet.js (they are case sensitive); or a ' +
      'subscription is being asked for as an in-app product, or the reverse.',
  );
}

/**
 * Start a PASER PRO subscription. Same contract as `storePurchase`: resolves
 * with what `/me/pro/subscribe` takes, plus the purchase for `finishPurchase`.
 *
 * On Android the offer token has to be fetched first (see `purchaseProduct`),
 * which is why this is its own function rather than a flag on that one.
 */
export async function storeSubscribe(productId) {
  let subscriptionOffers;
  if (Platform.OS === 'android') {
    await ensureConnection();
    const products = await fetchProducts({ skus: [productId], type: 'subs' });
    const offers = products?.find((p) => p.id === productId)?.subscriptionOffers || [];
    // Last offer is Play's own convention for the base plan with no
    // promotion attached; anything earlier can be an intro price the person
    // may not be eligible for.
    const offer = offers[offers.length - 1];
    if (offer?.offerToken) subscriptionOffers = [{ sku: productId, offerToken: offer.offerToken }];
  }
  const purchase = await purchaseProduct(productId, { type: 'subs', subscriptionOffers });
  const receipt = receiptFrom(purchase);
  if (!receipt) throw new Error('The store did not return a purchase token');
  return { receipt, platform: Platform.OS, purchase };
}

/**
 * What the store says this device currently has a live subscription to, in
 * the shape `/me/pro/sync` takes. Empty when nothing is active — including
 * when the store is unreachable, so a caller must treat an empty list as "no
 * news" and never as "cancel their PRO". Entitlement is the server's to
 * decide; this only ever feeds it fresher receipts.
 */
export async function activeSubscriptions(productIds) {
  await ensureConnection();
  const subs = await getActiveSubscriptions(productIds);
  return (subs || [])
    .filter((s) => s.isActive !== false && s.purchaseToken)
    .map((s) => ({
      product_id: s.productId,
      receipt: s.purchaseToken,
      platform: Platform.OS,
    }));
}

/**
 * Apple requires a way to restore a non-consumable purchase without paying
 * again (App Store review guideline 3.1.2) — this is what BuyProSheet's
 * "Restore purchases" link calls, for a live subscription and for the retired
 * lifetime pass alike. Play purchases don't need this the same
 * way (Play already knows what an account owns), but it is harmless to call
 * on both, so callers don't need a platform branch.
 */
export async function restorePurchases() {
  await ensureConnection();
  await restorePurchasesNative();
  return getAvailablePurchases();
}
