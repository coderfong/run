// The rank ladder as one horizontal, scrollable track.
//
// The vertical `RankLadder` is a whole screen you go to. This is the version
// that lives UNDER YOUR PORTRAIT: a milestone rail you can push along with a
// thumb to see what is ahead, without leaving the page you are on.
//
// THE TRACK IS ONE LINE THROUGH EVERY NODE, not a bar per tier. That is the
// entire reason it reads as a journey rather than as a row of badges: the fill
// runs continuously from the left edge to exactly where you are standing, so
// the distance between you and the next node is a LENGTH you can see, and the
// nodes past it are visibly further off.
//
// IT OPENS ON YOU, NOT ON WOOD. The first thing you should see is where you
// are standing, with the next tier already on screen to the right. Starting at
// the beginning of the ladder would mean everyone with any history opens it
// looking at ground they cleared months ago.
//
// TAP ANYWHERE OPENS THE FULL LADDER. The rail is a summary; the questions it
// cannot answer (what each tier is worth, what share of runners are there)
// belong on the screen it leads to.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { RankPlaque } from './RankBadge';
import { RANK_TIERS, ladderRungs } from '../../config/rankLadder';
import { PressableScale, useReduceMotion } from '../../ui/motion';
import { fonts, nbInk, radius, space, useTheme, withAlpha } from '../../theme';

// One node's slot. Wide enough for "Prismatic" at 10pt without truncating,
// narrow enough that three tiers are on screen at once on a small phone.
const NODE_W = 84;
const DOT = 30;
// Where the track sits inside a slot, measured from the top of the node column.
const TRACK_Y = DOT / 2 - 2;

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/** One milestone: the dot, the tier name, and the points it starts at. */
function Node({ rung, reached, current, colors, scheme }) {
  return (
    <View style={[styles.node, { width: NODE_W }]}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: reached ? rung.color : colors.cardAlt,
            borderColor: current ? nbInk(scheme, rung.color) : withAlpha(colors.text, reached ? 0.35 : 0.15),
            borderWidth: current ? 3 : 2,
            transform: [{ scale: current ? 1.18 : 1 }],
          },
        ]}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: current ? colors.text : reached ? colors.textMuted : colors.textDim },
        ]}
      >
        {rung.label}
      </Text>
      <Text style={[styles.floor, { color: colors.textDim }]}>
        {rung.floor != null ? fmt(rung.floor) : '·'}
      </Text>
    </View>
  );
}

/**
 * @param {object}   standing  from `standingFrom()` in config/rankLadder
 * @param {number[]} floors    per tier points thresholds (optional)
 * @param {Function} onPress   opens the full ladder
 */
export default function RankRail({ standing, floors = [], onPress, style }) {
  const { colors, scheme } = useTheme();
  const reduced = useReduceMotion();
  const scroller = useRef(null);

  const rungs = useMemo(() => ladderRungs({ floors }), [floors]);

  // Where the marker sits along the whole rail, in points. Node centres are at
  // `i * NODE_W + NODE_W / 2`; being part way through a tier moves you that
  // fraction of the way toward the NEXT centre, which is one node width on.
  const centre = standing.tier * NODE_W + NODE_W / 2;
  const filled = centre + (standing.isTop ? 0 : standing.progress * NODE_W);
  const total = RANK_TIERS.length * NODE_W;

  const jumpToMe = useCallback(() => {
    // Put the current tier a third of the way in, so what is AHEAD gets the
    // remaining two thirds. Landing it dead centre wastes half the rail on
    // tiers already behind you.
    scroller.current?.scrollTo({ x: Math.max(0, filled - NODE_W * 1.2), animated: !reduced });
  }, [filled, reduced]);

  useEffect(() => {
    // A frame late: on first layout the ScrollView has no content width yet
    // and the scroll is silently clamped to zero.
    const id = setTimeout(jumpToMe, 60);
    return () => clearTimeout(id);
  }, [jumpToMe]);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      style={[styles.wrap, style]}
      accessibilityRole="button"
      accessibilityLabel={
        standing.isTop
          ? `${standing.name}, top of the ladder. Open the rank ladder.`
          : `${standing.name}, ${fmt(standing.toNext)} rank points to the next rung. Open the rank ladder.`
      }
    >
      <View style={styles.heading}>
        <RankPlaque
          name={standing.name}
          color={standing.color}
          ink={standing.ink}
          width={140}
          height={30}
        />
        <Text style={[styles.summary, { color: colors.textMuted }]}>
          {standing.isTop
            ? `${fmt(standing.points)} pts`
            : `${fmt(standing.toNext)} to go`}
        </Text>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        // The rail is the scrollable thing INSIDE a vertically scrolling page,
        // so it has to keep the horizontal gesture for itself.
        directionalLockEnabled
        contentContainerStyle={styles.track}
        // Nested in the profile's ScrollView: without this a horizontal drag
        // that starts on a node is swallowed by the parent on Android.
        nestedScrollEnabled
      >
        <View style={{ width: total }}>
          {/* The line, drawn once behind every node. */}
          <View
            style={[
              styles.rail,
              { top: TRACK_Y, width: total - NODE_W, left: NODE_W / 2, backgroundColor: withAlpha(colors.text, 0.14) },
            ]}
          />
          <View
            style={[
              styles.rail,
              {
                top: TRACK_Y,
                left: NODE_W / 2,
                width: Math.max(0, Math.min(total - NODE_W, filled - NODE_W / 2)),
                backgroundColor: standing.color,
              },
            ]}
          />
          {/* You are here. */}
          <View style={[styles.marker, { left: filled - 5, top: TRACK_Y - 3 }]}>
            <View style={[styles.markerDot, { backgroundColor: colors.text, borderColor: standing.color }]} />
          </View>

          <View style={styles.nodes}>
            {rungs.map((rung) => (
              <Node
                key={rung.key}
                rung={rung}
                reached={standing.tier >= rung.tier}
                current={standing.tier === rung.tier}
                colors={colors}
                scheme={scheme}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  summary: { fontFamily: fonts.bodyMedium, fontSize: 12 },

  track: { paddingVertical: 2 },
  nodes: { flexDirection: 'row' },
  rail: { position: 'absolute', height: 6, borderRadius: 3 },
  marker: { position: 'absolute' },
  markerDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },

  node: { alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  label: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.2, marginTop: 6 },
  floor: { fontFamily: fonts.bodyMedium, fontSize: 10, marginTop: 1 },
});
