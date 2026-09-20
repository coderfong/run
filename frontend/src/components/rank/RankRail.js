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
//
// ---------------------------------------------------------------------------
// THE SCROLLVIEW CARRIES AN EXPLICIT HEIGHT, AND THAT IS NOT A DETAIL.
//
// This is a horizontal ScrollView nested inside the profile page's vertical
// one. A scroll view measured inside a parent that gives it unbounded height
// takes the space rather than its content's, so an unsized rail grew to most
// of a screen and pushed the stat wall, the PRO poster, the streak, the
// trophies, the run list and every setting below it down past the fold — the
// page read as though everything under the portrait had been deleted. Every
// piece of this component's height is therefore a constant, and RAIL_H is the
// sum. Anything added here has to be added to that sum.
// ---------------------------------------------------------------------------
//
// IT IS ALSO INSIDE THE TAB PAGER, which swipes sideways too. The pager won the
// drag, so the rail could only be moved by the jump-to-you on mount — and at
// the top of the ladder the one direction left to scroll is the swipe back to
// Club. `onGrab(true/false)` reports a finger on the track so the page can
// hold the pager still (hooks/useTabSwipeLock).
//
// WHAT IT HAS TO SAY, in the order it is asked: what am I (the plaque), how
// far along (the fill and the division ticks), how far off the next one (the
// gap line), and what is above me (the nodes to the right). The numbers are
// YOUR points against the threshold you are actually chasing — a rail whose
// only number is a tier floor you passed weeks ago is decoration.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { RankPlaque } from './RankBadge';
import { DIVISIONS, RANK_TIERS, ladderRungs, numeral, tierAt } from '../../config/rankLadder';
import { PressableScale, useReduceMotion } from '../../ui/motion';
import { NB, fonts, hardShadow, nbInk, space, useTheme, withAlpha } from '../../theme';

// One node's slot. Narrower than the labels strictly need — "Prismatic" is set
// at 10pt and clipped by a hair rather than given a column of its own — because
// the number of tiers you can see at once is what makes the rail feel like a
// ladder instead of a two-tier progress bar.
const NODE_W = 66;
// The tier discs. The one you are standing on is bigger and carries its
// division numeral, so "you are here" survives being screenshotted.
const DOT = 22;
const CUR = 28;

// The track: a stroked capsule, drawn the way every other functional box in
// this app is drawn (theme/nb.js) rather than as a bare coloured line.
const TRACK_H = 10;
const TRACK_STROKE = 2;
const FILL_H = TRACK_H - TRACK_STROKE * 2;

// Vertical budget, and the reason the rail can never eat the page again.
const PAD_TOP = 8;
const LABEL_GAP = 5;
const LABEL_H = 13;
const TRACK_BOX_H = PAD_TOP + CUR + LABEL_GAP + LABEL_H + 3;
// Where the track's centre line sits, measured from the top of a node column.
const TRACK_Y = PAD_TOP + CUR / 2 - TRACK_H / 2;

// The heading: plaque on the left, your standing in numbers on the right.
// Wide enough for PRISMATIC III, which is the longest string the ladder can
// put on it — the plaque sets its text on one line and would otherwise clip
// the numeral off exactly the tier that most wants showing off.
const PLAQUE_W = 132;
const PLAQUE_H = 26;
const HEAD_GAP = 4;

/** The whole component's height. Fixed, on purpose — see the header. */
export const RAIL_H = PLAQUE_H + HEAD_GAP + TRACK_BOX_H;

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/**
 * One milestone: the disc and the tier's name.
 *
 * The tier's own threshold is NOT printed under every node any more. Ten
 * numbers under ten labels is a table, it cost a whole row of height, and nine
 * of the ten answer a question nobody asked — the only threshold that matters
 * is the one you are climbing towards, which the heading states exactly.
 */
function Node({ rung, reached, current, division, colors, scheme }) {
  const size = current ? CUR : DOT;
  const ink = current ? nbInk(scheme, rung.color) : withAlpha(colors.text, reached ? 0.5 : 0.18);
  return (
    <View style={[styles.node, { width: NODE_W }]}>
      <View style={{ height: CUR, justifyContent: 'center' }}>
        <View
          style={[
            styles.dot,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: reached ? rung.color : colors.cardAlt,
              borderColor: ink,
              borderWidth: current ? 3 : TRACK_STROKE,
            },
            // The hard drop is reserved for the tier you are standing on. On
            // every node it would read as a row of buttons.
            current && hardShadow(nbInk(scheme), NB.offsetSm - 1),
          ]}
        >
          {current ? (
            <Text style={[styles.numeral, { color: rung.ink }]}>{numeral(division)}</Text>
          ) : null}
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: current ? colors.text : reached ? colors.textMuted : colors.textDim },
        ]}
      >
        {rung.label}
      </Text>
    </View>
  );
}

/**
 * @param {object}   standing  from `standingFrom()` in config/rankLadder
 * @param {number[]} floors    per tier points thresholds (optional)
 * @param {Function} onPress   opens the full ladder
 */
export default function RankRail({ standing, floors = [], onPress, onGrab, style }) {
  const { colors, scheme } = useTheme();
  const reduced = useReduceMotion();
  const scroller = useRef(null);

  // Finger down on the track, finger up. The page uses these to hold the tab
  // pager still — see the header and hooks/useTabSwipeLock.
  const grab = useCallback(() => onGrab?.(true), [onGrab]);
  const release = useCallback(() => onGrab?.(false), [onGrab]);

  const rungs = useMemo(() => ladderRungs({ floors }), [floors]);

  // Where the marker sits along the whole rail, in points. Node centres are at
  // `i * NODE_W + NODE_W / 2`; being part way through a tier moves you that
  // fraction of the way toward the NEXT centre, which is one node width on.
  const centre = standing.tier * NODE_W + NODE_W / 2;
  const filled = centre + (standing.isTop ? 0 : standing.progress * NODE_W);
  const total = RANK_TIERS.length * NODE_W;
  // The track spans centre-to-centre, and the fill is drawn INSIDE its stroke.
  const trackW = total - NODE_W;
  const fillW = Math.max(0, Math.min(trackW - TRACK_STROKE * 2, filled - NODE_W / 2 - TRACK_STROKE));

  // THE TARGET, STATED HONESTLY. `standing.next` is whatever the payload
  // carried, and /me/stats carries a progress fraction with no threshold at
  // all — so where the ladder request has landed, its floor for the tier above
  // is used instead. Falling back to nothing would print "0 to go" at the one
  // moment the number is the whole point of the rail.
  const above = standing.isTop ? null : tierAt(standing.tier + 1);
  const target = standing.next ?? (standing.isTop ? null : floors[standing.tier + 1] ?? null);
  const toGo = standing.toNext ?? (target != null ? Math.max(0, target - standing.points) : null);

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
          : toGo != null
            ? `${standing.name}, ${fmt(toGo)} rank points to ${above?.label || 'the next tier'}. Open the rank ladder.`
            : `${standing.name}, ${fmt(standing.points)} rank points. Open the rank ladder.`
      }
    >
      <View style={styles.heading}>
        <RankPlaque
          name={standing.name}
          color={standing.color}
          ink={standing.ink}
          width={PLAQUE_W}
          height={PLAQUE_H}
        />
        {/* Two short lines rather than one long one: the first is where you
            stand, the second is what you are chasing. Stacked, they fit the
            plaque's own height, so the whole heading costs one row. */}
        <View style={styles.headNumbers}>
          <Text numberOfLines={1} style={[styles.points, { color: colors.text }]}>
            {target != null ? `${fmt(standing.points)} / ${fmt(target)}` : `${fmt(standing.points)} pts`}
          </Text>
          <Text numberOfLines={1} style={[styles.gap, { color: colors.textMuted }]}>
            {standing.isTop
              ? 'Top of the ladder'
              : toGo != null
                ? `${fmt(toGo)} to ${above.label}`
                : `Division ${standing.division} of ${DIVISIONS}`}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        // The rail is the scrollable thing INSIDE a vertically scrolling page,
        // so it has to keep the horizontal gesture for itself.
        directionalLockEnabled
        // Measured, never inferred. See the header — an unsized nested scroll
        // view takes the parent's height and buries the rest of the page.
        style={styles.scroller}
        contentContainerStyle={styles.track}
        // Nested in the profile's ScrollView: without this a horizontal drag
        // that starts on a node is swallowed by the parent on Android.
        nestedScrollEnabled
        // And nested in the tab PAGER, which wants the same sideways drag.
        onTouchStart={grab}
        onTouchEnd={release}
        onTouchCancel={release}
        onScrollEndDrag={release}
      >
        <View style={{ width: total, height: TRACK_BOX_H }}>
          {/* The track, stroked once behind every node. */}
          <View
            style={[
              styles.rail,
              {
                top: TRACK_Y,
                left: NODE_W / 2,
                width: trackW,
                backgroundColor: colors.cardAlt,
                borderColor: withAlpha(colors.text, 0.22),
              },
            ]}
          >
            <View style={[styles.fill, { width: fillW, backgroundColor: standing.color }]} />
          </View>

          {/* THE DIVISIONS, drawn where they actually are: two ticks cutting
              the tier you are inside into three. Without them "Wood III" is a
              claim the rail does not back up — with them the fill visibly
              sits in the last third of the band. Presentation only, exactly
              as in config/rankLadder. */}
          {!standing.isTop
            ? Array.from({ length: DIVISIONS - 1 }, (_, i) => (
              <View
                key={`div-${i}`}
                style={[
                  styles.tick,
                  {
                    top: TRACK_Y + TRACK_STROKE,
                    left: centre + ((i + 1) * NODE_W) / DIVISIONS,
                    backgroundColor: withAlpha(colors.text, 0.3),
                  },
                ]}
              />
            ))
            : null}

          <View style={styles.nodes}>
            {rungs.map((rung) => (
              <Node
                key={rung.key}
                rung={rung}
                reached={standing.tier >= rung.tier}
                current={standing.tier === rung.tier}
                division={standing.division}
                colors={colors}
                scheme={scheme}
              />
            ))}
          </View>

          {/* Painted last, above the nodes, without covering their numerals. */}
          <View
            testID="rank-position-marker"
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: filled - 4,
                top: 2,
                backgroundColor: standing.color,
                borderColor: nbInk(scheme, standing.color),
              },
            ]}
          />
        </View>
      </ScrollView>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', height: RAIL_H },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: PLAQUE_H,
    marginBottom: HEAD_GAP,
  },
  headNumbers: { flex: 1, alignItems: 'flex-end', paddingLeft: space.sm },
  points: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 0.2 },
  gap: { fontFamily: fonts.bodyMedium, fontSize: 11, marginTop: 1 },

  scroller: { height: TRACK_BOX_H, flexGrow: 0, flexShrink: 0 },
  track: { alignItems: 'flex-start' },
  // PAD_TOP is shared with TRACK_Y: the discs and the track are centred on
  // the same line, and they only stay centred on it if the node row starts
  // where the track's own arithmetic assumes it does.
  nodes: { flexDirection: 'row', paddingTop: PAD_TOP },

  rail: {
    position: 'absolute',
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: TRACK_STROKE,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: { height: FILL_H, borderRadius: FILL_H / 2 },
  tick: { position: 'absolute', width: 2, height: TRACK_H - TRACK_STROKE * 2 },
  marker: {
    position: 'absolute',
    width: 8,
    height: 8,
    transform: [{ rotate: '45deg' }],
    borderRadius: 1,
    borderWidth: TRACK_STROKE,
  },

  node: { alignItems: 'center' },
  dot: { alignItems: 'center', justifyContent: 'center' },
  numeral: { fontFamily: fonts.display, fontSize: 11, letterSpacing: 0.5, marginTop: -1 },
  label: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.2, marginTop: LABEL_GAP, lineHeight: LABEL_H },
});
