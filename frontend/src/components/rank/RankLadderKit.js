// The pieces BOTH rank screens are drawn from.
//
// WHY THIS FILE EXISTS. The full ladder (from You) and the post claim
// progression (from a claim) used to be two different rank systems on screen:
// one a column of posters under a flat pink banner, the other a portrait, a
// plaque and a loose bar under another pink banner. Nothing tied the +4 you had
// just earned to the ladder you would see on your profile. Both screens now
// build from these parts, so the track, the threshold notches, the tier cards,
// the "you" marker and the header are literally the same components:
//
//   RankHeader          compact cream header with a pink accent rule
//   RankTrack           one tier's slice of the vertical track
//   RankThreshold       the notch and number on a tier's floor line
//   RankMarker          YOU: the avatar medallion and your points
//   RankTierCard        a tier's illustration with its plaque over it
//   CurrentRankSummary  tier, points, percentile, what is next
//
// The screens do NOT share a tree. The ladder is for browsing and holds still;
// the progression is for change and moves. What they share is the geometry
// (RAIL_W, TRACK_W, TRACK_RIGHT, MARKER), the colours (tier data), the copy
// helpers (config/rankLadder.js) and the marker.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Info } from 'lucide-react-native';

import BackButton from '../ui/BackButton';
import { RankPlaque } from './RankBadge';
import { CharacterBust } from '../character/CharacterRig';
import { RankCrest, RunnerFigure } from '../identity/PlayerIdentity';
import { rankArt } from '../../config/rankArt';
import { fmtPoints, nextTierCopy } from '../../config/rankLadder';
import { Image } from '../../ui/image';
import {
  NB,
  brand,
  fonts,
  nbInk,
  radius,
  space,
  useTheme,
  useThemedStyles,
  withAlpha,
} from '../../theme';

// --- the shared geometry -----------------------------------------------------
// The rail column on the left of every ladder, the track inside it, and the
// marker that rides the track. One set of numbers, so a threshold on the full
// ladder and one on the progression screen sit at the same x.
export const RAIL_W = 84;
export const TRACK_W = 8;
// From the rail's right edge to the track's right edge. The gap is where the
// marker's stem crosses into the card.
export const TRACK_RIGHT = 14;
// Centre of the track, from the rail's left edge.
export const TRACK_X = RAIL_W - TRACK_RIGHT - TRACK_W / 2;
// The avatar medallion. Fixed so a parent can position it before layout.
export const MARKER = 30;

// --- header ------------------------------------------------------------------

/**
 * The compact header both screens open with. Cream, not a pink block: the
 * pink is a short accent rule, which is all the brand needs to be present.
 */
export function RankHeader({ title, subtitle, onBack, top = 0, style }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.header, { paddingTop: top + space.sm }, style]}>
      <View style={styles.headerRow}>
        {onBack ? <BackButton size={36} onPress={onBack} on={colors.bg} /> : null}
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.accent, { marginLeft: onBack ? 36 + space.sm : 0 }]} />
    </View>
  );
}

// --- the track ---------------------------------------------------------------

/**
 * One tier's slice of the vertical track. Stroked down both sides and across
 * neither end, so slices stack into one unbroken rail. The empty part carries
 * a faint wash of the tier's own colour, so the rail reads as coloured tier
 * segments even above the runner; the filled part is the tier colour at full.
 */
export function RankTrack({ color, fill = 0, openTop = false, style }) {
  const { colors, scheme } = useTheme();
  const ink = nbInk(scheme, colors.bg);
  return (
    <View
      pointerEvents="none"
      style={[
        stylesStatic.track,
        {
          right: TRACK_RIGHT,
          width: TRACK_W,
          backgroundColor: withAlpha(color, 0.22),
          borderColor: withAlpha(ink, 0.8),
        },
        openTop && stylesStatic.trackOpenTop,
        style,
      ]}
    >
      <View
        style={[
          stylesStatic.trackFill,
          { height: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`, backgroundColor: color },
        ]}
      />
    </View>
  );
}

/**
 * A tier's floor: a notch across the track and the number beside it, clear of
 * the line rather than struck through by it. Sits at `bottom` inside its rail.
 */
export function RankThreshold({ points, reached = true, bottom = 0 }) {
  const { colors, scheme } = useTheme();
  if (points == null) return null;
  const ink = nbInk(scheme, colors.bg);
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          stylesStatic.notch,
          { bottom: bottom - 1, right: TRACK_RIGHT - 4, width: TRACK_W + 8, backgroundColor: ink },
        ]}
      />
      <Text
        style={[
          stylesStatic.floor,
          {
            bottom: bottom - 7,
            right: TRACK_RIGHT + TRACK_W + 6,
            color: reached ? colors.text : colors.textDim,
          },
        ]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        {fmtPoints(points)}
      </Text>
    </>
  );
}

// --- the marker --------------------------------------------------------------

/**
 * YOU. The same mark on both screens and in every tier: the runner in a pink
 * medallion on the track, a YOU tag with your points to its left, and a short
 * stem pointing into the card you are standing on. Deliberately NOT the tier
 * colour: the tier changes, you do not.
 *
 * Positioned by the parent (a box RAIL_W wide and MARKER tall); `points` can be
 * a node, which is how the progression screen puts a live count here.
 */
export function RankMarker({ equipped, points, halo = null }) {
  const { colors, scheme } = useTheme();
  const ink = nbInk(scheme, colors.bg);
  return (
    <View
      style={stylesStatic.marker}
      accessible
      accessibilityLabel="Current position on rank ladder"
    >
      <View style={[stylesStatic.markerLabel, { backgroundColor: colors.bg }]}>
        <Text style={stylesStatic.markerYou}>YOU</Text>
        {typeof points === 'number' || typeof points === 'string' ? (
          <Text style={[stylesStatic.markerPoints, { color: colors.text }]} numberOfLines={1}>
            {typeof points === 'number' ? fmtPoints(points) : points}
          </Text>
        ) : (
          points
        )}
      </View>
      <View style={stylesStatic.medallionSlot}>
        {halo}
        <View style={[stylesStatic.medallion, { borderColor: ink }]}>
          <CharacterBust equipped={equipped} size={MARKER - 6} bg={colors.card} />
        </View>
      </View>
      <View style={[stylesStatic.stem, { backgroundColor: brand.pink }]} />
    </View>
  );
}

// --- the tier card -----------------------------------------------------------

// Your runner on your tier card: clear of the card's top edge, and not drawn
// at all below the height where shoes and a top stop being readable.
const RUNNER_TOP_AIR = 8;
const RUNNER_MIN_H = 64;

// How much of the page's own background is laid over a tier's art. The current
// tier gets none. Everything else is quieter by distance, and a little more
// when it is not yet reached, but never greyed out: the art is the reason to
// climb, and you are meant to want it.
function veilFor(emphasis, reached) {
  if (emphasis === 'current') return 0;
  const base = emphasis === 'near' ? 0.08 : 0.18;
  return reached ? base : base + 0.14;
}

/**
 * A tier as a card: the illustration, its plaque on a band along the bottom,
 * and at most two chips over the sky (YOU ARE HERE, and the tier's own
 * percentile when it has a distinct one).
 *
 * @param emphasis 'current' | 'near' | 'far'
 * @param runner   `{ equipped, pose }` to stand YOUR full body runner in the
 *                 tier's art (your own card only). The illustration is the
 *                 place; the runner, in what they actually wear, is the player
 *                 standing in it. Skipped when the card is too short to draw a
 *                 legible figure.
 */
export function RankTierCard({
  tier,
  height,
  name,
  emphasis = 'near',
  reached = true,
  percent = null,
  gap = null,
  youHere = false,
  compact = false,
  runner = null,
  accessibilityLabel,
  style,
}) {
  const { colors, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const art = rankArt(tier.key);
  const current = emphasis === 'current';
  const veil = veilFor(emphasis, reached);
  const bandH = compact ? 28 : 38;
  const runnerH = runner ? height - bandH - RUNNER_TOP_AIR : 0;

  return (
    <View
      style={[styles.cardShell, current && styles.cardGlow, current && { shadowColor: tier.color }, { height }, style]}
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: art ? art.ground : withAlpha(tier.color, 0.14),
            borderColor: current ? tier.color : withAlpha(nbInk(scheme, colors.card), 0.55),
            borderWidth: current ? NB.stroke : NB.strokeThin,
          },
        ]}
      >
        {art ? (
          <Image
            source={art.source}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            // No fade: a column of cross fades reads as the page loading again.
            transition={0}
            accessible={false}
          />
        ) : null}
        {veil > 0 ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(colors.bg, veil) }]} />
        ) : null}

        {runner && runnerH >= RUNNER_MIN_H ? (
          <RunnerFigure
            equipped={runner.equipped}
            height={runnerH}
            pose={runner.pose}
            style={[styles.cardRunner, { bottom: bandH - 2 }]}
          />
        ) : null}

        {youHere ? (
          <View style={styles.youChip}>
            <Text style={styles.youChipText}>YOU ARE HERE</Text>
          </View>
        ) : null}

        {percent != null ? (
          <View style={[styles.percentChip, { backgroundColor: withAlpha(tier.ink, 0.82) }]}>
            <Text style={styles.percentText}>{`TOP ${percent}% OF RUNNERS`}</Text>
          </View>
        ) : null}

        <View style={[styles.band, { height: bandH, backgroundColor: withAlpha(tier.ink, 0.84) }]}>
          <RankPlaque
            name={name || tier.label}
            color={tier.color}
            ink={tier.ink}
            dim={!reached}
            width={compact ? 104 : 136}
            height={compact ? 20 : 28}
          />
          {gap ? (
            <Text numberOfLines={1} style={styles.gap}>
              {gap}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// --- current rank summary ----------------------------------------------------

/**
 * Where you stand, in words, before any scrolling: the tier, your points, your
 * percentile (ONCE, here, rather than on every card), and what is next.
 */
export function CurrentRankSummary({ standing, topPercent = null, equipped, note, style }) {
  const styles = useThemedStyles(makeStyles);
  if (!standing) return null;
  const next = nextTierCopy(standing);
  const spoken = [
    `Current rank ${standing.name}.`,
    `${fmtPoints(standing.points)} rank points.`,
    topPercent != null ? `Top ${topPercent}% of runners.` : null,
    next ? `${next}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <View style={[styles.summary, style]}>
      <View style={styles.summaryRow} accessible accessibilityLabel={spoken}>
        {/* Rank as a crest: the runner itself stands on the current tier
            card below, whole, rather than as a head in this ring. */}
        <RankCrest standing={standing} size={48} />
        <View style={styles.summaryText}>
          <View style={styles.summaryNameRow}>
            <View style={[styles.tierDot, { backgroundColor: standing.color }]} />
            <Text style={styles.summaryName} numberOfLines={1}>
              {standing.name.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.summaryLine} numberOfLines={1}>
            <Text style={styles.summaryPoints}>{`${fmtPoints(standing.points)} pts`}</Text>
            {topPercent != null ? `  ·  Top ${topPercent}% of runners` : ''}
          </Text>
          {next ? (
            <Text style={styles.summaryNext} numberOfLines={1}>
              {next}
            </Text>
          ) : null}
        </View>
      </View>
      {note ? (
        <View style={styles.note}>
          <Info size={14} color={styles.noteText.color} strokeWidth={2.4} />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Theme free styles for the parts that are positioned against the geometry
// above and read their colours from props.
const stylesStatic = StyleSheet.create({
  track: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderLeftWidth: NB.strokeThin,
    borderRightWidth: NB.strokeThin,
    overflow: 'hidden',
  },
  trackOpenTop: { borderTopLeftRadius: TRACK_W, borderTopRightRadius: TRACK_W },
  trackFill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  notch: { position: 'absolute', height: NB.strokeThin },
  floor: {
    position: 'absolute',
    left: 0,
    textAlign: 'right',
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  marker: {
    width: RAIL_W,
    height: MARKER,
    flexDirection: 'row',
    alignItems: 'center',
  },
  markerLabel: {
    position: 'absolute',
    right: RAIL_W - (TRACK_X - MARKER / 2) + 3,
    alignItems: 'flex-end',
    paddingHorizontal: 3,
    borderRadius: 6,
  },
  markerYou: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1,
    color: brand.pink,
    lineHeight: 11,
  },
  markerPoints: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 15 },
  medallionSlot: {
    position: 'absolute',
    left: TRACK_X - MARKER / 2,
    width: MARKER,
    height: MARKER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallion: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    borderWidth: NB.strokeThin,
    backgroundColor: brand.pink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // From the medallion's right edge across the gap and a few points into the
  // card, so the marker points AT the tier it belongs to.
  stem: {
    position: 'absolute',
    left: TRACK_X + MARKER / 2,
    width: RAIL_W - (TRACK_X + MARKER / 2) + 8,
    height: NB.strokeThin + 1,
    borderRadius: 2,
  },
});

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  header: { paddingHorizontal: space.gutter, paddingBottom: space.sm, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerText: { flex: 1 },
  headerTitle: { ...type.title, color: colors.text },
  headerSub: { ...type.bodySm, color: colors.textMuted, marginTop: -2 },
  accent: { width: 40, height: 3, borderRadius: 2, backgroundColor: brand.pink, marginTop: 6 },

  cardShell: { borderRadius: radius.lg },
  // A soft glow in the tier's colour, the one thing only the current card has.
  cardGlow: {
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  card: { flex: 1, borderRadius: radius.lg, overflow: 'hidden' },
  // Stands on the plaque band, toward the right, where the art is usually
  // open ground and the YOU ARE HERE chip (top left) is out of the way.
  cardRunner: { position: 'absolute', right: '12%' },
  youChip: {
    position: 'absolute',
    top: space.xs + 2,
    left: space.xs + 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: brand.pink,
    borderWidth: NB.strokeThin,
    borderColor: nbInk('light', brand.pink),
  },
  youChipText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, color: '#ffffff' },
  percentChip: {
    position: 'absolute',
    top: space.xs + 2,
    right: space.xs + 2,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  // White on the tier's own ink: this sits on the art in both schemes.
  percentText: { color: '#ffffff', fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 0.8 },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    gap: space.sm,
  },
  gap: { flex: 1, textAlign: 'right', fontFamily: fonts.bodyMedium, fontSize: 11, color: '#ffffff' },

  summary: { paddingHorizontal: space.gutter, paddingBottom: space.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  summaryText: { flex: 1 },
  summaryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  summaryName: { ...type.title, fontSize: 19, lineHeight: 24, color: colors.text, flexShrink: 1 },
  summaryLine: { ...type.captionMedium, color: colors.textMuted, marginTop: 1 },
  summaryPoints: { ...type.bodySmBold, color: colors.text },
  summaryNext: { ...type.caption, color: colors.textMuted, marginTop: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
  },
  noteText: { ...type.caption, color: colors.textMuted, flex: 1 },
});
