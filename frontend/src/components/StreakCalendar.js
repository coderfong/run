// StreakCalendar — a real month calendar. Shows one month at a time with
// day numbers; days you ran are filled in the accent colour, today gets a
// ring. Arrows page between months. Feed it 'YYYY-MM-DD' run days.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

import { radius, space, useTheme, useThemedType } from '../theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function iso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function StreakCalendar({ runDays = [], accent }) {
  // Theme-aware: on a light (white) card the day numbers/labels must read as
  // dark text, not the dark-palette greys that vanish against white.
  const { colors } = useTheme();
  const type = useThemedType();
  const ac = accent || colors.primary;
  // Accent-filled "ran" days: dark ink reads on the clan/brand accents (which
  // are the same colour in both themes), so keep it constant. The real fix is
  // the surrounding numbers/labels below, which now use themed text colours
  // instead of the dark-palette greys that vanished on a white card.
  const ranInk = '#0b0d10';
  const runSet = useMemo(() => new Set(runDays), [runDays]);
  const today = new Date();
  const [offset, setOffset] = useState(0); // months back from the current one

  const view = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  // Grid cells: leading blanks then 1..daysInMonth.
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const ranThisMonth = cells.filter((d) => d && runSet.has(iso(year, month, d))).length;

  return (
    <View>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => setOffset((o) => o - 1)} hitSlop={10} accessibilityLabel="Previous month">
          <ChevronLeft size={20} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={type.bodyBold}>{MONTHS[month]} {year}</Text>
        <TouchableOpacity
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
          hitSlop={10}
          disabled={offset >= 0}
          accessibilityLabel="Next month"
        >
          <ChevronRight size={20} color={offset >= 0 ? colors.textDim : colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={[styles.weekLabel, type.caption, { color: colors.textDim }]}>{w}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`b${i}`} style={styles.cell} />;
          const cellIso = iso(year, month, d);
          const ran = runSet.has(cellIso);
          const isToday = cellIso === todayIso;
          return (
            <View key={cellIso} style={styles.cell}>
              <View
                style={[
                  styles.day,
                  ran && { backgroundColor: ac },
                  isToday && { borderWidth: 1.5, borderColor: ran ? '#fff' : ac },
                ]}
              >
                <Text
                  style={[
                    type.caption,
                    { color: ran ? ranInk : colors.textMuted, fontVariant: ['tabular-nums'] },
                  ]}
                >
                  {d}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>
        {ranThisMonth
          ? `${ranThisMonth} run day${ranThisMonth === 1 ? '' : 's'} in ${MONTHS[month]}.`
          : `No runs logged in ${MONTHS[month]}.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  weekRow: { flexDirection: 'row' },
  weekLabel: { flex: 1, textAlign: 'center', marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
