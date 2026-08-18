// Development-only harness for the post-claim sequence.
//
// The sequence costs a run, energy and a one-per-run claim to see once, which
// makes it almost impossible to direct. This replays the LAST claim result
// through the whole animation with no further API traffic, and lets the
// scenario be switched without needing a real opponent to exist.
//
// Renders nothing outside __DEV__, and nothing in production depends on it: it
// only ever calls `sequence.replay(...)`, which is the same path the real
// sequence uses. Delete this file and the feature still works.
//
// WHY THERE IS NO PAUSE BUTTON, since it is the obvious thing to want.
//
// The scheduler could be frozen easily enough: it is a set of timers keyed to a
// generation. The characters could not. Every rig is a Reanimated body running
// its own transform chain on the UI thread, and the sprites are frame
// animations inside their own players. A pause would stop the timeline while
// the people carried on moving, which is a tool that lies about what it has
// stopped. Slow motion does the same job honestly (at 0.2x a 2.6 second scene
// takes thirteen seconds and every beat is legible) and the phase readout below
// names what is happening while it happens.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { radius, space, useTheme, useThemedType } from '../../theme';
import { CAPTURE_VARIANTS } from './useClaimSequence';
import {
  CAPTURE_STYLES,
  CHOREOGRAPHY_FAMILY,
  DEFAULT_CAPTURE_STYLE_ID,
  getCaptureStyle,
} from '../../effects/captureStyles';

// Stand-in opponents for scenarios the real claim did not produce. They wear
// the player's own avatar: a dev harness should not invent cosmetics.
function syntheticDefenders(count, avatar, color) {
  return Array.from({ length: count }, (_, i) => ({
    id: `dev-defender-${i}`,
    user_id: `dev-defender-${i}`,
    username: `Test ${i + 1}`,
    avatar,
    clan_color: color || null,
    rank_key: 'wood',
  }));
}

const SCENARIOS = [
  { key: 'real', label: 'Real' },
  { key: 'empty', label: 'Empty' },
  { key: 'one', label: '1 rival' },
  { key: 'two', label: '2 rivals' },
  { key: 'three', label: '3 rivals' },
];

const MOTION = [
  { key: 'auto', label: 'Auto' },
  { key: 'off', label: 'Normal' },
  { key: 'on', label: 'Reduced' },
];

// Slow motion stretches the SCHEDULE only. The rigs and the sprites keep their
// authored pace, so what is being inspected is the order and the overlap of the
// beats, which is exactly what the choreography rework is about.
const SPEEDS = [
  { key: 1, label: '1x' },
  { key: 2, label: '0.5x' },
  { key: 4, label: '0.25x' },
  { key: 5, label: '0.2x' },
];

// Named so a capture can be checked against a colour that is not the signed-in
// player's own. A pale claim over a dark map is a different picture.
const COLOURS = [
  { key: null, label: 'Mine' },
  { key: '#3DDC84', label: 'Green' },
  { key: '#FF6B4A', label: 'Orange' },
  { key: '#7CF7FF', label: 'Cyan' },
  { key: '#C79BFF', label: 'Violet' },
];

const FAMILIES = [
  { key: 'all', label: 'All' },
  { key: CHOREOGRAPHY_FAMILY.PROJECTILE, label: 'Projectile' },
  { key: CHOREOGRAPHY_FAMILY.TERRITORY, label: 'Territory' },
  { key: CHOREOGRAPHY_FAMILY.SUMMON, label: 'Summon' },
  { key: CHOREOGRAPHY_FAMILY.TAKEOVER, label: 'Takeover' },
  { key: CHOREOGRAPHY_FAMILY.DUEL, label: 'Duel' },
];

function Chip({ label, active, onPress, tint }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        {
          borderColor: tint || colors.border,
          backgroundColor: active ? (tint || colors.text) : 'transparent',
        },
      ]}
    >
      <Text style={[type.caption, { color: active ? colors.bg : colors.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Row({ title, children }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View style={styles.section}>
      <Text style={[type.caption, styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

export default function DevSequenceControls({ sequence, fallbackAvatar, style }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const type = useThemedType();
  const [scenario, setScenario] = useState('real');
  const [variant, setVariant] = useState('grin-knock');
  const [motion, setMotion] = useState('auto');
  const [speed, setSpeed] = useState(1);
  const [tint, setTint] = useState(null);
  const [family, setFamily] = useState('all');
  const [captureStyle, setCaptureStyle] = useState(DEFAULT_CAPTURE_STYLE_ID);

  if (!__DEV__) return null;

  const defendersFor = (key) => {
    if (key === 'empty') return [];
    if (key === 'one') return syntheticDefenders(1, fallbackAvatar);
    if (key === 'two') return syntheticDefenders(2, fallbackAvatar);
    if (key === 'three') return syntheticDefenders(3, fallbackAvatar);
    return undefined; // fall back to the claim's real victims
  };

  const reducedFor = (key) => (key === 'auto' ? null : key === 'on');

  const replay = (next = {}) => {
    const s = next.scenario ?? scenario;
    const m = next.motion ?? motion;
    sequence.replay({
      defenders: defendersFor(s),
      variant: next.variant ?? variant,
      reducedOverride: reducedFor(m),
      captureStyle: next.captureStyle ?? captureStyle,
      timeScale: next.speed ?? speed,
      // `null` is a real value here (the player's own colour), so `??` would
      // read it as "not provided" and fall through to the old state.
      tintOverride: next.tint === undefined ? tint : next.tint,
    });
  };

  const pick = (setter, key, field) => {
    setter(key);
    replay({ [field]: key });
  };

  const shown = family === 'all'
    ? CAPTURE_STYLES
    : CAPTURE_STYLES.filter((item) => item.family === family);
  const current = getCaptureStyle(captureStyle);

  return (
    <View style={[styles.root, { borderColor: colors.border, backgroundColor: colors.cardAlt }, style]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {/* The live readout: the controller's own state machine, so a frame
              can be named while it is on screen rather than reasoned about
              afterwards. */}
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {`DEV ${sequence.phase}${sequence.timeScale > 1 ? ` ${sequence.timeScale}x slower` : ''}`}
          </Text>
          <Text style={[type.caption, { color: colors.text }]} numberOfLines={1}>
            {current ? `${current.name} (${current.family})` : captureStyle}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => replay()}
          activeOpacity={0.8}
          style={[styles.replay, { backgroundColor: colors.text }]}
        >
          <Text style={[type.captionMedium, { color: colors.bg }]}>Restart</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => sequence.skip()}
          activeOpacity={0.8}
          style={[styles.ghost, { borderColor: colors.border }]}
        >
          <Text style={[type.captionMedium, { color: colors.text }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* What a capture actually has to survive: how many rivals lose ground,
          and what colour it turns. Neither needs a real opponent to exist. */}
      <Row title="CAST">
        {SCENARIOS.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            active={scenario === s.key}
            onPress={() => pick(setScenario, s.key, 'scenario')}
          />
        ))}
      </Row>

      <Row title="CLAIM COLOUR">
        {COLOURS.map((c) => (
          <Chip
            key={String(c.key)}
            label={c.label}
            tint={c.key || undefined}
            active={tint === c.key}
            onPress={() => pick(setTint, c.key, 'tint')}
          />
        ))}
      </Row>

      <Row title="MOTION">
        {MOTION.map((m) => (
          <Chip
            key={m.key}
            label={m.label}
            active={motion === m.key}
            onPress={() => pick(setMotion, m.key, 'motion')}
          />
        ))}
      </Row>

      <Row title="SPEED">
        {SPEEDS.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            active={speed === s.key}
            onPress={() => pick(setSpeed, s.key, 'speed')}
          />
        ))}
      </Row>

      <Row title="FAMILY">
        {FAMILIES.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            active={family === f.key}
            onPress={() => setFamily(f.key)}
          />
        ))}
      </Row>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.styleRow}>
        {shown.map((capture) => (
          <Chip
            key={capture.id}
            label={capture.name}
            active={captureStyle === capture.id}
            onPress={() => pick(setCaptureStyle, capture.id, 'captureStyle')}
          />
        ))}
      </ScrollView>

      {/* The four lines this style is directed to tell. If what plays does not
          match what this says, the scene is the thing that is wrong. */}
      {current ? (
        <View style={styles.beats}>
          {current.beats.map((line, i) => (
            <Text key={line} style={[type.caption, { color: colors.textMuted }]} numberOfLines={2}>
              {`${i + 1}. ${line}`}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        {CAPTURE_VARIANTS.map((v) => (
          <Chip
            key={v}
            label={v}
            active={variant === v}
            onPress={() => pick(setVariant, v, 'variant')}
          />
        ))}
        <Chip
          label="FX gallery"
          active={false}
          onPress={() => navigation.getParent()?.navigate('AnimationGallery')}
        />
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1 },
  section: { gap: 4 },
  sectionTitle: { letterSpacing: 0.8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  replay: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 5 },
  ghost: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  styleRow: { gap: 6, paddingRight: 12 },
  beats: { gap: 2, paddingTop: 2 },
});
