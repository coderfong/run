// The one enumeration of where the post-claim sequence is. Components read
// `phase` rather than juggling their own visibility booleans, so there is a
// single answer to "what is on screen right now".

export const CLAIM_PHASE = {
  IDLE: 'idle',
  // The run itself, replayed in 3D before anything is claimed. First because
  // it is the part the runner did; the claim then lands on ground they have
  // just been flown over.
  RUN_REPLAY: 'run-replay',
  FOCUS: 'focus',
  ENCOUNTER_INTRO: 'encounter-intro',
  ENCOUNTER_ATTACK: 'encounter-attack',
  ENCOUNTER_EXIT: 'encounter-exit',
  TERRITORY_REVEAL: 'territory-reveal',
  TERRITORY_HANDOFF: 'territory-handoff',
  VICTORY: 'victory',
  PAYOFF: 'payoff',
  LEADERBOARD_TRANSITION: 'leaderboard-transition',
  LEADERBOARD: 'leaderboard',
  COMPLETE: 'complete',
};

// Order matters for "have we reached / passed this beat" questions.
const ORDER = [
  CLAIM_PHASE.IDLE,
  CLAIM_PHASE.RUN_REPLAY,
  CLAIM_PHASE.FOCUS,
  CLAIM_PHASE.ENCOUNTER_INTRO,
  CLAIM_PHASE.ENCOUNTER_ATTACK,
  CLAIM_PHASE.ENCOUNTER_EXIT,
  CLAIM_PHASE.TERRITORY_REVEAL,
  CLAIM_PHASE.TERRITORY_HANDOFF,
  CLAIM_PHASE.VICTORY,
  CLAIM_PHASE.PAYOFF,
  CLAIM_PHASE.LEADERBOARD_TRANSITION,
  CLAIM_PHASE.LEADERBOARD,
  CLAIM_PHASE.COMPLETE,
];

export const phaseIndex = (phase) => ORDER.indexOf(phase);

// "Are we at or past this beat?" — how the permanent territory decides to stay
// on once the handoff has happened, whatever comes after.
export const atOrAfter = (phase, mark) => phaseIndex(phase) >= phaseIndex(mark);

export const isEncounterPhase = (phase) =>
  phase === CLAIM_PHASE.ENCOUNTER_INTRO ||
  phase === CLAIM_PHASE.ENCOUNTER_ATTACK ||
  phase === CLAIM_PHASE.ENCOUNTER_EXIT;
