// The post-run share flow. Pick the format and the background, see EXACTLY
// what posts, then send it into the Instagram story composer (or anywhere else
// via the system sheet). The preview is the same component that gets captured,
// so there is no "that isn't what I saw" gap.
//
// The photo background is the piece that makes this read like Strava rather
// than like a screenshot: the runner's own picture behind their numbers. It is
// optional in every sense — `expo-image-picker` is required lazily, so a
// binary built before it simply doesn't offer the button.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { LinearGradient } from 'expo-linear-gradient';

import RunShareCard, {
  ACCENTS,
  CARD_INK,
  DEFAULT_STATS,
  SHARE_FORMATS,
  availableStats,
} from './RunShareCard';
import { Segmented } from '../ui';
import { darkColors, radius, space, type } from '../../theme';
import { PressableScale, haptic } from '../../ui/motion';
import { toast } from '../../ui/toast';
import {
  canShareToInstagramStories,
  shareToInstagramStories,
  shareToSystemSheet,
} from '../../utils/socialShare';

const D = darkColors;

// Instagram's own gradient, so the destination is recognisable at a glance.
const IG_GRADIENT = ['#F9CE34', '#EE2A7B', '#6228D7'];

// Lazily resolved: adding the picker means a native module, and an older
// binary must lose the photo button rather than crash on import.
let pickerModule;
function imagePicker() {
  if (pickerModule === undefined) {
    try {
      pickerModule = require('expo-image-picker');
    } catch {
      pickerModule = null;
    }
  }
  return pickerModule;
}

// A labelled strip of controls.
function Row({ label, children }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }) {
  return (
    <PressableScale
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </PressableScale>
  );
}

// `closeLabel` exists because this sheet is now the LAST stage of the result
// flow, not a detour off it: closing it goes Home, so "Close" would be a lie
// about where the button leads. Anywhere it really is a detour keeps the
// default.
export default function RunShareSheet({ visible, onClose, closeLabel = 'Close', ...cardProps }) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardRef = useRef(null);
  const [format, setFormat] = useState('story');
  const [busy, setBusy] = useState(null); // 'story' | 'more' | 'photo'
  const [igReady, setIgReady] = useState(false);
  const [background, setBackground] = useState('colour'); // 'colour' | 'photo' | 'none'
  const [photoUri, setPhotoUri] = useState(null);

  // Everything the runner can change about the card. Defaults are the clan
  // colour and the run's own headline stats, so the card is already right
  // before anyone touches a control.
  const clanColor = cardProps.team?.glow;
  const [accent, setAccent] = useState(clanColor);
  const [textColor, setTextColor] = useState('light');
  const [align, setAlign] = useState('left');
  const [showRoute, setShowRoute] = useState(true);
  const [showCharacter, setShowCharacter] = useState(true);
  const [flip, setFlip] = useState(false);
  const offered = useMemo(() => availableStats(cardProps.run), [cardProps.run]);
  const [statKeys, setStatKeys] = useState(() =>
    DEFAULT_STATS.filter((k) => offered.some((s) => s.key === k))
  );

  // The clan's own colour leads the swatches; it is the one most runners want
  // and the one the rest of the app already uses for them.
  const swatches = useMemo(
    () => (clanColor ? [{ key: 'clan', color: clanColor }, ...ACCENTS] : ACCENTS),
    [clanColor]
  );

  const toggleStat = (key) =>
    setStatKeys((keys) => {
      if (keys.includes(key)) {
        // Never all the way to nothing: an empty stat block is a card with a
        // hole in it, and the runner has no way to see what they lost.
        return keys.length > 1 ? keys.filter((k) => k !== key) : keys;
      }
      // Six is three rows, which is the point where the route has nowhere left
      // to be drawn.
      return keys.length >= 6 ? keys : [...keys, key];
    });
  // The capture must not fire while the chosen photo is still decoding, or it
  // rasterises a hole where the background should be.
  const photoReady = useRef(true);

  // Ask once per open — the runner may have installed Instagram since.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    canShareToInstagramStories().then((ok) => { if (alive) setIgReady(!!ok); });
    return () => { alive = false; };
  }, [visible]);

  const onPhotoReady = useCallback(() => { photoReady.current = true; }, []);

  const spec = SHARE_FORMATS[format];
  // The preview is the real card, just smaller: fit it to whichever axis runs
  // out first. The controls scroll under it, so the preview is deliberately
  // kept to about half the screen rather than filling it.
  const chrome = 250 + insets.top + insets.bottom;
  const previewW = Math.max(
    128,
    Math.min(
      screenW - space.lg * 2,
      (screenH - chrome) / spec.ratio,
      screenH * 0.34 / spec.ratio
    )
  );

  const pickPhoto = async () => {
    const Picker = imagePicker();
    if (!Picker) {
      toast.error('Photo backgrounds need a newer build of PASER.');
      return;
    }
    setBusy('photo');
    try {
      const perm = await Picker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error('PASER needs photo access to put a picture behind your run.');
        return;
      }
      const res = await Picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        // The card crops to fill, so an editor here would only fight it.
        allowsEditing: false,
      });
      const uri = res?.assets?.[0]?.uri;
      if (!res?.canceled && uri) {
        photoReady.current = false;
        setPhotoUri(uri);
        setBackground('photo');
      }
    } catch (e) {
      toast.error(e?.message || 'Could not open your photos');
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    // Wait for the background photo to decode (bounded — a photo that never
    // reports is still worth exporting over letting the button hang).
    for (let i = 0; i < 40 && !photoReady.current; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // One more beat so the SVG route has certainly drawn — longer with the
    // avatar up, because the rig draws through `expo-image` and a layer that is
    // still decoding captures as nothing. In practice it has been on screen in
    // the preview for as long as the runner has been choosing controls, so this
    // is insurance rather than the mechanism.
    // The posed runner is NINE clipped copies of the rig, so it has the most
    // images of anything on the card to get decoded and drawn.
    await new Promise((r) => setTimeout(r, showCharacter ? 400 : 60));
    return captureRef(cardRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      fileName: `paser-run-${format}`,
      ...spec.export,
    });
  };

  const toStory = async () => {
    if (busy) return;
    setBusy('story');
    try {
      haptic.light();
      const uri = await capture();
      // As a sticker the card goes on top of whatever the runner already has
      // on their story; otherwise Instagram paints the canvas around the image,
      // and handing it the card's own ink is what stops the post looking like a
      // card floating on black.
      const res = await shareToInstagramStories(uri, {
        background: CARD_INK,
        asSticker: background === 'none',
      });
      if (res.ok) {
        if (!res.cancelled) onClose?.();
        return;
      }
      // Instagram refused (no app, old binary, story API knocked back). The
      // image is already made — put it in the system sheet rather than
      // dead-ending on an error.
      toast.show('Opening the share sheet instead…');
      const fallback = await shareToSystemSheet(uri);
      if (!fallback.ok) toast.error(fallback.reason);
    } catch (e) {
      toast.error(e?.message || 'Could not share to Instagram');
    } finally {
      setBusy(null);
    }
  };

  const toSystemSheet = async () => {
    if (busy) return;
    setBusy('more');
    try {
      haptic.light();
      const uri = await capture();
      const res = await shareToSystemSheet(uri);
      if (!res.ok) toast.error(res.reason);
    } catch (e) {
      toast.error(e?.message || 'Could not share');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Share your run</Text>
          <PressableScale
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={closeLabel === 'Done' ? 'Finish and go home' : 'Close sharing'}
          >
            <Text style={styles.close}>{closeLabel}</Text>
          </PressableScale>
        </View>

        <Segmented
          style={styles.formats}
          value={format}
          onChange={setFormat}
          labelSuffix="format"
          options={[
            { key: 'story', label: 'Story  9:16' },
            { key: 'square', label: 'Post  1:1' },
          ]}
        />

        <ScrollView
          style={styles.scroller}
          contentContainerStyle={styles.previewWrap}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
        >
          {/* The exact pixels that get posted. A transparent card is previewed
              over a stand-in "story" so the runner can see what shows through
              rather than judging white text on the app's own dark background. */}
          <View style={styles.previewShadow}>
            {background === 'none' && (
              <LinearGradient
                colors={['#5B6472', '#39404B', '#22262E']}
                style={StyleSheet.absoluteFill}
              />
            )}
            <RunShareCard
              {...cardProps}
              cardRef={cardRef}
              format={format}
              width={previewW}
              background={background}
              photoUri={photoUri}
              onPhotoReady={onPhotoReady}
              accent={accent}
              textColor={textColor}
              align={align}
              stats={statKeys}
              showRoute={showRoute}
              showCharacter={showCharacter}
              flip={flip}
            />
          </View>

          {/* --- customise ------------------------------------------------ */}

          <Row label="Accent">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {swatches.map((s) => {
                  const on = accent === s.color;
                  return (
                    <PressableScale
                      key={s.key}
                      onPress={() => setAccent(s.color)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${s.key} accent`}
                      style={[styles.swatch, { backgroundColor: s.color }, on && styles.swatchOn]}
                    />
                  );
                })}
              </View>
            </ScrollView>
          </Row>

          <Row label="Text">
            <View style={styles.controlStack}>
              <View style={styles.controlGroup}>
                <Text style={styles.controlLabel}>COLOUR</Text>
                <View style={styles.chipWrap}>
                  {[
                    { key: 'light', label: 'Light' },
                    { key: 'dark', label: 'Dark' },
                  ].map((o) => (
                    <Chip
                      key={o.key}
                      label={o.label}
                      on={textColor === o.key}
                      onPress={() => setTextColor(o.key)}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.controlGroup}>
                <Text style={styles.controlLabel}>ALIGNMENT</Text>
                <View style={styles.chipWrap}>
                  {[
                    { key: 'left', label: 'Left' },
                    { key: 'center', label: 'Centre' },
                    { key: 'right', label: 'Right' },
                  ].map((o) => (
                    <Chip
                      key={o.key}
                      label={o.label}
                      on={align === o.key}
                      onPress={() => setAlign(o.key)}
                    />
                  ))}
                </View>
              </View>
            </View>
          </Row>

          <Row label="Runner">
            <View style={styles.chipWrap}>
              <Chip
                label={showCharacter ? 'On' : 'Off'}
                on={showCharacter}
                onPress={() => setShowCharacter((v) => !v)}
              />
              {showCharacter && (
                <Chip label="Flip" on={flip} onPress={() => setFlip((v) => !v)} />
              )}
            </View>
          </Row>

          <Row label="Stats">
            <View style={styles.chipWrap}>
              {offered.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  on={statKeys.includes(s.key)}
                  onPress={() => toggleStat(s.key)}
                />
              ))}
              <Chip label="Route" on={showRoute} onPress={() => setShowRoute((v) => !v)} />
            </View>
          </Row>

          <Row label="Background">
            <View style={styles.bgRow}>
              <PressableScale
                style={[styles.bgBtn, background === 'none' && styles.bgBtnOn]}
                onPress={() => {
                  photoReady.current = true;
                  setBackground('none');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: background === 'none' }}
                accessibilityLabel="No background, overlay on your story"
              >
                <Text style={[styles.bgText, background === 'none' && styles.bgTextOn]}>
                  None
                </Text>
              </PressableScale>
              <PressableScale
                style={[styles.bgBtn, background === 'colour' && styles.bgBtnOn]}
                onPress={() => {
                  photoReady.current = true;
                  setBackground('colour');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: background === 'colour' }}
                accessibilityLabel="Colour background"
              >
                <Text style={[styles.bgText, background === 'colour' && styles.bgTextOn]}>
                  Colour
                </Text>
              </PressableScale>
              <PressableScale
                style={[styles.bgBtn, background === 'photo' && styles.bgBtnOn]}
                onPress={pickPhoto}
                disabled={busy === 'photo'}
                accessibilityRole="button"
                accessibilityState={{ selected: background === 'photo' }}
                accessibilityLabel="Photo background"
              >
                <Text style={[styles.bgText, background === 'photo' && styles.bgTextOn]}>
                  {busy === 'photo' ? 'Opening…' : photoUri ? 'Change' : 'Photo'}
                </Text>
              </PressableScale>
            </View>
          </Row>

          {background === 'none' && (
            <Text style={styles.hint}>
              Instagram opens this as a sticker. Pick your own photo or selfie behind it,
              then drag it where you want.
            </Text>
          )}
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
          {igReady && (
            <PressableScale
              onPress={toStory}
              disabled={!!busy}
              accessibilityRole="button"
              accessibilityLabel="Share to Instagram Stories"
            >
              <LinearGradient
                colors={IG_GRADIENT}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryText}>
                  {busy === 'story' ? 'Opening Instagram…' : 'Share to Instagram Stories'}
                </Text>
              </LinearGradient>
            </PressableScale>
          )}

          <PressableScale
            style={styles.secondaryBtn}
            onPress={toSystemSheet}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel="Share somewhere else"
          >
            <Text style={styles.secondaryText}>
              {busy === 'more' ? 'Preparing…' : igReady ? 'More options' : 'Share'}
            </Text>
          </PressableScale>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg, paddingHorizontal: space.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  title: { ...type.title, color: D.text },
  close: { ...type.bodySmBold, color: D.textMuted },
  formats: { marginBottom: space.md },
  scroller: { flex: 1, minHeight: 0 },
  previewWrap: { alignItems: 'center', paddingVertical: space.xs, paddingBottom: space.xl },

  row: { marginTop: space.md, alignSelf: 'stretch' },
  rowLabel: { ...type.labelSm, color: D.textDim, marginBottom: space.sm },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  controlStack: { gap: space.md },
  controlGroup: { gap: 6 },
  controlLabel: { ...type.caption, color: D.textDim },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: D.border,
  },
  chipOn: { backgroundColor: D.primary, borderColor: D.primary },
  chipText: { ...type.bodySm, color: D.textMuted },
  chipTextOn: { ...type.bodySmBold, color: D.primaryInk },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  // The selected swatch is ringed rather than recoloured — a colour control
  // that changes colour to show selection is unreadable.
  swatchOn: { borderWidth: 3, borderColor: '#FFFFFF' },

  previewShadow: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: D.border,
  },
  actions: {
    paddingTop: space.md,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: D.border,
    backgroundColor: D.bg,
  },
  bgRow: { flexDirection: 'row', gap: space.sm },
  bgBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: D.border,
  },
  bgBtnOn: { backgroundColor: D.primary, borderColor: D.primary },
  bgText: { ...type.buttonSm, fontSize: 13, color: D.textMuted },
  bgTextOn: { ...type.buttonSm, fontSize: 13, color: D.primaryInk },
  hint: { ...type.caption, color: D.textDim, textAlign: 'center' },
  primaryBtn: { paddingVertical: 16, borderRadius: radius.pill, alignItems: 'center' },
  primaryText: { ...type.button, color: '#fff' },
  secondaryBtn: {
    paddingVertical: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: D.border,
  },
  secondaryText: { ...type.button, color: D.text },
});
