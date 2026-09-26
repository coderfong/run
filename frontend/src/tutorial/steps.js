// The core tutorial, declared rather than coded.
//
// Every step is data: which screen it belongs to, which REAL control it points
// at, what it says, and which real event ends it. Nothing in here renders
// anything, navigates anywhere or starts a timer.
//
// THE RULE: SHOW ONE THING, THE RUNNER DOES IT, SAY SO, MOVE ON.
//
//   * A step never moves the app. The runner's own tap on the real control is
//     what changes the screen; the tutorial only notices that it changed.
//   * A step never advances on a timer. It ends on a signal from the screen
//     that owns the state (`on`), on a fact becoming true (`doneWhen`), or on
//     an explicit button on the card (`dismiss: 'cta'`). There is no "tap
//     anywhere to continue".
//   * A step only draws on the screen it names (`route`), and only once its
//     target has been registered AND measured. Otherwise it waits, invisibly.
//
// COPY RULE. A title and one or two short sentences. The four words the whole
// tutorial is built on are RUN, CLAIM, DEFEND and RANK, and nothing else is
// introduced. Words wrapped in *asterisks* come out in PASER pink
// (highlight.js). No dashes of any kind in anything a runner reads.

import { PHASE, STAGE } from './phases';
import { SIGNAL } from './signals';
import { TARGET } from './targets';

const HOME = ['HomeMain'];
const RUN = ['Record'];
const CLAIM = ['Result'];

// The claim chooser is on screen, and on which of its two steps.
const claimOn = (step) => (facts) => facts.claimReady === true && facts.claimStep === step;

// The demo claim's size, the way the Claim button spells it.
export function demoKm2(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} km²`;
}

/**
 * @typedef {object} TutorialStep
 * @property {string}   phase
 * @property {string}   stage      one of STAGE: what the progress strip lights
 * @property {'root'|'record'|'auto'} host  which overlay draws it. `record` is
 *                                 the host inside the run/claim modal, `root`
 *                                 the one beside the navigator, `auto` either,
 *                                 whichever is in front of the current route
 * @property {string[]} [route]    the screens it may draw on; absent = any
 * @property {string|null} target  a TARGET to spotlight, or null to centre
 * @property {boolean}  interactive true: the real control under the hole takes
 *                                 the press, everything else is blocked
 * @property {'cta'|'action'|'none'} dismiss
 *                                 cta: the card's own button; action: the real
 *                                 control; none: a signal from the screen
 * @property {'card'|'welcome'|'payoff'|'loop'|'banner'} kind
 * @property {string}   [cta]      the card's button, for dismiss: 'cta'
 * @property {{label: string, action: string}} [secondary]
 * @property {boolean}  [coach]    stand the runner on this card. Sparingly:
 *                                 welcome, success and done only
 * @property {boolean}  skippable  offer "Skip tutorial"
 * @property {string}   [enterHaptic]
 * @property {(facts: object) => boolean} [gate]
 * @property {(facts: object) => boolean} [doneWhen]  a fact that ends the step
 * @property {Object<string,string>} [on]  SIGNAL → the PHASE it moves to
 * @property {(facts: object) => {title: string, lines: string[], action?: string, ack?: string}} copy
 *           `action` is the one instruction, set apart; `ack` is the tiny
 *           confirmation of what the runner just did, above the title
 */

/** @type {TutorialStep[]} */
export const STEPS = [
  // --- RUN -----------------------------------------------------------------
  {
    phase: PHASE.WELCOME,
    stage: STAGE.RUN,
    host: 'root',
    route: HOME,
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'SHOW ME',
    coach: true,
    skippable: true,
    kind: 'welcome',
    enterHaptic: 'light',
    // Home stays exactly where it is. No tab jump, no scroll: SHOW ME only
    // swaps this card for a light on the Start a run card underneath it.
    copy: () => ({
      title: 'Welcome to *PASER*',
      lines: [
        'Your runs become claimable land.',
        'Plan your claim.',
        "Defend what's yours.",
        'Be the one true PASER.',
      ],
    }),
  },

  {
    phase: PHASE.START_RUN,
    stage: STAGE.RUN,
    host: 'root',
    route: HOME,
    target: TARGET.HOME_START_RUN,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    // ACTION-FIRST from here on: one title, one instruction, nothing else.
    // The welcome card already made the case for why; a step is not the
    // place to make it again.
    copy: () => ({
      title: 'Run to *claim*',
      lines: [],
      action: 'Tap START A RUN.',
    }),
    // The hero's own onPress opens the run screen. The step ends when that
    // screen is really up, however it got there.
    doneWhen: (facts) => facts.route === 'Record',
  },

  {
    phase: PHASE.RUN_START,
    stage: STAGE.RUN,
    host: 'record',
    route: RUN,
    target: TARGET.RUN_START,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    gate: (facts) => facts.running !== true,
    copy: () => ({
      title: 'Start running',
      lines: [],
      // The real button says "Start run" (RunningScreen.js), not the bare
      // "START" a first draft of this line used — same class of mismatch as
      // the old "LET'S RUN" one, so it names the control it actually is.
      action: 'Tap START RUN.',
    }),
    // Reported by the run screen when the runner presses Start and the demo
    // begins. Its Start button starts the demo, never a real run, while the
    // tutorial is on this step.
    on: { [SIGNAL.RUN_STARTED]: PHASE.DEMO_RUN },
  },

  {
    phase: PHASE.DEMO_RUN,
    stage: STAGE.RUN,
    host: 'record',
    route: RUN,
    target: null,
    interactive: false,
    // No button and no scrim: a banner, while the demo route draws itself for
    // about four seconds. The one message of the whole run.
    dismiss: 'none',
    skippable: true,
    kind: 'banner',
    gate: (facts) => facts.running === true,
    copy: () => ({
      title: 'Your route becomes your *claim*',
      lines: [],
    }),
    on: { [SIGNAL.DEMO_ROUTE_DONE]: PHASE.FINISH_DEMO },
  },

  {
    phase: PHASE.FINISH_DEMO,
    stage: STAGE.RUN,
    host: 'record',
    route: RUN,
    target: TARGET.FINISH_RUN,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    gate: (facts) => facts.running === true,
    copy: () => ({
      title: 'Finish your run',
      lines: [],
      action: 'Tap FINISH DEMO RUN.',
    }),
    on: { [SIGNAL.RUN_FINISHED]: PHASE.CLAIM_POSITION },
  },

  // --- CLAIM ---------------------------------------------------------------
  {
    phase: PHASE.CLAIM_POSITION,
    stage: STAGE.CLAIM,
    host: 'record',
    route: CLAIM,
    target: TARGET.CLAIM_POSITION,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    gate: claimOn('place'),
    copy: () => ({
      title: 'Place your *claim*',
      lines: [],
      action: 'Slide to pick where it lands.',
    }),
    // A real drag that ends somewhere other than where it started. A tap that
    // snaps back to the resting notch does not count.
    on: { [SIGNAL.CLAIM_POSITION_CHANGED]: PHASE.CLAIM_NEXT },
  },

  {
    phase: PHASE.CLAIM_NEXT,
    stage: STAGE.CLAIM,
    host: 'record',
    route: CLAIM,
    target: TARGET.CLAIM_NEXT,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    gate: claimOn('place'),
    copy: () => ({
      title: 'Choose your angle',
      lines: [],
      action: 'Tap CHOOSE ANGLE.',
    }),
    // The claim screen owns which step its chooser is on, and publishes it.
    doneWhen: (facts) => facts.claimStep === 'rotate',
  },

  {
    phase: PHASE.CLAIM_ROTATE,
    stage: STAGE.CLAIM,
    host: 'record',
    route: CLAIM,
    target: TARGET.CLAIM_ROTATION,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    gate: claimOn('rotate'),
    copy: () => ({
      title: 'Set the angle',
      lines: [],
      // "Turn it to fit your attack" was the direction; "attack" is outside
      // the four core words the copy is built on (RUN, CLAIM, DEFEND, RANK)
      // and a test enforces that, so "claim" carries the same beat.
      action: 'Turn it to fit your claim.',
    }),
    on: { [SIGNAL.CLAIM_ROTATION_CHANGED]: PHASE.CLAIM_CONFIRM },
  },

  {
    phase: PHASE.CLAIM_CONFIRM,
    stage: STAGE.CLAIM,
    host: 'record',
    route: CLAIM,
    target: TARGET.CLAIM_BUTTON,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    gate: claimOn('rotate'),
    copy: () => ({
      title: 'Claim it',
      lines: [],
      action: 'Tap CLAIM.',
    }),
    on: { [SIGNAL.CLAIM_PLACED]: PHASE.CLAIM_SUCCESS },
  },

  {
    phase: PHASE.CLAIM_SUCCESS,
    stage: STAGE.CLAIM,
    host: 'auto',
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'GOT IT',
    coach: true,
    skippable: false,
    kind: 'payoff',
    enterHaptic: 'success',
    copy: (facts) => ({
      title: '*Land* claimed!',
      lines: [facts.demoClaimM2 ? `*+${demoKm2(facts.demoClaimM2)}* is yours` : '*New land* is yours.'],
    }),
  },

  // --- DEFEND --------------------------------------------------------------
  // Two small cards over whatever is on screen. No trip to the rank ladder,
  // rivals, the You page or the share sheet: those are tips, later.
  {
    phase: PHASE.DEFEND,
    stage: STAGE.DEFEND,
    host: 'auto',
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'GOT IT',
    skippable: true,
    kind: 'card',
    copy: () => ({
      title: 'Now *defend* it',
      lines: ['Run your land again to keep it strong.'],
    }),
  },

  {
    phase: PHASE.RANK,
    stage: STAGE.DEFEND,
    host: 'auto',
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'GOT IT',
    skippable: true,
    kind: 'card',
    copy: () => ({
      title: '*Rank* up',
      lines: ['Hold more land. Climb higher.'],
    }),
  },

  // --- READY ---------------------------------------------------------------
  {
    phase: PHASE.READY,
    stage: STAGE.READY,
    host: 'auto',
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'START EXPLORING',
    // Home, and the demo is thrown away. The secondary opens a fresh, real run
    // screen instead.
    ctaAction: 'finish',
    secondary: { label: 'Take a real run', action: 'realRun' },
    coach: true,
    skippable: false,
    kind: 'loop',
    enterHaptic: 'light',
    copy: () => ({
      title: "You're *ready*",
      lines: [],
    }),
  },
];

const BY_PHASE = STEPS.reduce((map, step) => {
  map[step.phase] = step;
  return map;
}, {});

export function stepFor(phase) {
  return BY_PHASE[phase] || null;
}

/** The host a step draws in, given the route that is up. */
export function resolveHost(step, route, runRoutes) {
  if (!step) return null;
  if (step.host !== 'auto') return step.host;
  return runRoutes.has(route) ? 'record' : 'root';
}
