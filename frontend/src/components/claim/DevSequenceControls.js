// Development-only harness for the post-claim sequence.
//
// The sequence costs a run, energy and a one-per-run claim to see once, which
// makes it almost impossible to tune. This replays the LAST claim result
// through the whole animation with no further API traffic, and lets the
// scenario be switched without needing a real opponent to exist.
//
// Renders nothing outside __DEV__, and nothing in production depends on it:
// it only ever calls `sequence.replay(...)`, which is the same path the real
// sequence uses. Delete this file and the feature still works.

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { radius, space, useTheme, useThemedType } from '../../theme';
import { CAPTURE_VARIANTS } from './useClaimSequence';

// Stand-in opponents for scenarios the real claim didn't produce. They wear
// the player's own avatar — a dev harness should not invent cosmetics.
function syntheticDefenders(count, avatar) {
  return Array.from({ length: count }, (_, i) => ({
    id: `dev-defender-${i}`,
    user_id: `dev-defender-${i}`,
    username: `Test ${i + 1}`,
    avatar,
    clan_color: null,
    rank_key: 'wood',
  }));
}

const SCENARIOS = [
  { key: 'real', label: 'Real' },
  { key: 'empty', label: 'Empty' },
  { key: 'one', label: '1 def' },
  { key: 'three', label: '3 def' },
];

const MOTION = [
  { key: 'auto', label: 'Auto' },
  { key: 'on', label: 'Reduced' },
  { key: 'off', label: 'Full' },
];

function Chip({ label, active, onPress }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        { borderColor: colors.border, backgroundColor: active ? colors.text : 'transparent' },
      ]}
    >
      <Text style={[type.caption, { color: active ? colors.bg : colors.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DevSequenceControls({ sequence, fallbackAvatar, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const [scenario, setScenario] = useState('real');
  const [variant, setVariant] = useState('grin-knock');
  const [motion, setMotion] = useState('auto');

  if (!__DEV__) return null;

  const defendersFor = (key) => {
    if (key === 'empty') return [];
    if (key === 'one') return syntheticDefenders(1, fallbackAvatar);
    if (key === 'three') return syntheticDefenders(3, fallbackAvatar);
    return undefined; // fall back to the claim's real victims
  };

  const reducedFor = (key) => (key === 'auto' ? null : key === 'on');

  const replay = (next = {}) => {
    const s = next.scenario ?? scenario;
    const v = next.variant ?? variant;
    const m = next.motion ?? motion;
    sequence.replay({
      defenders: defendersFor(s),
      variant: v,
      reducedOverride: reducedFor(m),
    });
  };

  return (
    <View style={[styles.root, { borderColor: colors.border, backgroundColor: colors.cardAlt }, style]}>
      <View style={styles.headerRow}>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {`DEV · sequence · ${sequence.phase}`}
        </Text>
        <TouchableOpacity
          onPress={() => replay()}
          activeOpacity={0.8}
          style={[styles.replay, { backgroundColor: colors.text }]}
        >
          <Text style={[type.captionMedium, { color: colors.bg }]}>Replay</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        {SCENARIOS.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            active={scenario === s.key}
            onPress={() => { setScenario(s.key); replay({ scenario: s.key }); }}
          />
        ))}
      </View>

      <View style={styles.row}>
        {CAPTURE_VARIANTS.map((v) => (
          <Chip
            key={v}
            label={v}
            active={variant === v}
            onPress={() => { setVariant(v); replay({ variant: v }); }}
          />
        ))}
      </View>

      <View style={styles.row}>
        {MOTION.map((m) => (
          <Chip
            key={m.key}
            label={m.label}
            active={motion === m.key}
            onPress={() => { setMotion(m.key); replay({ motion: m.key }); }}
          />
        ))}
        <Chip label="Skip" active={false} onPress={() => sequence.skip()} />
      </View>
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
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  replay: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 5 },
});
