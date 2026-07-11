// StreakCalendar — a GitHub-style contribution grid of the last N weeks.
// Columns are weeks (oldest → newest, current week rightmost); rows are days
// Mon→Sun. Days the user ran are filled in the accent colour; today gets a
// ring. Pure presentational — feed it an array of 'YYYY-MM-DD' run days.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, space, type, withAlpha } from '../theme';

const DAY_LABELS = ['M', '', 'W', '', 'F', '', 'S'];
const WEEKS = 16;

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StreakCalendar({ runDays = [], accent = colors.primary }) {
  const { weeks, todayIso } = useMemo(() => {
    const set = new Set(runDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Monday of the current week.
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const cols = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() - w * 7 + d);
        const iso = isoDay(day);
        col.push({ iso, ran: set.has(iso), future: day > today });
      }
      cols.push(col);
    }
    return { weeks: cols, todayIso: isoDay(today) };
  }, [runDays]);

  return (
    <View style={styles.wrap}>
      <View style={styles.labels}>
        {DAY_LABELS.map((l, i) => (
          <Text key={i} style={styles.dayLabel}>{l}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {weeks.map((col, ci) => (
          <View key={ci} style={styles.col}>
            {col.map((cell) => (
              <View
                key={cell.iso}
                style={[
                  styles.cell,
                  cell.future
                    ? { backgroundColor: 'transparent' }
                    : cell.ran
                    ? { backgroundColor: accent }
                    : { backgroundColor: colors.bgElevated },
                  cell.iso === todayIso && { borderWidth: 1.5, borderColor: cell.ran ? '#fff' : accent },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const CELL = 12;
const GAP = 3;

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 6 },
  labels: { justifyContent: 'space-between', paddingVertical: 0 },
  dayLabel: { ...type.caption, fontSize: 9, lineHeight: CELL + GAP, color: colors.textDim, height: CELL + GAP },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'space-between' },
  col: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
});
