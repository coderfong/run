// One plot in the land list: its shape, its size, its clock and what it has
// been through. Tapping it opens the map framed on it.
//
// The clock chip is the runner's colour while the plot is healthy and the
// danger red inside the fading window, and the bar under the row is how much
// of its life is left, in the same colour. Both are read against the phone's
// clock at render (territory/landStatus), not frozen at fetch time.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { space, useTheme, useThemedType } from '../../theme';
import { PressableScale } from '../../ui/motion';
import { Pill } from '../ui';
import PlotShape from './PlotShape';
import {
  FADING_HOURS,
  fmtArea,
  isFading,
  lifeLeft,
  plotDetail,
  timeLeftLabel,
} from '../../territory/landStatus';

export default function PlotRow({ plot, accent, fadingHours = FADING_HOURS, onPress, divider = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const now = Date.now();
  const fading = isFading(plot, { now, fadingHours });
  const clock = timeLeftLabel(plot, { now, fadingHours });
  const life = lifeLeft(plot, now);
  const tone = fading ? colors.danger : accent;
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fmtArea(plot.area_m2)}. ${clock}. Show it on the map`}
      style={[
        styles.row,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      <PlotShape rings={plot.rings} color={accent} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[type.bodyBold, styles.area]} numberOfLines={1}>
            {fmtArea(plot.area_m2)}
          </Text>
          <Pill label={clock} color={tone} seed={`plot:${plot.id}`} />
        </View>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {plotDetail(plot)}
        </Text>
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View
            style={[styles.fill, { width: `${Math.round(life * 100)}%`, backgroundColor: tone }]}
          />
        </View>
      </View>
      {onPress ? <ChevronRight size={18} color={colors.textDim} strokeWidth={2.5} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 76,
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  area: { flexShrink: 1 },
  // Flat and square: a clock, not a progress bar to celebrate.
  track: { height: 4, marginTop: 2, overflow: 'hidden' },
  fill: { height: '100%' },
});
