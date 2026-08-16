// Light theme surfaces — NEO-BRUTALIST PAPER.
//
// Was a cool desaturated off-white (#f7f8fa) with hairline borders and
// deliberately muted semantics, chosen so nothing competed with clan colours.
// That palette is the direct opposite of what this style needs, and it also
// made the hand-drawn frames read as photocopies: they were drawn on paper,
// and paper is warm.
//
// So: a warm paper page, white cards to sit on it, near-black type, and
// semantics turned back up to full saturation because flat saturated blocks
// are the point rather than a hazard. Clan colours keep their monopoly on
// TERRITORY, trails and stats; these only ever appear as chrome.

import { NB } from './nb';

export const colors = {
  bg: NB.paper,
  bgElevated: '#ece5d5',
  card: '#ffffff',
  cardAlt: '#f5f1e6',

  // Kept as a genuine HAIRLINE, not the neo-brutalist stroke. Forty-nine call
  // sites read this token and most of them are dividers, sheet grabbers and
  // input rules; promoting it to 3pt ink would blacken all of them at once,
  // including several that should stay quiet. The heavy stroke is `ink`, and
  // components opt into it deliberately. This value is only warmed to match
  // the paper.
  border: '#d9d2c0',

  // The neo-brutalist stroke. See `nbInk` for picking it against a surface.
  ink: NB.ink,

  text: '#0c0c10',
  textMuted: '#5c5a55',
  textDim: '#8f8b82',

  primary: '#0c0c10', // brand ink — neutral CTA where there is no clan yet
  primaryDark: '#000000',
  primaryInk: '#ffffff',

  // Saturated, unlike the old palette. A neo-brutalist success banner is a
  // solid green block with a black stroke round it, and a desaturated sage
  // block reads as disabled.
  ok: '#2fbf71',
  // Amber, not the accent yellow. Two of the four call sites tint an ICON with
  // this, and #ffd54a on paper is barely there at icon weight. Where a yellow
  // BLOCK is wanted (a chip, a banner fill, a hard shadow) the component reaches
  // for `nbAccents.yellow` directly, which is free to be as bright as it likes
  // because it always has a black stroke round it.
  warn: '#d98324',
  danger: '#ff5252',
  dangerSoft: '#ffe0e0',
};
