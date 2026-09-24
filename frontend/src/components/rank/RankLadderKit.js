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
//   RankMarker          YOU: your ranked portrait and your points
//   RankTierCard        a tier's illustration with its plaque over it
//   CurrentRankSummary  your ranked portrait, tier, points, percentile
//
// The screens do NOT share a tree. The ladder is for browsing and holds still;
// the progression is for change and moves. What they share is the geometry
// (RAIL_W, TRACK_W, TRACK_RIGHT, MARKER), the colours (tier data), the copy
// helpers (config/rankLadder.js) and the marker.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, Info } from 'lucide-react-native';

import BackButton from '../ui/BackButton';
import { RankPlaque } from './RankBadge';
import { RunnerFigure } from '../identity/PlayerIdentity';
import RankedAvatar, { rankedAvatarSizeFor } from '../identity/RankedAvatar';
import { rankArt } from '../../config/rankArt';
import { fmtPoints } from '../../config/rankLadder';
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
// The marker's ranked portrait, as a footprint. Fixed so a parent can position
// it before layout; the portrait inside is `rankedAvatarSizeFor(MARKER)`.
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
 * YOU. The same mark on both screens and in every tier: your RANKED PORTRAIT
 * (the same RankedAvatar as the summary and the feed, so the face and its
 * frame are the one drawing everywhere) centred on the track, a YOU tag with
 * your points to its left on the same centre line, and a short pink stem
 * pointing into the card you are standing on.
 *
 * Positioned by the parent (a box RAIL_W wide and MARKER tall); `points` can be
 * a node, which is how the progression screen puts a live count here.
 */
export function RankMarker({ equipped, rankKey, points, halo = null }) {
  const { colors } = useTheme();
  return (
    <View
      style={stylesStatic.marker}
      accessible
      accessibilityLabel="Current position on rank ladder"
    >
      {/* The NUMBER sits on the marker's centre line — the same line as the
          portrait's centre and the stem — so the reading and the mark are one
          height. YOU hangs just above it rather than stacking the two, which
          pushed the number half a line below the marker. */}
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
        <RankedAvatar equipped={equipped} rankKey={rankKey} size={rankedAvatarSizeFor(MARKER)} bg={colors.card} />
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
 * A tier as a card: the illustration, and a band along the bottom carrying
 * its plaque and one quiet line (your gap to the next tier on your own card,
 * the tier's percentile on a tier above you). The only chip over the sky is
 * YOU ARE HERE.
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
          ) : percent != null ? (
            // How exclusive a tier above you is, said quietly on the band
            // beside its name rather than as a chip over the illustration.
            <Text numberOfLines={1} style={[styles.gap, styles.percentText]}>
              {`Top ${percent}%`}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// --- current rank summary ----------------------------------------------------

/**
 * Where you stand, ONCE, before any scrolling: your ranked portrait, the tier,
 * your points and your percentile. Nothing here is said again below — what is
 * next is on your own tier card, and the percentile appears nowhere else.
 *
 * The rank frame goes round your PORTRAIT (RankedAvatar), never round the tier
 * numeral: the frame is a player status frame, and the numeral is already in
 * the name beside it.
 *
 * `note` is one line under it; `noteMore` is the rest of the explanation,
 * folded behind the info row so the ladder starts sooner.
 */
export function CurrentRankSummary({ standing, topPercent = null, equipped, note, noteMore, style }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  if (!standing) return null;
  const spoken = [
    `Current rank ${standing.name}.`,
    `${fmtPoints(standing.points)} rank points.`,
    topPercent != null ? `Top ${topPercent}% of runners.` : null,
  ].filter(Boolean).join(' ');

  return (
    <View style={[styles.summary, style]}>
      <View style={styles.summaryRow} accessible accessibilityLabel={spoken}>
        <RankedAvatar
          equipped={equipped}
          rankKey={standing.key}
          size={SUMMARY_PORTRAIT}
          bg={styles.summaryDisc.backgroundColor}
        />
        <View style={styles.summaryText}>
          <Text style={styles.summaryName} numberOfLines={1}>
            {standing.name.toUpperCase()}
          </Text>
          <Text style={styles.summaryLine} numberOfLines={1}>
            <Text style={styles.summaryPoints}>{`${fmtPoints(standing.points)} pts`}</Text>
            {topPercent != null ? `  ·  Top ${topPercent}%` : ''}
          </Text>
        </View>
      </View>
      {note ? (
        <Pressable
          onPress={noteMore ? () => setOpen((v) => !v) : undefined}
          disabled={!noteMore}
          style={styles.note}
          accessibilityRole={noteMore ? 'button' : 'text'}
          accessibilityState={noteMore ? { expanded: open } : undefined}
          accessibilityLabel={open && noteMore ? `${note} ${noteMore}` : note}
          accessibilityHint={noteMore && !open ? 'Shows more about rank points' : undefined}
          hitSlop={6}
        >
          <Info size={14} color={styles.noteText.color} strokeWidth={2.4} />
          <Text style={styles.noteText} numberOfLines={open ? undefined : 2}>
            {open && noteMore ? `${note} ${noteMore}` : note}
          </Text>
          {noteMore ? (
            <ChevronDown
              size={14}
              color={styles.noteText.color}
              strokeWidth={2.4}
              style={open ? styles.chevronOpen : null}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

// The summary's portrait diameter. Its footprint is 1.25x this (RankedAvatar).
const SUMMARY_PORTRAIT = 48;

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
    position: 'absolute',
    bottom: '100%',
    right: 3,
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
  // Quieter than the gap line it stands in for: a fact about the tier, not a
  // call to action. White on the band's own ink in both schemes.
  percentText: { opacity: 0.78 },
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

  summary: { paddingHorizontal: space.gutter, paddingBottom: space.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  summaryText: { flex: 1 },
  // Only its colour is read: the disc behind the portrait.
  summaryDisc: { backgroundColor: colors.cardAlt },
  // The tier name is the card title of this block: the page title's face, a
  // step down so RANK LADDER above it still leads.
  summaryName: { ...type.pageTitle, fontSize: 19, lineHeight: 24, color: colors.text, flexShrink: 1 },
  summaryLine: { ...type.secondary, color: colors.textMuted, marginTop: 1 },
  summaryPoints: { ...type.bodySmBold, color: colors.text },
  // One quiet line, no box: it is a footnote to the summary, not a card.
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.xs,
    paddingVertical: 4,
  },
  noteText: { ...type.metadata, color: colors.textMuted, flex: 1 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
});
