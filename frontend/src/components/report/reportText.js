// The post-run report's type scale, in one place.
//
// The recap is three cards (the result, the territory report, the splits),
// and each one used to pick its own sizes: an uppercase display title on one,
// a muted eyebrow on the next, a third weight for the same kind of figure on
// the last. Read top to bottom it looked like three reports pasted together.
// Every text on those cards now comes from this map, so a label is a label and
// a figure is a figure wherever it sits.
//
// Built from the theme's own `type` scale and palette; this only decides which
// step each role takes. Colour is the palette's, never an accent: accents are
// set by the caller on the one or two things that earn them.

export function reportText(type, colors) {
  return {
    // The card's name: "Territory report", "Splits". Sentence case on the
    // display face, not the condensed uppercase title, so a card heading
    // never shouts louder than the number it introduces.
    cardTitle: { ...type.heading, color: colors.text },
    // The one line under a card title.
    cardSub: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    // A group inside a card: "Your form".
    sectionLabel: { ...type.labelSm, color: colors.textMuted },

    // The screen's headline figure and its name.
    heroValue: { ...type.statHero },
    heroUnit: { ...type.statMd, color: colors.textMuted },
    heroLabel: { ...type.bodyBold, color: colors.text },

    // A card's own lead figure (the standing, in the report).
    leadValue: { ...type.stat, color: colors.text },

    // Every other figure: stat grids, report rows, split paces.
    statLabel: { ...type.labelSm, color: colors.textMuted },
    statValue: { ...type.statSm, color: colors.text },
    statUnit: { ...type.caption, color: colors.textMuted },

    // A row's name when it reads as words rather than as a grid eyebrow.
    rowLabel: { ...type.bodySm, color: colors.text },
    body: { ...type.caption, color: colors.textMuted },
  };
}
