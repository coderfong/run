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
//   * No dashes in runner-facing copy, and no `·` between words either.

import { PRO_PERKS } from './pro';

// The fallback pitch: what PRO is when the runner did not arrive from any
// feature in particular. Deliberately the same copy the sheet has always
// carried, so opening PRO from the Profile hub is unchanged.
export const DEFAULT_CONTEXT = {
  key: 'default',
  source: 'profile',
  title: 'Upgrade for more perks',
  subtitle: '',
  perks: PRO_PERKS,
  cta: null, // null → the sheet's standard "Subscribe for <price> per <period>"
};

// Each entry overrides only what it needs. Everything absent falls back to
// DEFAULT_CONTEXT, including the perk list, so a new context is one small
// object rather than a copy of the whole pitch.
export const PRO_CONTEXTS = {
  // --- the map ------------------------------------------------------------
  territory_planner: {
    source: 'map_planner',
    title: 'Plan your route.',
    subtitle: 'Check the land before you run.',
    perks: [
      ['route', 'Unlimited route planning'],
      ['streak', 'Run and territory stats'],
    ],
    cta: 'Unlock Territory Planner',
  },

  territory_intelligence: {
    source: 'map_intelligence',
    title: 'View more map layers.',
    subtitle: 'See ageing, contested and expiring land.',
    perks: [
      ['route', 'Territory route planner'],
      ['streak', 'Run and territory stats'],
    ],
    cta: 'Unlock territory intelligence',
  },

  // --- after a run --------------------------------------------------------
  run_insights: {
    source: 'result',
    title: 'More run stats.',
    subtitle: 'See land, rivals and recent form.',
    perks: [
      ['streak', 'Compare with the last 30 days'],
      ['route', 'Territory route planner'],
    ],
    cta: 'See the full analysis',
  },

  run_detail: {
    source: 'run_detail',
    title: 'Run details.',
    subtitle: 'Compare this run with your others.',
    perks: [
      ['streak', 'Pace and distance trends'],
      ['route', 'Land per kilometre'],
    ],
    cta: 'See the full analysis',
  },

  // --- people -------------------------------------------------------------
  rival_insights: {
    source: 'rival_detail',
    title: 'Rival details.',
    subtitle: 'See history, form and contested land.',
    perks: [
      ['streak', 'Recent form'],
      ['route', 'Territory route planner'],
    ],
    cta: 'View full rivalry',
  },

  leaderboard_history: {
    source: 'leaderboard',
    title: 'Rank history.',
    subtitle: 'See every board and filter.',
    perks: [
      ['streak', 'Rank over time'],
      ['route', 'Territory route planner'],
    ],
    cta: 'Unlock every board',
  },

  // --- expression ---------------------------------------------------------
  cosmetics: {
    source: 'avatar',
    title: 'More styles.',
    subtitle: 'Unlock the PRO collection.',
    perks: [
      ['sparkles', 'Exclusive trails and cards'],
      ['route', 'Territory route planner'],
    ],
    cta: 'Unlock the PRO collection',
  },

  share: {
    source: 'share',
    title: 'Unlock everything',
    subtitle: 'Get the full PASER PRO experience',
    perks: PRO_PERKS,
    cta: 'Unlock premium cards',
  },

  season: {
    source: 'season',
    title: 'More season rewards.',
    subtitle: 'Get the PRO lane and every board filter.',
    perks: [
      ['sparkles', 'The PRO reward lane, all season'],
      ['streak', 'Run and territory stats'],
    ],
    cta: null,
  },

  progression: {
    source: 'progression',
    title: 'Unlock the PRO lane.',
    subtitle: 'Extra rewards up to level 50.',
    perks: [
      ['sparkles', 'The PRO reward lane, every level'],
      ['route', 'Territory route planner'],
    ],
    cta: null,
  },

  // --- deliberate destinations -------------------------------------------
  profile: DEFAULT_CONTEXT,

  home: {
    source: 'home',
    title: 'Upgrade for more perks',
    subtitle: '',
    perks: PRO_PERKS,
    cta: null,
  },

  onboarding: {
    source: 'onboarding',
    title: 'Upgrade for more perks',
    subtitle: '',
    perks: [
      ['route', 'Plan territory runs'],
      ['streak', 'More stats'],
      ['sparkles', 'Exclusive styles'],
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
