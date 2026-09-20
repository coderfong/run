// Contextual micro tutorials: one card, the first time a runner opens
// something, and never again.
//
// NOT PART OF THE CORE FLOW and never shown during it. PASER's secondary
// systems — clubs, the boards, everything you have earned, somebody attacking
// your land — are things you meet weeks apart, and front-loading them into the
// first five minutes is how an onboarding turns into a manual. Each of these
// waits until the runner is actually looking at the thing it describes.
//
// A tip is dismissed by ONE tap anywhere. There is no Next, no dots and no
// second card: if a system needs two cards to introduce, it needs a better
// screen, not a longer tip.

import { TIP } from './progress';
import { TARGET } from './targets';

export const TIPS = {
  [TIP.CLUB]: {
    key: TIP.CLUB,
    target: TARGET.CLUB_MAIN,
    title: 'Run together.',
    lines: ['Join a club and compete as a *team*.'],
  },

  [TIP.LEADERBOARD]: {
    key: TIP.LEADERBOARD,
    target: TARGET.LEADERBOARD_MAIN,
    title: "See who's taking over.",
    lines: ['Your runs move you up the *rankings*.'],
  },

  [TIP.PROGRESSION]: {
    key: TIP.PROGRESSION,
    target: TARGET.YOU_MAIN,
    // "Everything you've earned" is the honest description of this page: it
    // carries the runner, their rank, their level, their land and their gear.
    title: "Everything you've earned lives here.",
    lines: ['Levels, rank, land and cosmetics.'],
  },

  [TIP.DEFENSE]: {
    key: TIP.DEFENSE,
    // No target: this one arrives on top of whatever screen the runner happens
    // to be on, behind the banner that told them. There is nothing on screen
    // to point at, and inventing something to light would be a lie.
    target: null,
    title: 'Someone wants your territory 👀',
    lines: ['Run again to *defend it*.'],
  },
};

export function tipFor(key) {
  return TIPS[key] || null;
}

export { TIP };
