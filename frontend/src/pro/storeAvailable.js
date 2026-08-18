// Can PASER actually sell a subscription right now?
//
// ONE question, asked by every marketing surface in the app, so that the
// answer cannot differ between the Home card, the Profile poster, the teasers
// and the popup. They used to each read `IAP_ENABLED` directly, which was fine
// until there was a reason for the answer to be more complicated than one
// constant — which there now is, twice over:
//
//   1. THE RELEASE SWITCH. `IAP_ENABLED` in config/releaseFeatures.js is the
//      real gate and stays authoritative. It is false until a sandbox purchase
//      has been taken end to end, because a release that advertises a
//      subscription it cannot actually complete is a rejected release and a
//      one-star review from everybody who tapped it in the meantime.
//
//   2. THE DEV OVERRIDE. With the switch off, every PRO surface renders
//      nothing — which makes them impossible to look at, review or approve.
//      The override lets a development build show the whole monetisation
//      without pretending purchases work.
//
// The override is `__DEV__`-only in the strictest sense: the branch cannot be
// reached in a release build at all, so no amount of state can turn selling on
// where the store is not ready.

import { useEffect, useState } from 'react';

import { IAP_ENABLED, PRO_SURFACES_ENABLED } from '../config/releaseFeatures';

let devOverride = false;
const listeners = new Set();

/**
 * True when a purchase could actually COMPLETE.
 *
 * Only the things that take money ask this: the subscribe button, the plan
 * picker, restore. Everything else asks `proVisible()` — see the note on
 * `PRO_SURFACES_ENABLED` in config/releaseFeatures.js for why the two
 * questions had to come apart.
 */
export function storeAvailable() {
  return IAP_ENABLED || (__DEV__ && devOverride);
}

/**
 * True when PASER PRO should be PRESENT in the app: cards, posters, teasers,
 * padlocks on gated features, and the pitch itself.
 *
 * Implied by being able to sell — a build that can take money must obviously
 * show what it is selling — and otherwise by the surfaces switch on its own.
 */
export function proVisible() {
  return PRO_SURFACES_ENABLED || storeAvailable();
}

/** Dev builds only: show the monetisation without flipping the release switch. */
export function setDevStoreOverride(on) {
  if (!__DEV__) return;
  devOverride = !!on;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function devStoreOverride() {
  return __DEV__ && devOverride;
}

/**
 * Subscribe to override changes so a screen re-renders when it is flipped.
 * Returns an unsubscribe. A no-op outside dev, where the value cannot change.
 */
export function subscribeStoreAvailable(fn) {
  if (!__DEV__) return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The hook form. Components use this rather than calling `storeAvailable()` in
 * the render body, so flipping the dev override repaints the app instead of
 * needing every affected screen to be navigated away from and back.
 */
export function useStoreAvailable() {
  const [on, setOn] = useState(storeAvailable);
  useEffect(() => subscribeStoreAvailable(() => setOn(storeAvailable())), []);
  return on;
}

/** The hook form of `proVisible`. */
export function useProVisible() {
  const [on, setOn] = useState(proVisible);
  useEffect(() => subscribeStoreAvailable(() => setOn(proVisible())), []);
  return on;
}

export default storeAvailable;
