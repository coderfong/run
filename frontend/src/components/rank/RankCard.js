// The compact rank card — a tier, a division, and the gap to the next one.
//
// REPLACED EloProgressCard. That card led with a four digit rating and spent
// its bottom row on a win/loss/draw record, which is the shape of a chess
// profile: it tells you your number and leaves you to work out what the number
// means. This leads with WHAT YOU ARE (the badge and the plaque) and spends
// the rest on WHAT IS NEXT, because that is the only part anybody acts on.
//
// THE TIER'S WORLD RUNS DOWN THE RIGHT EDGE (config/rankArt.js). The card's
// emblem says WHO — your runner in the tier's frame, or a club's crest — and it
// used to be the only picture here, which left the tier itself stated in
// nothing but a coloured plaque. The right hand column is the same
// illustration the ladder draws its rungs from, flush to the card's top, right
// and bottom strokes, so the card and the ladder agree about what Gold LOOKS
// like.
//
// IT IS A COLUMN, NOT A WASH BEHIND THE COPY. Laying the art under the text and
// fading it out from the left is the obvious build, and it cannot work here:
// the runner is in the middle of a 16:9 frame, so the part of the illustration
// that lands under the plaque is the runner. The card reserves the column
// instead — every piece of copy, the rail included, stops before it — which is
// what makes the figure fully visible rather than a shape behind a gradient.
// Nothing overlaps it, so it needs no scrim; its left edge is a stroke, drawn
// like every other edge in the app.
//
// The column's WIDTH is the whole of the layout. The art is cropped to it with
// `cover`, which trims the sides evenly — the runner is centred in the source,
// so a column this shape shows the figure whole with about ten points of
// scenery either side. Widen it and the plaque loses the room it needs on a
// 375pt screen; narrow it and the crop starts eating the figure.
//
// The crop also tightens as the CARD grows, because the column is as tall as
// the card and `cover` scales to the height. It has room for the card to reach
// about 180pt before the figure's own edges start being trimmed, which the
// copy cannot do at one line of title and one of progress — but a second line
// of either is the thing to check if the figure ever looks clipped.
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
import { rankArt } from '../../config/rankArt';
import { Card, Row } from '../ui';
import { Image } from '../../ui/image';
import { Bar } from '../../ui/motion';
import { NB, fonts, nbInk, space, useTheme, useThemedType, withAlpha } from '../../theme';

// The art column, and the plaque that has to fit beside it. Both are constants
// because the card is 335pt wide on the narrowest phone the app supports: 100
// for the art plus 12 of padding and an 8pt gutter leaves 215, and the 70pt
// emblem plus a 12pt gap leaves 133 for a 124pt plaque. A plaque sized for the
// phone it was designed on is one that gets clipped on the small one.
const ART_W = 100;
const PLAQUE_W = 124;

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
  const art = rankArt(standing.key);

  return (
    <Card
      // The card lays out its OWN padding, so the art column can be placed
      // against the card's edges without depending on whether an absolute
      // inset is measured from the border or from inside the padding.
      padded={false}
      style={[styles.card, style]}
      onPress={onPress}
      accessibilityLabel={`${title}. ${standing.name}. ${copy}`}
    >
      {art ? (
        <View
          style={[
            styles.art,
            {
              width: ART_W,
              // The art's own ground, so the column is that scene's sky rather
              // than a grey hole for the frame before the decode lands.
              backgroundColor: art.ground,
              borderLeftColor: nbInk(scheme, colors.card),
            },
          ]}
          pointerEvents="none"
        >
          <Image
            source={art.source}
            style={StyleSheet.absoluteFill}
            // The column is taller than it is wide, so `cover` scales the art
            // to the height and trims the sides — which is exactly where the
            // runner is not.
            resizeMode="cover"
            transition={0}
            accessible={false}
          />
        </View>
      ) : null}

      <View style={[styles.content, art && { paddingRight: ART_W + space.sm }]}>
        <Row gap={space.md} style={styles.top}>
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
            <Text
              numberOfLines={1}
              style={[type.caption, { color: colors.textMuted, letterSpacing: 1 }]}
            >
              {String(title).toUpperCase()}
            </Text>
            <RankPlaque
              name={standing.name}
              color={standing.color}
              ink={standing.ink}
              width={PLAQUE_W}
              height={34}
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
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // Clipped, so the art column stops at the card's own rounded corners.
  card: { overflow: 'hidden' },
  content: { padding: space.md },
  // Flush to the top, right and bottom of the card. The stroke on its left is
  // the only edge it needs, because no copy runs over it.
  art: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: NB.strokeThin,
    overflow: 'hidden',
  },
  top: { alignItems: 'center' },
  // `minWidth: 0` so the middle column yields to the two fixed ones instead of
  // pushing the thumb off the card's right edge.
  headings: { flex: 1, minWidth: 0 },
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
