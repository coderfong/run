// SectionHeader — a section title with an optional trailing action link.
// Standard section rhythm: 24 above (apply via margin at the call site).

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { colors, type } from '../../theme';

export default function SectionHeader({ title, action, onAction, style }) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
        style,
      ]}
    >
      <Text style={type.heading}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={[type.captionMedium, { color: colors.textMuted }]}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
