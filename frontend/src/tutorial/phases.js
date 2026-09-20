// The one enumeration of where the first-run tutorial is.
//
// Deliberately the same shape as components/claim/phases.js: an object of
// named phases plus an ORDER array, so "have we reached this beat" is one
// comparison rather than a pile of booleans spread over four screens.
//
// THE TUTORIAL FOLLOWS THE APP, NOT THE OTHER WAY AROUND. Nothing here drives
// gameplay. Each phase says what is being taught and what real event ends it;
// the run and claim state machines are untouched and remain the source of
// truth. See signals.js for the events the app reports back.

export const PHASE = {
  // Nothing on screen. Either the tutorial is done, or it has not been armed.
  IDLE: 'idle',

  // --- the world, taught on the map ---------------------------------------
  WELCOME: 'welcome',
  MAP: 'map',
  PLAYER: 'player',
  TERRITORY: 'territory',
  CORE_LOOP: 'core-loop',

  // --- the loop, taught by doing it ---------------------------------------
  START_RUN: 'start-run',
  ACTIVE_RUN: 'active-run',
  FINISH_RUN: 'finish-run',
  CLAIM_SELECT: 'claim-select',
  CLAIM_CONFIRM: 'claim-confirm',
  FIRST_CLAIM_SUCCESS: 'first-claim-success',

  COMPLETE: 'complete',
};

// Order matters for "have we reached / passed this beat" questions, and for
// `nextPhase`, which is what a tap on an informational card does.
export const CORE_ORDER = [
  PHASE.WELCOME,
  PHASE.MAP,
  PHASE.PLAYER,
  PHASE.TERRITORY,
  PHASE.CORE_LOOP,
  PHASE.START_RUN,
  PHASE.ACTIVE_RUN,
  PHASE.FINISH_RUN,
  PHASE.CLAIM_SELECT,
  PHASE.CLAIM_CONFIRM,
  PHASE.FIRST_CLAIM_SUCCESS,
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

// The phases that live inside the Record / claim modals rather than over the
// tab bar. A native fullScreenModal is presented ABOVE the React root, so an
// overlay mounted beside the navigator cannot draw on top of these — see
// TutorialOverlay's `host`.
export const RECORD_PHASES = new Set([
  PHASE.ACTIVE_RUN,
  PHASE.FINISH_RUN,
  PHASE.CLAIM_SELECT,
  PHASE.CLAIM_CONFIRM,
  PHASE.FIRST_CLAIM_SUCCESS,
]);

// Where a tutorial interrupted mid-run should pick up again. Everything about
// the world has already been taught by the time a run starts, so a runner who
// killed the app halfway through their first run comes back to "start a run",
// never to "this is your world" all over again.
export function resumePhase(phase) {
  if (!phase || phaseIndex(phase) < 0) return PHASE.WELCOME;
  if (phase === PHASE.COMPLETE) return PHASE.COMPLETE;
  // Anything inside the run/claim branch rewinds to the top of that branch:
  // the run it was attached to is gone, and the next one teaches it again.
  if (RECORD_PHASES.has(phase)) return PHASE.START_RUN;
  return phase;
}
