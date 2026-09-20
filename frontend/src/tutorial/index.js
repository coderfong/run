// The first-run tutorial — coach marks that play over the real interface.
//
//   TutorialProvider   the state machine, the target registry, persistence
//   TutorialOverlay    what is drawn; mounted once per host (see its header)
//   TutorialTarget     how a component offers itself as something to light
//   useTutorial()      stable callbacks: signal, setFacts, replay, skip
//   useTutorialTip()   a contextual first-open tip
//
// Everything a screen needs is in this barrel. Screens should not reach past
// it into the individual files.

export { TutorialProvider, useTutorial, useTutorialState } from './TutorialContext';
export { default as TutorialOverlay } from './TutorialOverlay';
export {
  TutorialTarget,
  TutorialAnchor,
  useTutorialTarget,
  useTutorialTip,
} from './TutorialTarget';

export { PHASE } from './phases';
export { SIGNAL } from './signals';
export { TARGET } from './targets';
export { TIP, CORE, coreActive } from './progress';
