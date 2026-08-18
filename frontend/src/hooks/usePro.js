// usePro — is this runner a PASER PRO subscriber, and what should we say
// about it.
//
// ONE source of truth, and it is the SERVER (backend/app/entitlements.py).
// Not the store, and not a flag cached at purchase time. The store knows what
// was bought on this device; only the backend knows what this ACCOUNT is
// entitled to, which is the thing every gated feature actually asks about.
//
// `syncPro` is the other half. A subscription renews with the app closed, so
// the expiry the backend holds goes stale on its own; calling `syncPro` on
// launch re-posts whatever the store says is live and moves that date forward.
// It is deliberately quiet: it can never take PRO away, only extend it, so a
// store that is unreachable at launch costs nothing.

import { useCallback, useEffect, useRef } from 'react';

import { api } from '../api/client';
import { invalidateAfterEntitlementChange } from '../api/cache';
import { PRO_PRODUCTS } from '../config/pro';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { activeSubscriptions } from '../iap';
import useQuery from './useQuery';

export const PRO_CACHE_KEY = 'pro';

/**
 * Entitlement for the signed-in account.
 *
 * `isPro` is false while the first fetch is in flight, which is the correct
 * way round: a gated surface that flashes open and then closes is worse than
 * one that opens a beat late.
 */
export function usePro({ enabled = true } = {}) {
  const { data, loading, refresh } = useQuery(PRO_CACHE_KEY, api.proStatus, {
    // False while signed out. There is no account to be entitled yet, and the
    // call would spend a request to be told 401 on the auth screen — which
    // matters because ProProvider mounts above the whole app, including the
    // signed-out half of it.
    enabled,
    // Entitlement changes on the scale of a billing period, not a tab swipe.
    staleMs: 5 * 60 * 1000,
    // A failed fetch settles as "not PRO" rather than hanging on a skeleton.
    // Safe because it is not a lock: nothing is lost, the paywall simply
    // shows, and the next refresh corrects it.
    fallback: { active: false },
  });

  return {
    pro: data || null,
    isPro: !!data?.active,
    isLifetime: !!data?.lifetime,
    // True only while a lapsed subscription is inside its grace window. The
    // one thing worth interrupting somebody about, because it is fixable and
    // they are about to lose something they are paying for.
    inGrace: !!data?.in_grace,
    loading,
    refresh,
  };
}

/**
 * Refresh entitlement from the store's own record. Called once per launch
 * from the root navigator, which is why it takes `signedIn` rather than
 * reading auth itself: there is no account to attach a receipt to before then.
 *
 * Silent on every failure. There is no version of "we couldn't reach the App
 * Store" that a runner needs to be told about, and no version of it that
 * should change what they can do.
 */
export function useProSync(signedIn) {
  const done = useRef(false);

  const sync = useCallback(async () => {
    if (!IAP_ENABLED) return;
    try {
      const purchases = await activeSubscriptions(PRO_PRODUCTS);
      if (!purchases.length) return; // nothing live on this device: no news
      await api.syncPro(purchases);
      // A renewal picked up here can be what turns PRO back on, so everything
      // carrying an entitlement-shaped half is dropped, not just the flag.
      invalidateAfterEntitlementChange();
    } catch {
      // Offline, store unreachable, no subscription. All the same here.
    }
  }, []);

  useEffect(() => {
    // Once per signed-in session, not once per mount: the store call is a
    // native round trip and a renewal cannot land twice in one launch.
    if (!signedIn || done.current) return;
    done.current = true;
    sync();
  }, [signedIn, sync]);
}

export default usePro;
