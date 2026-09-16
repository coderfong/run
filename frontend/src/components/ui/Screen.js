// Screen — the standard page container. Handles safe area, background per
// theme, the standard gutter, and optional scroll. Screens compose this
// instead of a raw <View> with a background.
//
// On the night palette the ground is textured: PageTexture lays the dot grid
// under everything, fixed to the window while the content scrolls over it. A
// caller that repaints the ground (a `backgroundColor` in `style`, nearly always
// 'transparent' over a painted backdrop) gets no grid, because the grid belongs
// to the page colour and would otherwise print dots across the painting.

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { darkColors, space, useTheme } from '../../theme';
import PageTexture from './PageTexture';

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
  // For pages that have to drive their own scroll position — arriving at a run
  // to leave a comment should land on the comment box, not at the top of a page
  // whose composer is a map and a splits table below the fold.
  scrollRef,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bg = dark ? darkColors.bg : colors.bg;
  const ground = StyleSheet.flatten(style)?.backgroundColor;
  const texture = ground == null || ground === bg ? <PageTexture dark={dark} /> : null;
  const pad = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingHorizontal: gutter ? space.gutter : 0,
  };

  if (scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: bg }, style]}>
        {texture}
        <ScrollView
          ref={scrollRef}
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
      {texture}
      {children}
    </View>
  );
}
