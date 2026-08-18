// How often PASER is allowed to mention PRO, and where.
//
// EVERY tunable number for the monetisation lives here. That is the point of
// the file: the rules for "has this runner seen too much of this?" were the
// kind of thing that ends up as three different magic numbers inside three
// different screens, and then nobody can answer what the app actually does.
// Screens ask `src/pro/exposure.js`; that module reads this; nothing else
// hard-codes a threshold.
//
// THE SHAPE OF THE POLICY. Two completely different things are rate limited,
// and conflating them is the mistake that makes an app feel like a billboard:
//
//   AUTOMATIC — PASER decided to bring PRO up. Nobody asked. These are heavily
//   limited: one per session, never on the first runs, never twice for the
//   same context, and never straight after the last one.
//
//   USER INITIATED — the runner tapped a thing with a padlock on it. This is
//   not an interruption, it is an answer to a question they just asked, so it
//   is NOT rate limited at all. Suppressing it would mean tapping "Territory
//   Planner" did nothing, which is worse than any paywall.

// ---------------------------------------------------------------------------
// Automatic prompts
// ---------------------------------------------------------------------------

// Runs finished before PASER is allowed to raise PRO by itself. The first two
// results belong entirely to the run: somebody who has just finished their
// first ever run is learning what the app IS, and selling to them there is
// both rude and useless.
export const MIN_RUNS_BEFORE_AUTO = 3;

// Never two automatic full paywalls in one session. A session that shows two
// is a session that has stopped being about running.
export const MAX_AUTO_PAYWALLS_PER_SESSION = 1;

// And not within this of the last one, across sessions — someone who opens the
// app four times in an evening should not be sold to four times.
export const MIN_MS_BETWEEN_AUTO = 20 * 60 * 60 * 1000; // 20 hours

// A context that has been dismissed this many times stops prompting
// automatically for good. The answer was no; asking a fourth time is not going
// to change it, and the teaser rows are still there whenever they want them.
export const MAX_DISMISSALS_PER_CONTEXT = 2;

// ---------------------------------------------------------------------------
// Result screen — which runs are worth saying anything after
// ---------------------------------------------------------------------------

// The Territory Report is ALWAYS shown (it is mostly free content). This
// governs only whether the run was notable enough to earn the stronger PRO
// surface underneath it. Every field below is one the run insights endpoint
// already returns — see backend/app/routes/insights.py. Nothing here is
// inferred, estimated or invented.
export const NOTABLE_RUN = {
  // A claim this size is a big day out by any reading of the board.
  bigClaimM2: 500_000,
  // Took ground off at least this many other runners.
  rivalsTaken: 1,
  // Landed inside the top of the field. Only ever applied when the endpoint
  // actually returned a standing.
  topRankFraction: 0.25,
};

// ---------------------------------------------------------------------------
// Territory Planner
// ---------------------------------------------------------------------------

// Free planner previews, ever — not per week. The planner is the one PRO
// feature a free runner can hold in their hands, and three is enough to
// understand what it does on real ground they actually run.
//
// Only a COMPLETED preview counts (a route with at least two points that came
// back with a result). Opening the planner, panning it, or drawing one point
// and closing it are all free, because charging for a mis-tap is how a limit
// stops feeling like a trial and starts feeling like a trap.
export const FREE_PLANNER_PREVIEWS = 3;

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

// Runs before the compact PRO card may appear low on Home. Deliberately the
// same threshold as the automatic prompts: one idea of "has this person
// actually played PASER yet", not two.
export const MIN_RUNS_BEFORE_HOME_CARD = MIN_RUNS_BEFORE_AUTO;

// How long Home must be settled before it may raise PRO by itself.
//
// This is the app's only prompt that is not a reaction to something the runner
// just did, so the delay is doing real work. Firing it as Home appears puts a
// sheet over a screen still drawing itself, which reads as a launch
// interstitial no matter what it says. Waiting means the feed is up, the
// season card is up, and the runner has had a moment to be somewhere before
// anything is asked of them — and it self-cancels if they leave in the
// meantime, so a runner who opens the app and taps straight into a run is
// never interrupted at all.
//
// Everything else about this prompt is the ordinary automatic policy above:
// three finished runs, one per session, twenty hours apart, and gone for good
// after two dismissals.
export const HOME_AUTO_PROMPT_DELAY_MS = 2500;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

// How many events the in-memory dev ring buffer keeps. Lives here rather than
// in analytics.js so every tunable is in one file.
export const RECENT_EVENT_LIMIT = 200;

// Storage key for the persisted exposure record. Versioned: a shape change
// should start from a clean slate rather than crash on last release's blob.
export const EXPOSURE_STORAGE_KEY = 'paser:pro:exposure:v1';
