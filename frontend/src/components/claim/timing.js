// Every duration in the post-claim sequence, in one place. Components take
// their beat lengths from here rather than carrying magic numbers, so the
// whole thing can be retuned without hunting through five files.
//
// RETUNED 2026-08-10. The first slowdown still compressed the encounter,
// reveal and victory into one gesture on a phone. Full motion now gives each
// of those beats its own readable pause; reduced motion remains concise.
//
// Occupied-territory budget, from "Claim here" to a readable payoff:
//   focus 2100 + intro 1050 + grinHold 700 + anticipation 520 + dash 500
//   = 4870 to impact, then exit hold 700 + reveal 2400 + handoff 400
//   + victory 2400 + payoffEntrance 800  ≈ 11.6s.
//
// Two of these are NOT visual beats and must not be scaled with the rest:
// `settle` (how long the camera is given to stop before its coordinates are
// projected) and `impactTimeout` (the deadline that rescues a broken
// encounter). Both are consequences of the numbers above — see their notes.

export const CLAIM_TIMING = {
  // --- the run, replayed in 3D (claim/runFlyover.js) ---
  // The whole pass along the route: long enough to be a lap of somewhere
  // rather than a swoop, short enough that it stays a title sequence and does
  // not become a re-run.
  //
  // `runReplayLevel` is the tilt coming back OFF afterwards, and it is not
  // decoration. The reveal projects map coordinates into screen pixels, and
  // that projection is only true from straight down — at a pitch the ground
  // plane is foreshortened and a projected polygon drifts further out the
  // deeper into the scene it goes. The camera must be flat AND settled before
  // anything is projected.
  runReplay: 4200,
  runReplayPitch: 55,
  runReplayZoom: 16,
  runReplayLevel: 600,

  // --- map beats (also read by useClaimReveal) ---
  // Long enough to read as flying somewhere rather than cutting to it.
  focus: 2100,
  // The camera must be fully stopped before coordinates are projected to
  // screen space, or the polygon lands offset. Not a visual beat — this is
  // slack after the flight, and it scales with nothing.
  settle: 180,
  reveal: 2400,
  handoff: 400,

  // --- capture encounter ---
  encounterIntro: 1050,
  grinHold: 700,
  attackAnticipation: 520,
  attackDash: 500,
  defenderExit: 1100,
  // Capture presentation begins at impact. Its authored reveal cue starts the
  // territory transition while defenders finish leaving over the top of it.
  defenderExitOverlap: 400,
  // Empty ground: the attacker just lands on the spot and plants a flag.
  emptyLanding: 1050,

  // --- payoff and after ---
  victoryBeat: 2400,
  payoffEntrance: 800,
  leaderboardWipe: 1200,
  rowStagger: 110,
  playerRowEmphasis: 900,

  // A failed encounter must never stall the sequence: if `onImpact` has not
  // fired by this point the controller proceeds to the reveal regardless.
  // MUST stay clear of the encounter's own path to impact — intro 1050 +
  // grinHold 700 + anticipation 520 + dash 500 = 2770 — or this deadline
  // fires DURING a healthy attack and cuts the fight off mid-dash. The margin
  // below is deliberate slack, not a guess.
  impactTimeout: 4000,
};

// Reduced motion keeps every phase and every piece of information — the beats
// just collapse to quick fades. No dashes, no flight, no wipe.
export const CLAIM_TIMING_REDUCED = {
  // No flyover at all under Reduce Motion. A pitched camera swinging along a
  // route is exactly the kind of large-field movement the setting exists to
  // suppress, and unlike the beats below it carries no information that is
  // lost by skipping it — the run is on the map either way. 0 means the
  // controller skips the phase rather than playing a fast version of it.
  runReplay: 0,
  runReplayPitch: 0,
  runReplayZoom: 16,
  runReplayLevel: 0,

  focus: 260,
  settle: 120,
  reveal: 220,
  handoff: 120,

  encounterIntro: 160,
  grinHold: 0,
  attackAnticipation: 0,
  attackDash: 120,
  defenderExit: 160,
  defenderExitOverlap: 60,
  emptyLanding: 160,

  victoryBeat: 320,
  payoffEntrance: 200,
  leaderboardWipe: 220,
  rowStagger: 12,
  playerRowEmphasis: 180,

  impactTimeout: 900,
};

export const timingFor = (reduced) => (reduced ? CLAIM_TIMING_REDUCED : CLAIM_TIMING);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
