// The core tutorial, declared rather than coded.
//
// Every step is data: what it points at, what it says, what ends it, and what
// has to be true before it may appear at all. Nothing in here renders anything
// and nothing in here knows about React — which is the point. The overlay is
// one component that can draw any step, and adding, reordering or rewording a
// step is an edit to this file alone.
//
// WHAT THE CORE TUTORIAL TEACHES:
//
//   WORLD → GOAL → PRACTICE RUN (played on the real screens) → RIVAL
//   → CAPTURE → CROSSROADS → CUSTOMISE → SHOP → PROGRESS → DEFEND → REAL RUN
//
// The practice run plays on the real run, claim, recap and share screens,
// driven by an autopilot, and never reaches the network (run/tutorialRun.js).
// The beats after it are simulated inside the coach card. Neither writes a
// route, territory, purchase or rival.
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

// The run and claim screens are native modals, drawn above the root overlay.
// A root card reached while one is still up (the tour moves on the moment the
// practice claim has been celebrated, a beat before the autopilot closes the
// modal) must wait for it to close rather than draw where nobody can see it.
const RUN_ROUTES = new Set(['Record', 'Result', 'PlanAttack']);
const offRun = (facts) => !RUN_ROUTES.has(facts.route);

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
 * @property {(nav: object) => void} [onEnter]  run when the TOUR REACHES this
 *                                 step, not when it draws — a gated step is
 *                                 entered before it is allowed to show, which
 *                                 is what lets a step navigate to the screen
 *                                 its own gate is waiting for
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
    // NO NAVIGATION HERE. This step is entered the instant the tutorial arms,
    // and the Map tab does not exist that early — App.js mounts the tabs
    // lazily and only starts building the other three once the app has been
    // idle (see its `preloadDistance`). Jumping from here moved the tab index
    // onto a tab that had not been built, so the pager stayed on Home while
    // everything else believed it was on the map. Going to the map belongs to
    // the step that teaches the map, below.
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
    // THE STEP THAT NEEDS THE MAP IS THE STEP THAT ASKS FOR IT. Entered as
    // soon as the tour reaches this phase, which is when SHOW ME is pressed,
    // and gated on having arrived — so the lesson waits on Home, silently,
    // until the map is really the screen under it. The two halves are not a
    // contradiction: `onEnter` runs when the tour reaches a step, `gate` when
    // it is allowed to draw. See the step lifecycle in TutorialContext.
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
    // THE GOAL, said as a goal. "Run. Claim. Defend." named three verbs and
    // told a new runner nothing about what they were for. The ladder under
    // it still draws the three, so the title is free to say why.
    copy: () => ({
      title: 'Your goal: *own your city*.',
      lines: [
        'Every run you finish becomes *territory* on this map.',
        'Take ground from rivals and hold yours to climb the ranks.',
      ],
    }),
  },

  {
    phase: PHASE.TRAINING_RUN,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'START PRACTICE RUN', skippable: true, kind: 'training', scene: 'run',
    // The button opens the REAL run screen: ACTIVE_RUN's onEnter. From there
    // the practice plays itself all the way back to Home.
    copy: () => ({
      title: 'First, a practice run.',
      lines: ["We'll run *5 km* for you. Watch what happens."],
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
      title: 'Watch your *5 km* fly by.',
      lines: ['Your route draws itself as you run. This one is practice.'],
    }),
    on: { [SIGNAL.RUN_FINISHED]: PHASE.CLAIM_SELECT },
    // Reached from the practice card's button. The run screen sees this phase
    // and starts the simulated run itself (RunningScreen's autopilot).
    onEnter: (nav) => nav.goToRecord(),
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
      title: 'This is *Plan Attack*.',
      lines: ['You choose where your shape lands. We will place this one.'],
    }),
    // The practice claim is placed by ResultScreen's autopilot; a runner who
    // presses CLAIM HERE first simply gets there sooner. A practice run that
    // somehow has nothing to claim moves the tour on rather than rewinding
    // into a second practice.
    on: {
      [SIGNAL.CLAIM_PLACED]: PHASE.FIRST_CLAIM_SUCCESS,
      [SIGNAL.CLAIM_UNAVAILABLE]: PHASE.TRAINING_RIVAL,
    },
  },

  {
    phase: PHASE.FIRST_CLAIM_SUCCESS,
    host: 'record',
    target: null,
    interactive: false,
    // Takes itself away: the practice carries on to the recap and the share
    // page by itself, and a button here would be the one thing to press.
    dismiss: 'auto',
    autoMs: 3200,
    skippable: false,
    kind: 'payoff',
    enterHaptic: 'success',
    // WAITS FOR THE REAL CELEBRATION TO FINISH. PASER already plays a flyover,
    // an encounter, a radial reveal and a victory beat when a claim lands;
    // this is the sentence after all of that, not a card on top of it.
    gate: (facts) => facts.claimCelebrated === true,
    copy: () => ({
      title: "IT'S YOURS!",
      lines: ['Every real run claims territory just like this.'],
    }),
  },
  {
    phase: PHASE.TRAINING_RIVAL,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    gate: offRun,
    cta: 'ATTACK', skippable: true, kind: 'training', scene: 'rival',
    copy: () => ({
      title: 'A rival owns this ground.',
      lines: ['Claim across their land to *attack* it. Stronger runs win.'],
    }),
  },
  {
    phase: PHASE.TRAINING_CAPTURED,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'TAKE IT BACK', skippable: true, kind: 'training', scene: 'captured',
    copy: () => ({
      title: 'Rivals can capture you too.',
      lines: ['Run again to reclaim it, or reinforce nearby land.'],
    }),
  },
  {
    phase: PHASE.TRAINING_CROSSROADS,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'MEET THEM', skippable: true, kind: 'training', scene: 'crossroads',
    copy: () => ({
      title: 'Routes can cross.',
      lines: ['Crossroads remembers nearby runners. View, follow or remove them.'],
    }),
  },
  {
    phase: PHASE.TRAINING_CUSTOMISE,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'TRY A LOOK', skippable: true, kind: 'training', scene: 'customise',
    copy: () => ({
      title: 'Your runner is yours.',
      lines: ['Change outfits, colours and effects from *You*.'],
    }),
  },
  {
    phase: PHASE.TRAINING_SHOP,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'KEEP TOURING', skippable: true, kind: 'training', scene: 'shop',
    copy: () => ({
      title: 'The shop unlocks new style.',
      lines: ['Spend earned currency on cosmetics. Gear never buys power.'],
    }),
  },
  {
    phase: PHASE.TRAINING_PROGRESS,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'SHOW DEFENSE', skippable: true, kind: 'training', scene: 'progress',
    copy: () => ({
      title: 'Every run moves something.',
      lines: ['Missions earn rewards. Rankings and clubs track your season.'],
    }),
  },
  {
    phase: PHASE.TRAINING_DEFEND,
    host: 'root', target: null, interactive: false, dismiss: 'cta',
    cta: 'I AM READY', skippable: true, kind: 'training', scene: 'defend',
    copy: () => ({
      title: 'Build, attack, defend, repeat.',
      lines: ['Notifications warn you when land changes hands. Now run for real.'],
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
