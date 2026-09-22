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

  // --- a safe training run -----------------------------------------------
  // These beats are an illustrated simulation. They never call the run,
  // claim, shop or social APIs, so learning cannot change the player's real
  // route, land, currency or relationships.
  TRAINING_RUN: 'training-run',
  TRAINING_CLAIM: 'training-claim',
  TRAINING_RIVAL: 'training-rival',
  TRAINING_CAPTURED: 'training-captured',
  TRAINING_CROSSROADS: 'training-crossroads',
  TRAINING_CUSTOMISE: 'training-customise',
  TRAINING_SHOP: 'training-shop',
  TRAINING_PROGRESS: 'training-progress',
  TRAINING_DEFEND: 'training-defend',

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
//
// THE PRACTICE RUN IS PLAYED, NOT DRAWN. It used to be two illustrated cards
// (a fake progress bar, a fake claim) near the start and the real run branch
// at the very end, which meant the runner was told about the run screen long
// before they saw it. Now the practice card opens the real run screen, and the
// run, the claim, the celebration, the recap and the share page all play
// themselves (see the autopilot notes in RunningScreen and ResultScreen) and
// hand the runner back to Home, where the rest of the tour carries on. The
// last beat is still START_RUN: the real button, for a real run.
//
// TRAINING_CLAIM, FINISH_RUN and CLAIM_CONFIRM are no longer on the tour. The
// constants stay so a record persisted on one of them still normalises; see
// resumePhase.
export const CORE_ORDER = [
  PHASE.WELCOME,
  PHASE.MAP,
  PHASE.PLAYER,
  PHASE.TERRITORY,
  PHASE.CORE_LOOP,
  PHASE.TRAINING_RUN,
  PHASE.ACTIVE_RUN,
  PHASE.CLAIM_SELECT,
  PHASE.FIRST_CLAIM_SUCCESS,
  PHASE.TRAINING_RIVAL,
  PHASE.TRAINING_CAPTURED,
  PHASE.TRAINING_CROSSROADS,
  PHASE.TRAINING_CUSTOMISE,
  PHASE.TRAINING_SHOP,
  PHASE.TRAINING_PROGRESS,
  PHASE.TRAINING_DEFEND,
  PHASE.START_RUN,
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

// Where a tutorial interrupted mid run should pick up again.
//
// The run branch is the PRACTICE run now, so an interrupted one starts over
// from its own card: the simulated run it was attached to is gone, and the
// next one plays the whole thing again. Once the claim has landed there is
// nothing left of the practice to replay, so that beat carries on forward.
export function resumePhase(phase) {
  if (!phase) return PHASE.WELCOME;
  if (phase === PHASE.COMPLETE) return PHASE.COMPLETE;
  if (phase === PHASE.FIRST_CLAIM_SUCCESS) return PHASE.TRAINING_RIVAL;
  if (RECORD_PHASES.has(phase) || phase === PHASE.TRAINING_CLAIM) return PHASE.TRAINING_RUN;
  if (phaseIndex(phase) < 0) return PHASE.WELCOME;
  return phase;
}
