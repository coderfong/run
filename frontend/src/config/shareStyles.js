// Share card styles — the named looks the sheet offers for the card.
//
// A STYLE IS A PRESET, NOT A NEW RENDERER. Every value below sets controls
// RunShareCard already has: accent, alignment, whether the route is drawn,
// whether the character is standing on it, which stats appear. That is a
// deliberate constraint, and it is what makes this safe to ship: a preset
// cannot crash a card, cannot fail to export, and cannot look different from
// what the preview showed. The share card is the one surface in this app with
// a crash history (see docs/SHARING.md and the share flag harness), so adding
// a second rendering path to it to sell a subscription would be a bad trade.
//
// TWO LOOKS, AND THE SHEET FITS ON ONE SCREEN. This list was five: Classic,
// Clean, and three PRO presets (Neon, Character showcase, Rival battle). They
// went on 2026-09-10, along with the Placement, Stats, Trail and Flip rows,
// because the sheet had become a settings page. Five named looks over the same
// three numbers are not five cards; they are one card in five accent colours,
// and each one cost a wrapped chip row on a screen that had to scroll past its
// own preview to reach the share buttons. Two looks — the card as it comes, and
// a centred one with the runner taken off — is the whole difference worth
// naming, and the rows underneath still reach the rest in one tap.
//
// The deleted presets are in git (this file at 2280d89) if a curated look is
// ever worth bringing back. Bring back at most one, and only into a row that
// does not wrap.
//
// WHAT PRO BUYS ON THIS SHEET is the Accent row: your own colour instead of
// your clan's. Picking a look has always been free, and now every look is.
//
// STYLES THAT ARE NOT HERE. "Animated", "Season Recap" and "Territory
// Takeover" were all asked for and none of them is a preset: the first needs a
// video encoder, the second needs season history the card is never given, the
// third needs the claim polygon drawn on the card. Each would be real work on
// the card itself. They are recorded in docs/PRO_BACKEND.md rather than
// half-built here, because a style that renders a plausible-looking
// approximation of a season recap is worse than no season recap.

// Stat keys must exist in RunShareCard's `availableStats` for the run, and the
// sheet filters them against it — a preset asking for a stat this particular
// run does not have simply drops it rather than rendering a blank tile.
//
// `time`, not `duration`: the key the card actually publishes is `time`, and
// this list said `duration` from the day it was written, so every preset using
// it silently dropped the clock and posted two numbers instead of three. A key
// added here has to be checked against `availableStats` — the filter that
// makes a wrong key safe is the same filter that makes it invisible.
const CORE_STATS = ['distance', 'pace', 'time'];

export const SHARE_STYLES = [
  {
    key: 'classic',
    label: 'Classic',
    pro: false,
    // Empty on purpose: Classic changes nothing, so the card as the sheet
    // first drew it is always one tap back.
    preset: {},
  },
  {
    key: 'clean',
    label: 'Clean',
    pro: false,
    preset: {
      align: 'center',
      showRoute: true,
      showCharacter: false,
      statKeys: CORE_STATS,
    },
  },
];

export function shareStyleByKey(key) {
  return SHARE_STYLES.find((s) => s.key === key) || SHARE_STYLES[0];
}

/**
 * The styles offered for THIS run.
 *
 * `availableFor` is the seam for a look that only makes sense on some runs —
 * "Rival battle" used it, so that it never appeared on a quiet solo jog — and
 * it is kept because a style that cannot honestly describe the run has to be
 * left out entirely rather than shown disabled: there is nothing the runner
 * could do about it, and a permanently greyed chip just looks broken. Neither
 * of the two looks here sets it, so today this returns both of them.
 */
export function stylesForRun(run) {
  return SHARE_STYLES.filter((s) => !s.availableFor || s.availableFor(run));
}
