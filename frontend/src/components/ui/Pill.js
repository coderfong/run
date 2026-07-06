// Pill — a small rounded chip. Variants: tint (soft fill), solid, outline.
// Optional leading colored dot. Used for clan tags, league chips, filters.

import React from 'react';
import { Text, View } from 'react-native';

import { colors, radius, space, type, withAlpha } from '../../theme';

export default function Pill({
  label,
  color = colors.primary,
  variant = 'tint',
  dot = false,
  textColor,
  style,
}) {
  const bg =
    variant === 'solid' ? color : variant === 'outline' ? 'transparent' : withAlpha(color, 0.14);
  const fg = textColor || (variant === 'solid' ? '#fff' : color);
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
          ...(variant === 'outline' ? { borderWidth: 1, borderColor: color } : {}),
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} /> : null}
      <Text style={[type.labelSm, { color: fg, textTransform: 'none', letterSpacing: 0.2 }]}>
        {label}
      </Text>
    </View>
  );
}
