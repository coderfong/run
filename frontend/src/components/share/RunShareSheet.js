// The post-run share flow. Tune the card, see EXACTLY what posts, then send it
// wherever it is going. The preview is the same component that gets captured,
// so there is no "that isn't what I saw" gap.
//
// THE CARD IS ALWAYS TRANSPARENT. There is no background chooser: no colour
// wash, no photo picker. Instagram gets a transparent PNG as a STICKER and the
// runner's own story — their selfie, their photo, their plain colour — is the
// background. That is the Strava behaviour, and it is the only one worth
// having: a card with its own background covers the story it is posted onto,
// and the two backgrounds then fight each other for the same 9:16.
//
// The preview therefore sits on a CHECKERBOARD rather than on the app's own
// surface, because "transparent" and "dark grey" look identical against a dark
// screen and the runner has to be able to tell which one they are getting.

import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { Copy, Download, Instagram, Share2 } from 'lucide-react-native';

import RunShareCard, {
  ACCENTS,
  CARD_INK,
  DEFAULT_STATS,
  SHARE_FORMATS,
  availableStats,
} from './RunShareCard';
import RunPostEditor from '../RunPostEditor';
import { Segmented } from '../ui';
import { radius, space, useTheme, useThemedStyles } from '../../theme';
import { PressableScale, haptic } from '../../ui/motion';
import { toast } from '../../ui/toast';

// Instagram's own gradient, so the destination is recognisable at a glance.
const IG_GRADIENT = ['#F9CE34', '#EE2A7B', '#6228D7'];

// The transparency checkerboard, in the size Photoshop and Figma use. Drawn as
// one SVG pattern rather than a grid of Views: a 9:16 preview is a couple of
// hundred squares, and that is a couple of hundred native views for decoration.
const CHECKER = 12;

// Keep optional native sharing code out of the initial render. This screen can
// be delivered over the air to older binaries that do not contain every
// native module yet.
const socialShare = () => require('../../utils/socialShare');

function Checkerboard({ style }) {
  return (
    <Svg style={style} width="100%" height="100%">
      <Defs>
        <Pattern
          id="checker"
          width={CHECKER * 2}
          height={CHECKER * 2}
          patternUnits="userSpaceOnUse"
        >
          <Rect x={0} y={0} width={CHECKER * 2} height={CHECKER * 2} fill="#4A4A4E" />
          <Rect x={0} y={0} width={CHECKER} height={CHECKER} fill="#38383C" />
          <Rect x={CHECKER} y={CHECKER} width={CHECKER} height={CHECKER} fill="#38383C" />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#checker)" />
    </Svg>
  );
}

// The card, or a stand-in the same size as it.
//
// Deliberately its own tiny boundary rather than the app-wide one: this is a
// preview inside a working sheet, and replacing the whole screen with "try
// again" would take the destinations, the format switch and the way home with
// it. Reported to Sentry either way, because a card that will not draw is a
// card that will not export.
class ShareBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    try {
      Sentry.captureException(error);
    } catch {}
  }

  render() {
    const { width, height, styles, children } = this.props;
    if (!this.state.failed) return children;
    return (
      <View style={[styles.cardFallback, { width, height }]}>
        <Text style={styles.cardFallbackText}>
          This run could not be drawn as a card.
        </Text>
      </View>
    );
  }
}

// A labelled strip of controls.
function Row({ label, children }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }) {
  const styles = useThemedStyles(makeStyles);
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

// One destination in the "Share to" row: a round target with its name under it,
// which is the shape every share sheet in every app already uses.
function Destination({ label, busyLabel, busy, disabled, onPress, gradient, children }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const Body = gradient ? LinearGradient : View;
  const bodyProps = gradient
    ? { colors: gradient, start: { x: 0, y: 1 }, end: { x: 1, y: 0 } }
    : {};
  return (
    <PressableScale
      style={styles.destination}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Body
        {...bodyProps}
        style={[styles.destinationDisc, !gradient && { backgroundColor: colors.cardAlt }]}
      >
        {children}
      </Body>
      <Text style={styles.destinationLabel} numberOfLines={2}>
        {busy ? busyLabel : label}
      </Text>
    </PressableScale>
  );
}

// `closeLabel` exists because this sheet is now the LAST stage of the result
// flow, not a detour off it: closing it goes Home, so "Close" would be a lie
// about where the button leads. Anywhere it really is a detour keeps the
// default.
export default function RunShareSheet({ visible, onClose, closeLabel = 'Close', ...cardProps }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardRef = useRef(null);
  const [format, setFormat] = useState('story');
  const [busy, setBusy] = useState(null); // 'story' | 'save' | 'copy' | 'more'
  const [editorReady, setEditorReady] = useState(false);

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

  // Ask once per open — the runner may have installed Instagram since.
  useEffect(() => {
    if (!visible) {
      setEditorReady(false);
      return undefined;
    }
    let alive = true;
    let timer;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (alive) setEditorReady(true);
      }, 80);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      task?.cancel?.();
    };
  }, [visible]);

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

  // `result` is 'tmpfile' for anything that takes a URI and 'base64' for the
  // clipboard, which wants the bytes rather than a path.
  const capture = async (result = 'tmpfile') => {
    // One beat so the SVG route has certainly drawn — longer with the avatar
    // up, because the rig draws through `expo-image` and a layer that is still
    // decoding captures as nothing. In practice it has been on screen in the
    // preview for as long as the runner has been choosing controls, so this is
    // insurance rather than the mechanism.
    // The posed runner is NINE clipped copies of the rig, so it has the most
    // images of anything on the card to get decoded and drawn.
    await new Promise((r) => setTimeout(r, showCharacter ? 400 : 60));
    const viewShot = require('react-native-view-shot');
    const captureView = viewShot.captureRef || viewShot.default?.captureRef;
    if (!captureView) throw new Error('Sharing needs a newer build of PASER.');
    return captureView(cardRef, {
      format: 'png',
      quality: 1,
      result,
      fileName: `paser-run-${format}`,
      ...spec.export,
    });
  };

  // Every destination is the same shape: go busy, make the image, hand it over,
  // report whatever came back. Only the middle step differs.
  const perform = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    try {
      haptic.light();
      await fn();
    } catch (e) {
      toast.error(e?.message || 'Could not share your run');
    } finally {
      setBusy(null);
    }
  };

  const toStory = () =>
    perform('story', async () => {
      const { shareToInstagramStories, shareToSystemSheet } = socialShare();
      const uri = await capture();
      // Always a sticker: the card is transparent, so it goes ON TOP of the
      // runner's own story rather than becoming the story.
      const res = await shareToInstagramStories(uri, { background: CARD_INK, asSticker: true });
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
    });

  const toPhotos = () =>
    perform('save', async () => {
      const { saveToPhotos } = socialShare();
      const res = await saveToPhotos(await capture());
      if (res.ok) toast.show('Saved to your photos');
      else toast.error(res.reason);
    });

  const toClipboard = () =>
    perform('copy', async () => {
      const { copyImageToClipboard } = socialShare();
      const res = await copyImageToClipboard(await capture('base64'));
      if (res.ok) toast.show('Copied. Paste it into your story.');
      else toast.error(res.reason);
    });

  const toSystemSheet = () =>
    perform('more', async () => {
      const { shareToSystemSheet } = socialShare();
      const res = await shareToSystemSheet(await capture());
      if (!res.ok) toast.error(res.reason);
    });

  const shareCapabilities = editorReady ? socialShare() : null;
  const canSave = !!shareCapabilities?.canSaveToPhotos?.();
  const canCopy = !!shareCapabilities?.canCopyImage?.();

  if (!visible) return null;

  return (
    <View style={[styles.screen, styles.fullScreen, { paddingTop: insets.top + space.sm }]}>
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

        {editorReady ? <Segmented
          style={styles.formats}
          value={format}
          onChange={setFormat}
          labelSuffix="format"
          options={[
            { key: 'story', label: 'Story  9:16' },
            { key: 'square', label: 'Post  1:1' },
          ]}
        /> : null}

        {editorReady ? <ScrollView
          style={styles.scroller}
          contentContainerStyle={styles.previewWrap}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
        >
          {/* The exact pixels that get posted, on a checkerboard so the empty
              parts read as empty rather than as dark grey. */}
          <View style={styles.previewShadow}>
            <Checkerboard style={StyleSheet.absoluteFill} />
            {/* Boundaried. The card composites a runner's whole avatar over a
                projected route, and it is the LAST thing between a finished run
                and the way home — a throw in here used to take the result
                screen down with it, losing the recap the runner was looking at.
                Now the card is the only thing lost, and everything else on the
                sheet still works. */}
            <ShareBoundary
              width={previewW}
              height={previewW * spec.ratio}
              styles={styles}
            >
              <RunShareCard
                {...cardProps}
                cardRef={cardRef}
                format={format}
                width={previewW}
                accent={accent}
                textColor={textColor}
                align={align}
                stats={statKeys}
                showRoute={showRoute}
                showCharacter={showCharacter}
                flip={flip}
              />
            </ShareBoundary>
            <View style={styles.transparentBadge} pointerEvents="none">
              <Text style={styles.transparentText}>TRANSPARENT</Text>
            </View>
          </View>

          <Text style={styles.hint}>
            Everything around your run stays see through, so your own story shows behind it.
          </Text>

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

          <Row label="Home post">
            <RunPostEditor
              runId={cardProps.run?.runId}
              initialCaption={cardProps.run?.caption}
              initialMedia={cardProps.run?.media}
            />
          </Row>
        </ScrollView> : (
          <View style={styles.preparing}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.preparingText}>Preparing your run card…</Text>
          </View>
        )}

        {editorReady ? <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
          <Text style={styles.actionsLabel}>Share to</Text>
          <View style={styles.destinations}>
            <Destination
                label="Instagram Story"
                busyLabel="Opening…"
                busy={busy === 'story'}
                disabled={!!busy}
                onPress={toStory}
                gradient={IG_GRADIENT}
              >
                <Instagram size={24} color="#fff" strokeWidth={2} />
              </Destination>

            {canSave && (
              <Destination
                label="Save"
                busyLabel="Saving…"
                busy={busy === 'save'}
                disabled={!!busy}
                onPress={toPhotos}
              >
                <Download size={22} color={colors.text} strokeWidth={2} />
              </Destination>
            )}

            {canCopy && (
              <Destination
                label="Copy"
                busyLabel="Copying…"
                busy={busy === 'copy'}
                disabled={!!busy}
                onPress={toClipboard}
              >
                <Copy size={22} color={colors.text} strokeWidth={2} />
              </Destination>
            )}

            <Destination
              label="More"
              busyLabel="Preparing…"
              busy={busy === 'more'}
              disabled={!!busy}
              onPress={toSystemSheet}
            >
              <Share2 size={22} color={colors.text} strokeWidth={2} />
            </Destination>
          </View>
        </View> : null}
      </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  fullScreen: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 30 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  title: { ...type.title, color: colors.text },
  close: { ...type.bodySmBold, color: colors.textMuted },
  formats: { marginBottom: space.md },
  scroller: { flex: 1, minHeight: 0 },
  preparing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  preparingText: { ...type.bodySm, color: colors.textMuted },
  previewWrap: { alignItems: 'center', paddingVertical: space.xs, paddingBottom: space.xl },

  row: { marginTop: space.md, alignSelf: 'stretch' },
  rowLabel: { ...type.labelSm, color: colors.textDim, marginBottom: space.sm },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  controlStack: { gap: space.md },
  controlGroup: { gap: 6 },
  controlLabel: { ...type.caption, color: colors.textDim },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...type.bodySm, color: colors.textMuted },
  chipTextOn: { ...type.bodySmBold, color: colors.primaryInk },
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
    borderColor: colors.border,
  },
  // Named on the preview the way Strava names it, so "why is my background
  // grey squares" answers itself.
  transparentBadge: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  transparentText: { ...type.labelSm, fontSize: 10, letterSpacing: 1, color: '#FFFFFF' },
  cardFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  cardFallbackText: { ...type.bodySm, color: '#FFFFFF', textAlign: 'center' },
  hint: { ...type.caption, color: colors.textDim, textAlign: 'center', marginTop: space.md },

  actions: {
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  actionsLabel: { ...type.labelSm, color: colors.textDim, marginBottom: space.md },
  destinations: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  destination: { alignItems: 'center', width: 68 },
  destinationDisc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationLabel: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
});
