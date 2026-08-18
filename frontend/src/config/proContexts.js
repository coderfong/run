// What the paywall says, depending on what the runner was doing when it opened.
//
// ONE sheet, nine arguments. The alternative — a subscription screen per
// feature — is how an app ends up with four paywalls that drift apart until
// three of them are missing the renewal disclosure and the build gets rejected.
// components/BuyProSheet.js is still the only sheet, still carries the whole
// guideline 3.1.2 block, and takes one of these as `context`.
//
// WHY IT MATTERS THAT THESE DIFFER. A paywall that says "PASER PRO — unlock
// everything" is answering a question nobody asked. Somebody who just tapped
// "Vulnerable territories" on the map has a specific, live question, and the
// sheet's job is to answer THAT one. The generic pitch is what they get when
// they walked in through the Profile hub deliberately, and only then.
//
// RULES FOR EDITING THIS FILE
//
//   * `perks` must describe knowledge, expression or depth. Never power. The
//     test in __tests__/proContexts.test.js fails the build on words like
//     "more energy" or "stronger", because this is where pay-to-win would
//     enter PASER first: in copy, a release before it enters the code.
//   * Every `icon` must exist in components/AppIcon.js. An unknown name renders
//     as nothing, which is a blank row nobody notices in review.
//   * `source` must be a member of SOURCES in src/analytics.js, or the funnel
//     silently forks in two.
//   * No dashes in runner-facing copy (house rule). `·` is the separator.

import { PRO_PERKS } from './pro';

// The fallback pitch: what PRO is when the runner did not arrive from any
// feature in particular. Deliberately the same copy the sheet has always
// carried, so opening PRO from the Profile hub is unchanged.
export const DEFAULT_CONTEXT = {
  key: 'default',
  source: 'profile',
  title: 'PASER PRO',
  subtitle:
    'Plan your ground, read your history, know your rivals. Every claim, every metre of land and every place on the board stays exactly as free as it is today.',
  perks: PRO_PERKS,
  cta: null, // null → the sheet's standard "Subscribe · price per period"
};

// Each entry overrides only what it needs. Everything absent falls back to
// DEFAULT_CONTEXT, including the perk list, so a new context is one small
// object rather than a copy of the whole pitch.
export const PRO_CONTEXTS = {
  // --- the map ------------------------------------------------------------
  territory_planner: {
    source: 'map_planner',
    title: 'Plan smarter. Capture more.',
    subtitle:
      'Draw a route before you run it and see the ground it crosses · yours, theirs and the open land in between.',
    perks: [
      ['route', 'Unlimited route planning, on any ground'],
      ['layers', 'See whose land a route crosses before you go'],
      ['steal', 'Spot the plots worth taking back'],
      ['streak', 'Deep running and territory analytics'],
    ],
    cta: 'Unlock Territory Planner',
  },

  territory_intelligence: {
    source: 'map_intelligence',
    title: 'Read the whole board.',
    subtitle:
      'Intelligence layers over the land you can already see · what is ageing, what is contested, and which of yours is about to go.',
    perks: [
      ['layers', 'Territory age, contested ground and strongholds'],
      ['claim', 'Your own land, ranked by what expires first'],
      ['route', 'Plan a route and see the land it would take'],
      ['streak', 'Deep running and territory analytics'],
    ],
    cta: 'Unlock territory intelligence',
  },

  // --- after a run --------------------------------------------------------
  run_insights: {
    source: 'result',
    title: "There's more behind this run.",
    subtitle:
      'Understand your territory gains, your rival impact and where this run sits against your own recent form.',
    perks: [
      ['streak', 'This run against your last 30 days'],
      ['claim', 'Which of your land is about to decay'],
      ['trophy', 'Every leaderboard filter and your rank over time'],
      ['steal', 'Full head to head history with your rivals'],
    ],
    cta: 'See the full analysis',
  },

  run_detail: {
    source: 'run_detail',
    title: 'Read the run properly.',
    subtitle:
      'How this one compares to the rest of your running, and what it did for the ground you hold.',
    perks: [
      ['streak', 'Pace and distance trends across your runs'],
      ['route', 'Land earned per kilometre, run by run'],
      ['claim', 'Territory efficiency and what it cost you'],
      ['trophy', 'Your rank over time'],
    ],
    cta: 'See the full analysis',
  },

  // --- people -------------------------------------------------------------
  rival_insights: {
    source: 'rival_detail',
    title: 'Know your rival.',
    subtitle:
      'The complete head to head · streaks, defence rates, current form and the ground you keep meeting on. Who is winning stays free.',
    perks: [
      ['steal', 'Full head to head history'],
      ['claim', 'The ground you two keep fighting over'],
      ['streak', 'Momentum and current form'],
      ['trophy', 'Every leaderboard filter and your rank over time'],
    ],
    cta: 'View full rivalry',
  },

  leaderboard_history: {
    source: 'leaderboard',
    title: 'See where you are going.',
    subtitle:
      'Your rank over time, every window and every field. Where you stand today is free, and always will be.',
    perks: [
      ['trophy', 'Weekly, monthly and all time boards'],
      ['locate', 'Local and club only fields'],
      ['streak', 'Your rank over time'],
      ['claim', 'Land gained and lost across the season'],
    ],
    cta: 'Unlock every board',
  },

  // --- expression ---------------------------------------------------------
  cosmetics: {
    source: 'avatar',
    title: 'Make your runner yours.',
    subtitle:
      'The PASER PRO collection · pieces that never appear on the free ladder or in the shop.',
    perks: [
      ['sparkles', 'Exclusive trails, share cards and capture styles'],
      ['customize', 'The full PRO wardrobe'],
      ['crown', 'Rare pieces with no other route in'],
      ['route', 'Plan a route and see the land it would take'],
    ],
    cta: 'Unlock the PRO collection',
  },

  share: {
    source: 'share',
    title: 'Post it properly.',
    subtitle:
      'Premium share cards for the runs worth showing. Every free card stays free, and stays good.',
    perks: [
      ['share', 'Premium share card styles'],
      ['sparkles', 'Exclusive trails, share cards and capture styles'],
      ['customize', 'The full PRO wardrobe'],
      ['streak', 'Deep running and territory analytics'],
    ],
    cta: 'Unlock premium cards',
  },

  season: {
    source: 'season',
    title: 'Take the season further.',
    subtitle:
      'The PRO reward lane, plus every board filter for reading where the season is actually going.',
    perks: [
      ['sparkles', 'The PRO reward lane, all season'],
      ['trophy', 'Every leaderboard filter and your rank over time'],
      ['customize', 'The full PRO wardrobe'],
      ['streak', 'Deep running and territory analytics'],
    ],
    cta: null,
  },

  progression: {
    source: 'progression',
    title: 'Every tier, both lanes.',
    subtitle:
      'The PRO lane runs alongside the free one all the way to fifty. Levels and rewards you have already earned are yours either way.',
    perks: [
      ['sparkles', 'The PRO reward lane, every level'],
      ['crown', 'Rare pieces with no other route in'],
      ['customize', 'The full PRO wardrobe'],
      ['route', 'Plan a route and see the land it would take'],
    ],
    cta: null,
  },

  // --- deliberate destinations -------------------------------------------
  profile: DEFAULT_CONTEXT,

  home: {
    source: 'home',
    title: 'Get more from every run.',
    subtitle:
      'Strategy, insights and exclusive styles. The running, the claiming and the board stay exactly as they are.',
    perks: PRO_PERKS,
    cta: null,
  },

  onboarding: {
    source: 'onboarding',
    title: 'PASER PRO',
    subtitle:
      'Take PASER further whenever you want to. Nothing here is needed to run, to claim ground or to climb the board.',
    perks: [
      ['route', 'Plan territory runs'],
      ['streak', 'Advanced insights'],
      ['customize', 'Exclusive customisation'],
    ],
    cta: null,
  },
};

/**
 * Resolve a context key into the full object the sheet renders.
 *
 * Unknown keys fall back to the default pitch rather than throwing. A paywall
 * that crashes because somebody typo'd a source is strictly worse than a
 * paywall that makes the generic argument.
 */
export function proContext(key) {
  if (!key) return DEFAULT_CONTEXT;
  const found = PRO_CONTEXTS[key];
  if (!found) {
    if (__DEV__) console.warn(`[pro] unknown paywall context "${key}"`);
    return DEFAULT_CONTEXT;
  }
  return { ...DEFAULT_CONTEXT, ...found, key };
}

export default PRO_CONTEXTS;
