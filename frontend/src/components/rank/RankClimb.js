// A cropped piece of the real ladder, around the runner, with the runner's
// marker MOVING from where the claim found them to where it left them.
//
// THIS IS THE FULL LADDER, ZOOMED IN. Same track, same tier coloured
// segments, same threshold notches, same tier cards with their art, same YOU
// marker (all from RankLadderKit). The only differences are scale and motion:
// three tiers instead of ten (the one you are in, and one either side), and
// the marker travels.
//
// THE MOVE HAS TO BE SEEN. A +4 on a tier 250 points tall is a couple of
// pixels, which on screen is no move at all. So the travel overshoots: it runs
// past the destination by enough to register as a climb, then springs back to
// the exact position. The final resting place is always the true one; only the
// journey is exaggerated. A teal trail on the track marks the ground this
// claim won (a muted one marks ground lost), and stays after the marker
// settles, so the gain is still legible once the motion is over.
//
// CROSSING A THRESHOLD is reported to the parent (`onCross`) at the moment the
// marker passes the line, which is when the tier transition plays. Whether a
// tier changed at all is the SERVER's word (see rankChange), never decided
// here.
//
// Timing is driven with setTimeout on the JS side for the beats and Reanimated
// on the UI thread for the travel, so the beats are testable with fake timers.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  MARKER,
  RAIL_W,
  TRACK_W,
  TRACK_X,
  RankMarker,
  RankThreshold,
  RankTierCard,
  RankTrack,
} from './RankLadderKit';
import { TOP_TIER, fmtPoints, positionInTier, tierAt } from '../../config/rankLadder';
import { brand, fonts, space, useTheme, withAlpha } from '../../theme';
import { CountUpText, Pop, useReduceMotion } from '../../ui/motion';

// Share of the height each kind of band takes.
const WEIGHT = { current: 2.2, neighbour: 1, cap: 0.42, floor: 0.22 };
// Where inside a band the marker may sit, so it never lands ON a line.
const EDGE = 0.08;
// The least distance the marker is seen to travel, in points.
const MIN_TRAVEL = 18;
const CARD_V = 3;

/**
 * The bands of the cropped ladder, top first, with their pixel geometry.
 * Exported for the tests: the geometry is the part that can be wrong silently.
 */
export function climbBands(centerTier, height) {
  const list = [];
  list.push(centerTier < TOP_TIER ? { kind: 'neighbour', tier: centerTier + 1 } : { kind: 'cap' });
  list.push({ kind: 'current', tier: centerTier });
  list.push(centerTier > 0 ? { kind: 'neighbour', tier: centerTier - 1 } : { kind: 'floor' });
  const total = list.reduce((a, b) => a + WEIGHT[b.kind], 0);
  let bottom = height;
  return list.map((b) => {
    const h = Math.round((height * WEIGHT[b.kind]) / total);
    bottom -= h;
    return { ...b, h, bottom: Math.max(0, bottom) };
  });
}

/** Height above the ladder's bottom edge for a points total in a tier. */
export function climbY(points, tier, bands, floors) {
  const band = bands.find((b) => b.tier === tier);
  if (!band) {
    const tiers = bands.filter((b) => b.tier != null).map((b) => b.tier);
    return tier > Math.max(...tiers) ? bands[0].bottom + bands[0].h : 0;
  }
  const next = tier >= TOP_TIER ? null : floors[tier + 1];
  const frac = Math.max(EDGE, Math.min(1 - EDGE, positionInTier(points, floors[tier], next)));
  return band.bottom + frac * band.h;
}

export default function RankClimb({
  change,
  equipped,
  height,
  // When the travel starts, and how long the eased part of it takes.
  startDelay = 500,
  travelMs = 520,
  // The tier whose card is currently "yours". The parent flips it at onCross.
  activeTier,
  onCross,
  onSettle,
}) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const floors = change.floors;
  const bands = useMemo(() => climbBands(change.to.tier, height), [change.to.tier, height]);

  const fromY = climbY(change.before, change.from.tier, bands, floors);
  const toY = climbY(change.after, change.to.tier, bands, floors);
  const dy = toY - fromY;
  const dir = dy === 0 ? 0 : Math.sign(dy);
  // Overshoot so a tiny gain is still a visible climb, then settle exactly.
  const kick = dir === 0 ? 0 : Math.max(6, MIN_TRAVEL - Math.abs(dy)) * dir;

  // The threshold this move crosses, if the tier changed.
  const crossY = change.from.tier !== change.to.tier
    ? (bands.find((b) => b.tier === Math.max(change.from.tier, change.to.tier))?.bottom ?? null)
    : null;

  const y = useSharedValue(reduced || dir === 0 ? toY : fromY);
  const halo = useSharedValue(0);
  const timers = useRef([]);

  useEffect(() => {
    const later = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    if (reduced || dir === 0) {
      y.value = toY;
      if (crossY != null) onCross?.();
      onSettle?.();
      return undefined;
    }
    y.value = fromY;
    y.value = withDelay(
      startDelay,
      withSequence(
        withTiming(toY + kick, { duration: travelMs, easing: Easing.out(Easing.cubic) }),
        withSpring(toY, { damping: 13, stiffness: 190, mass: 0.7 })
      )
    );
    if (crossY != null) {
      // Out cubic reaches a fraction p of the way at t = 1 - cbrt(1 - p).
      const p = Math.max(0, Math.min(1, (crossY - fromY) / (toY + kick - fromY)));
      later(startDelay + Math.round((1 - Math.cbrt(1 - p)) * travelMs), () => onCross?.());
    }
    const settleAt = startDelay + travelMs + 240;
    later(settleAt, () => {
      onSettle?.();
      // One ring off the medallion: the move is done.
      halo.value = 0;
      halo.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
    });
    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
      timers.current = [];
    };
    // The move is played once, for the claim it was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markerStyle = useAnimatedStyle(() => ({ bottom: y.value - MARKER / 2 }));
  const trailStyle = useAnimatedStyle(() => ({
    bottom: Math.min(fromY, y.value),
    height: Math.abs(y.value - fromY),
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value > 0 ? 0.7 * (1 - halo.value) : 0,
    transform: [{ scale: 1 + halo.value * 0.9 }],
  }));

  const lossColor = withAlpha(colors.danger || '#ff5252', 0.75);
  const gainColor = brand.teal;

  // The part of each band's track that was yours BEFORE this claim moved you
  // (for a gain) or that is still yours AFTER it (for a loss). The difference
  // is the trail.
  const baseY = Math.min(fromY, toY);
  const now = activeTier ?? change.to.tier;

  return (
    <View style={[styles.root, { height }]}>
      {bands.map((band) => {
        const fillPx = Math.max(0, Math.min(band.h, baseY - band.bottom));
        const isTier = band.tier != null;
        const tier = isTier ? tierAt(band.tier) : null;
        const isNow = isTier && band.tier === now;
        const reached = isTier && band.tier <= now;
        const emphasis = isNow ? 'current' : 'near';
        const standing = band.tier === change.to.tier ? change.to : band.tier === change.from.tier ? change.from : null;
        return (
          <View key={`${band.kind}:${band.tier ?? 'x'}`} style={[styles.band, { height: band.h }]}>
            <View style={styles.rail}>
              {isTier ? (
                <>
                  <RankTrack color={tier.color} fill={fillPx / band.h} openTop={band.tier >= TOP_TIER} />
                  <RankThreshold points={floors[band.tier]} reached={reached} />
                </>
              ) : null}
            </View>
            <View style={styles.cardCol}>
              {isTier ? (
                <Pop trigger={isNow ? 1 : 0} from={isNow && change.from.tier !== change.to.tier ? 0.9 : 1}>
                  <RankTierCard
                    tier={tier}
                    height={band.h - CARD_V * 2}
                    name={isNow && standing ? standing.name : tier.label}
                    emphasis={emphasis}
                    reached={reached}
                    youHere={isNow}
                    // YOUR runner stands on the card you are on, and moves to
                    // the new one when the marker crosses a floor; a rank up
                    // lands with the rig's own hop.
                    runner={isNow ? { equipped, pose: change.rankUp && band.tier === change.to.tier ? 'celebrate' : 'neutral' } : null}
                    compact={band.kind !== 'current' || band.h < 120}
                    accessibilityLabel={
                      isNow
                        ? `Current rank ${standing ? standing.name : tier.label}.`
                        : `${tier.label} rank begins at ${fmtPoints(floors[band.tier])} points.`
                    }
                  />
                </Pop>
              ) : null}
            </View>
          </View>
        );
      })}

      {/* The ground this claim moved you across, on top of the track. */}
      {dir !== 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.trail,
            { backgroundColor: dir > 0 ? gainColor : lossColor },
            trailStyle,
          ]}
        />
      ) : null}

      <Animated.View pointerEvents="box-none" style={[styles.markerWrap, markerStyle]}>
        <RankMarker
          equipped={equipped}
          rankKey={tierAt(now).key}
          points={
            dir === 0 || reduced ? fmtPoints(change.after) : (
              <CountUpText
                value={change.after}
                from={change.before}
                delay={startDelay}
                durationMs={travelMs}
                style={[styles.markerPoints, { color: colors.text }]}
              />
            )
          }
          halo={<Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  band: { flexDirection: 'row' },
  rail: { width: RAIL_W },
  cardCol: { flex: 1, marginRight: space.gutter, paddingVertical: CARD_V },
  markerPoints: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 15 },
  trail: {
    position: 'absolute',
    left: TRACK_X - TRACK_W / 2 + 2,
    width: TRACK_W - 4,
    borderRadius: 2,
  },
  markerWrap: { position: 'absolute', left: 0, width: RAIL_W, height: MARKER, zIndex: 3 },
  halo: {
    position: 'absolute',
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    borderWidth: 3,
    borderColor: brand.pink,
  },
});
