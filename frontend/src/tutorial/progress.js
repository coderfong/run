// The tutorial's PERSISTED shape, and the one decision that matters: is the
// person holding this phone a genuinely new player?
//
// Pure on purpose — no React, no storage, no api. Everything here is decidable
// from values the caller already has, which is what makes "does an existing
// runner get dragged through the tutorial after an update" a testable question
// rather than something you find out from the App Store reviews.
//
// WHERE IT LIVES. Inside the per-account profile record (state/profile.js,
// AsyncStorage `paser:profile:v1:<id>`), under one `tutorial` key. That file is
// already the app's preferences model and already holds one-time teaching flags
// (crossroadsIntroSeen, rankGuideSeen), so this adds a key rather than a second
// storage abstraction — and a tutorial write cannot disturb the name, the
// birthday or anything else in there, because it only ever replaces that key.

import { PHASE, phaseIndex } from './phases';

// Bump to introduce a NEW tutorial. A record from an older version is treated
// as "this person has been taught the old thing", not as unread: they keep
// their completed state and simply become eligible for whatever the new
// version adds. Nothing here ever re-runs the core tutorial on an upgrade
// without the runner asking for it.
//
// v2 (2026-09-23): the interactive core tutorial replaced the autopiloted v1
// tour. A v1 record, finished or not, reads as taught: nobody is dropped back
// into a tutorial after an update, and "Replay tutorial" plays the new one.
export const TUTORIAL_VERSION = 2;

export const CORE = {
  // Never armed. The state an existing account sits in.
  IDLE: 'idle',
  // Armed and in progress.
  RUNNING: 'running',
  // Finished properly, all the way to the first claim.
  DONE: 'done',
  // Dismissed with Skip. Distinct from DONE so the funnel can tell the two
  // apart; identical in behaviour (nothing more is shown).
  SKIPPED: 'skipped',
};

// Contextual tips, each shown once, none of them part of the core flow.
export const TIP = {
  MAP: 'map',
  MAP_TERRITORY: 'map-territory',
  MISSIONS: 'missions',
  SHOP: 'shop',
  CLUB: 'club',
  RIVALS: 'rivals',
  RANK: 'rank',
  SHARE: 'share',
  FIRST_REAL_CLAIM: 'first-real-claim',
  LEADERBOARD: 'leaderboard',
  PROGRESSION: 'progression',
  DEFENSE: 'defense',
};

// The reasons decideCoreState arms a NEW account for. A replay ('replay') or a
// migration is never one of them.
const NEW_PLAYER_REASONS = new Set(['intro_just_finished', 'no_runs_yet']);

export const EMPTY_PROGRESS = Object.freeze({
  version: TUTORIAL_VERSION,
  core: CORE.IDLE,
  phase: PHASE.IDLE,
  startedAt: null,
  completedAt: null,
  // Why this account is (or is not) in the tutorial. Carried so a support
  // question can be answered without guessing; never shown to the runner.
  reason: null,
  // STICKY: true once this account was armed as a genuinely NEW player (see
  // decideCoreState). Never set by a replay or a migration, never cleared.
  // It is the whole gate for everything that teaches: contextual tips and the
  // one-time explainers only show to an account that is going through its
  // first onboarding. A veteran on a new phone, after a reinstall or after an
  // update that added a tip is never shown any of it.
  firstOnboarding: false,
  tips: {},
});

/**
 * Coerce whatever came back from storage into a record this app can reason
 * about. Storage is not a schema: a half-written record, a record from a build
 * that has since been rolled back, or a record from a future version all have
 * to land somewhere sane rather than throwing inside a provider.
 */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROGRESS, tips: {} };

  const version = Number.isFinite(raw.version) ? raw.version : 0;
  const tips = raw.tips && typeof raw.tips === 'object' ? { ...raw.tips } : {};

  // A record written by an older tutorial. The runner has already been taught
  // *something*, so the core stays finished; only the version moves. (Were a
  // v2 ever to need a fresh run, this is the single line that would decide it,
  // and it would be a deliberate edit rather than a side effect.)
  if (version !== TUTORIAL_VERSION) {
    const taught = raw.core === CORE.DONE || raw.core === CORE.SKIPPED || version > 0;
    return {
      ...EMPTY_PROGRESS,
      version: TUTORIAL_VERSION,
      core: taught ? CORE.DONE : CORE.IDLE,
      phase: taught ? PHASE.COMPLETE : PHASE.IDLE,
      startedAt: raw.startedAt || null,
      completedAt: raw.completedAt || null,
      reason: `migrated_from_v${version}`,
      // An older record is not a first onboarding under this tutorial.
      firstOnboarding: false,
      tips,
    };
  }

  const core = Object.values(CORE).includes(raw.core) ? raw.core : CORE.IDLE;
  return {
    version: TUTORIAL_VERSION,
    core,
    // A phase that is not a phase (a rename, a corrupt write) rewinds to the
    // start of whatever is still worth teaching rather than pinning the
    // overlay to something that will never resolve.
    // Keep the live persisted phase intact. TutorialProvider rewinds record
    // phases only after navigation proves the modal is gone. Rewinding here
    // on every profile write turns START_RUN → ACTIVE_RUN into an endless
    // write loop because an active run is persisted before the next render.
    phase: core === CORE.RUNNING
      ? (phaseIndex(raw.phase) >= 0 ? raw.phase : PHASE.WELCOME)
      : (raw.phase || PHASE.IDLE),
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || null,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    // Also true for a record armed before the flag existed: its reason
    // already says it was armed as a new player.
    firstOnboarding: raw.firstOnboarding === true || NEW_PLAYER_REASONS.has(raw.reason),
    tips,
  };
}

/**
 * Is this account going through its FIRST onboarding? The one question every
 * teaching surface asks before it shows itself: the core tutorial's tips and
 * the one-time explainers (Crossroads, the ranked map). Reads a raw stored
 * record as well as a normalised one; anything missing reads as NO.
 */
export function inFirstOnboarding(record) {
  return !!(record && record.firstOnboarding === true);
}

/**
 * Should this account be put through the core tutorial?
 *
 * THE CONSERVATIVE RULE, stated once: an account is only ever ARMED on
 * positive evidence that it is new. Absence of evidence arms nothing. A
 * released build that cannot reach /me/stats, an account whose local profile
 * was wiped by an app reinstall, a shared device — all of those land on "not
 * new", which costs a genuinely new runner a tutorial they can still replay
 * from Settings, and costs a three-year veteran nothing at all.
 *
 * @param {object}  opts
 * @param {object}  [opts.record]           the stored tutorial record, if any
 * @param {boolean} [opts.tutorialPending]  profile flag set by the intro flow
 * @param {boolean} [opts.introDone]        profile flag: the intro has been run
 * @param {number|null} [opts.runCount]     finished runs on this account, or
 *                                          null while /me/stats is in flight
 * @returns {{core: string, phase: string, reason: string}}
 */
export function decideCoreState({ record, tutorialPending, introDone, runCount } = {}) {
  // An existing decision always wins. This function only ever SEEDS.
  if (record && record.core && record.core !== CORE.IDLE) {
    return { core: record.core, phase: record.phase, reason: record.reason || 'stored' };
  }

  // The unambiguous signal. `tutorialPending` is written by completeIntro() at
  // the end of the first-run flow and by nothing else, so it can only be true
  // on an account created on this device, moments ago.
  if (tutorialPending === true) {
    return { core: CORE.RUNNING, phase: PHASE.WELCOME, reason: 'intro_just_finished' };
  }

  // The second signal, for an account created in the window between the intro
  // shipping and this tutorial shipping: it went through the intro, and it has
  // never finished a run. Both halves are required. `runCount` unknown is NOT
  // zero — see the conservative rule above.
  if (introDone === true && runCount === 0) {
    return { core: CORE.RUNNING, phase: PHASE.WELCOME, reason: 'no_runs_yet' };
  }

  if (runCount == null) {
    return { core: CORE.IDLE, phase: PHASE.IDLE, reason: 'runs_unknown' };
  }
  return { core: CORE.IDLE, phase: PHASE.IDLE, reason: 'existing_account' };
}

/** Arm the core tutorial from the top. What "Replay tutorial" does. */
export function armed(record, { now = Date.now(), reason = 'replay' } = {}) {
  return {
    ...normalise(record),
    core: CORE.RUNNING,
    phase: PHASE.WELCOME,
    startedAt: now,
    completedAt: null,
    reason,
  };
}

/** Move the running tutorial to `phase`, finishing it if that is the end. */
export function advanced(record, phase, { now = Date.now() } = {}) {
  const base = normalise(record);
  if (phase === PHASE.COMPLETE) {
    return { ...base, core: CORE.DONE, phase: PHASE.COMPLETE, completedAt: now };
  }
  return { ...base, phase, startedAt: base.startedAt || now };
}

/** Skip: stop showing the core tutorial, without pretending it was completed. */
export function skipped(record, { now = Date.now() } = {}) {
  return { ...normalise(record), core: CORE.SKIPPED, phase: PHASE.COMPLETE, completedAt: now };
}

/** Mark a contextual tip as seen. */
export function tipSeen(record, tip) {
  const base = normalise(record);
  return { ...base, tips: { ...base.tips, [tip]: true } };
}

export function hasSeenTip(record, tip) {
  return !!(record && record.tips && record.tips[tip]);
}

/** True while the core tutorial should be putting something on screen. */
export function coreActive(record) {
  return !!record && record.core === CORE.RUNNING && record.phase !== PHASE.COMPLETE;
}
