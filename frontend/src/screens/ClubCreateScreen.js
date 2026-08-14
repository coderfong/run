// Create-club flow: name, tag, color (12), photo, privacy.

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Camera, ChevronLeft, Images, Trash2 } from 'lucide-react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { radius, space, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Button, Framed, Segmented } from '../components/ui';
import ClanBadge from '../components/ClanBadge';
import { Image } from '../ui/image';
import { pickPhoto } from '../ui/photoPicker';
import { toast } from '../ui/toast';
import { PressableScale, Reveal, haptic, staggerDelay } from '../ui/motion';
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
  const [photo, setPhoto] = useState(null);
  // Counts photo changes so the crest can re-enter on each one. The image
  // itself is a megabyte of base64 and makes a poor React key.
  const [photoTake, setPhotoTake] = useState(0);
  const [picking, setPicking] = useState(null);
  const [privacy, setPrivacy] = useState('open');
  const [busy, setBusy] = useState(false);

  const accent = STROKE[colorKey];

  // The crop is square because the crest is drawn square everywhere, and the
  // server re-crops anyway; doing it here is what lets you see the framing you
  // are going to get.
  const choosePhoto = async (source) => {
    setPicking(source);
    try {
      const picked = await pickPhoto(source, { square: true });
      if (picked) {
        haptic.light();
        setPhoto(picked);
        setPhotoTake((n) => n + 1);
      }
    } catch (e) {
      toast.error(e.message || 'Could not add that photo');
    } finally {
      setPicking(null);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await api.createClan({
        name: name.trim(),
        tag: tag.trim().toUpperCase(),
        color_key: colorKey,
        photo,
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
          {/* Keyed on the photo so picking a new one re-enters the crest
              rather than swapping it in place. Tapping the crest is the
              shortest path to the picker; the buttons below spell it out. */}
          <Reveal key={photoTake} from="none" duration={220}>
            <PressableScale
              onPress={() => choosePhoto('library')}
              scaleTo={0.94}
              accessibilityRole="button"
              accessibilityLabel="Choose a club photo"
            >
              <View style={[styles.previewBadge, { backgroundColor: accent }]}>
                {photo ? (
                  <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <ClanBadge icon="shield" size={42} color="#FFFFFF" />
                )}
              </View>
            </PressableScale>
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

      <Text style={styles.label}>Club photo</Text>
      <Text style={[type.caption, { marginBottom: space.sm }]}>
        Give your crew a face. You can change it later.
      </Text>
      {/* three compact actions wrap rather than squeeze on a narrow phone */}
      <View style={styles.photoActions}>
        <Button
          title={picking === 'library' ? 'Opening…' : photo ? 'Change photo' : 'Choose photo'}
          variant="secondary"
          size="sm"
          full={false}
          disabled={picking != null}
          icon={<Images size={16} color={colors.text} />}
          onPress={() => choosePhoto('library')}
        />
        <Button
          title={picking === 'camera' ? 'Opening…' : 'Take photo'}
          variant="secondary"
          size="sm"
          full={false}
          disabled={picking != null}
          icon={<Camera size={16} color={colors.text} />}
          onPress={() => choosePhoto('camera')}
        />
        {photo ? (
          <Button
            title="Remove"
            variant="secondary"
            size="sm"
            full={false}
            icon={<Trash2 size={16} color={colors.text} />}
            onPress={() => { setPhoto(null); setPhotoTake((n) => n + 1); }}
          />
        ) : null}
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
  previewBadge: {
    width: 78, height: 78, borderRadius: 39, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  label: { ...type.labelSm, marginTop: space.md, marginBottom: 6 },
  input: {
    ...type.body, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 14,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
