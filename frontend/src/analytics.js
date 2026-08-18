// analytics.js — the monetisation funnel, and nothing else yet.
//
// PASER had no analytics of any kind before this. That is why the question
// "which screen actually causes people to subscribe?" could not be answered:
// the paywall opened from five places and every one of them looked identical
// by the time it reached the store.
//
// WHAT THIS IS. A tiny in-process event bus with a pluggable sink. It carries
// no vendor SDK, because adding one is a native dependency, a privacy policy
// change and an App Store data-disclosure change all at once — three things
// that must not ride along on a monetisation branch. `setAnalyticsSink` is the
// single seam where Amplitude/PostHog/a backend endpoint gets attached later;
// everything above it is already written and already firing.
//
// WHAT MUST NEVER GO IN AN EVENT. No username, no user id, no email, no
// coordinates, no route geometry, no run id. Events describe BEHAVIOUR — which
// surface, which feature, was it automatic — not people. `scrub()` below drops
// anything that looks like the former, so a careless call site cannot leak
// something the privacy policy does not cover. That check is deliberately
// belt-and-braces: it runs on every event, in release as well as dev.

import { RECENT_EVENT_LIMIT } from './config/proExposure';

// ---------------------------------------------------------------------------
// Event names. Declared as constants rather than typed at each call site so a
// renamed event breaks at import time instead of silently forking the funnel
// into two half-populated names.
// ---------------------------------------------------------------------------

export const EVENTS = {
  // Something PRO-shaped was rendered where a free runner could see it.
  TEASER_IMPRESSION: 'pro_teaser_impression',
  TEASER_TAP: 'pro_teaser_tap',
  // The paywall itself.
  PAYWALL_VIEW: 'pro_paywall_view',
  PAYWALL_DISMISS: 'pro_paywall_dismiss',
  PURCHASE_START: 'pro_purchase_start',
  PURCHASE_SUCCESS: 'pro_purchase_success',
  PURCHASE_FAILURE: 'pro_purchase_failure',
  RESTORE_SUCCESS: 'pro_restore_success',
  // A PRO-only thing was reached by somebody who does not have it. `blocked`
  // is the hard stop; `preview` is the one we would rather see, because it
  // means they got to look at it first.
  FEATURE_BLOCKED: 'pro_feature_blocked',
  FEATURE_PREVIEW: 'pro_feature_preview',
  // The planner's free allowance being spent. The single most useful number
  // for tuning FREE_PLANNER_PREVIEWS.
  PLANNER_FREE_USE: 'territory_planner_free_use',
};

// Every `source` a PRO event may carry. A source that is not on this list is
// still sent (dropping data is worse than an odd label) but is flagged in dev,
// because the usual cause is a typo that quietly splits one funnel in two.
export const SOURCES = [
  'result',
  'map_planner',
  'map_intelligence',
  'rival_detail',
  'leaderboard',
  'run_detail',
  'avatar',
  'share',
  'season',
  'progression',
  'profile',
  'home',
  'onboarding',
];

// ---------------------------------------------------------------------------
// Privacy scrubbing
// ---------------------------------------------------------------------------

// Keys that must never travel, whatever a call site thinks it is doing.
const BANNED_KEYS = /^(user(_?id|name)?|email|username|lat|lon|latitude|longitude|coords?|route|path|points|run_?id|token|receipt)$/i;

// Free text is where a name ends up by accident. Property values are therefore
// limited to primitives, and strings to something short and label-shaped.
const MAX_STRING = 64;

function scrub(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (BANNED_KEYS.test(key)) continue;
    if (value == null) continue;
    if (typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : 0;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_STRING);
    }
    // Objects and arrays are dropped outright. Nothing in this funnel needs
    // one, and a nested blob is exactly how a route or a profile gets in.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ambient context — properties every event carries
// ---------------------------------------------------------------------------

// Set from the PRO provider as entitlement and run count resolve, so no call
// site has to remember to attach them. Scrubbed on the way in like everything
// else.
let context = {};

export function setAnalyticsContext(next) {
  context = { ...context, ...scrub(next) };
}

export function getAnalyticsContext() {
  return { ...context };
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

let sink = null;

/**
 * Attach the real destination. Called once, at boot, when there is one.
 * @param {(name: string, props: object) => void} fn
 */
export function setAnalyticsSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

// The last N events, newest last. Exists for the dev panel — it is the only
// way to check a funnel fires correctly before a vendor is wired up. Bounded,
// so it cannot grow into a leak on a long session.
const recent = [];

export function recentEvents() {
  return recent.slice();
}

export function clearRecentEvents() {
  recent.length = 0;
}

/**
 * Record one event.
 *
 * Never throws and never blocks: a broken analytics sink must not be able to
 * take down a screen, and certainly not the paywall.
 */
export function track(name, props = {}) {
  if (!name) return;
  const payload = { ...context, ...scrub(props) };

  if (__DEV__ && payload.source && !SOURCES.includes(payload.source)) {
    console.warn(`[analytics] unknown source "${payload.source}" on ${name}`);
  }

  recent.push({ name, props: payload, at: Date.now() });
  if (recent.length > RECENT_EVENT_LIMIT) recent.shift();

  try {
    sink?.(name, payload);
  } catch {
    // A sink that throws is a bug in the sink, not a reason to lose the screen.
  }

  if (__DEV__ && !sink) {
    // Without this the funnel is invisible until a vendor is attached, which
    // is precisely when it is least convenient to discover it was never firing.
    console.log(`[analytics] ${name}`, payload);
  }
}

export default track;
