// Theme switch — System / Light / Dark. Reads and writes the persisted
// preference from ThemeProvider. Drop into Profile/Settings once the app-wide
// light-mode sweep is complete (until then, only converted screens respond).
//
//   import ThemeToggle from '../components/ThemeToggle';
//   ...
//   <ThemeToggle />

import React from 'react';
import { Text, View } from 'react-native';

import { radius, type, useTheme } from '../theme';
import { PressableScale } from '../ui/motion';

const OPTIONS = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export default function ThemeToggle({ style }) {
  const { colors, preference, setPreference } = useTheme();
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
      {OPTIONS.map((opt) => {
        const active = opt.key === preference;
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
            onPress={() => setPreference(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${opt.label} theme`}
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
