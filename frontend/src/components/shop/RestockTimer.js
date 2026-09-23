// RestockTimer: the rotation countdown, as a quiet pill at the foot of the
// storefront panel. It used to be a board hanging off the stall's awning,
// floating over the scene; the clock belongs with the stock it counts down.
//
// STILL THE ONLY THING ON THE SCREEN THAT TICKS EVERY SECOND, and still
// isolated: the interval lives in `useCountdown`, inside this memoised leaf,
// so a clock running sixty times a minute re-renders one small pill and never
// the grid or the scene around it.

import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { useTheme, useThemedType, withAlpha } from '../../theme';

export function useCountdown(expiresAt) {
  const remaining = (expiry) => (expiry ? Math.max(0, expiry * 1000 - Date.now()) : 0);
  const [clock, setClock] = useState(() => ({ expiresAt, left: remaining(expiresAt) }));
  useEffect(() => {
    if (!expiresAt) {
      setClock({ expiresAt, left: 0 });
      return undefined;
    }
    const tick = () => setClock({ expiresAt, left: remaining(expiresAt) });
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return clock.expiresAt === expiresAt ? clock.left : null;
}

/** 9h 54m 58s, dropping the hours once they run out. */
export function formatCountdown(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

const RestockTimer = memo(function RestockTimer({ expiresAt, onExpire, accent }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const left = useCountdown(expiresAt);
  const fired = useRef(null);

  useEffect(() => {
    if (!expiresAt || left == null || left !== 0) return;
    if (fired.current === expiresAt) return;
    fired.current = expiresAt;
    onExpire?.();
  }, [left, expiresAt, onExpire]);

  const text = expiresAt && left ? `Fresh stock in ${formatCountdown(left)}` : 'Fresh stock soon';

  return (
    <View
      style={[styles.pill, { backgroundColor: withAlpha(accent, 0.12) }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      <RefreshCw size={14} color={colors.textMuted} strokeWidth={2.5} />
      <Text style={[type.captionMedium, styles.text, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  text: { fontVariant: ['tabular-nums'] },
});

export default RestockTimer;
