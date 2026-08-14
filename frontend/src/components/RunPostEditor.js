// The editable content attached to a run in Home: an optional caption and up
// to four photos. The share artwork is deliberately separate; changing what
// appears in the feed must not silently change the Instagram export.

import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Camera, Images, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, apiPhotoSource } from '../api/client';
import { invalidate, updateCached } from '../api/cache';
import { radius, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { PressableScale, haptic } from '../ui/motion';
import { toast } from '../ui/toast';
import { MAX_DATA_URI_LENGTH, dataUri, imagePicker } from '../ui/photoPicker';

export const MAX_POST_PHOTOS = 4;
export const MAX_CAPTION = 280;

function PickerButton({ label, Icon, disabled, onPress }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      containerStyle={styles.pickerButtonContainer}
      style={[styles.pickerButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={19} color={colors.text} strokeWidth={2.3} />
      <Text style={[type.bodySmBold, { color: colors.text }]}>{label}</Text>
    </PressableScale>
  );
}

export default function RunPostEditor({
  runId,
  initialCaption = '',
  initialMedia,
  onSaved,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const [caption, setCaption] = useState(initialCaption || '');
  const [media, setMedia] = useState(initialMedia || []);
  const [busy, setBusy] = useState(null);
  const [saving, setSaving] = useState(false);
  // The global toast host is mounted once at the app root, and a native
  // <Modal> — which is what this editor lives inside of — presents in its own
  // window above that whole tree. On iOS especially, that means a `toast.*()`
  // call made from in here never becomes visible: every failure looked like
  // the button silently doing nothing. Shown inline instead, next to the
  // thing that failed, so it can't get lost behind the sheet that raised it.
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    setCaption(initialCaption || '');
    setMedia(initialMedia || []);
  }, [runId, initialCaption, initialMedia]);

  const fail = (message) => {
    setFormError(message);
    toast.error(message);
  };

  const addPhotos = async (source) => {
    setFormError(null);
    const Picker = imagePicker();
    if (!Picker) {
      fail('Photo editing needs the latest PASER app update.');
      return;
    }
    const remaining = MAX_POST_PHOTOS - media.length;
    if (remaining <= 0) return;

    setBusy(source);
    try {
      const permission = source === 'camera'
        ? await Picker.requestCameraPermissionsAsync()
        : await Picker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        fail(
          source === 'camera'
            ? 'PASER needs camera access to take a post photo.'
            : 'PASER needs photo access to add pictures to your post.'
        );
        return;
      }

      const options = {
        mediaTypes: ['images'],
        base64: true,
        quality: 0.55,
        exif: false,
        allowsEditing: source === 'camera',
        ...(source === 'library'
          ? { allowsMultipleSelection: true, selectionLimit: remaining }
          : null),
      };
      const result = source === 'camera'
        ? await Picker.launchCameraAsync(options)
        : await Picker.launchImageLibraryAsync(options);
      if (result?.canceled) return;

      const next = (result?.assets || []).slice(0, remaining).map(dataUri).filter(Boolean);
      const acceptable = next.filter((value) => value.length <= MAX_DATA_URI_LENGTH);
      if (acceptable.length !== next.length) {
        fail('One photo was too large. Try a screenshot or a smaller image.');
      }
      if (acceptable.length) {
        haptic.light();
        setMedia((current) => [...current, ...acceptable].slice(0, MAX_POST_PHOTOS));
      }
    } catch (error) {
      fail(error?.message || 'Could not add that photo');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!runId || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const post = await api.updateRunPost(runId, caption.trim(), media);
      haptic.success();
      updateCached('feed', (feed) => ({
        ...(feed || {}),
        items: (feed?.items || []).map((item) =>
          item.id === runId
            ? { ...item, caption: post.caption, media: post.media }
            : item
        ),
      }));
      invalidate('me:runs');
      setCaption(post.caption || '');
      setMedia(post.media || []);
      onSaved?.(post);
      toast.show('Post updated');
    } catch (error) {
      fail(error?.message || 'Could not update your post');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.editor}>
      <TextInput
        style={[styles.caption, type.body, { color: colors.text }]}
        value={caption}
        onChangeText={setCaption}
        placeholder="Add a caption to your run…"
        placeholderTextColor={colors.textDim}
        multiline
        maxLength={MAX_CAPTION}
        textAlignVertical="top"
        accessibilityLabel="Run post caption"
      />
      <Text style={[type.caption, styles.count]}>{caption.length}/{MAX_CAPTION}</Text>

      {media.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoRow}
        >
          {media.map((uri, index) => (
            <View key={`${index}:${uri.length}`} style={styles.photoWrap}>
              <Image source={apiPhotoSource(uri)} style={styles.photo} resizeMode="cover" />
              <PressableScale
                style={styles.removePhoto}
                onPress={() => setMedia((items) => items.filter((_, i) => i !== index))}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
              >
                <Trash2 size={15} color="#FFFFFF" strokeWidth={2.4} />
              </PressableScale>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.pickerRow}>
        <PickerButton
          label={busy === 'library' ? 'Opening…' : 'Camera roll'}
          Icon={Images}
          disabled={!!busy || media.length >= MAX_POST_PHOTOS}
          onPress={() => addPhotos('library')}
        />
        <PickerButton
          label={busy === 'camera' ? 'Opening…' : 'Take photo'}
          Icon={Camera}
          disabled={!!busy || media.length >= MAX_POST_PHOTOS}
          onPress={() => addPhotos('camera')}
        />
      </View>

      {formError ? (
        <Text style={[type.captionMedium, styles.errorText]}>{formError}</Text>
      ) : null}

      <PressableScale
        style={[styles.save, (!runId || saving) && styles.disabled]}
        disabled={!runId || saving}
        onPress={save}
        accessibilityRole="button"
        accessibilityLabel="Save run post"
      >
        <Text style={[type.buttonSm, { color: colors.primaryInk }]}>
          {saving ? 'Saving…' : 'Save post'}
        </Text>
      </PressableScale>
    </View>
  );
}

export function RunPostEditorModal({ visible, onClose, ...props }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View
        style={[
          styles.modal,
          { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg },
        ]}
      >
        <View style={styles.modalHead}>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: colors.text }]}>Edit post</Text>
            <Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>
              These photos and this caption appear on your Home runner card.
            </Text>
          </View>
          <PressableScale
            style={styles.close}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close post editor"
          >
            <X size={24} color={colors.text} />
          </PressableScale>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>
          <RunPostEditor {...props} onSaved={(post) => { props.onSaved?.(post); onClose?.(); }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  editor: { alignSelf: 'stretch' },
  caption: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    padding: space.md,
  },
  count: { alignSelf: 'flex-end', color: colors.textDim, marginTop: 4 },
  errorText: { color: colors.danger, marginTop: space.sm },
  photoRow: { gap: space.sm, paddingVertical: space.md },
  photoWrap: { width: 116, height: 116 },
  photo: { width: 116, height: 116, borderRadius: radius.md, backgroundColor: colors.cardAlt },
  removePhoto: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  pickerButtonContainer: {
    flexGrow: 1,
    minWidth: 130,
  },
  pickerButton: {
    width: '100%',
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: space.md,
  },
  save: {
    minHeight: 50,
    marginTop: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  modal: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalBody: { paddingTop: space.xl, paddingBottom: space.xxl },
});
