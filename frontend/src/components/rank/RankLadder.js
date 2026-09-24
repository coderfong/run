// The rank ladder: every tier as a rung in one scrolling column, with your own
// position marked on the rail beside it.
//
// THE JOB IS POSITION. "Where am I, what is next, what exists." It is browsed,
// so it holds still: one short entrance (the rungs fade in, your card lifts,
// your marker slides onto the track) and nothing loops.
//
// ONE LADDER, NOT A STACK OF POSTERS. The rail on the left is a single track
// through all ten rungs, cut into tier coloured segments, with a notch and the
// real threshold at each tier's floor. Each card is exactly as tall as its
// slice of the track, so a card and the range it covers line up by position
// alone. Your marker (the same RankMarker the post claim screen moves) sits on
// the track at your exact height and points into your card.
//
// EMPHASIS BY DISTANCE. Your tier is the only card at full strength (thicker
// stroke in its colour, a glow, YOU ARE HERE, slightly wider). Neighbours are a
// touch quieter, far tiers quieter again, unreached ones a little more. Never
// greyed: the art above you is the reason to climb.
//
// PERCENTILES ARE PER TIER, ABOVE YOU, AND ONLY WHERE THEY SAY SOMETHING. The server's
// `top_percent` is the share of players AT OR ABOVE a tier, so an empty tier
// carries the same number as the tier above it, which is how "Top 11% of
// runners" used to repeat down the column. A card now shows its percentile
// only when it differs from the tier above, never on your own card (your
// percentile is printed once, in the summary), and never the meaningless 100%.
//
// CARD HEIGHT FOLLOWS THE ART. The illustrations are 16:9. A rung is sized so
// its card is close to 16:9 at the card's actual width, which keeps the runner
// in every scene whole while fitting more of the ladder per screen than the old
// fixed 208pt rungs did (about 80% of that height on a 375pt phone).

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  MARKER,
  RAIL_W,
  RankMarker,
  RankThreshold,
  RankTierCard,
  RankTrack,
} from './RankLadderKit';
import {
  TOP_TIER,
  fmtPoints,
  floorsOrMirror,
  ladderRungs,
  nextTierCopy,
  positionInTier,
} from '../../config/rankLadder';
import { RANK_ART_ASPECT } from '../../config/rankArt';
import { space, useTheme, useThemedType } from '../../theme';
import { Pop, Reveal, useReduceMotion } from '../../ui/motion';

// Vertical breathing room inside a rung, around its card. The current card
// takes less of it, which is what makes it read a size up.
const CARD_V = 5;
const CARD_V_CURRENT = 2;
// Non current cards are inset a little from both sides for the same reason.
const CARD_INSET = 6;
// How close the marker may come to either end of its rung: enough to clear the
// threshold printed on the floor line.
const YOU_PAD = 9;
// The YOU tag hangs this far above the marker's number, so the marker stops
// that much sooner under the rung above's threshold.
const YOU_TAG = 11;
// The open end of the track above the top tier.
const CAP_H = 30;
// Below this screen width a tier card is too narrow for the full plaque and
// its line, so the cards take the compact plaque.
const NARROW_W = 360;

/** The rung height for a screen width: the card lands near 16:9. */
export function rungHeightFor(width) {
  const cardW = width - RAIL_W - space.gutter - CARD_INSET * 2;
  const h = Math.round(cardW / RANK_ART_ASPECT) + CARD_V * 2;
  return Math.max(148, Math.min(200, h));
}

/**
 * The one percentile a card may show, or null. See the header: equal to the
 * tier above means nobody stands in this tier, so it says nothing new.
 */
export function cardPercent(shares, tierIndex, currentTier) {
  // Only the tiers still ahead: how exclusive a goal is helps you want it;
  // the share of a tier you already passed is trivia.
  if (tierIndex <= currentTier) return null;
  const mine = shares?.[tierIndex];
  if (mine == null || mine >= 100) return null;
  const above = shares?.[tierIndex + 1];
  if (above != null && above === mine) return null;
  return mine;
}

function Rung({ rung, standing, floors, shares, equipped, rungH, narrow }) {
  const reached = standing.tier >= rung.tier;
  const isCurrent = standing.tier === rung.tier;
  const distance = Math.abs(standing.tier - rung.tier);
  const emphasis = isCurrent ? 'current' : distance === 1 ? 'near' : 'far';

  const next = rung.tier >= TOP_TIER ? null : floors[rung.tier + 1] ?? null;
  const fill = isCurrent
    ? positionInTier(standing.points, floors[rung.tier], next)
    : reached ? 1 : 0;

  // Kept inside the rung whatever the fill says. Placed at a raw percentage
  // the marker used to leave the ladder entirely at the top. The clamp only
  // bites within a few points of a threshold, where the numbers would
  // otherwise print over each other; everywhere else the marker's centre is
  // exactly the rung's height at your points.
  const youBottom = Math.max(
    YOU_PAD,
    Math.min(rungH - MARKER - YOU_PAD - YOU_TAG, Math.round(fill * rungH - MARKER / 2))
  );

  const cardV = isCurrent ? CARD_V_CURRENT : CARD_V;
  const label = isCurrent
    ? `Current rank ${standing.name}. ${fmtPoints(standing.points)} rank points.`
    : rung.floor != null
      ? `${rung.label} rank begins at ${fmtPoints(rung.floor)} points.`
      : `${rung.label} rank.`;

  const card = (
    <RankTierCard
      tier={rung}
      height={rungH - cardV * 2}
      name={isCurrent ? standing.name : rung.label}
      emphasis={emphasis}
      reached={reached}
      percent={cardPercent(shares, rung.tier, standing.tier)}
      // What is next, on your own card only. Not at the top: the track's
      // open end already says "Top of the ladder", once.
      gap={isCurrent && !standing.isTop ? nextTierCopy(standing) : null}
      youHere={isCurrent}
      runner={isCurrent ? { equipped } : null}
      // The narrow plaque on small phones, so the line beside it (the gap,
      // a percentile) has room to be read instead of ending in an ellipsis.
      compact={narrow}
      accessibilityLabel={label}
    />
  );

  return (
    <View style={[styles.rung, { height: rungH }]}>
      {/* Raised on your rung so the marker's stem draws over the card edge. */}
      <View style={[styles.rail, isCurrent && styles.railRaised]}>
        <RankTrack color={rung.color} fill={fill} openTop={rung.tier >= TOP_TIER} />
        <RankThreshold points={rung.floor} reached={reached} />
        {isCurrent ? (
          <View style={[styles.youWrap, { bottom: youBottom, height: MARKER }]}>
            <Reveal from="down" delay={160} duration={320}>
              <RankMarker equipped={equipped} rankKey={standing.key} points={fmtPoints(standing.points)} />
            </Reveal>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.cardCol,
          { paddingVertical: cardV },
          !isCurrent && { paddingHorizontal: CARD_INSET },
        ]}
      >
        {isCurrent ? (
          <Pop from={0.96} delay={80}>
            {card}
          </Pop>
        ) : card}
      </View>
    </View>
  );
}

/**
 * @param {object} standing  from `standingFrom()` in config/rankLadder
 * @param {number[]} floors  per tier thresholds (the mirror fills in if absent)
 * @param {number[]} shares  per tier "top n% of runners", measured server side
 * @param {object} equipped  the avatar the marker wears
 */
export default function RankLadder({ standing, floors, shares, equipped, style, contentStyle }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const scroller = useRef(null);
  const rungH = rungHeightFor(width);
  const f = useMemo(() => floorsOrMirror(floors), [floors]);

  // Highest tier at the TOP, which is the direction a ladder runs.
  const rungs = useMemo(
    () => ladderRungs({ floors: f, shares }).slice().reverse(),
    [f, shares]
  );

  // Open on the player, not the top. Your card lands just above the middle.
  const jumpToMe = useCallback(() => {
    const rowsAbove = rungs.findIndex((r) => r.tier === standing.tier);
    if (rowsAbove < 0) return;
    const y = Math.max(0, CAP_H + rowsAbove * rungH - Math.max(0, height * 0.3 - rungH / 2));
    scroller.current?.scrollTo({ y, animated: false });
  }, [rungs, standing.tier, rungH, height]);

  useEffect(() => {
    // One frame late: on the first layout the ScrollView has no content height
    // yet and the scroll is silently clamped to zero.
    const id = setTimeout(jumpToMe, 60);
    return () => clearTimeout(id);
  }, [jumpToMe]);

  return (
    <ScrollView
      ref={scroller}
      style={[styles.scroll, style]}
      contentContainerStyle={[styles.content, contentStyle]}
      showsVerticalScrollIndicator={false}
    >
      {/* The open end of the track: Mythic has nothing above it. */}
      <View style={[styles.cap, { height: CAP_H }]}>
        <View style={styles.rail} />
        <Text style={[type.labelSm, styles.capText, { color: colors.textDim }]}>Top of the ladder</Text>
      </View>
      {rungs.map((rung) => {
        const near = Math.abs(rung.tier - standing.tier);
        return (
          <Reveal
            key={rung.key}
            delay={reduced ? 0 : Math.min(near, 4) * 30}
            duration={260}
            from="none"
          >
            <Rung
              rung={rung}
              standing={standing}
              floors={f}
              shares={shares}
              equipped={equipped}
              rungH={rungH}
              narrow={width < NARROW_W}
            />
          </Reveal>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.huge },
  rung: { flexDirection: 'row', alignItems: 'stretch' },
  rail: { width: RAIL_W, justifyContent: 'flex-end' },
  railRaised: { zIndex: 2 },
  youWrap: { position: 'absolute', left: 0, width: RAIL_W, zIndex: 2 },
  cardCol: { flex: 1, marginRight: space.gutter },
  cap: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 4 },
  capText: { letterSpacing: 1 },
});
