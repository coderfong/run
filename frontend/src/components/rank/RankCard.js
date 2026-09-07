// The compact rank card — a tier, a division, and the gap to the next one.
//
// REPLACED EloProgressCard. That card led with a four digit rating and spent
// its bottom row on a win/loss/draw record, which is the shape of a chess
// profile: it tells you your number and leaves you to work out what the number
// means. This leads with WHAT YOU ARE (the badge and the plaque) and spends
// the rest on WHAT IS NEXT, because that is the only part anybody acts on.
//
// THE RAIL FILLS THE DIVISION, NOT THE TIER. A bar measuring the whole tier
// band barely moves for a fortnight in the upper tiers, and a progress bar
// that does not visibly move is worse than no progress bar. Dividing the band
// into three gives it something to finish. The exact tier gap is still stated
// in words underneath, so nothing is hidden by the choice.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import RankBadge, { RankPlaque } from './RankBadge';
import { DIVISIONS, numeral } from '../../config/rankLadder';
import { Card, Row } from '../ui';
import { Bar } from '../../ui/motion';
import { fonts, nbInk, radius, space, useTheme, useThemedType, withAlpha } from '../../theme';

/** The one line under the rail. Exported so screens can say the same thing. */
export function rankProgressCopy(standing) {
  if (!standing) return '';
  if (standing.isTop) return 'Top of the ladder';
  const points = Number(standing.toNext || 0).toLocaleString();
  const next = standing.division < DIVISIONS
    ? `${standing.label} ${numeral(standing.division + 1)}`
    : 'the next tier';
  return `${points} rank points to ${next}`;
}

/**
 * @param {object} standing  from `standingFrom()` in config/rankLadder
 * @param {node}   emblem    what to draw in the badge slot; defaults to the
 *                           runner in their tier frame. Clubs pass their own.
 * @param {object} equipped  avatar, when using the default emblem
 */
export default function RankCard({
  title = 'Rank',
  standing,
  equipped,
  emblem,
  onPress,
  style,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  if (!standing) return null;

  const copy = rankProgressCopy(standing);

  return (
    <Card
      style={[styles.card, style]}
      onPress={onPress}
      accessibilityLabel={`${title}. ${standing.name}. ${copy}`}
    >
      <Row gap={space.lg} style={styles.top}>
        {emblem !== undefined ? emblem : (
          <RankBadge
            tierKey={standing.key}
            equipped={equipped}
            size={70}
            division={standing.division}
            color={standing.color}
          />
        )}
        <View style={styles.headings}>
          <Text style={[type.caption, { color: colors.textMuted, letterSpacing: 1 }]}>
            {String(title).toUpperCase()}
          </Text>
          <RankPlaque
            name={standing.name}
            color={standing.color}
            ink={standing.ink}
            width={168}
            height={36}
            style={styles.plaque}
          />
          <Text style={[styles.points, { color: colors.text }]}>
            {`${Number(standing.points).toLocaleString()} rank points`}
          </Text>
        </View>
      </Row>

      <Bar
        pct={standing.divisionProgress}
        animateOnMount
        trackStyle={[
          styles.track,
          { backgroundColor: colors.cardAlt, borderColor: nbInk(scheme, colors.cardAlt) },
        ]}
        fillStyle={[styles.fill, { backgroundColor: standing.color }]}
      />
      <Text style={[type.caption, { color: colors.textMuted, marginTop: space.xs }]}>{copy}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md },
  top: { alignItems: 'center' },
  headings: { flex: 1 },
  plaque: { marginTop: space.xs, alignSelf: 'flex-start' },
  points: { fontFamily: fonts.bodyMedium, fontSize: 12, marginTop: space.xs },
  track: {
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    marginTop: space.md,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 6 },
});
