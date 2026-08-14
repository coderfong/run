// iap.js — the real store client behind BuyPassSheet and BuyEnergySheet.
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
 * Buy one product (a one-time IAP, not a subscription — nothing in PASER's
 * shop is recurring). Resolves once the STORE confirms the purchase; the
 * caller still owns sending the receipt to the backend and then calling
 * `finishPurchase` — never the other way round, see there.
 *
 * Rejects with a plain Error. `error.cancelled` is true when the person
 * backed out of the system sheet, which callers should treat as silent
 * rather than as a failure worth a toast.
 */
export function purchaseProduct(productId) {
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
        type: 'in-app',
        request: {
          apple: { sku: productId },
          google: { skus: [productId] },
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
 * nothing. `isConsumable` is false for the permanent pass (and any
 * non-consumable), true for energy/coin packs, which have to be finished as
 * consumed so the same SKU can be bought again.
 */
export async function finishPurchase(purchase, { isConsumable }) {
  await finishTransaction({ purchase, isConsumable });
}

/**
 * The shape BuyPassSheet / BuyEnergySheet actually want: buy the product,
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
 */
export async function fetchProductPrices(skus) {
  if (!skus?.length) return {};
  await ensureConnection();
  const products = await fetchProducts({ skus, type: 'in-app' });
  const out = {};
  for (const p of products || []) out[p.id] = p.displayPrice;
  return out;
}

/**
 * Apple requires a way to restore a non-consumable purchase without paying
 * again (App Store review guideline 3.1.2) — this is what BuyPassSheet's
 * "Restore purchases" link calls. Play purchases don't need this the same
 * way (Play already knows what an account owns), but it is harmless to call
 * on both, so callers don't need a platform branch.
 */
export async function restorePurchases() {
  await ensureConnection();
  await restorePurchasesNative();
  return getAvailablePurchases();
}
