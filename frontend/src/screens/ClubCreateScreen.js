// Create-club flow: name, tag, color (12), badge (16), privacy.

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { radius, space, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Button, Framed, Segmented } from '../components/ui';
import ClanBadge, { BADGE_KEYS } from '../components/ClanBadge';
import { toast } from '../ui/toast';
import { PressableScale, Reveal, staggerDelay } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';

// Must match the server palette keys (clans_meta.py).
const COLOR_KEYS = ['violet', 'emerald', 'azure', 'crimson', 'amber', 'teal', 'rose', 'indigo', 'lime', 'cyan', 'fuchsia', 'orange'];
const STROKE = {
  violet: '#9333ea', emerald: '#15803d', azure: '#2563eb', crimson: '#dc2626',
  amber: '#b45309', teal: '#0f766e', rose: '#be123c', indigo: '#4338ca',
  lime: '#4d7c0f', cyan: '#0e7490', fuchsia: '#a21caf', orange: '#c2410c',
};

export default function ClubCreateScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
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
      <View style={styles.pageHead}>
        <PressableScale
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color={colors.text} />
        </PressableScale>
        <Text style={type.title}>Create your club</Text>
      </View>
      {/* The preview is the point of this screen — it is what the club will
          look like — so it arrives first and the form follows it in. */}
      <Reveal>
        <Framed
          frame={frameVariant('banner', 'club-preview')}
          tint={accent}
          fill={withAlpha(accent, 0.15)}
          weight={INK.medium}
          pose={framePose('club-preview')}
          inset={false}
          style={styles.preview}
          contentStyle={styles.previewInner}
        >
          {/* Keyed on the badge so picking a new one re-enters the mark rather
              than swapping it in place. */}
          <Reveal key={badge} from="none" duration={220}>
            <View style={[styles.previewBadge, { backgroundColor: accent }]}>
              <ClanBadge icon={badge} size={42} color="#FFFFFF" />
            </View>
          </Reveal>
          <Text style={[type.title, { marginTop: space.sm }]}>[{tag.toUpperCase() || 'TAG'}] {name || 'Club name'}</Text>
        </Framed>
      </Reveal>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={24} placeholder="Night Owls" placeholderTextColor={colors.textDim} />

      <Text style={styles.label}>Tag (2 to 5 characters)</Text>
      <TextInput style={styles.input} value={tag} onChangeText={(v) => setTag(v.toUpperCase())} maxLength={5} autoCapitalize="characters" placeholder="OWLS" placeholderTextColor={colors.textDim} />

      <Text style={styles.label}>Color</Text>
      <View style={styles.swatchRow}>
        {COLOR_KEYS.map((k, i) => (
          <Reveal key={k} delay={staggerDelay(i)} duration={240}>
            <PressableScale
              onPress={() => setColorKey(k)}
              scaleTo={0.88}
              style={[styles.swatch, { backgroundColor: STROKE[k] }, colorKey === k && styles.swatchOn]}
              accessibilityRole="button"
              accessibilityLabel={`Color ${k}`}
            />
          </Reveal>
        ))}
      </View>

      <Text style={styles.label}>Badge</Text>
      <View style={styles.badgeRow}>
        {BADGE_KEYS.map((k, i) => (
          <Reveal key={k} delay={staggerDelay(i)} duration={240}>
            <PressableScale
              onPress={() => setBadge(k)}
              scaleTo={0.9}
              style={styles.badgePress}
              accessibilityRole="button"
              accessibilityLabel={`Badge ${k}`}
            >
              <Framed
                frame={frameVariant('badge', `club-badge:${k}`)}
                tint={badge === k ? colors.text : colors.border}
                fill={badge === k ? accent : colors.card}
                weight={badge === k ? INK.medium : INK.thin}
                pose={framePose(`club-badge:${k}`)}
                inset={false}
                style={styles.badgeCell}
                contentStyle={styles.badgeInner}
              >
                <ClanBadge icon={k} size={24} color={badge === k ? '#FFFFFF' : colors.textMuted} />
              </Framed>
            </PressableScale>
          </Reveal>
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

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, marginBottom: space.md },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  preview: { minHeight: 170, marginBottom: space.lg },
  previewInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  previewBadge: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
  label: { ...type.labelSm, marginTop: space.md, marginBottom: 6 },
  input: {
    ...type.body, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 14,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  badgePress: { width: 52, height: 52 },
  badgeCell: { width: 52, height: 52 },
  badgeInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
