// Toon kit — the game-style surface pieces used across the app (Home, Pasers,
// tab bar…): ink-outlined cards with a hard offset shadow, gradient page
// headers with outlined titles, chips, list rows, progress tracks, and the
// "Get started" checklist strip.
//
// Every piece is scheme-aware via `toonSurface()`: the hard black outline +
// drop shadow are a LIGHT-UI device, so on dark they become a soft rim with
// no shadow (see src/theme/toon.js).

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
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
import { PressableScale } from '../../ui/motion';
import OutlinedText from './OutlinedText';

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
// ToonHeader — the page header: a colour wash, a small eyebrow, a big
// outlined title, and an optional cut-out illustration on the right.
// ---------------------------------------------------------------------------

export function ToonHeader({
  eyebrow,
  title,
  art,
  leftArt,
  rightArt,
  // `framed` = art flush to both edges with the title centred between them
  // and no ink outline. Auto-on whenever a side art is supplied.
  framed: framedProp,
  tint = [brand.teal, '#7dd3fc'],
  // Pass a single colour string to get a flat wash instead of the gradient.
  solid,
  top = 0,
  onBack,
  children,
  style,
}) {
  const framed = framedProp ?? !!(leftArt || rightArt);
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
              style={[toonType.label, styles.eyebrow, framed && { textAlign: 'center' }]}
              outline={toon.ink}
              width={framed ? 0 : 1.5}
              align={framed ? 'center' : 'left'}
              containerStyle={framed ? undefined : { alignSelf: 'flex-start' }}
            >
              {eyebrow}
            </OutlinedText>
          ) : null}
          <OutlinedText
            style={[toonType.hero, { color: '#fff' }, framed && { textAlign: 'center' }]}
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

export function ProgressTrack({ value = 0, height = 14, fill = brand.pink, style }) {
  const { colors, scheme } = useTheme();
  const s = toonSurface(colors, scheme);
  const pct = Math.max(0, Math.min(1, value));
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
      <View style={{ width: `${pct * 100}%`, height: '100%' }}>
        <LinearGradient
          colors={[fill, '#F97CBB']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
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
