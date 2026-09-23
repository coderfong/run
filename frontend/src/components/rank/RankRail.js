// Your rank, as the divisions of the tier you are standing in.
//
// The vertical `RankLadder` is a whole screen you go to. This is the version
// that lives UNDER YOUR PORTRAIT, and it only draws the tier you are in: Wood
// I, Wood II, Wood III — and it ends at Wood. The tiers above are the ladder
// screen's job; on the profile they read as a road you are nowhere near, and
// they pushed the part you can actually move off to one side.
//
// THE TRACK IS ONE LINE THROUGH EVERY DIVISION. Each node sits where its
// division begins, and the track runs on past the last one to the end of the
// tier, so the fill is simply your progress through the tier: the distance to
// the next division is a LENGTH you can see.
//
// It fits the page's width, so there is no sideways scroll to fight the tab
// pager for. Positions are percentages of the track, which keeps it exact
// without waiting on a layout pass.
//
// TAP ANYWHERE OPENS THE FULL LADDER. The rail is a summary; the questions it
// cannot answer (what each tier is worth, what is above) belong on the screen
// it leads to.
//
// THE RAIL CARRIES AN EXPLICIT HEIGHT, AND THAT IS NOT A DETAIL. An earlier
// version was a nested horizontal ScrollView that, unsized, took most of a
// screen and buried everything under the portrait. Every piece of this
// component's height is a constant and RAIL_H is the sum; anything added here
// has to be added to that sum.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RankPlaque } from './RankBadge';
import RankCrest from '../identity/RankCrest';
import { DIVISIONS, numeral, tierAt } from '../../config/rankLadder';
import { PressableScale } from '../../ui/motion';
import { NB, fonts, hardShadow, nbInk, space, useTheme, withAlpha } from '../../theme';

// One node's label box, centred on the node. Wide enough for "Prismatic III"
// at 10pt; the track is inset by half of it on the left so the first label is
// never clipped by the page edge.
const NODE_W = 76;
const INSET_L = NODE_W / 2;
// On the right the track runs to the tier's end, which carries no label, so it
// only needs to clear the marker.
const INSET_R = 6;
// The division discs. The one you are standing on is bigger and carries its
// numeral, so "you are here" survives being screenshotted.
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
// Where the track's centre line sits, measured from the top of the track box.
const TRACK_Y = PAD_TOP + CUR / 2 - TRACK_H / 2;

// The heading: plaque on the left, your standing in numbers on the right.
// Wide enough for PRISMATIC III, which is the longest string the ladder can
// put on it.
const PLAQUE_W = 132;
const PLAQUE_H = 26;
const HEAD_GAP = 4;
// The rank crest (identity/RankCrest) that leads the heading when the rail
// sits under a FULL BODY runner: there the rank is no longer the frame round
// the portrait, so the rail is where the tier's emblem is shown. It is a touch
// taller than the plaque, so the heading takes its height.
const CREST = 32;
const HEAD_H = Math.max(PLAQUE_H, CREST);

/** The whole component's height. Fixed, on purpose — see the header. */
export const RAIL_H = HEAD_H + HEAD_GAP + TRACK_BOX_H;

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/** Where a division begins along the track, as a percentage of its length. */
export function divisionAt(division) {
  return ((division - 1) / DIVISIONS) * 100;
}

/** One division: the disc and its name ("Wood II"). */
function Node({ tier, division, reached, current, colors, scheme }) {
  const size = current ? CUR : DOT;
  const ink = current ? nbInk(scheme, tier.color) : withAlpha(colors.text, reached ? 0.5 : 0.18);
  return (
    <View
      style={[styles.node, { left: `${divisionAt(division)}%` }]}
      pointerEvents="none"
    >
      <View style={{ height: CUR, justifyContent: 'center' }}>
        <View
          style={[
            styles.dot,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: reached ? tier.color : colors.cardAlt,
              borderColor: ink,
              borderWidth: current ? 3 : TRACK_STROKE,
            },
            // The hard drop is reserved for the division you are standing on.
            current && hardShadow(nbInk(scheme), NB.offsetSm - 1),
          ]}
        >
          {current ? (
            <Text style={[styles.numeral, { color: tier.ink }]}>{numeral(division)}</Text>
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
        {`${tier.label} ${numeral(division)}`}
      </Text>
    </View>
  );
}

/**
 * @param {object}   standing  from `standingFrom()` in config/rankLadder
 * @param {number[]} floors    per tier points thresholds (optional)
 * @param {Function} onPress   opens the full ladder
 * @param {boolean}  crest     lead the heading with the tier's crest
 */
export default function RankRail({ standing, floors = [], onPress, crest = false, style }) {
  const { colors, scheme } = useTheme();

  // Progress through the tier you are in, which is exactly how far along the
  // track the fill runs. The top of the ladder reads as full.
  const pct = (standing.isTop ? 1 : Math.max(0, Math.min(1, standing.progress || 0))) * 100;

  // THE TARGET, STATED HONESTLY. `standing.next` is whatever the payload
  // carried, and /me/stats carries a progress fraction with no threshold at
  // all — so where the ladder request has landed, its floor for the tier above
  // is used instead. Falling back to nothing would print "0 to go" at the one
  // moment the number is the whole point of the rail.
  const above = standing.isTop ? null : tierAt(standing.tier + 1);
  const target = standing.next ?? (standing.isTop ? null : floors[standing.tier + 1] ?? null);
  const toGo = standing.toNext ?? (target != null ? Math.max(0, target - standing.points) : null);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      // The header centres its children (alignItems: 'center'), so the rail
      // only spans the full width if ITS OWN root stretches — and that root
      // is PressableScale's outer Pressable, not the inner Animated.View that
      // `style` lands on. Passing the sizing there instead is what makes the
      // track run edge to edge rather than shrink to its content, which used
      // to squeeze all three division labels into overlapping text.
      containerStyle={[styles.wrap, style]}
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
        {crest ? <RankCrest standing={standing} size={CREST} style={styles.crest} /> : null}
        <RankPlaque
          name={standing.name}
          color={standing.color}
          ink={standing.ink}
          width={PLAQUE_W}
          height={PLAQUE_H}
        />
        {/* Two short lines rather than one long one: the first is where you
            stand, the second is what you are chasing. */}
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

      <View style={styles.box}>
        {/* Everything below is positioned in percentages of THIS box, which is
            the track's own length. */}
        <View style={styles.trackArea}>
          <View
            style={[
              styles.rail,
              { backgroundColor: colors.cardAlt, borderColor: withAlpha(colors.text, 0.22) },
            ]}
          >
            <View
              testID="rank-fill"
              style={[styles.fill, { width: `${pct}%`, backgroundColor: standing.color }]}
            />
          </View>

          {Array.from({ length: DIVISIONS }, (_, i) => (
            <Node
              key={`div-${i + 1}`}
              tier={standing}
              division={i + 1}
              reached={standing.division >= i + 1}
              current={standing.division === i + 1}
              colors={colors}
              scheme={scheme}
            />
          ))}

          {/* Painted last, above the nodes, without covering their numerals. */}
          <View
            testID="rank-position-marker"
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: `${pct}%`,
                backgroundColor: standing.color,
                borderColor: nbInk(scheme, standing.color),
              },
            ]}
          />
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', height: RAIL_H },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: HEAD_H,
    marginBottom: HEAD_GAP,
  },
  crest: { marginRight: 4 },
  headNumbers: { flex: 1, alignItems: 'flex-end', paddingLeft: space.sm },
  points: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 0.2 },
  gap: { fontFamily: fonts.bodyMedium, fontSize: 11, marginTop: 1 },

  box: { height: TRACK_BOX_H },
  trackArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: INSET_L,
    right: INSET_R,
  },

  rail: {
    position: 'absolute',
    top: TRACK_Y,
    left: 0,
    right: 0,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: TRACK_STROKE,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: { height: FILL_H, borderRadius: FILL_H / 2 },
  marker: {
    position: 'absolute',
    top: 2,
    marginLeft: -4,
    width: 8,
    height: 8,
    transform: [{ rotate: '45deg' }],
    borderRadius: 1,
    borderWidth: TRACK_STROKE,
  },

  node: {
    position: 'absolute',
    top: PAD_TOP,
    width: NODE_W,
    marginLeft: -NODE_W / 2,
    alignItems: 'center',
  },
  dot: { alignItems: 'center', justifyContent: 'center' },
  numeral: { fontFamily: fonts.display, fontSize: 11, letterSpacing: 0.5, marginTop: -1 },
  label: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.2, marginTop: LABEL_GAP, lineHeight: LABEL_H },
});
