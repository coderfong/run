// Season leaderboard selector art.
//
// Each board owns a cut-out illustration and the flat panel colour it sits on,
// in Home's hero-card format: black copy on the left, characters on the right,
// no scrim. `source` is the TRANSPARENT cut-out produced by
// `scripts/cut-header-art.py` from the original full-bleed square in
// assets/art/season/ — those had their background baked in, so they could only
// ever be used behind a scrim with white text over them.
//
// `bg` is derived from the art's own baked ground, lightened until it clears
// 4.5:1 against the ink copy (the floor Home's purple card already sits at).
// Keeping the hue means each board still reads as its own colour; keeping the
// contrast means the title stays legible on it. Re-tint one of these and the
// ratio has to be re-checked — black type on the old #254FD2 was unreadable.

export const SEASON_SCOPE_ART = Object.freeze({
  clans: {
    source: require('../../assets/art/panel/clubs.png'),
    bg: '#008C8F',
  },
  solo: {
    source: require('../../assets/art/panel/solo.png'),
    bg: '#AC57DA',
  },
});

export const SEASON_CATEGORY_ART = Object.freeze({
  land: {
    source: require('../../assets/art/panel/land.png'),
    bg: '#D55154',
  },
  claims: {
    source: require('../../assets/art/panel/claims.png'),
    bg: '#FF7017',
  },
  captures: {
    source: require('../../assets/art/panel/captures.png'),
    bg: '#F54D09',
  },
  defenses: {
    source: require('../../assets/art/panel/defenses.png'),
    bg: '#5277EA',
  },
  distance: {
    source: require('../../assets/art/panel/distance.png'),
    bg: '#0CA1C4',
  },
});

export const SEASON_ART_BACKGROUNDS = Object.freeze([
  ...Object.values(SEASON_SCOPE_ART).map((item) => item.bg),
  ...Object.values(SEASON_CATEGORY_ART).map((item) => item.bg),
]);
