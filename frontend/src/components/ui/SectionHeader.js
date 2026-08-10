// SectionHeader — a section title with an optional trailing action link.
// Standard section rhythm: 24 above (apply via margin at the call site).
//
// `accessory` sits BESIDE the title — a small flourish that belongs to the
// section, not a second row above it. Trophies uses it for the medal clip: as
// its own centred block the animation was 88pt of mostly-empty air between the
// heading and the shelf, which read as a hole rather than as decoration.
// Baseline alignment is dropped when one is present, because a View has no
// text baseline to sit on.

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { space, useTheme, useThemedType } from '../../theme';

export default function SectionHeader({ title, action, onAction, accessory, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: accessory ? 'center' : 'baseline',
          justifyContent: 'space-between',
        },
        style,
      ]}
    >
      {accessory ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 }}>
          <Text style={type.heading}>{title}</Text>
          {accessory}
        </View>
      ) : (
        <Text style={type.heading}>{title}</Text>
      )}
      {action ? (
        <TouchableOpacity onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={[type.captionMedium, { color: colors.textMuted }]}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
