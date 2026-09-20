// What the APP tells the tutorial.
//
// The rule this file exists to enforce: the tutorial never decides that a run
// started, that a claim landed or that options failed. It is told. Every one of
// these is reported from the screen that already owns that state, at the point
// where it already changes it, so the tutorial can only ever be a step behind
// reality rather than a second opinion about it.
//
// TWO MECHANISMS, ONE JOB EACH.
//
//   SIGNALS (here)  discrete events that MOVE the tutorial on. Fire and forget,
//                   and idempotent: a screen may report the same one twice (a
//                   retry, a resumed run), and a signal that does not match the
//                   phase the machine is in is dropped.
//   FACTS (facts.js) continuous state that decides whether a step may SHOW. A
//                   step whose fact is not true yet simply waits, invisibly.
//
// Everything that can be derived rather than reported IS derived — the current
// route comes from the navigator and `running` comes from the recording state,
// so the tab bar, the close button and a run started from the watch all
// already work without knowing this file exists.

export const SIGNAL = {
  // The run ended and is being submitted. Reported by RunningScreen.finishRun.
  RUN_FINISHED: 'run-finished',

  // The runner moved or turned the claim: they have USED the chooser.
  CLAIM_ADJUSTED: 'claim-adjusted',
  // The claim was accepted by the server.
  CLAIM_PLACED: 'claim-placed',
  // This run has nothing to claim, or the options never arrived. Not a failure
  // of the tutorial: the lesson rewinds and waits for a run that earns ground.
  CLAIM_UNAVAILABLE: 'claim-unavailable',
};

/** Every value `signal()` will actually answer to — exported for tests. */
export const SIGNAL_NAMES = Object.freeze(Object.values(SIGNAL));
