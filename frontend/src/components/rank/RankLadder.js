// The rank ladder — every tier as a rung in one scrolling column, with your
// own position marked on the rail beside it.
//
// THIS IS WHAT REPLACED THE ELO CARD. A rating and a win/loss record answered
// "what is your number"; nobody asks that. The questions people actually have
// are "what am I", "what is next", and "how far off is it", and a ladder
// answers all three in one glance because the thing above you is drawn
// directly above you.
//
// THE RAIL IS THE POINT, NOT THE DECORATION. The left column is one continuous
// track running the height of the whole ladder, filled up to where you
// actually are and empty above it, with the real threshold printed at every
// rung's floor. That is what turns a list of names into a distance: you can
// see that Gold is close and Diamond is not.
//
// TIERS YOU HAVE PASSED STAY BRIGHT. The obvious build dims everything except
// the current tier, and it is wrong — the rungs below are the climb you
// already did, and greying them out throws away the only part of the ladder
// that is purely good news. Only the UNREACHED rungs are dimmed, because those
// are the ones that are genuinely not yours yet.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import RankBadge, { RankPlaque } from './RankBadge';
import { ladderRungs, tierAt } from '../../config/rankLadder';
import { fonts, nbInk, radius, space, useTheme, useThemedType, withAlpha } from '../../theme';
import { Reveal, useReduceMotion } from '../../ui/motion';

// Fixed rung height, because the rail has to be a straight line through all
// ten of them and a rung that grew with its copy would put kinks in it.
const RUNG_H = 208;
const RAIL_W = 66;

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/** One tier: badge, percentile, plaque, and its slice of the rail. */
function Rung({ rung, standing, equipped, colors, type, scheme }) {
  const reached = standing.tier >= rung.tier;
  const isCurrent = standing.tier === rung.tier;
  // Divisions you hold on THIS tier. A tier below you is fully earned, so it
  // shows all three; a tier above shows none.
  const division = isCurrent ? standing.division : reached ? 3 : 0;

  // Where the fill stops inside this rung. The rail is drawn bottom up, so a
  // rung you are part way through is filled from its bottom edge to here.
  const fillPct = isCurrent ? standing.progress : reached ? 1 : 0;

  return (
    <View style={[styles.rung, { height: RUNG_H }]}>
      {/* --- the rail ------------------------------------------------- */}
      <View style={[styles.rail, { width: RAIL_W }]}>
        <View style={[styles.track, { backgroundColor: withAlpha(colors.text, 0.12) }]} />
        <View
          style={[
            styles.trackFill,
            { height: `${Math.round(fillPct * 100)}%`, backgroundColor: rung.color },
          ]}
        />
        {/* The threshold, sitting on this rung's floor line. */}
        {rung.floor != null ? (
          <Text style={[styles.floor, { color: reached ? colors.text : colors.textDim }]}>
            {fmt(rung.floor)}
          </Text>
        ) : null}

        {/* Your own marker, placed at your exact height inside your tier. */}
        {isCurrent ? (
          <View style={[styles.youWrap, { bottom: `${Math.round(standing.progress * 100)}%` }]}>
            <View style={[styles.you, { backgroundColor: rung.color, borderColor: nbInk(scheme, rung.color) }]}>
              <Text style={[styles.youText, { color: rung.ink }]}>{fmt(standing.points)}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* --- the tier -------------------------------------------------- */}
      <View
        style={[
          styles.body,
          isCurrent && {
            backgroundColor: withAlpha(rung.color, 0.14),
            borderColor: withAlpha(rung.color, 0.5),
          },
        ]}
      >
        <RankBadge
          tierKey={rung.key}
          equipped={equipped}
          size={92}
          division={division}
          color={rung.color}
          dim={!reached}
        />
        {rung.topPercent != null ? (
          <Text style={[styles.percentile, { color: reached ? colors.textMuted : colors.textDim }]}>
            <Text style={{ color: rung.color, fontFamily: fonts.bold }}>{`TOP ${rung.topPercent}% `}</Text>
            OF RUNNERS
          </Text>
        ) : null}
        <RankPlaque
          name={isCurrent ? standing.name : rung.label}
          color={rung.color}
          ink={rung.ink}
          dim={!reached}
          width={186}
          height={38}
          style={styles.plaque}
        />
        {isCurrent && !standing.isTop ? (
          <Text style={[type.caption, { color: colors.textMuted, marginTop: space.xs }]}>
            {`${fmt(standing.toNext)} to ${tierAt(rung.tier + 1).label}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * @param {object} standing  from `standingFrom()` in config/rankLadder
 * @param {number[]} floors  per tier points thresholds
 * @param {number[]} shares  per tier "top n% of runners", measured server side
 * @param {object} equipped  the avatar to wear in every rung's frame
 */
export default function RankLadder({ standing, floors, shares, equipped, style, contentStyle }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const scroller = useRef(null);

  // Highest tier at the TOP, which is the direction a ladder runs. The data is
  // stored bottom first because every other consumer wants it that way.
  const rungs = useMemo(
    () => ladderRungs({ floors, shares }).slice().reverse(),
    [floors, shares]
  );

  // Open on the player, not on the top of the ladder. Where you are standing
  // is the answer to the question that brought you here; Mythic is trivia
  // until you are close to it.
  const jumpToMe = useCallback(() => {
    const rowsAbove = rungs.findIndex((r) => r.tier === standing.tier);
    if (rowsAbove < 0) return;
    // Half a rung of headroom, so the current tier lands in the middle of the
    // viewport rather than flush against its top edge.
    const y = Math.max(0, rowsAbove * RUNG_H - RUNG_H * 0.55);
    scroller.current?.scrollTo({ y, animated: !reduced });
  }, [rungs, standing.tier, reduced]);

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
      {rungs.map((rung, i) => (
        <Reveal key={rung.key} delay={reduced ? 0 : Math.min(i, 6) * 40} from="none">
          <Rung
            rung={rung}
            standing={standing}
            equipped={equipped}
            colors={colors}
            type={type}
            scheme={scheme}
          />
        </Reveal>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.huge },

  rung: { flexDirection: 'row', alignItems: 'stretch' },

  rail: { alignItems: 'center', justifyContent: 'flex-end' },
  // One straight line the full height of every rung, so ten of them stack
  // into a single unbroken track.
  track: { position: 'absolute', top: 0, bottom: 0, width: 6, borderRadius: 3 },
  trackFill: { position: 'absolute', bottom: 0, width: 6, borderRadius: 3 },
  floor: {
    position: 'absolute',
    bottom: -7,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  youWrap: { position: 'absolute', alignItems: 'center' },
  you: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  youText: { fontFamily: fonts.bold, fontSize: 12 },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.gutter,
    marginVertical: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  percentile: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.8,
    marginTop: space.xs,
  },
  plaque: { marginTop: space.sm },
});
