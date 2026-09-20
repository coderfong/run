// The names a component can register itself under, and the one place they are
// spelled.
//
// A step in steps.js asks for a target by one of these; a screen offers one by
// wrapping something in <TutorialTarget id={TARGET.X}> or dropping a
// <TutorialAnchor id={TARGET.X}> over the region it wants lit. Constants rather
// than string literals at both ends, so a renamed target breaks at import time
// instead of quietly producing a step that can never find what it points at.

export const TARGET = {
  // --- the world ----------------------------------------------------------
  // The live map inside its drawn frame, on the Map tab.
  MAP_BOARD: 'map-board',
  // Where the runner is standing, once the camera has flown to them.
  MAP_PLAYER: 'map-player',

  // --- the loop -----------------------------------------------------------
  // The record button in the middle of the tab bar. Present on every tab.
  START_RUN: 'start-run',
  // The live route, on the running screen.
  RUN_ROUTE: 'run-route',
  // Hold to finish.
  FINISH_RUN: 'finish-run',
  // The claim controls: place, rotate, and the claim button under them.
  CLAIM_SHEET: 'claim-sheet',
  // Just the confirmation button.
  CLAIM_BUTTON: 'claim-button',

  // --- contextual ---------------------------------------------------------
  CLUB_MAIN: 'club-main',
  LEADERBOARD_MAIN: 'leaderboard-main',
  YOU_MAIN: 'you-main',
};

export const TARGET_NAMES = Object.freeze(Object.values(TARGET));
