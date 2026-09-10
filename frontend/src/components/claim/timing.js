// Every duration in the post-claim sequence, in one place. Components take
// their beat lengths from here rather than carrying magic numbers, so the
// whole thing can be retuned without hunting through five files.
//
// RETUNED 2026-08-10, and again when capture styles became complete
// cutscenes. The encounter beats that used to live here are GONE: there is no
// longer a fixed collision in front of every style, so there is no intro,
// grin, wind-up, dash or defender exit for this table to time. Each style owns
// its own pacing (src/effects/captureStyles.js) and tells the controller when
// the ground turns over; the numbers below are the map beats around it.
//
// Occupied-territory budget, from "Claim here" to a readable payoff:
//   focus 2100 + the style's own run to its reveal cue (1000-2300 depending
//   on the style) + reveal 2400 + handoff 400 + victory 2400
//   + payoffEntrance 800  ≈ 12s to 13s.
//
// The style keeps playing THROUGH the reveal and handoff — that is where its
// consequence, defender exit and victory beats live — so the extra length over
// the old 11.6s is anticipation at the front, not dead time at the back.
//
// `settle` is NOT a visual beat and must not be scaled with the rest: it is
// how long the camera is given to stop before its coordinates are projected.
//
// `DRAMA_SCALE` stretches every beat in a capture style
// (effects/captureStyles.js) and the actor timing table
// (effects/choreography.js) by one factor. That is safe despite the
// one-body-per-action rule those files enforce: multiplying every timestamp AND
// every duration by the same K preserves every "clears before the next beat"
// relationship the authoring computed, because K*end = K*start + K*duration for
// any K > 0. `reveal` and `handoff` below carry the same factor, because
// `POST_REVEAL_BUDGET` in choreography.js is derived from them.
//
// RETUNED 2026-08-17, back to 1.0. It was 1.4, stretching every scene to five
// and six seconds on the theory that anticipation makes an impact feel earned.
// What it actually produced was several seconds of effects moving with nothing
// happening — and worse, it divided every sprite's playback `speed` by the same
// factor, so sheets that were already 2 to 3 seconds long at speed 1
// (magic_spell_01 is 81 frames at 30fps; freezing_bloom_01 is 100) stretched
// past FIVE seconds and covered the three beats that came after them.
//
// The scenes are now authored directly against the target shape, so there is
// nothing left to stretch:
//
//     0-300     setup: the runner commits, the world warns, the rivals notice
//     300-800   the attack is released
//     700-1200  it travels
//     ~1150     IMPACT — one frame, everything at once, nothing else on screen
//     1200-1750 the rivals are displaced and the ground turns over
//     1750-2300 the effects settle and the rivals leave
//     2300-2600 the runner takes the ground; payoff follows
//
// Keep this at 1.0 unless the whole pack is being retuned deliberately.
export const DRAMA_SCALE = 1.0;

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
  // How long the style is given to finish its own consequence, defender exit
  // and victory over the top of the turnover. `POST_REVEAL_BUDGET` in
  // effects/choreography.js is reveal + handoff, and validation fails any
  // style that schedules a beat past it.
  //
  // These are the "1.2-1.8 conversion / 1.8-2.4 settle" half of the shape in
  // the DRAMA_SCALE note: the ground finishes turning over, the rivals leave
  // over the top of it, and the style is unmounted with ~1.3s of room after its
  // own reveal cue. Was 3360/560, which left a style playing for well over
  // three seconds after the outcome was already visible.
  reveal: Math.round(1000 * DRAMA_SCALE),
  handoff: Math.round(350 * DRAMA_SCALE),

  // --- payoff and after ---
  // The runner standing on the ground they took. Deliberately shorter than the
  // capture that earned it: this is the payoff, not a second animation.
  victoryBeat: Math.round(1500 * DRAMA_SCALE),
  payoffEntrance: 800,
  leaderboardWipe: 1200,
  // The board no longer lands its rows one at a time. It arrives whole and
  // then TRAVELS — scrolling from the podium down to the runner's own slot,
  // where their row drops in (LeaderboardTransition TravelBoard). `travelLead`
  // is the pause between the board arriving and the scroll setting off; the
  // journey's own length is derived from how far it has to go, because a
  // fixed duration reads as a crawl at rank 4 and a blur at rank 400.
  travelLead: 500,
};

// Reduced motion keeps every phase and every piece of information — the beats
// just collapse to quick fades. No flight, no wipe. The cast is NOT dropped:
// the style's own reduced plan (CaptureStylePlayer.buildCapturePlan) keeps the
// rivals, their reaction and their exit, and only takes the travel out.
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

  victoryBeat: 320,
  payoffEntrance: 200,
  leaderboardWipe: 220,
  // Reduce Motion keeps the DESTINATION and drops the journey: the board jumps
  // straight to the runner's row with it already in place. Nothing is lost —
  // the travel was never carrying information the arrival does not.
  travelLead: 0,
};

export const timingFor = (reduced) => (reduced ? CLAIM_TIMING_REDUCED : CLAIM_TIMING);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
