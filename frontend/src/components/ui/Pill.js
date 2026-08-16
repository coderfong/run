// Pill — a small chip. Variants: tint (soft fill), solid, outline. Optional
// leading colored dot. Used for clan tags, league chips, filters.
//
// EVERY variant now carries a stroke. The neo-brutalist badge is a flat block
// with a hard edge round it, and the old `tint` variant — a 14% wash of the
// colour with no edge at all — was the single softest thing in the app: on
// paper it read as a faint smudge, and it was doing most of the work of making
// clan tags and league chips look tentative.
//
// The stroke is `strokeThin`. A chip is about 26pt tall and 3pt of ink at that
// size closes up the counters in the label.

import React from 'react';
import { Text, View } from 'react-native';

import { NB, nbInk, radius, space, withAlpha, useTheme, useThemedType } from '../../theme';

export default function Pill({
  label,
  color,
  variant = 'tint',
  dot = false,
  textColor,
  style,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const col = color ?? colors.primary;
  const bg =
    variant === 'solid' ? col : variant === 'outline' ? 'transparent' : withAlpha(col, 0.14);
  const fg = textColor || (variant === 'solid' ? '#fff' : col);
  // `outline` has no fill of its own, so its stroke is really sitting on the
  // page — and a tint is thin enough that the page is what shows through it.
  const stroke = nbInk(scheme, variant === 'solid' ? col : colors.bg);
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
