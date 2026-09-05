// EnergyMeter — the claim-energy HUD chip: a bolt, a fill bar, and the live
// count. Energy gates CLAIMING territory (runs are always free). Tapping it
// (if onPress given) opens the refill shop. Counts up locally between fetches
// using the server's regen rate so the bar feels alive without polling.

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { brand, nbInk, space, useTheme, useThemedType } from '../theme';
import { Bar } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import AppIcon from './AppIcon';
import GameLottie from './GameLottie';
import Framed from './ui/Framed';

export default function EnergyMeter({ status, onPress, compact = false, style }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const [energy, setEnergy] = useState(status?.energy ?? 0);
  const [fx, setFx] = useState(null);
  const previousEnergy = useRef(null);
  const fxToken = useRef(0);

  const max = status?.energy_max ?? 100;
  const regen = status?.regen_seconds ?? 360;

  // Re-sync when a fresh status arrives.
  useEffect(() => { setEnergy(status?.energy ?? 0); }, [status?.energy]);

  useEffect(() => {
    if (previousEnergy.current == null) {
      previousEnergy.current = energy;
      return;
    }
    if (energy !== previousEnergy.current) {
      setFx({
        name: energy > previousEnergy.current ? 'energyGain' : 'energySpend',
        token: ++fxToken.current,
      });
      previousEnergy.current = energy;
    }
  }, [energy]);

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
  // The chip is a DRAWN BOX and the track keeps its stroke. A progress bar is
  // the one control where the edge is doing more than styling: a bare track
  // tinted `cardAlt` sitting inside a bare chip tinted `card` is two surface
  // steps apart, which on the dark palette is six percent of lightness and on
  // paper is almost nothing — so the EMPTY portion of the bar was invisible and
  // the meter read as a floating pink stub rather than as a bar with a level in
  // it. The chip's own rounded rectangle went the way of every other chip in the
  // app; see components/ui/Pill.js.
  const ink = nbInk(scheme, colors.card);
  return (
    <Wrap
      style={style}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Energy ${energy} of ${max}`}
    >
    <Framed
      frame={frameVariant('chip', 'energy')}
      fill={colors.card}
      on={colors.card}
      weight={INK.thin}
      pose={framePose('energy')}
      inset={compact ? 2 : 4}
      contentStyle={[styles.wrap, compact && styles.compact]}
    >
      <View style={[styles.iconSlot, compact && styles.iconSlotCompact]}>
        <AppIcon name="energy" size={compact ? 16 : 20} />
        {fx ? (
          <GameLottie
            name={fx.name}
            size={compact ? 48 : 58}
            trigger={fx.token}
            style={styles.energyFx}
          />
        ) : null}
      </View>
      {/* Not animated on mount: this chip rides along in headers, and a bar
          refilling itself every time you land on a screen is noise. It moves
          when the energy moves — a claim taking a bite out of it, or the regen
          tick above adding one back. */}
      {/* The outline owns a wrapper, not Bar's measured element. Bar measures
          the exact inner width now, so a full fill ends at the inside edge
          instead of running two border widths long. */}
      <View
        style={[
          styles.track,
          compact && styles.trackCompact,
          { backgroundColor: colors.cardAlt, borderColor: ink },
        ]}
      >
        <Bar
          pct={pct}
          trackStyle={StyleSheet.absoluteFill}
          fillStyle={[styles.fill, { backgroundColor: barColor }]}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          type.bodySmBold,
          styles.count,
          compact && styles.countCompact,
          { color: colors.text },
        ]}
      >
        {compact ? energy : `${energy}/${max}`}
      </Text>
    </Framed>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  // No padding of its own any more: the frame's measured ink clearance is the
  // padding, and a `paddingHorizontal` written here would be half-overridden by
  // it — see the same note in Pill.
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  compact: { gap: space.xs },
  iconSlot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  iconSlotCompact: { width: 16, height: 16 },
  energyFx: { position: 'absolute' },
  // Taller than the 8 it was: a 1pt stroke on each side of an 8pt track leaves
  // 6pt of actual bar, and the fill stops reading as a quantity. The border is
  // on this shell while Bar measures the absolutely-filled inner track.
  track: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden', minWidth: 60, borderWidth: 1 },
  trackCompact: { minWidth: 46 },
  fill: { height: '100%', borderRadius: 6 },
  count: { minWidth: 46, textAlign: 'right' },
  // The compact Home HUD needs only the live amount. The bar already shows its
  // share of the maximum, and dropping the repeated “/100” keeps the number
  // inside the chip instead of underneath the notification button.
  countCompact: { minWidth: 24 },
});
