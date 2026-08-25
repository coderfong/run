// Share card styles — named looks for the card, free and PRO.
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
// A FREE PRESET MAY SET A PRO CONTROL, and that is on purpose. Accent,
// placement and the choice of stats are padlocked as CONTROLS (2026-08-24), but
// "Clean" is a curated look that happens to be centred, and gating the free
// looks behind the same padlock would leave one free style that changes
// nothing. The line is: you cannot dial your own colour and position without
// PRO; you can always pick a look somebody drew for you.
//
// PREVIEW IS ALWAYS FREE. Selecting a PRO style applies it to the real card,
// with the runner's real run, at full size. The gate is on EXPORT — saving,
// posting or sending it. Somebody has to see the thing on their own run to
// want it, and a blurred thumbnail sells nothing.
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
  // --- free ---------------------------------------------------------------
  {
    key: 'classic',
    label: 'Classic',
    pro: false,
    // null = leave the control exactly where the runner put it. The free
    // default deliberately changes nothing at all, so the card everybody has
    // always had is still one tap away after this feature exists.
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

  // --- PRO ----------------------------------------------------------------
  {
    key: 'neon',
    label: 'Neon',
    pro: true,
    preset: {
      accent: '#2DD4BF',
      align: 'left',
      showRoute: true,
      showCharacter: true,
    },
  },
  {
    key: 'showcase',
    label: 'Character showcase',
    pro: true,
    // The runner, big, with the numbers pulled back to the three that fit
    // beside them. The one card that is about the person rather than the run.
    preset: {
      accent: '#8B5CF6',
      align: 'center',
      showRoute: false,
      showCharacter: true,
      statKeys: CORE_STATS,
    },
  },
  {
    key: 'battle',
    label: 'Rival battle',
    pro: true,
    preset: {
      accent: '#EC4899',
      align: 'left',
      showRoute: true,
      showCharacter: true,
    },
    // Only offered on a run that actually took ground off somebody. A "Rival
    // battle" card for a quiet solo jog is a lie about the run, and the
    // runner's followers are the ones being told it.
    availableFor: (run) => Number(run?.stolen_m2 || 0) > 0 || Number(run?.rivals_taken || 0) > 0,
  },
  {
    key: 'gold',
    label: 'Gold',
    pro: true,
    preset: {
      accent: '#F5B32C',
      align: 'center',
      showRoute: true,
      showCharacter: true,
    },
  },
];

export const PRO_SHARE_STYLES = SHARE_STYLES.filter((s) => s.pro);

export function shareStyleByKey(key) {
  return SHARE_STYLES.find((s) => s.key === key) || SHARE_STYLES[0];
}

/**
 * The styles offered for THIS run. A style whose `availableFor` says no is
 * left out entirely rather than shown disabled: there is nothing the runner
 * could do about it, and a permanently greyed row just looks broken.
 */
export function stylesForRun(run) {
  return SHARE_STYLES.filter((s) => !s.availableFor || s.availableFor(run));
}
