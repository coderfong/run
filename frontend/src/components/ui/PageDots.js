// PageDots — the small "which page am I on" mark under a paged carousel.
//
// One recipe for every carousel in the app, so the hero and the quick actions
// under it do not grow two dialects of the same indicator. The current page is
// a short pink bar and the others are small hollow squares — hard-edged blocks
// under hand-drawn boxes, which is the contrast the whole style runs on — kept
// quiet (thin stroke, dimmed) because it is a hint, not a control.
//
// Draws nothing for a single page: an indicator with one position is noise.

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { brand, nbInk, useTheme } from '../../theme';

export default function PageDots({ count, index, style }) {
  const { colors, scheme } = useTheme();
  if (!count || count < 2) return null;
  const ink = nbInk(scheme, colors.bg);
  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Page ${index + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { borderColor: ink },
            i === index ? styles.on : styles.off,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 0, borderWidth: 1, opacity: 0.55 },
  on: { width: 16, backgroundColor: brand.pink, opacity: 1 },
  off: { width: 6, backgroundColor: 'transparent' },
});
