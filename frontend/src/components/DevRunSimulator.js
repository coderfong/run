// Development-only: finish a run without going for one.
//
// Same idea as DevSequenceControls, one step earlier in the flow. That one
// replays a claim you already made; this one produces the run in the first
// place, so the whole post-run sequence — the claim card, choosing where the
// ground lands, the capture, the payoff, the standings, crossed paths — can be
// looked at from a desk.
//
// The run is REAL. The trace goes through /start-run and /end-run like any
// other, which is what makes the screens afterwards worth looking at, and also
// why the gate matters: the server cannot tell it apart from a run, so a button
// here is free territory.
//
// WHICH IS WHY THE GATE IS NOT `__DEV__` ALONE. A build flag is decided when
// the binary is made, so every tester on a TestFlight build would get this and
// a build promoted to release would carry it. `dev_tools` comes from /me and is
// false for every account the server has not been told about — see
// backend/app/devtools.py. The harness is therefore present in every build and
// reaches nobody by default, and switching it on or off is a deployment change
// rather than a new binary.
//
// The server enforces its own half: /start-run ignores a backdated start for
// anyone not on the list, and without that a simulated run is a two-second
// activity that can never claim. Hiding this card is convenience; that is the
// control.

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { SIM_PRESETS } from '../run/simulatedRun';
import { radius, space, useTheme, useThemedType } from '../theme';

const SCENARIOS = [
  { key: 'open', label: 'Open ground' },
  { key: 'steal', label: 'Capture rival' },
];

export default function DevRunSimulator({
  onSimulate,
  onRivalTake,
  busy = false,
  disabled = false,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { user } = useAuth();
  const [scenario, setScenario] = useState('open');

  // Hooks first, then the gate — an early return above them changes the hook
  // order between an allowed and a disallowed account.
  if (!__DEV__ && !user?.dev_tools) return null;

  return (
    <View style={[styles.root, { borderColor: colors.border, backgroundColor: colors.cardAlt }, style]}>
      <View style={styles.headerRow}>
        <Text style={[type.caption, { color: colors.textMuted }]}>DEV: simulate a finished run</Text>
        {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </View>
      <Text style={[type.caption, { color: colors.textDim }]}>Set up the next result</Text>
      <View style={styles.row}>
        {SCENARIOS.map((item) => {
          const active = scenario === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => setScenario(item.key)}
              disabled={busy || disabled}
              activeOpacity={0.75}
              style={[
                styles.chip,
                {
                  borderColor: active ? colors.text : colors.border,
                  backgroundColor: active ? colors.text : 'transparent',
                  opacity: busy || disabled ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[type.caption, { color: active ? colors.bg : colors.text }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[type.caption, { color: colors.textDim }]}>Run distance</Text>
      <View style={styles.row}>
        {SIM_PRESETS.map((p) => (
          <TouchableOpacity
            key={p.key}
            onPress={() => onSimulate(p, scenario)}
            disabled={busy || disabled}
            activeOpacity={0.75}
            style={[
              styles.chip,
              { borderColor: colors.border, opacity: busy || disabled ? 0.4 : 1 },
            ]}
          >
            <Text style={[type.caption, { color: colors.text }]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[type.caption, { color: colors.textDim }]}>
        Submits a real run at your current location, then opens the result screen. Costs a claim
        and energy exactly like running does.
      </Text>
      <TouchableOpacity
        onPress={onRivalTake}
        disabled={busy || disabled}
        activeOpacity={0.75}
        style={[
          styles.lossButton,
          { borderColor: colors.danger, opacity: busy || disabled ? 0.4 : 1 },
        ]}
      >
        <Text style={[type.captionMedium, { color: colors.danger }]}>DEV RIVAL TAKES MY LAND</Text>
      </TouchableOpacity>
      <Text style={[type.caption, { color: colors.textDim }]}>
        Uses your largest live territory and creates the real loss, rivalry, and notification state.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
    gap: space.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  lossButton: {
    borderWidth: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
