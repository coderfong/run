// The names a component can register itself under, and the one place they are
// spelled.
//
// A step in steps.js asks for a target by one of these; a screen offers one by
// spreading useTutorialTarget(TARGET.X) onto the REAL control, or wrapping it
// in <TutorialTarget id={TARGET.X}>. Constants rather than string literals at
// both ends, so a renamed target breaks at import time instead of quietly
// producing a step that can never find what it points at.
//
// A step whose target is not registered and measured draws NOTHING. It never
// falls back to a centred card over whatever screen happens to be up.

export const TARGET = {
  // --- Home ---------------------------------------------------------------
  // The Start a run hero card on Home.
  HOME_START_RUN: 'home.startRun',

  // --- the run screen -----------------------------------------------------
  // The Start run button.
  RUN_START: 'run.start',
  // The live route (a declared rectangle over the map).
  RUN_ROUTE: 'run.route',
  // The finish control (Finish demo run in the tutorial).
  FINISH_RUN: 'run.finish',

  // --- the claim ----------------------------------------------------------
  // "Position on your run": the slider.
  CLAIM_POSITION: 'claim.position',
  // "NEXT: CHOOSE ANGLE".
  CLAIM_NEXT: 'claim.next',
  // The rotation dial and its two arrow buttons.
  CLAIM_ROTATION: 'claim.rotation',
  // The Claim button.
  CLAIM_BUTTON: 'claim.confirm',
  // The whole claim sheet. Kept for older call sites.
  CLAIM_SHEET: 'claim.sheet',

  // --- older names, still registered by screens outside the core ----------
  // The record button in the tab bar.
  START_RUN: 'tabbar.record',
  MAP_BOARD: 'map.board',

  // --- contextual ---------------------------------------------------------
  CLUB_MAIN: 'club.main',
  LEADERBOARD_MAIN: 'leaderboard.main',
  YOU_MAIN: 'you.main',
};

export const TARGET_NAMES = Object.freeze(Object.values(TARGET));
