// Rank, as MOVEMENT on the ladder — the twin of XpProgress.
//
// The payoff used to state it: "+21 rank points · 2,471 total", a trophy icon
// and two numbers. That is a receipt for a thing nobody counts in points —
// what a runner actually holds is a RUNG, and the only question a claim
// answers is whether it moved. So this is the same result as a position: the
// track starts where the runner stood before the claim and travels to where
// they stand now.
//
// IT FALLS AS WELL AS CLIMBING, which is the whole reason rank gets its own
// bar instead of borrowing the XP one. XP is a treadmill and its bar only ever
// fills; a defence that failed empties this one back through the division
// below, and watching it drain is the honest version of a number going down.
//
// Everything is derived from the two numbers the claim already carries (the
// standing after, and what it moved by), so it costs no extra request in the
// four seconds this is on screen.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { rankBands, rankSteps } from '../../config/rankLadder';
import { NB, nbInk, space, toonRadius, useTheme, useThemedStyles } from '../../theme';
import { SteppedBar } from '../../ui/motion';

// Matched to XpProgress so the two bars under each other read as one move
// rather than as a race.
const TOTAL_MS = 900;
const MIN_STEP_MS = 260;

function withDurations(steps) {
  const covered = steps.map((s) => Math.max(0.02, Math.abs(s.to - s.from)));
  const total = covered.reduce((a, b) => a + b, 0) || 1;
  return steps.map((s, i) => ({
    ...s,
    ms: Math.max(MIN_STEP_MS, Math.round((TOTAL_MS * covered[i]) / total)),
  }));
}

/**
 * @param {number} points  the standing AFTER the claim
 * @param {number} delta   what the claim moved it by (negative when it fell)
 * @param {number[]} floors  measured tier thresholds, when the caller has them
 */
export default function RankProgress({
  points,
  delta = 0,
  floors,
  label = 'RANK',
  delay = 420,
  height = 16,
  style,
}) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const bands = useMemo(() => rankBands(floors), [floors]);

  // The window this bar is travelling across. Held in state for the reason
  // XpProgress holds its own: the payoff re-renders while it is open (the
  // steal banner's clock, the rig's animation) and deriving the window from
  // the current total every render would restart the travel each time.
  const [range, setRange] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (points == null) return;
    setRange((current) => {
      if (!current) return { from: points - (delta || 0), to: points };
      if (points !== current.to) return { from: current.to, to: points };
      return current;
    });
  }, [points, delta]);

  const steps = useMemo(
    () => (range ? withDurations(rankSteps(range.from, range.to, bands)) : []),
    [range, bands]
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)] || null;
  const band = step?.band || bands[0];
  const falling = !!range && range.to < range.from;

  // What is left to climb, off the band the bar has come to rest on. Points
  // are the ladder's own unit — naming the rung above is what makes them mean
  // something, which is exactly what the bare total this replaced did not do.
  const caption = (() => {
    if (!step) return '·';
    const last = steps[steps.length - 1];
    if (last.band.hi == null) return 'Top of the ladder';
    const to = Math.max(0, Math.round(last.band.hi - (range?.to ?? 0)));
    const above = bands[bands.indexOf(last.band) + 1];
    return `${to.toLocaleString()} to ${above ? above.name : 'the next rung'}`;
  })();

  return (
    <View style={[styles.root, style]}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.standing, { color: band?.color || D.text }]} numberOfLines={1}>
          {(band?.name || '').toUpperCase()}
        </Text>
      </View>

      {/* Outline on the wrapper, never on the measured track — see Bar. */}
      <View style={[styles.track, { height, borderRadius: toonRadius.pill }]}>
        <SteppedBar
          steps={steps}
          delay={delay}
          onStep={setStepIndex}
          trackStyle={StyleSheet.absoluteFill}
          fillStyle={styles.fill}
        >
          {/* Painted in the TIER's colour, not the brand's: the bar and the
              portrait border round the same runner have to agree about what
              this rung looks like. */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: band?.color || D.textDim }]}
          />
        </SteppedBar>
      </View>

      <Text style={[styles.caption, falling && styles.captionFalling]} numberOfLines={1}>
        {falling ? `Ground lost, ${caption.charAt(0).toLowerCase()}${caption.slice(1)}` : caption}
      </Text>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  root: { alignSelf: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  label: { ...type.labelSm, color: colors.textDim, letterSpacing: 1.2 },
  standing: { ...type.labelSm, letterSpacing: 1.2 },
  track: {
    backgroundColor: colors.cardAlt,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.cardAlt),
    overflow: 'hidden',
  },
  fill: { height: '100%' },
  caption: { ...type.caption, color: colors.textDim, marginTop: 5 },
  captionFalling: { color: colors.textMuted },
});
