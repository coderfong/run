// Screen — the standard page container. Handles safe area, background per
// theme, the standard gutter, and optional scroll. Screens compose this
// instead of a raw <View> with a background.

import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, darkColors, space } from '../../theme';

export default function Screen({
  children,
  scroll = false,
  dark = false,
  gutter = true,
  edges = ['top'],
  style,
  contentStyle,
  refreshControl,
  center = false,
}) {
  const insets = useSafeAreaInsets();
  const bg = dark ? darkColors.bg : colors.bg;
  const pad = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingHorizontal: gutter ? space.gutter : 0,
  };

  if (scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: bg }, style]}>
        <ScrollView
          contentContainerStyle={[pad, contentStyle]}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[
        { flex: 1, backgroundColor: bg },
        pad,
        center && { justifyContent: 'center', alignItems: 'center' },
        style,
      ]}
    >
      {children}
    </View>
  );
}
