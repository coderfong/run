// Pill — a small chip. Variants: tint, solid, outline. Optional leading
// colored dot. Used for clan tags, league chips, filters.
//
// EVERY variant carries a stroke, and `tint` IS `solid` now. The neo-brutalist
// badge is a flat block with a hard edge round it, and `tint` used to be a 14%
// wash of the colour with no edge at all — the single softest thing in the app.
// On paper it read as a faint smudge, and it was doing most of the work of
// making clan tags and league chips look tentative. The two variants are kept
// separate only so the fourteen call sites do not all have to change; if one
// ever needs to be quiet again it should say `outline`.
//
// A pill with NO colour deals itself one from the deck. That is the other half
// of the change: most metadata chips (a level, a member count, a paser total)
// used to pass `colors.textMuted` and came out grey, which is exactly the chip
// the reference boards make brightest.
//
// The stroke is `strokeThin`. A chip is about 26pt tall and 3pt of ink at that
// size closes up the counters in the label.

import React from 'react';
import { Text, View } from 'react-native';

import { NB, nbAccentFor, nbInk, nbTextOn, radius, space, useTheme, useThemedType } from '../../theme';

export default function Pill({
  label,
  color,
  variant = 'tint',
  dot = false,
  textColor,
  // Seeds the dealt colour when the label is not distinctive enough — two
  // chips both reading "Solo" would otherwise always land on the same hue.
  seed,
  style,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const col = color ?? nbAccentFor(seed ?? label);
  const bg = variant === 'outline' ? 'transparent' : col;
  // Judged against the fill, not fixed white: the deck runs from yellow to
  // purple, and white on yellow is the failure this exists to prevent.
  const fg = textColor || (variant === 'outline' ? col : nbTextOn(col));
  // `outline` has no fill of its own, so its stroke sits on the page.
  const stroke = nbInk(scheme, variant === 'outline' ? colors.bg : col);
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          paddingHorizontal: space.md,
          paddingVertical: 5,
          backgroundColor: bg,
          borderWidth: NB.strokeThin,
          // The outline variant keeps its own colour as the stroke — that IS
          // the variant. The other two take the scheme's ink, so a row of
          // mixed chips reads as one set rather than as a colour chart.
          borderColor: variant === 'outline' ? col : stroke,
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: col }} /> : null}
      <Text style={[type.labelSm, { color: fg, textTransform: 'none', letterSpacing: 0.2 }]}>
        {label}
      </Text>
    </View>
  );
}
