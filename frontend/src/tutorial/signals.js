// What the APP tells the tutorial.
//
// The rule this file exists to enforce: the tutorial never decides that a run
// started, that a claim moved or that a claim landed. It is told, by the
// screen that owns that state, at the moment the runner caused it. There is
// no timer anywhere in the core tutorial that moves it on.
//
// TWO MECHANISMS, ONE JOB EACH.
//
//   SIGNALS (here)  discrete events that MOVE the tutorial on. Fire and forget,
//                   and idempotent: a screen may report the same one twice (a
//                   double tap, a retry), and a signal the current step does
//                   not listen for is dropped.
//   FACTS           continuous state that decides whether a step may SHOW
//                   (the route, `claimStep`, `demoRouteDone`). A step whose
//                   facts are not right yet simply waits, invisibly.

export const SIGNAL = {
  // The runner pressed Start on the run screen and the demo run began.
  RUN_STARTED: 'run-started',
  // The demo route finished drawing itself: the Finish button can be shown.
  // A component animation ending, which only REVEALS a control; the tutorial
  // still waits for the runner to press it.
  DEMO_ROUTE_DONE: 'demo-route-done',
  // The run ended. Reported by RunningScreen.finishRun.
  RUN_FINISHED: 'run-finished',

  // The runner moved the claim along the route, meaningfully (not a tap that
  // snapped back to where it started).
  CLAIM_POSITION_CHANGED: 'claim-position-changed',
  // The runner turned the claim.
  CLAIM_ROTATION_CHANGED: 'claim-rotation-changed',
  // Either of the two above. Kept for older call sites.
  CLAIM_ADJUSTED: 'claim-adjusted',
  // The claim was placed.
  CLAIM_PLACED: 'claim-placed',
  // This run has nothing to claim, or the options never arrived.
  CLAIM_UNAVAILABLE: 'claim-unavailable',
};

/** Every value `signal()` will actually answer to. Exported for tests. */
export const SIGNAL_NAMES = Object.freeze(Object.values(SIGNAL));
