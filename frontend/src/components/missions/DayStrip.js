// The week across the top: seven days, each carrying its own verdict.
//
// WHY A FIXED MONDAY WEEK AND NOT A ROLLING SEVEN DAYS. A rolling window puts
// today in the same slot every day, which sounds tidy and means the strip
// never tells you anything — you cannot glance at it and see that you missed
// Tuesday, because Tuesday keeps moving. A calendar week holds still, so the
// gaps in it are readable.
//
// A PAST DAY IS STILL OPENABLE. Missions are derived from what actually
// happened (backend/app/missions.py), so a day you finished but never
// collected is still payable when you tap it on Friday. That is the whole
// reason the strip is a control rather than a progress read out.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '../../ui/motion';
import { fonts, nbInk, space, useTheme, withAlpha } from '../../theme';

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Tick({ color }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M5 13 L10 18 L19 6" stroke={color} strokeWidth={3.4} fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Padlock({ color }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M7 10 L7 7 A5 5 0 0 1 17 7 L17 10" stroke={color} strokeWidth={2.4} fill="none"
            strokeLinecap="round" />
      <Path d="M5 10 L19 10 L19 20 L5 20 Z" fill={color} />
    </Svg>
  );
}

function Dot({ day, index, selected, onPress, colors, scheme, accent }) {
  const label = LABELS[index];
  const complete = day.all_complete;
  const locked = day.locked;

  // Three fills, and the selected ring is drawn on top of whichever it is, so
  // "which day am I looking at" and "how did that day go" never compete for
  // the same channel.
  const fill = locked
    ? withAlpha(colors.text, 0.06)
    : complete
      ? withAlpha(colors.ok, 0.22)
      : colors.card;

  return (
    <PressableScale
      onPress={locked ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: locked }}
      accessibilityLabel={
        locked
          ? `${label}, not started yet`
          : `${label}, ${day.complete_count} of ${day.total} missions done`
      }
      style={styles.slot}
    >
      <Text style={[styles.label, { color: selected ? colors.text : colors.textDim }]}>{label}</Text>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: fill,
            borderColor: selected ? accent : nbInk(scheme, fill),
            borderWidth: selected ? 3 : 2,
          },
        ]}
      >
        {locked ? (
          <Padlock color={colors.textDim} />
        ) : complete ? (
          <Tick color={colors.ok} />
        ) : (
          <Text style={[styles.count, { color: colors.textMuted }]}>
            {`${day.complete_count}/${day.total}`}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

export default function DayStrip({ week, selected, accent, onSelect, style }) {
  const { colors, scheme } = useTheme();
  if (!week?.length) return null;
  return (
    <View style={[styles.strip, style]}>
      {week.map((day, i) => (
        <Dot
          key={day.day}
          day={day}
          index={i}
          selected={day.day === selected}
          accent={accent}
          colors={colors}
          scheme={scheme}
          onPress={() => onSelect?.(day.day)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', justifyContent: 'space-between' },
  slot: { alignItems: 'center', gap: 4, flex: 1 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  dot: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontFamily: fonts.bold, fontSize: 12 },
});
