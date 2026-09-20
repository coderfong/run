// The core tutorial, declared rather than coded.
//
// Every step is data: what it points at, what it says, what ends it, and what
// has to be true before it may appear at all. Nothing in here renders anything
// and nothing in here knows about React — which is the point. The overlay is
// one component that can draw any step, and adding, reordering or rewording a
// step is an edit to this file alone.
//
// WHAT THE CORE TUTORIAL TEACHES, AND NOTHING ELSE:
//
//   MAP → YOU → TERRITORY → RUN → FINISH → CLAIM → PAYOFF
//
// Everything else PASER does is taught contextually, later, the first time the
// runner opens it (tips.js). There is deliberately no step for the shop, the
// season, energy, rivals, missions or pasers: a tutorial that explains every
// button is a tutorial nobody finishes.
//
// COPY RULE. Five to twelve words a line, two lines at most, and the words
// that carry the idea wrapped in *asterisks* so they land in the game's
// colour (highlight.js). No dashes of any kind in anything a runner reads —
// that is a standing rule across the whole app, not a preference of this file.

import { PHASE } from './phases';
import { SIGNAL } from './signals';
import { TARGET } from './targets';

// How long the running coach mark stays up before it takes itself away. Long
// enough to read twice; short enough that it is gone before the first corner.
export const ACTIVE_RUN_MS = 3800;

// The map steps only make sense on the map, so each one states it. A step
// whose `gate` is false shows NOTHING and waits — which is also how the
// tutorial survives a runner wandering off to another tab mid lesson.
const onMap = (facts) => facts.route === 'MapMain';

/**
 * @typedef {object} TutorialStep
 * @property {string}   phase      the PHASE this step draws
 * @property {'root'|'record'} host which overlay mounts it (a fullScreenModal
 *                                 is presented above the React root, so the
 *                                 run and claim steps need the inner host)
 * @property {string|null} target  a TARGET id to spotlight, or null to centre
 * @property {boolean}  interactive true = the real control under the hole
 *                                 stays pressable and the step is ended by
 *                                 USING it; false = tap anywhere to continue
 * @property {'tap'|'cta'|'action'|'auto'} dismiss
 * @property {number}   [autoMs]   for dismiss: 'auto'
 * @property {boolean}  skippable  does this step offer Skip
 * @property {'card'|'loop'|'payoff'} kind  which presentation the overlay uses
 * @property {string}   [cta]      the button's words, for dismiss: 'cta'
 * @property {string}   [enterHaptic]  a key on theme/haptics' `haptic`
 * @property {(facts: object) => boolean} [gate]  may this step show yet
 * @property {(facts: object) => {title: string, lines: string[]}} copy
 * @property {Object<string,string>} [on]  SIGNAL → the PHASE it moves to
 * @property {(nav: object) => void} [onEnter]
 */

/** @type {TutorialStep[]} */
export const STEPS = [
  {
    phase: PHASE.WELCOME,
    host: 'root',
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'SHOW ME',
    skippable: true,
    kind: 'card',
    enterHaptic: 'light',
    copy: () => ({
      title: 'Welcome to PASER 👋',
      lines: ['Run. Claim territory. Take over your city.'],
    }),
    // The world is the map, so the tour starts by going there. Pressing SHOW
    // ME is what moves the tab; the next step waits until it has.
    onEnter: (nav) => nav.goToMap(),
  },

  {
    phase: PHASE.MAP,
    host: 'root',
    target: TARGET.MAP_BOARD,
    interactive: false,
    dismiss: 'tap',
    skippable: true,
    kind: 'card',
    gate: onMap,
    copy: () => ({
      title: 'This is your world.',
      lines: ['Every coloured area is *territory*.'],
    }),
    onEnter: (nav) => nav.goToMap(),
  },

  {
    phase: PHASE.PLAYER,
    host: 'root',
    target: TARGET.MAP_PLAYER,
    interactive: false,
    dismiss: 'tap',
    skippable: true,
    kind: 'card',
    // Only when the map actually knows where they are. With location refused
    // there is no dot to point at, and a spotlight on an empty patch of map
    // saying "that's you" is worse than skipping the lesson — so it is
    // skipped, and the tour carries on to territory.
    gate: (facts) => onMap(facts) && facts.playerLocated === true,
    skipWhen: (facts) => onMap(facts) && facts.playerLocated === false,
    copy: () => ({
      title: "That's you.",
      lines: ['PASER follows you while you run.'],
    }),
  },

  {
    phase: PHASE.TERRITORY,
    host: 'root',
    target: TARGET.MAP_BOARD,
    interactive: false,
    dismiss: 'tap',
    skippable: true,
    kind: 'card',
    gate: onMap,
    // A brand new runner owns nothing, and the board around them may be empty
    // too. Both readings are true sentences about what is on screen; neither
    // requires a territory to exist for the step to work.
    copy: (facts) =>
      facts.ownsLand
        ? {
            title: 'Your colour is *your land*.',
            lines: ['Every other colour belongs to a runner.'],
          }
        : {
            title: 'Every colour belongs to a runner.',
            lines: ['Run to take ground of your own.'],
          },
  },

  {
    phase: PHASE.CORE_LOOP,
    host: 'root',
    target: null,
    interactive: false,
    dismiss: 'tap',
    skippable: true,
    kind: 'loop',
    copy: () => ({
      title: 'Run. Claim. Defend.',
      lines: ['Build your territory one run at a time.'],
    }),
  },

  {
    phase: PHASE.START_RUN,
    host: 'root',
    // The record button in the middle of the tab bar: the app's own way in,
    // reachable from every tab, and the one a runner will use for the rest of
    // their time with PASER. No copy of it is drawn here — the real button
    // takes the real press, through the hole.
    target: TARGET.START_RUN,
    interactive: true,
    dismiss: 'action',
    skippable: true,
    kind: 'card',
    enterHaptic: 'light',
    copy: () => ({
      title: 'Ready?',
      lines: ['Tap here to *start your run*.'],
    }),
  },

  {
    phase: PHASE.ACTIVE_RUN,
    host: 'record',
    target: TARGET.RUN_ROUTE,
    interactive: false,
    // Takes itself away. A runner mid stride must not have to tap through
    // anything, and nothing here is worth interrupting a run for.
    dismiss: 'auto',
    autoMs: ACTIVE_RUN_MS,
    skippable: false,
    kind: 'card',
    gate: (facts) => facts.running === true,
    copy: () => ({
      title: 'Your route appears as you run.',
      lines: ["Just run normally. We'll handle the rest."],
    }),
    on: { [SIGNAL.RUN_FINISHED]: PHASE.CLAIM_SELECT },
  },

  {
    phase: PHASE.FINISH_RUN,
    host: 'record',
    target: TARGET.FINISH_RUN,
    interactive: true,
    dismiss: 'action',
    skippable: false,
    kind: 'card',
    // Not the moment the run starts: "finish your run" over a run that has
    // covered forty metres is telling somebody to stop before they have
    // begun. It waits until the run has actually earned ground to place.
    gate: (facts) => facts.running === true && facts.runClaimable === true,
    // The control is a PRESS AND HOLD, so the copy says hold. Describing a
    // button as something it is not is how a tutorial gets blamed for a
    // control that does not work.
    copy: () => ({
      title: 'Done running?',
      lines: ['Hold *FINISH* to see what you can claim.'],
    }),
    on: { [SIGNAL.RUN_FINISHED]: PHASE.CLAIM_SELECT },
  },

  {
    phase: PHASE.CLAIM_SELECT,
    host: 'record',
    // The whole claim sheet, which holds the placement dial AND the claim
    // button. Lighting the pair keeps both live, so a runner who is happy
    // with where the land fell can simply claim it and skip ahead.
    target: TARGET.CLAIM_SHEET,
    interactive: true,
    dismiss: 'action',
    skippable: false,
    kind: 'card',
    gate: (facts) => facts.claimReady === true,
    copy: () => ({
      title: 'Your run earned you *territory*.',
      lines: ['Choose where you want to claim.'],
    }),
    on: {
      [SIGNAL.CLAIM_ADJUSTED]: PHASE.CLAIM_CONFIRM,
      [SIGNAL.CLAIM_PLACED]: PHASE.FIRST_CLAIM_SUCCESS,
      [SIGNAL.CLAIM_UNAVAILABLE]: PHASE.START_RUN,
    },
  },

  {
    phase: PHASE.CLAIM_CONFIRM,
    host: 'record',
    target: TARGET.CLAIM_BUTTON,
    interactive: true,
    dismiss: 'action',
    skippable: false,
    kind: 'card',
    gate: (facts) => facts.claimReady === true,
    copy: () => ({
      title: 'Looks good?',
      lines: ['*Claim it.*'],
    }),
    on: {
      [SIGNAL.CLAIM_PLACED]: PHASE.FIRST_CLAIM_SUCCESS,
      [SIGNAL.CLAIM_UNAVAILABLE]: PHASE.START_RUN,
    },
  },

  {
    phase: PHASE.FIRST_CLAIM_SUCCESS,
    host: 'record',
    target: null,
    interactive: false,
    dismiss: 'cta',
    cta: 'LET ME AT IT',
    skippable: false,
    kind: 'payoff',
    enterHaptic: 'success',
    // WAITS FOR THE REAL CELEBRATION TO FINISH. PASER already plays a flyover,
    // an encounter, a radial reveal and a victory beat when a claim lands;
    // this is the sentence after all of that, not a card on top of it.
    gate: (facts) => facts.claimCelebrated === true,
    copy: () => ({
      title: "IT'S YOURS!",
      lines: ['Keep running to grow your territory.'],
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

/** True when this phase's card belongs to the given overlay host. */
export function stepHost(phase) {
  return BY_PHASE[phase]?.host || null;
}
