// Segmented — a flat two-or-more option toggle. Active segment fills with a
// surface step (no accent flood — the map/clan colors own saturation).

import React from 'react';
import { Text, View } from 'react-native';

import { radius, useTheme, useThemedType } from '../../theme';
import { PressableScale } from '../../ui/motion';

export default function Segmented({ options, value, onChange, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: colors.bgElevated,
          borderRadius: radius.pill,
          padding: 3,
          gap: 4,
        },
        style,
      ]}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <PressableScale
            key={opt.key}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: radius.pill,
              alignItems: 'center',
              backgroundColor: active ? colors.card : 'transparent',
            }}
            onPress={() => onChange(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[type.bodySmBold, { color: active ? colors.text : colors.textMuted }]}>
              {opt.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
