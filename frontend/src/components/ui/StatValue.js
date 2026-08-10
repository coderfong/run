// StatValue — a labelled stat. Big tabular Space Grotesk number with an
// optional unit and an uppercase eyebrow label. The single way stats render
// so they stay consistent (and tabular) everywhere.

import React from 'react';
import { Text, View } from 'react-native';

import { useTheme, useThemedType } from '../../theme';
import { CountUpText } from '../../ui/motion';

export default function StatValue({
  value,
  unit,
  label,
  size = 'md',
  color,
  align = 'flex-start',
  style,
  countTo,
  format,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const SIZES = { hero: type.statHero, lg: type.stat, md: type.statMd, sm: type.statSm };
  const valueStyle = SIZES[size] || SIZES.md;
  // `countTo` opts a stat into counting up to its number instead of appearing
  // at it. `format` runs on the UI thread, so it has to be a worklet.
  const counting = typeof countTo === 'number';
  return (
    <View style={[{ alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}>
      {label ? <Text style={[type.labelSm, { marginBottom: 4 }]}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {counting ? (
          <CountUpText
            value={countTo}
            format={format}
            style={[valueStyle, color ? { color } : null]}
          />
        ) : (
          <Text style={[valueStyle, color ? { color } : null]} numberOfLines={1}>
            {value}
          </Text>
        )}
        {unit ? (
          <Text style={[type.statSm, { color: colors.textMuted, marginLeft: 3, marginBottom: 2 }]}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
