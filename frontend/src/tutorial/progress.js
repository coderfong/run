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

import { PHASE, resumePhase } from './phases';

// Bump to introduce a NEW tutorial. A record from an older version is treated
// as "this person has been taught the old thing", not as unread: they keep
// their completed state and simply become eligible for whatever the new
// version adds. Nothing here ever re-runs the core tutorial on an upgrade
// without the runner asking for it.
export const TUTORIAL_VERSION = 1;

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
  CLUB: 'club',
  LEADERBOARD: 'leaderboard',
  PROGRESSION: 'progression',
  DEFENSE: 'defense',
};

export const EMPTY_PROGRESS = Object.freeze({
  version: TUTORIAL_VERSION,
  core: CORE.IDLE,
  phase: PHASE.IDLE,
  startedAt: null,
  completedAt: null,
  // Why this account is (or is not) in the tutorial. Carried so a support
  // question can be answered without guessing; never shown to the runner.
  reason: null,
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
    phase: core === CORE.RUNNING ? resumePhase(raw.phase) : (raw.phase || PHASE.IDLE),
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || null,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    tips,
  };
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
