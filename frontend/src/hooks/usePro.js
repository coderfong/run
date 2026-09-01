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
//
// ---------------------------------------------------------------------------
// WHY BOTH HALVES RETRY. "I bought PRO and it still says tap to unlock."
// ---------------------------------------------------------------------------
//
// Entitlement was read exactly ONCE per launch and never again. ProProvider
// mounts above the navigator, so `useQuery`'s focus refetch has no navigation
// context to hang off; nothing else forced a re-read; and `staleMs` only ever
// SUPPRESSES a fetch, it does not schedule one. So the single request fired at
// launch decided what the account was entitled to for the whole session — and
// it lands against a free-tier backend whose cold start is longer than the
// client's request timeout (see the memory on Render latency). One timed-out
// read and `fallback: { active: false }` settled the app on "not a subscriber"
// until it was force quit, with every padlock in the app arguing with a
// receipt the runner is holding.
//
// The store sync had the same shape for a worse reason: `done` was set BEFORE
// the await, so a sync that FAILED still counted as done. The one case it
// exists for — the store holds a live subscription the server never recorded,
// because `/me/pro/subscribe` failed after the purchase went through — was
// therefore unrecoverable in that session too.
//
// Both now retry on a bounded schedule and again whenever the app comes back
// to the foreground, which is the moment something may have changed outside it
// (a subscription bought in Settings, a billing retry that finally cleared).
// Neither can take PRO away: the read is authoritative and the sync only ever
// extends, so the worst a spurious retry costs is one request.

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { api } from '../api/client';
import { applyProEntitlement } from '../api/cache';
import { PRO_PRODUCTS } from '../config/pro';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { activeSubscriptions } from '../iap';
import useQuery from './useQuery';

export const PRO_CACHE_KEY = 'pro';

// A failed entitlement read is retried on this ladder, in milliseconds, and
// then left alone until the app is foregrounded again. Short first, because the
// overwhelmingly likely cause is a cold backend that is now warm; bounded,
// because the other cause is being offline and there is no request that fixes
// that.
const READ_RETRY_MS = [3000, 9000, 25000];

// The store/server reconciliation gets the same bounded self-heal as the
// entitlement read. This is the path that repairs a purchase which completed
// in the store but whose first backend handoff timed out.
const SYNC_RETRY_MS = [4000, 12000, 30000];

// Two foreground syncs this close together are the same trip away. iOS emits
// active/inactive around notification shades and control centre, and a native
// store round trip per pull-down is not free.
const SYNC_COOLDOWN_MS = 60 * 1000;

/**
 * Entitlement for the signed-in account.
 *
 * `isPro` is false while the first fetch is in flight, which is the correct
 * way round: a gated surface that flashes open and then closes is worse than
 * one that opens a beat late.
 *
 * `revalidate` arms the retry ladder and the foreground re-read. ProProvider
 * passes it, because it holds the instance every gated surface in the app
 * reads; other callers (the paywall sheet, wanting the expiry to print) share
 * the same cache entry and should not each mount their own listener.
 */
export function usePro({ enabled = true, revalidate = false } = {}) {
  const { data, loading, error, refresh } = useQuery(PRO_CACHE_KEY, api.proStatus, {
    // False while signed out. There is no account to be entitled yet, and the
    // call would spend a request to be told 401 on the auth screen — which
    // matters because ProProvider mounts above the whole app, including the
    // signed-out half of it.
    enabled,
    // Entitlement changes on the scale of a billing period, not a tab swipe.
    staleMs: 5 * 60 * 1000,
    // A failed fetch settles as "not PRO" rather than hanging on a skeleton.
    // Safe because it is not a lock: nothing is lost, the paywall simply
    // shows, and the next refresh corrects it — which is what the retry ladder
    // below is for. Without it this fallback is permanent for the session.
    fallback: { active: false },
  });

  // Nothing to correct once a real answer has landed: `active: true` is one,
  // and so is a server that said "no" without erroring. Only a read that FAILED
  // is worth asking again.
  const unanswered = !!error;
  const attempt = useRef(0);
  useEffect(() => {
    if (!revalidate || !enabled) return undefined;
    if (!unanswered) {
      attempt.current = 0;
      return undefined;
    }
    const wait = READ_RETRY_MS[attempt.current];
    // Ladder exhausted. The foreground listener below is what picks it up from
    // here, rather than a timer that keeps firing at a network that is not
    // there.
    if (wait == null) return undefined;
    attempt.current += 1;
    const timer = setTimeout(() => refresh(), wait);
    return () => clearTimeout(timer);
    // `error` is a fresh object per failure, so each failed retry re-arms this
    // at the next rung of the ladder rather than stopping at the first.
  }, [revalidate, enabled, unanswered, error, refresh]);

  useEffect(() => {
    if (!revalidate || !enabled) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Forced: the whole point is to overrule a stale answer, and `staleMs`
      // would otherwise swallow this for the first five minutes of every
      // session — which includes the minute somebody comes back from having
      // just subscribed in the App Store's own settings.
      attempt.current = 0;
      refresh();
    });
    return () => sub.remove();
  }, [revalidate, enabled, refresh]);

  return {
    pro: data || null,
    isPro: !!data?.active,
    isLifetime: !!data?.lifetime,
    // True only while a lapsed subscription is inside its grace window. The
    // one thing worth interrupting somebody about, because it is fixable and
    // they are about to lose something they are paying for.
    inGrace: !!data?.in_grace,
    loading,
    // Surfaced so a caller can tell "the server says you are not a subscriber"
    // apart from "we never managed to ask", which are the same `isPro: false`
    // and very much not the same thing to say to somebody who just paid.
    error,
    refresh,
  };
}

/**
 * Refresh entitlement from the store's own record. Armed once from the root
 * navigator, which is why it takes `signedIn` rather than reading auth itself:
 * there is no account to attach a receipt to before then.
 *
 * Runs at launch and again on each return to the foreground (throttled), and
 * keeps trying until one sync actually completes. See the header for what that
 * recovers.
 *
 * Silent on every failure. There is no version of "we couldn't reach the App
 * Store" that a runner needs to be told about, and no version of it that
 * should change what they can do.
 */
export function useProSync(signedIn) {
  // Set only once a sync has actually COMPLETED. It used to be set before the
  // await, which turned the one failure this exists to recover from into a
  // permanent one.
  const settled = useRef(false);
  const running = useRef(false);
  const lastRun = useRef(0);

  const sync = useCallback(async ({ force = false } = {}) => {
    if (!IAP_ENABLED) return true;
    if (running.current) return null;
    if (!force && settled.current) return true;
    if (Date.now() - lastRun.current < SYNC_COOLDOWN_MS) return null;
    running.current = true;
    lastRun.current = Date.now();
    try {
      const purchases = await activeSubscriptions(PRO_PRODUCTS);
      // Nothing live on this device: no news, and nothing to keep retrying
      // for. The store answered, which is what "settled" means here.
      if (!purchases.length) {
        settled.current = true;
        return true;
      }
      const status = await api.syncPro(purchases);
      settled.current = true;
      // The sync response is the server's final entitlement. Publishing it to
      // the shared cache updates ProProvider immediately; invalidating alone
      // left its mounted useQuery holding the old `active: false` forever.
      applyProEntitlement(status);
      return true;
    } catch {
      // Offline, store unreachable, backend cold. All the same here — and all
      // of them worth trying again, which is why `settled` stays false.
      // A scheduled retry is deliberate, so it must not be swallowed by the
      // foreground cooldown that protects successful store round trips.
      lastRun.current = 0;
      return false;
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      // A later sign-in may be a different PASER account on the same device;
      // a completed sync for the previous account cannot settle the next one.
      settled.current = false;
      lastRun.current = 0;
      return undefined;
    }

    let cancelled = false;
    let retryTimer = null;
    let retryAttempt = 0;

    const clearRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const run = async (options) => {
      const result = await sync(options);
      if (cancelled || result !== false) return;
      const wait = SYNC_RETRY_MS[retryAttempt];
      if (wait == null) return;
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        run();
      }, wait);
    };

    // A signed-in session always gets its own reconciliation, even if this
    // hook remained mounted through a sign-out/sign-in transition.
    settled.current = false;
    lastRun.current = 0;
    run();
    // A subscription can start, renew or be restored while PASER is in the
    // background — App Store settings is where people manage them — so coming
    // back is exactly when the store's record is worth re-reading. Forced past
    // `settled` because a sync that answered "nothing live" an hour ago says
    // nothing about now; the cooldown is what keeps that cheap.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clearRetry();
      retryAttempt = 0;
      run({ force: true });
    });
    return () => {
      cancelled = true;
      clearRetry();
      sub.remove();
    };
  }, [signedIn, sync]);
}

export default usePro;
