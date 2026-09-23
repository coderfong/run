// Rank progression: what THIS claim did to your rank.
//
// Reached from the claim payoff's "View rank progression" link (a side trip:
// ResultScreen ends the celebration first, then pushes this on the run stack,
// so Done goes back to the run recap). Its job is CHANGE, where the full
// ladder's job is POSITION, so this one moves and that one holds still.
//
// THE SEQUENCE (about 1.2s, 1.4s when a tier changes; all of it skipped to the
// end state under Reduce Motion):
//
//   0.00  screen in, compact header
//   0.15  the tier and points line fade in, showing the OLD total
//   0.30  "+4 RANK POINTS" pops (spring), a burst behind it, one light haptic
//   0.45  the total counts old to new
//   0.50  the marker leaves its old position on the ladder, overshoots a small
//         gain so it is visible, and springs back to the exact new position;
//         a teal trail stays on the track over the ground won
//   cross (tier change only) the new tier's card takes the marker, RANK UP!
//         and "PRISMATIC → MYTHIC III" pop in, a second burst, a success haptic
//   1.20  the marker settles and throws one ring; the tier name confirms
//   1.00  Done fades up to full strength by about 1.3s
//
// THE LADDER HERE IS THE LADDER ON YOUR PROFILE, cropped to the three tiers
// around you (RankClimb, built from the same RankLadderKit parts as
// RankLadder). Nothing here decides a promotion: tiers come from the server's
// `rank_key_before/after` and `rank_up`, the floors only place the marker.
//
// No XP here any more: the payoff already shows the level bar, and a rank
// screen that is half about XP is two screens.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { brand, fonts, space, toon, useTheme, useThemedStyles } from '../theme';
import { OutlinedText, ToonButton, ToonGhostButton } from '../components/ui';
import GameAnimation from '../components/GameAnimation';
import RankClimb from '../components/rank/RankClimb';
import { RankHeader } from '../components/rank/RankLadderKit';
import { fmtPoints, nextTierCopy, rankChange } from '../config/rankLadder';
import { useAvatar } from '../state/avatar';
import { CountUpText, Pop, Reveal, haptic, useReduceMotion } from '../ui/motion';

// The beats, in ms from mount. See the table above.
export const BEATS = {
  tier: 150,
  gain: 300,
  count: 450,
  travel: 500,
  cta: 1000,
};
const TRAVEL_MS = 480;
const TRAVEL_MS_TIER = 700;

// Everything on the screen that is not the ladder, in points, so the ladder
// can take the rest without a layout pass (the move starts on mount, and a
// ladder that waited to be measured would start it late or twice).
const FIXED = { header: 70, gain: 52, tier: 58, change: 22, caption: 22, actions: 104, gaps: 32 };
export const LADDER_MIN = 200;
export const LADDER_MAX = 420;

/** The ladder height for a window, clamped. Exported for the fit test. */
export function ladderHeight(windowHeight, insets, tierChange) {
  const fixed = FIXED.header + FIXED.gain + FIXED.tier + FIXED.caption + FIXED.actions + FIXED.gaps
    + (tierChange ? FIXED.change : 0);
  const h = windowHeight - (insets?.top || 0) - (insets?.bottom || 0) - fixed;
  return Math.max(LADDER_MIN, Math.min(LADDER_MAX, Math.round(h)));
}

/** The words for a change. Exported so the copy is tested, not eyeballed. */
export function progressionCopy(change) {
  if (!change) return { subtitle: 'Your rank held', gain: null };
  const d = change.delta;
  const n = Math.abs(d);
  const unit = n === 1 ? 'RANK POINT' : 'RANK POINTS';
  let subtitle;
  if (change.rankUp) subtitle = 'This claim moved you up a tier';
  else if (change.rankDown) subtitle = 'This claim dropped you a tier';
  else if (d > 0) subtitle = 'This claim moved you up the ladder';
  else if (d < 0) subtitle = 'This claim cost you rank points';
  else subtitle = 'Your rank held';
  // U+2212 for the loss: a minus before a number is a number, not a dash.
  const gain = d > 0 ? `+${n} ${unit}` : d < 0 ? `−${n} ${unit}` : null;
  return { subtitle, gain };
}

export default function RankProgressionScreen({ route }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const navigation = useNavigation();
  const { equipped } = useAvatar();
  const reduced = useReduceMotion();

  const claim = route?.params?.claim;
  // Held for the life of the screen: the move is played once, for this claim.
  const change = useMemo(() => rankChange(claim), [claim]);
  const tierChange = !!change && (change.rankUp || change.rankDown);
  const copy = progressionCopy(change);

  const [activeTier, setActiveTier] = useState(change ? (tierChange ? change.from.tier : change.to.tier) : 0);
  const [crossed, setCrossed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [burst, setBurst] = useState(0);
  const timers = useRef([]);

  // The gain lands: one light haptic and the burst behind it. Only for a gain:
  // a loss is shown honestly, not celebrated.
  useEffect(() => {
    if (!change || change.delta <= 0) return undefined;
    const fire = () => { haptic.light(); setBurst(1); };
    if (reduced) { fire(); return undefined; }
    const id = setTimeout(fire, BEATS.gain);
    timers.current.push(id);
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, [change, reduced]);

  const onCross = useCallback(() => {
    if (!change) return;
    setActiveTier(change.to.tier);
    setCrossed(true);
    if (change.rankUp) {
      haptic.success();
      setBurst(2);
    }
  }, [change]);
  const onSettle = useCallback(() => setSettled(true), []);

  const done = () => navigation.goBack();
  const openLadder = () => {
    if (navigation.getState?.()?.routeNames?.includes('RankLadder')) {
      navigation.navigate('RankLadder');
      return;
    }
    navigation.navigate('Tabs', { screen: 'You', params: { screen: 'RankLadder' } });
  };

  if (!change) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <RankHeader title="Rank progression" top={insets.top} onBack={done} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>This claim did not change your rank.</Text>
        </View>
        <View style={[styles.actions, { paddingBottom: insets.bottom + space.sm }]}>
          <ToonButton title="Done" size="sm" onPress={done} />
          <ToonGhostButton title="View full ladder →" color={colors.textMuted} onPress={openLadder} style={styles.link} />
        </View>
      </View>
    );
  }

  const H = ladderHeight(winH, insets, tierChange);
  const { from, to } = change;
  // The name on the line above the ladder: the old one until the marker has
  // crossed (or settled into a new division), then the new one.
  const showName = crossed || settled ? to.name : from.name;
  const moved = change.delta !== 0;
  const caption = nextTierCopy(to);

  const spoken = [
    change.delta > 0 ? `${change.delta} rank points gained from this claim.` : null,
    change.delta < 0 ? `${-change.delta} rank points lost on this claim.` : null,
    change.rankUp ? `Rank up. ${from.label} to ${to.name}.` : null,
    change.rankDown ? `Rank down. ${from.label} to ${to.name}.` : null,
    `Current rank ${to.name}.`,
    `${fmtPoints(change.after)} rank points.`,
    caption ? `${caption}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <RankHeader title="Rank progression" subtitle={copy.subtitle} top={insets.top} onBack={done} />

      <View style={styles.column}>
        <View accessible accessibilityLabel={spoken}>
          {/* 1. The trigger: what the claim was worth. */}
          <View style={styles.gain}>
            {change.delta > 0 ? (
              <View style={styles.burst} pointerEvents="none">
                <GameAnimation name="rewardBurst" size={150} visible={burst > 0} trigger={burst} />
              </View>
            ) : null}
            {copy.gain ? (
              <Reveal from="none" delay={reduced ? 0 : BEATS.gain} duration={140}>
                <Pop from={0.6} delay={reduced ? 0 : BEATS.gain}>
                  {change.delta > 0 ? (
                    <OutlinedText style={[styles.gainText, { color: brand.teal }]} outline={toon.ink} width={2}>
                      {copy.gain}
                    </OutlinedText>
                  ) : (
                    <Text style={[styles.gainText, { color: colors.textMuted }]}>{copy.gain}</Text>
                  )}
                </Pop>
              </Reveal>
            ) : (
              <Text style={styles.heldText}>NO CHANGE</Text>
            )}
          </View>

          {/* 2. The tier and the total, counting old to new. */}
          <Reveal from="none" delay={reduced ? 0 : BEATS.tier} style={styles.tierBlock}>
            <Pop trigger={showName} from={showName === from.name ? 1 : 0.85}>
              <Text style={styles.tierName} numberOfLines={1}>
                {showName.toUpperCase()}
              </Text>
            </Pop>
            <View style={styles.pointsRow}>
              {moved ? (
                <Text style={styles.pointsWas}>{`${fmtPoints(change.before)} → `}</Text>
              ) : null}
              {moved && !reduced ? (
                <CountUpText
                  value={change.after}
                  from={change.before}
                  delay={BEATS.count}
                  durationMs={650}
                  style={styles.points}
                />
              ) : (
                <Text style={styles.points}>{fmtPoints(change.after)}</Text>
              )}
              <Text style={styles.pointsUnit}> pts</Text>
            </View>
          </Reveal>

          {/* 3. Only when the server says a tier changed. */}
          {tierChange ? (
            <View style={styles.changeLine}>
              {crossed ? (
                <Pop from={0.7}>
                  <Text style={styles.changeText} numberOfLines={1}>
                    <Text style={{ color: change.rankUp ? brand.pink : colors.textMuted }}>
                      {change.rankUp ? 'RANK UP!  ' : 'RANK DOWN  '}
                    </Text>
                    {`${from.label.toUpperCase()} → ${to.name.toUpperCase()}`}
                  </Text>
                </Pop>
              ) : null}
              {change.rankUp ? (
                <View style={styles.burst} pointerEvents="none">
                  <GameAnimation name="rewardBurst" size={120} visible={burst === 2} trigger={burst} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* 4. The payoff: the marker moving on the real ladder. */}
        <View style={styles.ladder}>
          <RankClimb
            change={change}
            equipped={equipped}
            height={H}
            startDelay={BEATS.travel}
            travelMs={tierChange ? TRAVEL_MS_TIER : TRAVEL_MS}
            activeTier={activeTier}
            onCross={onCross}
            onSettle={onSettle}
          />
        </View>

        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>

      <Reveal from="none" delay={reduced ? 0 : BEATS.cta} duration={300}>
        <View style={[styles.actions, { paddingBottom: insets.bottom + space.sm }]}>
          <ToonButton title="Done" size="sm" onPress={done} />
          <ToonGhostButton
            title="View full ladder →"
            color={colors.textMuted}
            onPress={openLadder}
            style={styles.link}
          />
        </View>
      </Reveal>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  root: { flex: 1 },
  // Everything between the header and the button, centred, so a tall phone's
  // spare height sits at the edges rather than opening a hole in the middle.
  column: { flex: 1, justifyContent: 'center' },

  gain: { height: FIXED.gain, alignItems: 'center', justifyContent: 'center' },
  burst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  gainText: { fontFamily: fonts.hero, fontSize: 28, lineHeight: 36, letterSpacing: 0.5 },
  heldText: { ...type.label, color: colors.textMuted },

  tierBlock: { alignItems: 'center', height: FIXED.tier },
  tierName: { ...type.title, color: colors.text },
  pointsRow: { flexDirection: 'row', alignItems: 'baseline' },
  pointsWas: { ...type.bodySm, color: colors.textMuted },
  points: { ...type.statMd, color: colors.text },
  pointsUnit: { ...type.bodySm, color: colors.textMuted },

  changeLine: { height: FIXED.change, alignItems: 'center', justifyContent: 'center' },
  changeText: { ...type.bodySmBold, color: colors.text, letterSpacing: 0.4 },

  ladder: { marginTop: space.sm },
  caption: { ...type.captionMedium, color: colors.textMuted, textAlign: 'center', marginTop: space.xs },

  actions: { paddingHorizontal: space.gutter, paddingTop: space.sm },
  link: { alignSelf: 'center', marginTop: space.xs },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.gutter },
  emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center' },
});
