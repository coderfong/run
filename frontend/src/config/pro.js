// PASER PRO — the plans, and the line that decides what PRO is allowed to be.
//
// WHAT PRO SELLS: knowledge, expression and depth. Planning a route before you
// run it, reading your own history, seeing a rivalry in detail, filtering a
// leaderboard, wearing something rare.
//
// WHAT PRO NEVER SELLS: power. Not more land, not stronger land, not slower
// decay, not cheaper energy, not a better steal, not a place on the board, and
// never the ability to see where you actually rank. The moment somebody can
// think "they beat me because they pay", the competitive game stops being
// worth playing for everyone who doesn't. The backend holds the same line in
// app/entitlements.py; this file is the client half of it.
//
// The ids must match `pro_products` in backend/app/config.py, and both must
// exist in ONE subscription group in App Store Connect and the Play Console.
// One group is what makes monthly and annual alternatives to each other:
// across two groups a runner switching plans would be billed for both.

export const PRO_MONTHLY = 'paser_pro_monthly';
export const PRO_ANNUAL = 'paser_pro_annual';

// PRO's colour wherever it is named: the gold reward track, the pitch card's
// frame tint, the paywall. Lives here rather than in a component so a screen
// can tint itself PRO without importing the paywall to do it.
export const GOLD = '#eab308';

export const PRO_PRODUCTS = [PRO_MONTHLY, PRO_ANNUAL];

// Shown only until the store answers with real, storefront-localized prices.
// Never used to CHARGE anything, and never shown next to a currency the device
// isn't actually in — see the fallback handling in the paywall.
export const PLANS = [
  {
    id: PRO_MONTHLY,
    label: 'Monthly',
    fallbackPrice: '$4.99',
    period: 'month',
  },
  {
    id: PRO_ANNUAL,
    label: 'Yearly',
    fallbackPrice: '$39.99',
    period: 'year',
    // Worked out from the fallbacks above and replaced with the real
    // saving once both store prices land, so this can never advertise a
    // discount the storefront doesn't actually give.
    badge: 'Best value',
  },
];

// What the paywall lists. Deliberately all depth, no power: read the header.
// Every icon name here must exist in components/AppIcon.js — an unknown one
// renders as nothing at all rather than erroring, which is a blank row nobody
// notices in review.
export const PRO_PERKS = [
  ['route', 'Plan a route and see the land it would take'],
  ['layers', 'Territory intelligence overlays'],
  ['steal', 'Full head to head history with your rivals'],
  ['streak', 'Deep running and territory analytics'],
  ['trophy', 'Every leaderboard filter and your rank over time'],
  ['sparkles', 'Exclusive trails, share cards and capture styles'],
];
