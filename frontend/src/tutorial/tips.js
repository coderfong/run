// Contextual first-visit tips: one small card, the first time a runner opens
// something, and never again.
//
// NOT PART OF THE CORE TUTORIAL and never shown during it. The core teaches
// run, claim, defend, rank; everything else waits until the runner actually
// reaches it, and is then introduced in one card.
//
// THE RULES FOR A TIP. One title, one or two short sentences, one explicit
// button. It never navigates, never scrolls, never moves a map and never
// starts a second card. A tip that needs two cards needs a better screen.
//
// `host` works as it does for steps: 'root' for the tabs, 'auto' for a tip
// that can arrive inside the run/claim modal.

import { TIP } from './progress';
import { TARGET } from './targets';

export const TIPS = {
  [TIP.MAP]: {
    key: TIP.MAP,
    target: null,
    host: 'root',
    title: 'This is your *city*',
    lines: ['Coloured areas are territory. Your colour is your land.'],
  },

  // Only after the runner taps somebody else's territory on the map.
  [TIP.MAP_TERRITORY]: {
    key: TIP.MAP_TERRITORY,
    target: null,
    host: 'root',
    title: 'Runners can take each other’s land',
    lines: ['Stronger territory is harder to take.'],
  },

  [TIP.MISSIONS]: {
    key: TIP.MISSIONS,
    target: null,
    host: 'root',
    title: 'Daily *missions*',
    lines: ['Complete these while you run to earn extra rewards.'],
  },

  [TIP.SHOP]: {
    key: TIP.SHOP,
    target: null,
    host: 'root',
    title: 'Water point',
    lines: ['Spend your coins on cosmetics and rotating stock.'],
  },

  [TIP.CLUB]: {
    key: TIP.CLUB,
    target: TARGET.CLUB_MAIN,
    host: 'root',
    title: 'Run together',
    lines: ['Join a club and claim territory as a *team*.'],
  },

  [TIP.RIVALS]: {
    key: TIP.RIVALS,
    target: null,
    host: 'root',
    title: '*Rivals*',
    lines: ['These are runners competing for nearby territory.'],
  },

  [TIP.RANK]: {
    key: TIP.RANK,
    target: null,
    host: 'auto',
    title: 'Your *rank*',
    lines: ['Hold territory to earn rank points and climb the ladder.'],
  },

  [TIP.SHARE]: {
    key: TIP.SHARE,
    target: null,
    host: 'auto',
    title: 'Want to share your run?',
    lines: [],
    // Two explicit choices. The screen that asked for the tip says what "Try
    // sharing" does; the tip itself never navigates.
    cta: 'TRY SHARING',
    dismissLabel: 'Not now',
  },

  [TIP.FIRST_REAL_CLAIM]: {
    key: TIP.FIRST_REAL_CLAIM,
    target: null,
    host: 'auto',
    title: 'Your first real *claim*',
    lines: ['Choose where this run becomes territory.'],
  },

  [TIP.LEADERBOARD]: {
    key: TIP.LEADERBOARD,
    target: TARGET.LEADERBOARD_MAIN,
    host: 'root',
    title: "See who's taking over",
    lines: ['Your runs move you up the *rankings*.'],
  },

  [TIP.PROGRESSION]: {
    key: TIP.PROGRESSION,
    target: TARGET.YOU_MAIN,
    host: 'root',
    title: "Everything you've earned",
    lines: ['Levels, rank, land and cosmetics.'],
  },

  [TIP.DEFENSE]: {
    key: TIP.DEFENSE,
    // Arrives on top of whatever screen the runner is on, behind the banner
    // that told them. Nothing on screen to point at.
    target: null,
    host: 'auto',
    title: 'Someone wants your territory',
    lines: ['Run through it again to *defend* it.'],
  },
};

export function tipFor(key) {
  return TIPS[key] || null;
}

export { TIP };
