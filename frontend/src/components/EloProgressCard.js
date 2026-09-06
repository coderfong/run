import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AppIcon from './AppIcon';
import { Card, Row } from './ui';
import { Bar } from '../ui/motion';
import { nbInk, radius, space, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';

export function eloProgressCopy({ rating = 1000, nextRating, nextLabel, matches = 0 }) {
  if (!matches) return 'Play a rated territory battle to start moving';
  if (nextRating == null) return 'Highest rank reached';
  return `${Math.max(0, nextRating - rating).toLocaleString()} Elo to ${nextLabel}`;
}

/** A shared, explicit view of either a runner's or a club's Elo ladder. */
export default function EloProgressCard({
  title = 'Solo Elo',
  rating = 1000,
  label = 'Wood',
  nextRating = null,
  nextLabel = null,
  progress = 0,
  matches = 0,
  wins = 0,
  losses = 0,
  draws = 0,
  peak = null,
  accent,
  style,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const tint = accent || colors.text;
  const pct = nextRating == null ? 1 : Math.max(0, Math.min(1, Number(progress) || 0));
  const summary = eloProgressCopy({ rating, nextRating, nextLabel, matches });

  return (
    <Card
      style={[styles.card, style]}
      accessibilityLabel={`${title}, ${rating} Elo, ${label}. ${summary}`}
    >
      <Row between style={styles.heading}>
        <Row gap={space.sm}>
          <View style={[styles.icon, { backgroundColor: withAlpha(tint, 0.16), borderColor: tint }]}>
            <AppIcon name="trophy" size={24} />
          </View>
          <View>
            <Text style={type.bodyBold}>{title}</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>{label} rank</Text>
          </View>
        </Row>
        <View style={styles.ratingBlock}>
          <Text style={[type.stat, { color: tint }]}>{Number(rating).toLocaleString()}</Text>
          <Text style={[type.captionMedium, { color: colors.textMuted }]}>ELO</Text>
        </View>
      </Row>

      <Bar
        pct={pct}
        animateOnMount
        trackStyle={[styles.track, { backgroundColor: colors.cardAlt, borderColor: nbInk(scheme, colors.cardAlt) }]}
        fillStyle={[styles.fill, { backgroundColor: tint }]}
      />
      <Row between style={styles.progressCopy}>
        <Text style={[type.caption, { color: colors.textMuted, flex: 1 }]}>{summary}</Text>
        {peak != null ? (
          <Text style={[type.captionMedium, { color: colors.text }]}>Peak {Number(peak).toLocaleString()}</Text>
        ) : null}
      </Row>

      <View style={[styles.record, { borderTopColor: withAlpha(colors.text, 0.12) }]}>
        <Text style={[type.captionMedium, { color: colors.ok }]}>{wins} W</Text>
        <Text style={[type.captionMedium, { color: colors.danger }]}>{losses} L</Text>
        <Text style={[type.captionMedium, { color: colors.textMuted }]}>{draws} D</Text>
        <Text style={[type.caption, { color: colors.textDim, marginLeft: 'auto' }]}>
          {matches} rated {matches === 1 ? 'battle' : 'battles'}
        </Text>
      </View>
    </Card>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  card: { padding: space.md },
  heading: { alignItems: 'center' },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBlock: { alignItems: 'flex-end' },
  track: { height: 13, borderRadius: 7, borderWidth: 1.5, marginTop: space.md, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6 },
  progressCopy: { marginTop: space.xs, alignItems: 'center' },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: space.sm,
    paddingTop: space.sm,
  },
});
