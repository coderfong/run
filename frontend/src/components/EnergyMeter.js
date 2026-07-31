// EnergyMeter — the claim-energy HUD chip: a bolt, a fill bar, and the live
// count. Energy gates CLAIMING territory (runs are always free). Tapping it
// (if onPress given) opens the refill shop. Counts up locally between fetches
// using the server's regen rate so the bar feels alive without polling.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { brand, radius, space, useTheme, useThemedType } from '../theme';
import AppIcon from './AppIcon';

export default function EnergyMeter({ status, onPress, compact = false, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const [energy, setEnergy] = useState(status?.energy ?? 0);

  const max = status?.energy_max ?? 100;
  const regen = status?.regen_seconds ?? 360;

  // Re-sync when a fresh status arrives.
  useEffect(() => { setEnergy(status?.energy ?? 0); }, [status?.energy]);

  // Tick a local +1 every regen interval so the meter climbs between fetches.
  useEffect(() => {
    if (energy >= max) return undefined;
    const secs = status?.seconds_to_next || regen;
    const id = setTimeout(() => setEnergy((e) => Math.min(max, e + 1)), secs * 1000);
    return () => clearTimeout(id);
  }, [energy, max, regen, status?.seconds_to_next]);

  const pct = Math.max(0, Math.min(1, energy / max));
  const low = energy < (status?.claim_cost ?? 25);
  const barColor = low ? colors.danger : brand.pink;

  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      style={[styles.wrap, compact && styles.compact, { backgroundColor: colors.card }, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Energy ${energy} of ${max}`}
    >
      <AppIcon name="energy" size={compact ? 16 : 20} />
      <View style={[styles.track, { backgroundColor: colors.cardAlt }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[type.bodySmBold, { color: colors.text, minWidth: 46, textAlign: 'right' }]}>
        {energy}/{max}
      </Text>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  compact: { paddingVertical: 6, paddingHorizontal: space.sm },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', minWidth: 60 },
  fill: { height: '100%', borderRadius: 4 },
});
