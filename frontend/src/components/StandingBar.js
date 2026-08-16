// StandingBar — "you are 84th of 1,203", on whichever board is open.
//
// FREE, always, for everybody. A board that shows the top fifty and stops
// leaves everyone below fiftieth guessing, and a guessing player cannot tell
// whether they are losing to better runners or to somebody's subscription.
// That doubt is far more expensive than the subscription is worth, so this bar
// sits outside the PRO gate on purpose. See backend routes/leaderboard.py,
// which says the same thing at the other end.
//
// It renders its own answer for a runner who has not scored yet, rather than
// hiding: "not ranked yet" with the size of the field is information, a blank
// space is not.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAccent } from '../hooks/useAccent';
import { radius, space, withAlpha, useTheme, useThemedType } from '../theme';

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function amount(category, value) {
  switch (category) {
    case 'land':
      return `${(value / 1e6).toFixed(2)} km²`;
    case 'distance':
      return `${(value / 1000).toFixed(1)} km`;
    default:
      return value.toLocaleString();
  }
}

/**
 * @param {string} category  land | claims | captures | defenses | distance
 * @param {object} opts      { window, filter, lat, lon } — must match the board
 *                           on screen, or the bar answers a question nobody
 *                           asked.
 */
export default function StandingBar({ category = 'land', opts = {}, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const accent = useAccent();

  // Keyed by the whole board identity so switching boards shows that board's
  // standing from cache rather than the previous board's number, which would
  // be wrong for as long as the new request takes.
  const key = `standing:${category}:${opts.window || 'season'}:${opts.filter || 'all'}`;
  const { data } = useQuery(key, () => api.myStanding(category, opts), {
    staleMs: 60 * 1000,
    // Silence rather than an error row. This bar is reassurance; a failed
    // fetch of it must never become the loudest thing on the screen.
    fallback: null,
  });

  if (!data) return null;

  const ranked = data.rank != null;
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: withAlpha(accent, 0.10), borderColor: withAlpha(accent, 0.35) },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={
        ranked
          ? `You are ${ordinal(data.rank)} of ${data.field_size}`
          : `You are not ranked on this board yet. ${data.field_size} runners are`
      }
    >
      <Text style={[type.bodySmBold, { color: colors.text }]}>
        {ranked ? `You are ${ordinal(data.rank)}` : 'Not ranked yet'}
      </Text>
      <Text style={[type.caption, { color: colors.textMuted }]}>
        {ranked
          ? `of ${data.field_size.toLocaleString()} · ${amount(category, data.value)}`
          : `${data.field_size.toLocaleString()} runners on this board`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.card,
    borderWidth: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
  },
});
