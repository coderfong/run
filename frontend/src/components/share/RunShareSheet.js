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
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Copy, Download, Share2 } from 'lucide-react-native';

import RunShareCard, {
  ACCENTS,
  CARD_INK,
  DEFAULT_STATS,
  SHARE_FORMATS,
  availableStats,
} from './RunShareCard';
import { TRAIL_DECORATIONS, TRAIL_NONE } from './trailDecorations';
import RunPostEditor from '../RunPostEditor';
import { Segmented } from '../ui';
import { radius, space, useTheme, useThemedStyles } from '../../theme';
import { PressableScale, haptic } from '../../ui/motion';
import { toast } from '../../ui/toast';
import { SHARE_DEBUG_FLAGS, shareCrumb } from '../../utils/shareDebugFlags';
import { TRAIL_DECORATIONS_ENABLED } from '../../config/releaseFeatures';

// Instagram's own gradient, so the destination is recognisable at a glance.
const IG_GRADIENT = ['#F9CE34', '#EE2A7B', '#6228D7'];

// The transparency checkerboard, in the size Photoshop and Figma use.
//
// TWO nodes, and it has to stay that way. A grid of Views is a thousand native
// views for decoration, so this began as an SVG `<Pattern>` — which was the one
// react-native-svg feature the app used NOWHERE else, mounted on the one screen
// that died the moment it opened. Every dark square now goes into a single
// `<Path>` instead: the same picture, no pattern, and still only a fill and a
// path to rasterise.
const CHECKER = 12;

// The path is built in the preview's own pixels rather than at "100%", because
// the squares have to stay square whatever shape the card is.
function checkerPath(width, height) {
  const cols = Math.ceil(width / CHECKER);
  const rows = Math.ceil(height / CHECKER);
  let d = '';
  for (let r = 0; r < rows; r += 1) {
    // Dark where row + column is even, which is the diagonal the tile drew.
    for (let c = r % 2; c < cols; c += 2) {
      d += `M${c * CHECKER} ${r * CHECKER}h${CHECKER}v${CHECKER}h${-CHECKER}z`;
    }
  }
  return d;
}

// Keep optional native sharing code out of the initial render. This screen can
// be delivered over the air to older binaries that do not contain every
// native module yet.
const socialShare = () => require('../../utils/socialShare');

function Checkerboard({ width, height, style }) {
  const d = useMemo(() => checkerPath(width, height), [width, height]);
  return (
    <Svg style={style} width={width} height={height}>
      <Rect x={0} y={0} width={width} height={height} fill="#4A4A4E" />
      <Path d={d} fill="#38383C" />
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

// Instagram's own mark, drawn here rather than imported.
//
// THIS WAS THE CRASH-ON-OPEN. lucide dropped every brand icon in v1, so
// `import { Instagram } from 'lucide-react-native'` resolves to `undefined` —
// a named import Metro does not warn about and Hermes does not fault on until
// the element is created. `<undefined />` then throws during the render of the
// destinations row, which is the first thing that happens after the sheet goes
// ready, and an uncaught throw there takes the whole screen down. Nothing was
// ever wrong with the card, the route SVG, the avatar or the checkerboard.
//
// Three nodes on lucide's own 24-grid and stroke weight, so it sits level with
// the Download / Copy / Share icons beside it. The stroke is repeated on every
// child rather than inherited from <Svg>, because that is what lucide's own
// icons do — and those are the ones this app has been rendering for months.
function InstagramGlyph({ size, color }) {
  const line = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect {...line} x={2} y={2} width={20} height={20} rx={5} ry={5} />
      <Circle {...line} cx={12} cy={12} r={4} />
      <Circle cx={17.5} cy={6.5} r={1.35} fill={color} />
    </Svg>
  );
}

// A lucide icon, or a plain dot in its place when `icons` is off — one more
// suspect isolated from the crash-on-open without losing the destination
// button's layout.
function DestIcon({ Icon, size, color }) {
  // A missing `Icon` is not hypothetical here — see InstagramGlyph above. The
  // dot costs the runner one glyph; rendering `<undefined />` costs them the
  // screen, so an icon that went away upstream degrades instead of crashing.
  if (!SHARE_DEBUG_FLAGS.icons || !Icon) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
  return <Icon size={size} color={color} strokeWidth={2} />;
}

// One destination in the "Share to" row: a round target with its name under it,
// which is the shape every share sheet in every app already uses.
function Destination({ label, busyLabel, busy, disabled, onPress, gradient, children }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const useGradient = !!gradient && SHARE_DEBUG_FLAGS.gradient;
  const Body = useGradient ? LinearGradient : View;
  const bodyProps = useGradient
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
        style={[styles.destinationDisc, !useGradient && { backgroundColor: colors.cardAlt }]}
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
  const [align, setAlign] = useState('left');
  const [showRoute, setShowRoute] = useState(true);
  const [trail, setTrail] = useState(TRAIL_NONE);
  // The simplified card is the route, four numbers and the wordmark, so the
  // figure starts OFF. The control stays: it is one tap to put the runner back
  // on, and it is the only part of the card that is theirs rather than the
  // run's.
  const [showCharacter, setShowCharacter] = useState(false);
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
    shareCrumb('RunShareSheet opened', { ...SHARE_DEBUG_FLAGS });
    let alive = true;
    let timer;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (alive) {
          shareCrumb('editorReady -> true');
          setEditorReady(true);
        }
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

  // `nativeShareProbe` gates the instant this runs `require('expo-media-library')`
  // / `require('expo-clipboard')` (see socialShare.js's `lazy()`, which
  // breadcrumbs each require) — the moment editorReady flips, before any
  // button press. Suspect #1 for a crash that fires the instant the sheet
  // becomes ready with everything else disabled.
  const shareCapabilities =
    editorReady && SHARE_DEBUG_FLAGS.nativeShareProbe ? socialShare() : null;
  const canSave = !!shareCapabilities?.canSaveToPhotos?.();
  const canCopy = !!shareCapabilities?.canCopyImage?.();

  if (!visible) return null;

  // `sheetBody` is the widest cut available without a rebuild: off, nothing
  // below the head bar (title + Close) mounts at all — format switch,
  // ScrollView, every control row, the destinations row. If the crash
  // survives THIS off, it isn't in RunShareSheet's body; it's either in the
  // head bar itself or upstream (ResultScreen's own stage-change effects,
  // React Navigation). See `mountSheet` in ResultScreen.js for the next cut.
  const bodyOn = editorReady && SHARE_DEBUG_FLAGS.sheetBody;

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

        {bodyOn ? <Segmented
          style={styles.formats}
          value={format}
          onChange={setFormat}
          labelSuffix="format"
          options={[
            { key: 'story', label: 'Story  9:16' },
            { key: 'square', label: 'Post  1:1' },
          ]}
        /> : null}

        {bodyOn ? <ScrollView
          style={styles.scroller}
          contentContainerStyle={styles.previewWrap}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
        >
          {/* The exact pixels that get posted, on a checkerboard so the empty
              parts read as empty rather than as dark grey. */}
          <View style={styles.previewShadow}>
            {SHARE_DEBUG_FLAGS.checkerboard && <Checkerboard
              width={previewW}
              height={previewW * spec.ratio}
              style={StyleSheet.absoluteFill}
            />}
            {/* Boundaried. The card composites a runner's whole avatar over a
                projected route, and it is the LAST thing between a finished run
                and the way home — a throw in here used to take the result
                screen down with it, losing the recap the runner was looking at.
                Now the card is the only thing lost, and everything else on the
                sheet still works. */}
            {SHARE_DEBUG_FLAGS.card && <ShareBoundary
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
                align={align}
                stats={statKeys}
                showRoute={showRoute}
                trail={trail}
                showCharacter={showCharacter}
                flip={flip}
              />
            </ShareBoundary>}
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

          {/* Text is WHITE and only white now — the dark option is gone. See
              the tone note in RunShareCard: black type on a card with no
              background of its own is the one combination that vanishes. */}
          <Row label="Text">
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
          </Row>

          {/* What grows along the line the runner actually ran: side-on marks
              rooted on the route, drawn in the accent and spaced by distance.
              PARKED behind TRAIL_DECORATIONS_ENABLED — built, kept, not shipped
              yet — and only offered while the route is on the card at all. */}
          {TRAIL_DECORATIONS_ENABLED && showRoute ? (
            <Row label="Trail">
              <View style={styles.chipWrap}>
                {TRAIL_DECORATIONS.map((d) => (
                  <Chip
                    key={d.key}
                    label={d.label}
                    on={trail === d.key}
                    onPress={() => setTrail(d.key)}
                  />
                ))}
              </View>
            </Row>
          ) : null}

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

          {SHARE_DEBUG_FLAGS.postEditor && <Row label="Home post">
            <RunPostEditor
              runId={cardProps.run?.runId}
              initialCaption={cardProps.run?.caption}
              initialMedia={cardProps.run?.media}
            />
          </Row>}
        </ScrollView> : (
          <View style={styles.preparing}>
            {editorReady ? (
              <Text style={styles.preparingText}>Sheet body off (debug)</Text>
            ) : (
              <>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.preparingText}>Preparing your run card…</Text>
              </>
            )}
          </View>
        )}

        {bodyOn ? <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
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
                <DestIcon Icon={InstagramGlyph} size={24} color="#fff" />
              </Destination>

            {canSave && (
              <Destination
                label="Save"
                busyLabel="Saving…"
                busy={busy === 'save'}
                disabled={!!busy}
                onPress={toPhotos}
              >
                <DestIcon Icon={Download} size={22} color={colors.text} />
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
                <DestIcon Icon={Copy} size={22} color={colors.text} />
              </Destination>
            )}

            <Destination
              label="More"
              busyLabel="Preparing…"
              busy={busy === 'more'}
              disabled={!!busy}
              onPress={toSystemSheet}
            >
              <DestIcon Icon={Share2} size={22} color={colors.text} />
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
