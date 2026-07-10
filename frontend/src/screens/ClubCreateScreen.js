// Create-club flow: name, tag, color (12), badge (16), privacy.

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { colors, radius, space, type, withAlpha } from '../theme';
import { Screen, Button, Segmented } from '../components/ui';
import ClanBadge, { BADGE_KEYS } from '../components/ClanBadge';
import { toast } from '../ui/toast';

// Must match the server palette keys (clans_meta.py).
const COLOR_KEYS = ['violet', 'emerald', 'azure', 'crimson', 'amber', 'teal', 'rose', 'indigo', 'lime', 'cyan', 'fuchsia', 'orange'];
const STROKE = {
  violet: '#9333ea', emerald: '#15803d', azure: '#2563eb', crimson: '#dc2626',
  amber: '#b45309', teal: '#0f766e', rose: '#be123c', indigo: '#4338ca',
  lime: '#4d7c0f', cyan: '#0e7490', fuchsia: '#a21caf', orange: '#c2410c',
};

export default function ClubCreateScreen({ navigation }) {
  const { refresh } = useClan();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [colorKey, setColorKey] = useState('azure');
  const [badge, setBadge] = useState('shield');
  const [privacy, setPrivacy] = useState('open');
  const [busy, setBusy] = useState(false);

  const accent = STROKE[colorKey];

  const create = async () => {
    setBusy(true);
    try {
      await api.createClan({
        name: name.trim(),
        tag: tag.trim().toUpperCase(),
        color_key: colorKey,
        badge_icon: badge,
        privacy,
      });
      await refresh();
      toast.success('Club created');
      navigation.goBack();
    } catch (e) {
      toast.error(e.message || 'Could not create club');
    } finally {
      setBusy(false);
    }
  };

  const valid = name.trim().length >= 3 && tag.trim().length >= 2;

  return (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      <View style={[styles.preview, { backgroundColor: withAlpha(accent, 0.12) }]}>
        <ClanBadge icon={badge} size={40} color={accent} />
        <Text style={[type.title, { marginTop: space.sm }]}>[{tag.toUpperCase() || 'TAG'}] {name || 'Club name'}</Text>
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={24} placeholder="Night Owls" placeholderTextColor={colors.textDim} />

      <Text style={styles.label}>Tag (2–5)</Text>
      <TextInput style={styles.input} value={tag} onChangeText={(v) => setTag(v.toUpperCase())} maxLength={5} autoCapitalize="characters" placeholder="OWLS" placeholderTextColor={colors.textDim} />

      <Text style={styles.label}>Color</Text>
      <View style={styles.swatchRow}>
        {COLOR_KEYS.map((k) => (
          <TouchableOpacity
            key={k}
            onPress={() => setColorKey(k)}
            style={[styles.swatch, { backgroundColor: STROKE[k] }, colorKey === k && styles.swatchOn]}
            accessibilityRole="button"
            accessibilityLabel={`Color ${k}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Badge</Text>
      <View style={styles.badgeRow}>
        {BADGE_KEYS.map((k) => (
          <TouchableOpacity
            key={k}
            onPress={() => setBadge(k)}
            style={[styles.badgeCell, badge === k && { borderColor: accent, backgroundColor: withAlpha(accent, 0.1) }]}
            accessibilityRole="button"
            accessibilityLabel={`Badge ${k}`}
          >
            <ClanBadge icon={k} size={22} color={badge === k ? accent : colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Privacy</Text>
      <Segmented
        options={[{ key: 'open', label: 'Open' }, { key: 'invite_only', label: 'Invite only' }]}
        value={privacy}
        onChange={setPrivacy}
        style={{ marginBottom: space.xl }}
      />

      <Button title="Create club" variant="gradient" onPress={create} loading={busy} disabled={!valid} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', borderRadius: radius.card, padding: space.xl, marginBottom: space.lg },
  label: { ...type.labelSm, marginTop: space.md, marginBottom: 6 },
  input: {
    ...type.body, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 14,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  badgeCell: {
    width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
});
