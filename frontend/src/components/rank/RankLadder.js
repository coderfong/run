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
//
// EVERY RUNG IS A PLACE (config/rankArt.js). A tier used to be a colour and a
// word, which made the rung above yours worth nothing in particular; each one
// now carries its own illustration of the runner AT that tier — the woods and
// a bark shield at the bottom, a crown on a pile of coins at Gold, floating
// islands at the top. The scene is the rung: the art fills it, and the three
// pieces of data sit ON the art rather than beside it (your badge top left,
// the percentile top right, the plaque and the gap on a band along the
// bottom). That band is opaque enough to read against any of the ten
// illustrations, which is why the copy is not simply laid over open sky.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import RankBadge, { RankPlaque } from './RankBadge';
import { ladderRungs, tierAt } from '../../config/rankLadder';
import { rankArt } from '../../config/rankArt';
import { Image } from '../../ui/image';
import { NB, fonts, nbInk, radius, space, useTheme, withAlpha } from '../../theme';
import { Reveal, useReduceMotion } from '../../ui/motion';

// Fixed rung height, because the rail has to be a straight line through all
// ten of them and a rung that grew with its copy would put kinks in it.
const RUNG_H = 208;
const RAIL_W = 66;
// The band along the bottom of each scene, carrying the plaque and the gap.
const BAND_H = 46;
// The badge over the scene's top left corner. Smaller than the 92 it was when
// it WAS the rung, because the illustration is now the thing being looked at
// and this is the "and you are here" mark on it.
const BADGE = 62;

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/** One tier: its scene, the marks laid over it, and its slice of the rail. */
function Rung({ rung, standing, equipped, colors, scheme }) {
  const reached = standing.tier >= rung.tier;
  const isCurrent = standing.tier === rung.tier;
  // Divisions you hold on THIS tier. A tier below you is fully earned, so it
  // shows all three; a tier above shows none.
  const division = isCurrent ? standing.division : reached ? 3 : 0;

  // Where the fill stops inside this rung. The rail is drawn bottom up, so a
  // rung you are part way through is filled from its bottom edge to here.
  const fillPct = isCurrent ? standing.progress : reached ? 1 : 0;

  // Null for a tier with no illustration in the build — the rung falls back to
  // the flat tier wash it was drawn with before the art landed, rather than
  // borrowing another tier's world. See config/rankArt.js.
  const art = rankArt(rung.key);

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

      {/* --- the tier: the scene, with the data on it ------------------ */}
      <View
        style={[
          styles.body,
          // The art's own ground under the image. A rung that has not decoded
          // yet is that scene's dirt or ice rather than a grey hole, and the
          // cover crop has something to sit on at either edge.
          { backgroundColor: art ? art.ground : withAlpha(rung.color, 0.14) },
          { borderColor: isCurrent ? rung.color : nbInk(scheme, colors.card) },
          isCurrent && styles.bodyCurrent,
        ]}
      >
        {art ? (
          <Image
            source={art.source}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            // No fade. Ten of these scroll past at once and a staggered set of
            // cross-fades reads as the page loading over and over.
            transition={0}
            accessible={false}
          />
        ) : null}
        {/* Unreached tiers are veiled, not greyed. The scene stays legible —
            you are meant to want it — but it is visibly behind glass, and the
            veil is the page's own background so it reads the same in both
            schemes. */}
        {!reached ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(colors.bg, 0.58) }]} />
        ) : null}

        {/* You, wearing this tier's frame, standing in this tier's world. */}
        <RankBadge
          tierKey={rung.key}
          equipped={equipped}
          size={BADGE}
          division={division}
          color={rung.color}
          dim={!reached}
          style={styles.badge}
        />

        {/* The measured share, over the sky rather than in the band — the band
            is already carrying the plaque and the gap, and three things in a
            46pt strip is a receipt. */}
        {rung.topPercent != null ? (
          <View style={[styles.percentileChip, { backgroundColor: withAlpha(rung.ink, 0.82) }]}>
            <Text style={styles.percentile}>
              <Text style={{ color: rung.color, fontFamily: fonts.bold }}>{`TOP ${rung.topPercent}% `}</Text>
              OF RUNNERS
            </Text>
          </View>
        ) : null}

        <View style={[styles.band, { height: BAND_H, backgroundColor: withAlpha(rung.ink, 0.86) }]}>
          <RankPlaque
            name={isCurrent ? standing.name : rung.label}
            color={rung.color}
            ink={rung.ink}
            dim={!reached}
            width={150}
            height={32}
          />
          {isCurrent && !standing.isTop ? (
            <Text numberOfLines={2} style={[styles.gap, { color: '#ffffff' }]}>
              {`${fmt(standing.toNext)} to ${tierAt(rung.tier + 1).label}`}
            </Text>
          ) : null}
        </View>
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

  // The scene. Clipped, stroked and filled with the art's own ground — every
  // child of it is an overlay ON the illustration.
  body: {
    flex: 1,
    marginRight: space.gutter,
    marginVertical: space.xs,
    borderRadius: radius.lg,
    borderWidth: NB.strokeThin,
    overflow: 'hidden',
  },
  // The tier you are standing on takes the full stroke in its own colour, so
  // "you are here" survives a scroll past at speed.
  bodyCurrent: { borderWidth: NB.stroke },

  badge: { position: 'absolute', top: space.sm, left: space.sm },

  percentileChip: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  // White on the tier's own ink, not a themed text colour: this sits on the
  // illustration in both schemes and has to hold its contrast in each.
  percentile: {
    color: '#ffffff',
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 0.8,
  },

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
  gap: {
    flex: 1,
    textAlign: 'right',
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
  },
});
