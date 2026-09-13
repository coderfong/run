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
export const PRO_ANNUAL = 'paser_pro_yearly';

// PRO's colour wherever it is named: the gold reward track, the pitch card's
// frame tint, the paywall. Lives here rather than in a component so a screen
// can tint itself PRO without importing the paywall to do it.
export const GOLD = '#eab308';

export const PRO_PRODUCTS = [PRO_MONTHLY, PRO_ANNUAL];

// Shown only until the store answers with real, storefront-localized prices,
// and never used to CHARGE anything: Apple bills whatever the product costs in
// App Store Connect, never this string.
//
// PASER is sold in SINGAPORE ONLY, so these are the SGD prices a buyer is
// actually charged (read off App Store Connect 2026-08-25), not the US tiers
// the products were planned at. They were US dollars until then, which was
// wrong for every buyer the app has. `priceFor` is a plain `||` and does NOT
// check the storefront — an earlier version of this comment claimed it did —
// so whatever is written here is what a failed lookup advertises.
//
// The same storefront rule is why a US test account sees US prices here on a
// Singapore-only app: StoreKit answers for the ACCOUNT's storefront, not the
// app's market. That is not a bug, and it is the usual reason a device looks
// like it disagrees with App Store Connect. `fetchProductPrices` warns in dev
// whenever a lookup falls back rather than answering.
export const PLANS = [
  {
    id: PRO_MONTHLY,
    label: 'Monthly',
    fallbackPrice: 'S$4.98',
    period: 'month',
  },
  {
    id: PRO_ANNUAL,
    label: 'Yearly',
    fallbackPrice: 'S$39.98',
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
  ['route', 'Territory route planner'],
  ['layers', 'Territory map layers'],
  ['steal', 'Rival history'],
  ['streak', 'Run and territory stats'],
  ['trophy', 'Rank history and filters'],
  ['sparkles', 'Exclusive styles'],
];
