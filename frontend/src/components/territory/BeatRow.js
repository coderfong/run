// One thing that happened to your land: ground lost, an attack held off, or
// ground that ran out of time. Tapping it opens the map where it happened.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { NB, radius, space, useTheme, useThemedType } from '../../theme';
import { PressableScale } from '../../ui/motion';
import AppIcon from '../AppIcon';
import { timeAgo } from '../../utils/time';
import { beatIcon, beatTitle, fmtArea } from '../../territory/landStatus';

export default function BeatRow({ beat, onPress, divider = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  // Red for ground that left, green for ground that held, quiet for the clock.
  const tone =
    beat.kind === 'lost' ? colors.danger : beat.kind === 'held' ? colors.ok : colors.textDim;
  const title = beatTitle(beat);
  const meta = `${fmtArea(beat.area_m2)}, ${timeAgo(beat.at)}`;
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}${onPress ? '. Show it on the map' : ''}`}
      style={[
        styles.row,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      <View style={[styles.mark, { borderColor: tone, backgroundColor: colors.cardAlt }]}>
        <AppIcon name={beatIcon(beat.kind)} size={24} />
      </View>
      <View style={styles.body}>
        <Text style={type.bodyBold} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
          {meta}
        </Text>
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
    minHeight: 64,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: NB.strokeThin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
});
