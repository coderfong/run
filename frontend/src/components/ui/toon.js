// Toon kit — the game-style surface pieces used across the app (Home, Pasers,
// tab bar…): ink-outlined cards with a hard offset shadow, gradient page
// headers with outlined titles, chips, list rows, progress tracks, and the
// "Get started" checklist strip.
//
// Every piece is scheme-aware via `toonSurface()`: the hard black outline +
// drop shadow are a LIGHT-UI device, so on dark they become a soft rim with
// no shadow (see src/theme/toon.js).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from '../../ui/image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';

import {
  brand,
  space,
  toon,
  toonRadius,
  toonSurface,
  toonType,
  useTheme,
  useThemedType,
} from '../../theme';
import { Bar, PressableScale } from '../../ui/motion';
import OutlinedText from './OutlinedText';

// The copy colour on a `panel` header. Fixed, not `colors.text`: a panel is a
// saturated brand fill in both schemes, so the type has to stay ink either way.
// This is the same value Home's hero cards use for their titles.
export const PANEL_INK = '#141414';

// How wide a panel header's cut-out draws. Its HEIGHT is not fixed — see
// `artSize` in ToonHeader. The compact box is deliberately small enough that
// the ROW is sized by the title beside it rather than by the illustration,
// which is where most of a panel header's height comes from.
const PANEL_ART_W = 164;
const PANEL_ART_COMPACT_W = 112;

// ---------------------------------------------------------------------------
// ToonCard — the base surface. `flat` drops the shadow (for nested cards).
// ---------------------------------------------------------------------------

// The shadow lives on an OUTER view: iOS drops a layer's shadow as soon as it
// clips its content (`overflow: 'hidden'`), and these cards always clip.
export function ToonCard({ children, style, padded = true, flat = false, bg }) {
  const { colors, scheme } = useTheme();
  const s = toonSurface(colors, scheme);
  return (
    <View style={[flat ? null : s.shadow, style]}>
      <View
        style={[
          {
            backgroundColor: bg || colors.card,
            borderRadius: toonRadius.card,
            overflow: 'hidden',
            ...s.outline,
          },
          padded && { padding: space.lg },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ToonHeader — the page header. TWO formats:
//
//   `panel`  Home's hero-card look — a flat brand fill, ink-black copy on the
//            left, the illustration cut out on the right, no scrim, no shadow.
//            This is what Season standings, Pasers and Rivals use, and what a
//            new header should use.
//
//   default  the older gradient/full-bleed wash with a white outlined title
//            over it (`tint`, `bgArt` + `scrim`, `framed` with `leftArt`/
//            `rightArt`). NOTHING CALLS THIS ANY MORE — all three pages moved
//            to `panel`. Kept because it is a complete, working format, but if
//            nothing has adopted it by the next cleanup it should go.
// ---------------------------------------------------------------------------

export function ToonHeader({
  eyebrow,
  title,
  art,
  leftArt,
  rightArt,
  // Fills the whole header rectangle with an illustration instead of putting a
  // cut-out beside the title — for pages where the art IS the selection (the
  // season boards). A scrim goes over it so the outlined title keeps its
  // contrast whatever the image is doing underneath.
  bgArt,
  scrim = 'rgba(8,10,14,0.42)',
  // `framed` = art flush to both edges with the title centred between them
  // and no ink outline. Auto-on whenever a side art is supplied.
  framed: framedProp,
  tint = [brand.teal, '#7dd3fc'],
  // Pass a single colour string to get a flat wash instead of the gradient.
  solid,
  // Type overrides, appended last so they win. The kit's own `toonType` is
  // deliberately NOT uppercase; pages that want to read like the Home hero
  // cards (`type.display` / `type.labelSm`) pass those in here.
  titleStyle,
  eyebrowStyle,
  // `panel` = Home's hero-card format: a FLAT brand panel, ink-black copy on
  // the left, the illustration as a cut-out on the right, no scrim and no
  // shadow. Use it wherever a page header should read as one of Home's cards.
  // Needs `solid` (the panel colour) and cut-out `art` — full-bleed `bgArt`
  // with a scrim is the other treatment and the two do not combine.
  panel = false,
  // Panel-only: the sentence under the title. It belongs in the LEFT text
  // column beside the art, so it cannot come in through `children` (those sit
  // full-width under the row).
  subtitle,
  // Panel-only, and only for a header whose SUBTITLE CHANGES while the page
  // stays put. Reserves this many lines for it, so a shorter sentence leaves
  // the space a longer one would have used instead of the header changing
  // height under the reader's thumb. Set it to the LONGEST sentence's line
  // count; a longer one still grows rather than being cut. Leave unset when
  // the copy is fixed.
  subtitleLines,
  // Panel-only, and only for a header whose ART CHANGES while the page stays
  // put. Draws the cut-out in a fixed square instead of a box shaped to the
  // asset, so switching between a wide illustration and a tall one doesn't
  // resize the header. `contain` still shows each one whole and centred.
  stableArt = false,
  // Panel-only: the same header, roughly ninety points shorter. The back
  // chevron moves INLINE with the title instead of taking a line of its own
  // above it, the cut-out shrinks so the row is sized by the type rather than
  // by the art, and the bottom padding tightens. For a page where the header is
  // chrome over something that matters — Crossroads draws a whole plaza behind
  // it — rather than the page's hero.
  compact = false,
  top = 0,
  onBack,
  children,
  style,
}) {
  const framed = framedProp ?? !!(leftArt || rightArt);

  // The panel cut-out is sized to ITS OWN SHAPE, not to a square. `contain`
  // inside a fixed 164² box letterboxes anything that isn't square — the
  // Pasers art is 640x500, so eighteen points of empty header sat above the
  // runners and eighteen below, which is exactly the blank space the hero was
  // accused of. Resolving the asset's real ratio makes the box the art's box.
  const artSize = React.useMemo(() => {
    if (!art) return null;
    // A page that SWAPS its art takes the square instead. The season boards
    // range from a 640x295 illustration to a 601x640 one, which is a 88pt swing
    // in header height — the page jumped every time a board chip was tapped.
    const box = compact ? PANEL_ART_COMPACT_W : PANEL_ART_W;
    if (stableArt) return { width: box, height: box };
    const src = Image.resolveAssetSource?.(art);
    const ratio = src?.width && src?.height ? src.width / src.height : 1;
    return {
      width: box,
      // Clamped so a tall, narrow cut-out can't stretch the header past the
      // square it used to be.
      height: Math.min(box, Math.round(box / ratio)),
    };
  }, [art, stableArt, compact]);

  if (panel) {
    return (
      <View
        style={[
          styles.header,
          // No extra pad above the safe area. A panel header is the page's
          // hero, and unlike the scrimmed variant it has nothing behind it
          // that a strip of breathing room protects — the inset already
          // clears the notch, and anything past that is just a band of flat
          // colour above the art.
          { paddingTop: top, backgroundColor: solid || brand.pink },
          compact && styles.panelCompact,
          style,
        ]}
      >
        {/* Compact puts the chevron IN the row (see below); the standard panel
            gives it a line of its own above the title. */}
        {onBack && !compact ? (
          <PressableScale
            onPress={onBack}
            style={styles.panelBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={24} color={PANEL_INK} />
          </PressableScale>
        ) : null}
        <View style={[styles.panelRow, compact && styles.panelRowCompact]}>
          {onBack && compact ? (
            <PressableScale
              onPress={onBack}
              style={[styles.panelBack, styles.panelBackInline]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChevronLeft size={22} color={PANEL_INK} />
            </PressableScale>
          ) : null}
          <View style={styles.panelText}>
            {/* The ink styles go LAST, after the caller's overrides. Every
                `type.*` token carries `color: colors.text`, so a titleStyle of
                `type.display` would otherwise repaint the copy in the themed
                text colour — white on dark — on a panel that is always a
                saturated light fill. */}
            {eyebrow ? (
              <OutlinedText
                width={0}
                align="left"
                style={[toonType.label, eyebrowStyle, styles.panelEyebrow]}
              >
                {eyebrow}
              </OutlinedText>
            ) : null}
            <OutlinedText
              width={0}
              align="left"
              style={[toonType.hero, titleStyle, styles.panelTitle]}
            >
              {title}
            </OutlinedText>
            {subtitle ? (
              <Text
                style={[
                  toonType.body,
                  styles.panelSub,
                  // A FLOOR, not a clamp. Reserving the space is what stops a
                  // two-line sentence from sitting in a shorter header than a
                  // three-line one; capping it with numberOfLines as well would
                  // buy nothing at normal text size and would start hiding the
                  // end of the sentence at accessibility sizes.
                  subtitleLines
                    ? { minHeight: subtitleLines * toonType.body.lineHeight }
                    : null,
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {art ? (
            <Image
              source={art}
              style={[styles.panelArt, compact && styles.panelArtCompact, artSize]}
              resizeMode="contain"
              accessible={false}
            />
          ) : null}
        </View>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.header, { paddingTop: top + space.sm }, style]}>
      {solid ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: solid }]} />
      ) : (
        <LinearGradient
          colors={[tint[0], tint[1], 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {bgArt ? (
        <>
          {/* fadeDuration 0: the image swaps on every toggle, and a cross-fade
              on a full-bleed header reads as a flicker. */}
          <Image
            source={bgArt}
            style={styles.headerBgArt}
            resizeMode="cover"
            fadeDuration={0}
            accessible={false}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]} />
        </>
      ) : null}
      {onBack ? (
        <PressableScale
          onPress={onBack}
          style={styles.headerBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color="#fff" />
        </PressableScale>
      ) : null}
      <View style={[styles.headerRow, framed && styles.headerRowFramed]}>
        {/* A runner leaning in from each edge, framing the title. The left one
            is mirrored so the pair face inward, and both are pulled flush to
            the screen edge (cancelling the header's own gutter). */}
        {leftArt ? (
          <Image
            source={leftArt}
            style={[styles.headerSideArt, styles.headerSideArtFlip, styles.headerSideArtLeft]}
            resizeMode="contain"
          />
        ) : null}
        <View style={{ flex: 1 }}>
          {eyebrow ? (
            <OutlinedText
              // Framed headers sit on a flat brand wash, where the pink eyebrow
              // fights the ground (magenta on purple especially). Soft white
              // reads as a caption on any tint.
              style={[
                toonType.label,
                styles.eyebrow,
                framed && { textAlign: 'center', color: 'rgba(255,255,255,0.85)' },
                eyebrowStyle,
              ]}
              outline={toon.ink}
              width={framed ? 0 : 1.5}
              align={framed ? 'center' : 'left'}
              containerStyle={framed ? undefined : { alignSelf: 'flex-start' }}
            >
              {eyebrow}
            </OutlinedText>
          ) : null}
          <OutlinedText
            style={[
              toonType.hero,
              { color: '#fff' },
              framed && { textAlign: 'center' },
              titleStyle,
            ]}
            outline={toon.ink}
            width={framed ? 0 : 3}
            align={framed ? 'center' : 'left'}
          >
            {title}
          </OutlinedText>
        </View>
        {rightArt ? (
          <Image
            source={rightArt}
            style={[styles.headerSideArt, styles.headerSideArtRight]}
            resizeMode="contain"
          />
        ) : null}
        {art ? <Image source={art} style={styles.headerArt} resizeMode="contain" /> : null}
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ToonChip — the outlined pill used for counters (coins, energy, level).
// ---------------------------------------------------------------------------

export function ToonChip({ icon, label, bg, color, style }) {
  const { colors, scheme } = useTheme();
  const s = toonSurface(colors, scheme);
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: bg || colors.card, ...s.outline, ...s.shadow },
        style,
      ]}
    >
      {icon}
      <Text style={[toonType.sub, { fontSize: 15, color: color || colors.text }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ToonRowGroup / ToonRow — the settings-style list: one outlined card, rows
// divided by hairlines, each row an icon bubble + label + chevron.
// ---------------------------------------------------------------------------

export function ToonRowGroup({ children, style }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <ToonCard padded={false} style={[{ overflow: 'hidden' }, style]}>
      {kids.map((child, i) => (
        <React.Fragment key={child.key || i}>
          {i > 0 ? <Divider /> : null}
          {child}
        </React.Fragment>
      ))}
    </ToonCard>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 68 }} />;
}

export function ToonRow({ icon, iconBg, label, sub, onPress, right, disabled }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || !onPress}
      scaleTo={0.985}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={[styles.row, disabled && { opacity: 0.5 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg || colors.cardAlt }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[toonType.sub, { fontSize: 16, color: colors.text, textAlign: 'left' }]}>
          {label}
        </Text>
        {sub ? <Text style={[type.caption, { marginTop: 1 }]}>{sub}</Text> : null}
      </View>
      {right || (onPress ? <ChevronRight size={20} color={colors.textDim} /> : null)}
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// ProgressTrack — a chunky outlined bar (0…1).
// ---------------------------------------------------------------------------

export function ProgressTrack({
  value = 0,
  height = 14,
  fill = brand.pink,
  style,
  animateOnMount = false,
  delay = 0,
  durationMs,
}) {
  const { colors, scheme } = useTheme();
  const s = toonSurface(colors, scheme);
  // The outline lives on this wrapper, not on the Bar's own track. Bar sizes
  // its fill off a measured layout width, which INCLUDES the border, while the
  // percentage fill this replaced resolved against the content box — so hanging
  // the 2.5px toon outline on the measured element would run every fill a few
  // pixels long. Bar sits inside it on absoluteFill, which Yoga positions
  // against the padding box, and measures exactly the width the fill may use.
  return (
    <View
      style={[
        {
          height,
          borderRadius: toonRadius.pill,
          backgroundColor: colors.cardAlt,
          overflow: 'hidden',
          ...s.outline,
        },
        style,
      ]}
    >
      <Bar
        pct={value}
        animateOnMount={animateOnMount}
        delay={delay}
        durationMs={durationMs}
        trackStyle={StyleSheet.absoluteFill}
        fillStyle={{ height: '100%' }}
      >
        <LinearGradient
          colors={[fill, '#F97CBB']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Bar>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SlotDots — the dashed "empty player" circles from the checklist strip.
// `filled` entries render whatever node you pass; the rest are dashed adds.
// ---------------------------------------------------------------------------

export function SlotDots({ filled = [], total = 3, size = 46, onPress }) {
  const { colors } = useTheme();
  const empty = Math.max(0, total - filled.length);
  if (total <= 0) return null;
  return (
    <View style={styles.slots}>
      {filled.slice(0, total).map((node, i) => (
        <View key={`f${i}`} style={{ width: size, height: size }}>{node}</View>
      ))}
      {Array.from({ length: empty }).map((_, i) => (
        <PressableScale
          key={`e${i}`}
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel="Add a paser"
          style={[styles.slotEmpty, { width: size, height: size }]}
        >
          {/* SVG ring, not a dashed border: iOS silently renders dashed
              borders as solid once a view has a border radius. */}
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={size / 2 - 2}
              stroke={colors.textDim}
              strokeWidth={2}
              strokeDasharray="6 5"
              fill="none"
            />
          </Svg>
          <Plus size={size * 0.44} color={colors.textDim} strokeWidth={2.5} />
        </PressableScale>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// GetStartedCard — the sticky first-week checklist strip: eyebrow, one-line
// goal, and the slot row. Hidden by the caller once every step is done.
// ---------------------------------------------------------------------------

export function GetStartedCard({
  eyebrow = 'Get started',
  title,
  filled,
  total = 3,
  onPress,
  leftArt,
  rightArt,
  style,
}) {
  const { colors } = useTheme();
  return (
    <ToonCard padded={false} style={[{ overflow: 'hidden' }, style]}>
      <PressableScale
        onPress={onPress}
        disabled={!onPress}
        scaleTo={0.99}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={title}
        style={styles.getStarted}
      >
        <OutlinedText style={[toonType.label, styles.eyebrow]} outline={toon.ink} width={1.5}>
          {eyebrow}
        </OutlinedText>
        <OutlinedText
          style={[toonType.sub, { color: colors.text, marginTop: 2 }]}
          outline={toon.ink}
          width={2}
          numberOfLines={2}
        >
          {title}
        </OutlinedText>
        <SlotDots filled={filled} total={total} onPress={onPress} />
      </PressableScale>

      {/* mascot cut-outs bookending the strip (optional art) */}
      {leftArt ? <Image source={leftArt} style={[styles.stripArt, { left: 0 }]} resizeMode="contain" /> : null}
      {rightArt ? <Image source={rightArt} style={[styles.stripArt, { right: 0 }]} resizeMode="contain" /> : null}
    </ToonCard>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.gutter,
    paddingBottom: space.lg,
    borderBottomLeftRadius: toonRadius.panel,
    borderBottomRightRadius: toonRadius.panel,
    overflow: 'hidden',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Framed variant: no gap, so the flanking runners can sit hard against the
  // screen edges with the title centred between them.
  headerRowFramed: { gap: 0 },
  headerArt: { width: 108, height: 84 },
  // Explicit box: an <Image> given only StyleSheet.absoluteFill falls back
  // to its intrinsic size and shows one zoomed corner of itself.
  headerBgArt: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  headerSideArt: { width: 76, height: 96 },
  // Negative margins cancel the header's own paddingHorizontal so the runners
  // are flush with the border rather than inset by the gutter.
  headerSideArtLeft: { marginLeft: -space.gutter },
  headerSideArtRight: { marginRight: -space.gutter },
  // scaleX(-1) mirrors the left runner so the pair lean toward each other.
  headerSideArtFlip: { transform: [{ scaleX: -1 }] },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  eyebrow: { color: brand.pink, textTransform: 'uppercase' },

  // --- panel variant (Home hero-card format) -------------------------------
  // Text left, art right, flat ground, no scrim and no shadow. The panel
  // colours are saturated brand tints in BOTH schemes, so the copy is a fixed
  // ink rather than colors.text — see PANEL_INK.
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // SHRINK, not grow. With `flex: 1` the text column always ate the whole row,
  // so a short title ("Rivals") sat alone at the left with a hundred points of
  // flat colour between the last word and the cut-out. Sized to its content and
  // allowed to shrink, the column is as wide as the copy needs and no wider, so
  // the art comes to meet the words instead of hugging the screen edge.
  panelText: { flexShrink: 1 },
  panelEyebrow: { color: PANEL_INK, opacity: 0.75, textTransform: 'uppercase' },
  panelTitle: { color: PANEL_INK, marginTop: 2 },
  panelSub: { color: PANEL_INK, opacity: 0.72, marginTop: 6, textAlign: 'left' },
  // Sits INSIDE the header's gutter. It used to bleed right by a full gutter so
  // the cut-out reached the panel edge the way Home's heroImg reaches its card
  // edge — but Home's art is bled on a card that is itself inset from the
  // screen, whereas this header IS the screen edge, so the runners ended up
  // jammed against the bezel. Keeping the gutter also walks the art a gutter's
  // width back toward the copy.
  // No negative VERTICAL margin either: Home can afford one because its card
  // has a fixed height, but this header sizes to its content, so a negative
  // margin would shrink the row below the art and `overflow: hidden` would
  // slice the characters' feet off.
  // Width only — the height comes from the asset's own ratio (`artSize`).
  panelArt: {
    width: PANEL_ART_W,
  },
  // Compact keeps the cut-out near the copy without crowding it: the row's own
  // gap is zeroed so each side can be set independently (the back button
  // carries its own), and the art takes a small positive inset. Pulled tighter
  // than this — a negative margin — the runners start to sit on the last letter
  // of the title, since the text column shrinks to fit and its box ends at the
  // final glyph.
  panelRowCompact: { gap: 0 },
  panelArtCompact: { width: PANEL_ART_COMPACT_W, marginLeft: space.xs },
  // A white pill, not the dark disc the scrimmed headers use: on a bright flat
  // panel a black-22% circle reads as a smudge.
  panelBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 2,
    borderColor: PANEL_INK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  // In the row, not above it — the line it used to occupy is most of what
  // `compact` gives back. It carries its own right margin because the row's
  // `gap` is zeroed to pull the ART in, and a shared gap would have closed this
  // side too, jamming the eyebrow against the chevron.
  panelBackInline: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginBottom: 0,
    marginRight: space.sm,
  },
  panelCompact: { paddingBottom: space.md },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: toonRadius.pill,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  slots: { flexDirection: 'row', gap: space.md, marginTop: space.md, alignSelf: 'center' },
  slotEmpty: { alignItems: 'center', justifyContent: 'center' },

  getStarted: { paddingVertical: space.md, paddingHorizontal: space.huge, alignItems: 'center' },
  stripArt: { position: 'absolute', bottom: 0, width: 74, height: 88 },
});
