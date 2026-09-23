// The first-run tutorial: coach marks over the real interface, advanced only
// by the runner using the real controls. See phases.js for what it teaches.
//
//   TutorialProvider   the state machine, the target registry, persistence
//   TutorialOverlay    what is drawn; mounted once per host (see its header)
//   TutorialTarget     how a component offers itself as something to light
//   useTutorial()      stable callbacks: signal, setFacts, replay, skip
//   useTutorialTip()   a contextual first-open tip
//
// Everything a screen needs is in this barrel. Screens should not reach past
// it into the individual files.

export { TutorialProvider, useTutorial, useTutorialActive, useTutorialState } from './TutorialContext';
export { default as TutorialOverlay } from './TutorialOverlay';
export {
  TutorialTarget,
  TutorialAnchor,
  useTutorialTarget,
  useTutorialTip,
} from './TutorialTarget';

export { PHASE, STAGE, DEMO_RUN_PHASES } from './phases';
export { SIGNAL } from './signals';
export { TARGET } from './targets';
export { TIP, CORE, coreActive, inFirstOnboarding } from './progress';
