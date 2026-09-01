// The one place PASER PRO is asked about, and the one place its sheet lives.
//
// BEFORE THIS, every screen that wanted the paywall imported BuyProSheet,
// declared its own `const [payOpen, setPayOpen] = useState(false)`, and
// rendered its own copy. Six screens, six sheets, six chances for one of them
// to drift out of step with what the account actually holds — and no way at
// all to answer "which screen sold this subscription", because by the time the
// sheet was on screen it had forgotten where it came from.
//
// Now: ONE sheet, mounted at the root, opened with a CONTEXT.
//
//     const { isPro, openPaywall } = useProEntitlement();
//     openPaywall('territory_planner');
//
// The context decides what the sheet says (config/proContexts.js) and tags
// every event in the funnel with where it came from (src/analytics.js).
//
// WHY ENTITLEMENT IS RE-EXPORTED THROUGH HERE rather than leaving screens on
// `usePro()` directly: so there is exactly one hook to import, and so the dev
// override below can lie about entitlement in one place instead of needing a
// mock at every call site. `usePro` remains the source of truth and is still
// the thing that talks to the server; this wraps it, it does not replace it.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { EVENTS, setAnalyticsContext, track } from '../analytics';
import { proContext } from '../config/proContexts';
import usePro from '../hooks/usePro';
import { useQuery } from '../hooks/useQuery';
import BuyProSheet from '../components/BuyProSheet';
import ProWelcome from '../components/ProWelcome';
import { toast } from '../ui/toast';
import {
  canShowAuto,
  noteAutoDismissed,
  noteAutoShown,
  notePlannerUse,
  plannerPreviewsLeft,
} from './exposure';
import { proVisible, storeAvailable, useProVisible, useStoreAvailable } from './storeAvailable';

const ProContext = createContext(null);

export function ProProvider({ children }) {
  // This provider sits above the whole tree, including the signed-out half of
  // it, so both of its queries are gated on there being an account to ask
  // about. Without that, opening the app to the sign-in screen spends two
  // requests learning that nobody is signed in.
  const { signedIn } = useAuth();
  // `revalidate` is passed HERE and nowhere else: this is the instance every
  // padlock in the app reads, so it is the one that has to be able to correct
  // itself. A launch-time read that timed out against a cold backend used to
  // decide the whole session — see the header in hooks/usePro.js.
  const { pro, isPro: serverIsPro, isLifetime, inGrace, loading, refresh } = usePro({
    enabled: signedIn,
    revalidate: true,
  });

  // Finished runs on this account. Drives every "has this person actually
  // played PASER yet" gate. Undefined until it lands, and the exposure rules
  // treat that as NOT eligible on purpose — see canShowAuto.
  const { data: stats } = useQuery('me:stats', api.meStats, {
    enabled: signedIn,
    staleMs: 60 * 1000,
    fallback: {},
  });
  const runCount = Number.isFinite(stats?.runs_count) ? stats.runs_count : null;

  // Dev override. `null` = tell the truth. Only ever consulted under __DEV__,
  // so a release build cannot be talked into granting PRO by any code path.
  const [devPro, setDevPro] = useState(null);
  const isPro = __DEV__ && devPro != null ? devPro : serverIsPro;

  // Can PASER sell right now? Read as a hook rather than a constant so that
  // flipping the dev override repaints every marketing surface in the app at
  // once, instead of each screen needing to be navigated away from and back.
  const canSell = useStoreAvailable();
  // Whether PRO is PRESENT, which is a different question from whether it can
  // be bought — see config/releaseFeatures.js. Marketing, padlocks and the
  // pitch read this; only the money reads `canSell`.
  const canShowPro = useProVisible();

  // { context, automatic } while open, null while closed.
  const [paywall, setPaywall] = useState(null);
  // { returning } while the PRO welcome ceremony is up, null otherwise. Set a
  // beat AFTER the paywall closes — presenting a second modal in the same tick
  // an RN <Modal> is dismissing races on iOS ("presentation in progress").
  const [welcome, setWelcome] = useState(null);
  const welcomeTimer = useRef(null);
  useEffect(() => () => clearTimeout(welcomeTimer.current), []);
  // Set when a purchase completes, so closing the sheet afterwards is not
  // recorded as a dismissal — the funnel would otherwise show every successful
  // subscription as an abandonment too.
  const purchasedRef = useRef(false);

  // Ambient properties on every analytics event, so no call site has to
  // remember them. `is_pro` and `run_count` are the two that make the rest
  // readable: a teaser impression means something different at run 3 than at
  // run 300.
  useEffect(() => {
    setAnalyticsContext({ is_pro: isPro, run_count: runCount ?? -1 });
  }, [isPro, runCount]);

  /**
   * Open the paywall.
   *
   * @param {string} context  a key from config/proContexts.js
   * @param {object} [opts]
   * @param {boolean} [opts.automatic=false]  true when PASER decided to show
   *        this rather than the runner tapping something. Automatic prompts go
   *        through the exposure rules and are usually refused; user initiated
   *        ones never are.
   * @returns {boolean} whether the sheet actually opened.
   */
  const openPaywall = useCallback(
    (context, opts = {}) => {
      const { automatic = false } = opts;

      // Already a subscriber: nothing to sell, and silence is right.
      if (isPro) return false;

      // PRO turned off entirely (both switches). Nothing to open — but a tap
      // that the runner MADE must never do nothing at all. A padlocked
      // leaderboard filter that neither filters nor explains itself is a dead
      // end.
      //
      // NOTE this is `proVisible`, not `storeAvailable`. It used to be the
      // latter, which meant that with the store off the sheet would not open
      // even when the runner tapped a padlock — so PRO could not be READ
      // ABOUT, only refused. The sheet is the pitch; it opens whenever PRO is
      // present, and it is the sheet's own job to say that the plans are not
      // live yet rather than to fail at the button (see BuyProSheet).
      //
      // An automatic prompt stays silent, because nobody asked.
      if (!proVisible()) {
        if (!automatic) toast.show('PASER PRO is not available yet.');
        return false;
      }

      if (automatic) {
        const { allowed, reason } = canShowAuto(context, { runCount });
        if (!allowed) {
          // Recorded so a quiet funnel can be explained rather than guessed
          // at. This is the difference between "the teaser does not convert"
          // and "the teaser is never actually shown".
          track(EVENTS.FEATURE_BLOCKED, {
            source: proContext(context).source,
            context,
            suppressed: true,
            reason,
          });
          return false;
        }
        noteAutoShown(context);
      }

      purchasedRef.current = false;
      setPaywall({ context, automatic });
      track(EVENTS.PAYWALL_VIEW, {
        source: proContext(context).source,
        context,
        trigger: automatic ? 'automatic' : 'user',
        run_count: runCount ?? -1,
      });
      return true;
    },
    [isPro, runCount]
  );

  const closePaywall = useCallback(() => {
    setPaywall((open) => {
      if (open && !purchasedRef.current) {
        track(EVENTS.PAYWALL_DISMISS, {
          source: proContext(open.context).source,
          context: open.context,
          trigger: open.automatic ? 'automatic' : 'user',
        });
        // Only an automatic prompt counts as a rejection. Closing a sheet you
        // opened yourself is browsing, and counting it would eventually
        // silence prompts the runner never actually saw.
        if (open.automatic) noteAutoDismissed(open.context);
      }
      return null;
    });
  }, []);

  // Called by the sheet the instant a subscription is live — a fresh purchase,
  // or a restore (`restored: true`, which only swaps the ceremony's headline).
  // The sheet closes itself right after; the welcome opens once that dismissal
  // is done.
  const onPurchased = useCallback((info) => {
    purchasedRef.current = true;
    refresh?.();
    clearTimeout(welcomeTimer.current);
    welcomeTimer.current = setTimeout(
      () => setWelcome({ returning: !!info?.restored }),
      380
    );
  }, [refresh]);

  const closeWelcome = useCallback(() => setWelcome(null), []);

  /** Previews left on the free planner allowance. Infinity for PRO. */
  const plannerLeft = plannerPreviewsLeft(isPro);

  /** Spend one planner preview. Returns what is left afterwards. */
  const spendPlannerPreview = useCallback(() => {
    const left = notePlannerUse(isPro);
    if (!isPro) {
      track(EVENTS.PLANNER_FREE_USE, {
        source: 'map_planner',
        feature: 'territory_planner',
        previews_left: left,
      });
    }
    return left;
  }, [isPro]);

  const value = useMemo(
    () => ({
      // --- entitlement ---
      isPro,
      isLoading: loading,
      isLifetime,
      inGrace,
      // Where the entitlement comes from, for support questions and for the
      // dev panel. Never branched on: `isPro` is the only decision field.
      source: isLifetime ? 'lifetime' : pro?.store || null,
      expiresAt: pro?.expires_at || null,
      productId: pro?.product_id || null,
      refresh,

      // --- selling and showing ---
      // TWO questions, and every surface has to ask the right one.
      //
      // `canSell`     can a purchase complete? Only the subscribe button, the
      //               plan picker and restore care.
      // `canShowPro`  does PRO exist in this build? The Home card, the You
      //               poster, the teasers, the padlocks and the sheet all ask
      //               this. It is true whenever selling is, so a build that
      //               can take money always shows what it sells.
      //
      // Nothing reads IAP_ENABLED for itself, so these cannot disagree.
      canSell,
      canShowPro,
      openPaywall,
      closePaywall,
      paywallContext: paywall?.context || null,

      // --- gates ---
      runCount,
      plannerPreviewsLeft: plannerLeft,
      spendPlannerPreview,

      // --- dev ---
      devPro,
      setDevPro: __DEV__ ? setDevPro : () => {},
      // Raise the post purchase ceremony without a sandbox transaction. Dev
      // only, and it touches nothing but the local modal state.
      previewProWelcome: __DEV__
        ? (returning = false) => setWelcome({ returning: !!returning })
        : () => {},
    }),
    [
      isPro, loading, isLifetime, inGrace, pro, refresh, canSell, canShowPro, openPaywall, closePaywall,
      paywall, runCount, plannerLeft, spendPlannerPreview, devPro,
    ]
  );

  return (
    <ProContext.Provider value={value}>
      {children}
      {/* THE one paywall in the app. At the root, so it survives the screen
          underneath it navigating away, and so a screen can open it without
          having to own a modal of its own. */}
      <BuyProSheet
        visible={!!paywall}
        context={paywall?.context}
        automatic={!!paywall?.automatic}
        onClose={closePaywall}
        onPurchased={onPurchased}
      />
      {/* The payoff for the largest thing anyone does in the app. Mounted here
          for the same reason the sheet is: it has to survive the screen behind
          it navigating away. */}
      <ProWelcome
        visible={!!welcome}
        returning={!!welcome?.returning}
        onClose={closeWelcome}
      />
    </ProContext.Provider>
  );
}

/**
 * Entitlement, plus the ability to sell.
 *
 * Safe outside the provider: returns a shape where `isPro` is false and
 * `openPaywall` is a no-op, so a component rendered in a test or in the dev
 * animation gallery does not explode.
 */
export function useProEntitlement() {
  return (
    useContext(ProContext) || {
      isPro: false,
      isLoading: true,
      isLifetime: false,
      inGrace: false,
      source: null,
      expiresAt: null,
      productId: null,
      refresh: () => {},
      canSell: false,
      canShowPro: false,
      openPaywall: () => false,
      closePaywall: () => {},
      paywallContext: null,
      runCount: null,
      plannerPreviewsLeft: 0,
      spendPlannerPreview: () => 0,
      devPro: null,
      setDevPro: () => {},
      previewProWelcome: () => {},
    }
  );
}

export default ProProvider;
