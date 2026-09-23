// The one enumeration of where the first-run tutorial is.
//
// THE TUTORIAL FOLLOWS THE RUNNER. Every phase names the one thing the runner
// does next and the real event that says they did it. Nothing in the core
// tutorial navigates, scrolls, switches a tab, moves a map or presses a button
// on a timer: the runner taps the real control and the app moves because they
// tapped it. See signals.js for the events the screens report back.
//
// WHAT IT TEACHES, AND ONLY THIS (about 30 seconds):
//
//   RUN     WELCOME → START_RUN (tap LET'S RUN on Home) → RUN_START (tap
//           Start run) → DEMO_RUN (a four second demo route) → FINISH_DEMO
//           (tap Finish demo run)
//   CLAIM   CLAIM_POSITION (slide) → CLAIM_NEXT (tap Choose angle) →
//           CLAIM_ROTATE (turn) → CLAIM_CONFIRM (tap Claim) → CLAIM_SUCCESS
//   DEFEND  DEFEND → RANK
//   READY   READY → COMPLETE
//
// Everything else (the map, missions, the shop, clubs, rivals, the rank
// ladder, sharing) is a one card contextual tip, shown the first time the
// runner opens it. See tips.js.

export const PHASE = {
  // Nothing on screen. Either the tutorial is done, or it has not been armed.
  IDLE: 'idle',

  // --- RUN ------------------------------------------------------------------
  WELCOME: 'welcome',
  START_RUN: 'start-run',
  RUN_START: 'run-start',
  DEMO_RUN: 'demo-run',
  FINISH_DEMO: 'finish-demo',

  // --- CLAIM ----------------------------------------------------------------
  CLAIM_POSITION: 'claim-position',
  CLAIM_NEXT: 'claim-next',
  CLAIM_ROTATE: 'claim-rotate',
  CLAIM_CONFIRM: 'claim-confirm',
  CLAIM_SUCCESS: 'claim-success',

  // --- DEFEND ---------------------------------------------------------------
  DEFEND: 'defend',
  RANK: 'rank',

  // --- READY ----------------------------------------------------------------
  READY: 'ready',

  COMPLETE: 'complete',
};

// The four conceptual stages the progress strip shows. Never more: a strip of
// fourteen dots tells a new runner this is going to take a while.
export const STAGE = {
  RUN: 'RUN',
  CLAIM: 'CLAIM',
  DEFEND: 'DEFEND',
  READY: 'READY',
};
export const STAGES = [STAGE.RUN, STAGE.CLAIM, STAGE.DEFEND, STAGE.READY];

export const CORE_ORDER = [
  PHASE.WELCOME,
  PHASE.START_RUN,
  PHASE.RUN_START,
  PHASE.DEMO_RUN,
  PHASE.FINISH_DEMO,
  PHASE.CLAIM_POSITION,
  PHASE.CLAIM_NEXT,
  PHASE.CLAIM_ROTATE,
  PHASE.CLAIM_CONFIRM,
  PHASE.CLAIM_SUCCESS,
  PHASE.DEFEND,
  PHASE.RANK,
  PHASE.READY,
  PHASE.COMPLETE,
];

export const phaseIndex = (phase) => CORE_ORDER.indexOf(phase);

export const atOrAfter = (phase, mark) => {
  const a = phaseIndex(phase);
  const b = phaseIndex(mark);
  return a >= 0 && b >= 0 && a >= b;
};

export function nextPhase(phase) {
  const i = phaseIndex(phase);
  if (i < 0 || i >= CORE_ORDER.length - 1) return PHASE.COMPLETE;
  return CORE_ORDER[i + 1];
}

// The phases that only make sense while the demo run or its claim is on
// screen. They live inside the Record modal, and they are attached to a demo
// run that exists only in that screen's memory: if the modal goes away (the
// runner closed it, Back, the app was killed) the demo is gone and these
// phases have nothing left to point at.
export const DEMO_PHASES = new Set([
  PHASE.RUN_START,
  PHASE.DEMO_RUN,
  PHASE.FINISH_DEMO,
  PHASE.CLAIM_POSITION,
  PHASE.CLAIM_NEXT,
  PHASE.CLAIM_ROTATE,
  PHASE.CLAIM_CONFIRM,
]);

// Kept for older imports. Same set: every demo phase is a Record phase.
export const RECORD_PHASES = DEMO_PHASES;

// The demo phases the RUN screen owns (the run screen reads these to decide
// that its Start button starts the demo rather than a real run).
export const DEMO_RUN_PHASES = new Set([PHASE.RUN_START, PHASE.DEMO_RUN, PHASE.FINISH_DEMO]);

// Where a tutorial interrupted mid demo should pick up again.
//
// The demo run and its claim live only in the run screen's memory, so a demo
// phase that wakes up without that screen goes back to the one step that can
// start a fresh demo: tap LET'S RUN on Home. Once the demo claim has landed
// there is nothing left to replay, so the payoff carries on forward to the
// defend card, which is drawn wherever the runner is.
export function resumePhase(phase) {
  if (!phase) return PHASE.WELCOME;
  if (phase === PHASE.COMPLETE) return PHASE.COMPLETE;
  if (phase === PHASE.CLAIM_SUCCESS) return PHASE.DEFEND;
  if (DEMO_PHASES.has(phase)) return PHASE.START_RUN;
  if (phaseIndex(phase) < 0) return PHASE.WELCOME;
  return phase;
}
