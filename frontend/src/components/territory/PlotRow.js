// One plot in the land list: its shape, its size, its clock and what it has
// been through. Tapping it opens the map framed on it.
//
// `compact` is the summary row (the Your land card on You): area, time left and
// the life bar, plus at most one SHORT status ("Held 1 attack") beside the
// area. No detail sentence — the full Territory page keeps that, because it is
// the page you open to read a plot's history.
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
  plotStatus,
  timeLeftLabel,
} from '../../territory/landStatus';

export default function PlotRow({ plot, accent, fadingHours = FADING_HOURS, onPress, divider = false, compact = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const now = Date.now();
  const fading = isFading(plot, { now, fadingHours });
  const clock = timeLeftLabel(plot, { now, fadingHours });
  // The summary row says every clock the same way ("40h left"); the danger
  // red already says it is fading, and "Fades in 40h" was wide enough to push
  // the chevron off a 320pt row. The full page keeps the longer wording.
  const clockLabel = compact ? clock.replace(/^Fades in (.+)$/, '$1 left') : clock;
  const life = lifeLeft(plot, now);
  const tone = fading ? colors.danger : accent;
  const status = compact ? plotStatus(plot) : null;
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${fmtArea(plot.area_m2)}. ${clock}. Show it on the map`}
      style={[
        styles.row,
        compact && styles.rowCompact,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      <PlotShape rings={plot.rings} color={accent} />
      <View style={styles.body}>
        <View style={styles.top}>
          {/* Area and clock never give way: they are the row. */}
          <Text style={[type.cardTitle, styles.area]} numberOfLines={1}>
            {fmtArea(plot.area_m2)}
          </Text>
          <View style={styles.clock}>
            <Pill label={clockLabel} color={tone} seed={`plot:${plot.id}`} />
          </View>
        </View>
        {/* The one piece of news a plot can carry, on its own short line —
            beside the area it was squeezed to "H…" by a long clock. */}
        {status ? (
          <Text style={[type.secondary, { color: colors.textMuted }]} numberOfLines={1}>
            {status}
          </Text>
        ) : null}
        {compact ? null : (
          <Text style={[type.metadata, { color: colors.textMuted }]} numberOfLines={1}>
            {plotDetail(plot)}
          </Text>
        )}
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
  // Tighter: two lines (area and clock, then the bar) instead of three.
  rowCompact: { minHeight: 60, paddingVertical: space.sm + 2 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  area: { flexShrink: 0 },
  clock: { flexShrink: 0 },
  // Flat and square: a clock, not a progress bar to celebrate.
  track: { height: 4, marginTop: 2, overflow: 'hidden' },
  fill: { height: '100%' },
});
