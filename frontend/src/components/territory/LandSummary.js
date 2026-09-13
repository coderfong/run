// The three numbers across the top of the land card and the land page: plots
// about to fade, attacks held off this week, times ground was lost this week.
// Plain numbers on the card's own surface; the count only turns red when
// something is actually about to go.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { space, useTheme, useThemedType } from '../../theme';
import { summaryCells } from '../../territory/landStatus';

export default function LandSummary({ summary, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View style={[styles.strip, style]}>
      {summaryCells(summary).map((cell, i) => (
        <View
          key={cell.key}
          style={[
            styles.cell,
            i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
          ]}
          accessible
          accessibilityLabel={`${cell.label}: ${cell.value}`}
        >
          <Text style={[type.statSm, cell.alarm && { color: colors.danger }]}>{String(cell.value)}</Text>
          <Text
            style={[type.caption, { color: colors.textMuted }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {cell.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', paddingVertical: space.md },
  cell: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: space.xs },
});
