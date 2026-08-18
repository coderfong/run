// Has this runner seen enough of PRO for now?
//
// One module owns the answer, because the alternative is every screen keeping
// its own idea of "recently" and the app collectively showing four paywalls in
// an evening while each individual screen believes it showed one.
//
// THE TWO KINDS OF PROMPT (the whole design):
//
//   `canShowAuto(context, { runCount })` — PASER decided to bring PRO up. Rate
//   limited hard, per the constants in config/proExposure.js.
//
//   A tap on something with a padlock on it — NOT rate limited, does not come
//   through here at all, and deliberately so. The runner asked; answering is
//   not an interruption. Screens call `openPaywall` directly for those.
//
// PERSISTENCE. AsyncStorage, hydrated once at boot into a plain object so
// every read afterwards is synchronous — a rule this app already follows for
// the response cache, and for the same reason: a check that resolves a tick
// later is a check that renders the un-gated state first and then snaps.
//
// The planner allowance lives here too rather than in its own module, because
// it is the same persisted record and splitting it across two blobs is how the
// two end up disagreeing after a failed write.
//
// WHAT THIS IS NOT. It is not a security boundary. Everything here is
// on-device state a determined person can clear by reinstalling, and that is
// FINE: the planner allowance is a courtesy trial, not a licence check. What
// actually protects paid features is the server (backend/app/entitlements.py,
// `require_pro`). See docs/PRO_BACKEND.md for the server-side allowance
// contract that would make the planner count survive a reinstall.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  EXPOSURE_STORAGE_KEY,
  FREE_PLANNER_PREVIEWS,
  MAX_AUTO_PAYWALLS_PER_SESSION,
  MAX_DISMISSALS_PER_CONTEXT,
  MIN_MS_BETWEEN_AUTO,
  MIN_RUNS_BEFORE_AUTO,
} from '../config/proExposure';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const EMPTY = {
  // When PASER last opened a paywall nobody asked for.
  lastAutoAt: 0,
  // Times each context's automatic prompt has been dismissed. Keyed by context.
  dismissals: {},
  // Contexts whose teaser has been rendered at least once. Drives "explain
  // before you sell": the first tap on a locked feature shows what it is, and
  // only a runner who has already seen that goes straight to the sheet.
  seenTeasers: {},
  // Completed planner previews spent. Never decremented outside dev.
  plannerUses: 0,
  // Sessions ever. Not currently a gate on its own; recorded because "did they
  // come back" is the one number that says whether any of this is working.
  sessions: 0,
};

let state = { ...EMPTY };
let hydrated = false;

// Reset on every launch rather than persisted — that is what makes it a
// SESSION limit. Deliberately not in `state`.
let autoThisSession = 0;

// Writes are debounced: several of these can land in one frame (a teaser
// rendering and an impression firing), and each one is a disk round trip.
let writeTimer = null;

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    AsyncStorage.setItem(EXPOSURE_STORAGE_KEY, JSON.stringify(state)).catch(() => {
      // A failed write costs the runner one extra free planner preview or one
      // extra prompt. Not worth surfacing, and certainly not worth throwing.
    });
  }, 400);
}

/**
 * Read the persisted record. Called once, from the root, alongside
 * `hydrateCache`. Safe to call twice; the second call is a no-op.
 */
export async function hydrateProExposure() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(EXPOSURE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Field by field, not a spread of whatever was on disk: last release's
      // blob (or a corrupted one) must not be able to introduce keys this
      // module then treats as real.
      state = {
        lastAutoAt: Number(parsed.lastAutoAt) || 0,
        dismissals: parsed.dismissals && typeof parsed.dismissals === 'object' ? parsed.dismissals : {},
        seenTeasers: parsed.seenTeasers && typeof parsed.seenTeasers === 'object' ? parsed.seenTeasers : {},
        plannerUses: Math.max(0, Number(parsed.plannerUses) || 0),
        sessions: Math.max(0, Number(parsed.sessions) || 0),
      };
    }
  } catch {
    state = { ...EMPTY }; // unreadable blob: start clean rather than crash
  }
  state.sessions += 1;
  persist();
}

/** The whole record, for the dev panel. Never mutate the result. */
export function exposureSnapshot() {
  return { ...state, autoThisSession, hydrated };
}

// ---------------------------------------------------------------------------
// Automatic prompts
// ---------------------------------------------------------------------------

/**
 * May PASER open a paywall the runner did not ask for, right now?
 *
 * `runCount` is the account's finished-run count (from /me/stats). Passing
 * null means "not known yet", which is treated as NOT eligible: prompting
 * somebody because their stats had not loaded is exactly the accident this
 * gate exists to prevent.
 *
 * @returns {{ allowed: boolean, reason: string }} `reason` is for the dev
 *          panel and the analytics property, so a funnel that goes quiet can
 *          be explained rather than guessed at.
 */
export function canShowAuto(context, { runCount, now = Date.now() } = {}) {
  if (!context) return { allowed: false, reason: 'no_context' };
  if (runCount == null) return { allowed: false, reason: 'runs_unknown' };
  if (runCount < MIN_RUNS_BEFORE_AUTO) return { allowed: false, reason: 'too_new' };
  if (autoThisSession >= MAX_AUTO_PAYWALLS_PER_SESSION) {
    return { allowed: false, reason: 'session_cap' };
  }
  if (now - state.lastAutoAt < MIN_MS_BETWEEN_AUTO) {
    return { allowed: false, reason: 'too_soon' };
  }
  if ((state.dismissals[context] || 0) >= MAX_DISMISSALS_PER_CONTEXT) {
    return { allowed: false, reason: 'dismissed_enough' };
  }
  return { allowed: true, reason: 'ok' };
}

/** Record that an automatic paywall was actually shown. */
export function noteAutoShown(context, { now = Date.now() } = {}) {
  autoThisSession += 1;
  state.lastAutoAt = now;
  persist();
}

/**
 * Record a dismissal. Only automatic prompts should call this — a runner
 * closing a sheet they opened themselves has not rejected anything, and
 * counting it would eventually silence prompts they never saw.
 */
export function noteAutoDismissed(context) {
  if (!context) return;
  state.dismissals[context] = (state.dismissals[context] || 0) + 1;
  persist();
}

// ---------------------------------------------------------------------------
// Teasers
// ---------------------------------------------------------------------------

/** Has this context's explanation been shown before? */
export function hasSeenTeaser(context) {
  return !!state.seenTeasers[context];
}

/**
 * Record that the explanation for `context` has now been seen.
 * @returns {boolean} true if this was the FIRST time.
 */
export function noteTeaserSeen(context) {
  if (!context) return false;
  if (state.seenTeasers[context]) return false;
  state.seenTeasers[context] = true;
  persist();
  return true;
}

// ---------------------------------------------------------------------------
// Territory Planner allowance
// ---------------------------------------------------------------------------

/**
 * Previews left. PRO is unlimited and returns Infinity, so call sites can
 * compare numerically without branching on entitlement first.
 */
export function plannerPreviewsLeft(isPro) {
  if (isPro) return Infinity;
  return Math.max(0, FREE_PLANNER_PREVIEWS - state.plannerUses);
}

/**
 * Spend one preview. ONLY for a preview that actually completed and returned
 * a result — see the note on FREE_PLANNER_PREVIEWS. PRO spends nothing.
 *
 * @returns {number} previews left after this one.
 */
export function notePlannerUse(isPro) {
  if (isPro) return Infinity;
  state.plannerUses += 1;
  persist();
  return plannerPreviewsLeft(false);
}

// ---------------------------------------------------------------------------
// Dev only
// ---------------------------------------------------------------------------

/**
 * Overwrite the record so a state can be looked at. Dev builds only — this is
 * how "planner exhausted" gets inspected without running the planner three
 * times on a desk.
 */
export function devSetExposure(patch) {
  if (!__DEV__) return;
  state = { ...state, ...patch };
  if (patch.autoThisSession != null) autoThisSession = patch.autoThisSession;
  persist();
}

/** Dev only: back to a fresh install's worth of exposure. */
export function devResetExposure() {
  if (!__DEV__) return;
  state = { ...EMPTY };
  autoThisSession = 0;
  persist();
}
