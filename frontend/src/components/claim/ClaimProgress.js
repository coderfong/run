// What the claim did to the runner's level, as ONE block under the payoff.
//
// The payoff used to split this three ways: a LEVEL chip on the left, the
// "+88 XP" on the right, and "Max level reached" floating under a bar that
// looked like it was still going somewhere. Read top down it is now one
// sentence: what you earned, where it left you, and how far that is.
//
//   +88 XP
//   ● LEVEL 32                    340 / 500 XP
//   [==============-------]
//
// No box round it. The payoff keeps its drawn frames for the banner and the
// button; this is typography and one bar.
//
// THE LADDER IS THE SAME ONE XpProgress walks (`xpSteps`), so a gain that
// crosses a level rolls the bar over the boundary here exactly as it does on
// the run card, and `onLevelUp` fires from the same place — that is what hands
// the full screen LevelUpCelebration its cue once the payoff has closed.
//
// AT THE TOP there is no level 51. `xpSteps` fills the track at MAX_LEVEL
// rather than leaving it part way, and the caption says MAX instead of a
// count toward a level that does not exist. XP is still banked there (the
// server keeps the total), so the gain is still stated.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MAX_LEVEL, levelBandColor } from '../../config/progression';
import { NB, brand, nbInk, space, toonRadius, useTheme, useThemedStyles } from '../../theme';
import { CountUpText, Pop, SteppedBar, haptic } from '../../ui/motion';
import { withDurations, xpSteps } from '../XpProgress';

// The payoff has about two seconds for its whole sequence; the bar gets a
// share of that rather than the run card's full 900ms.
const BAR_MS = 700;

const fmtXp = (n) => {
  'worklet';
  return String(Math.round(n));
};

const fmtGain = (n) => {
  'worklet';
  return `+${Math.round(n)} XP`;
};

/** The spoken version of where the bar lands, for a screen reader. */
export function levelSpoken({ level, maxed, toXp, span }) {
  if (maxed) return `Level ${level}, maximum level.`;
  return `Level ${level}, ${Math.round(toXp)} of ${span} XP to level ${level + 1}.`;
}

export default function ClaimProgress({ xp, gained, delay = 0, onLevelUp, style }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Memoised on the two numbers: SteppedBar restarts on a new array.
  const steps = useMemo(
    () => withDurations(xpSteps(Math.max(0, xp - gained), xp), BAR_MS),
    [xp, gained]
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)] || null;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const leveledUp = steps.length > 1 && stepIndex > 0;
  const maxed = step ? step.level >= MAX_LEVEL : false;

  const onStep = (i) => {
    setStepIndex(i);
    if (i > 0) {
      // The one extra buzz this screen allows: a level is rare.
      haptic.success();
      const reached = steps[i]?.level;
      if (reached != null) onLevelUp?.(reached, steps[i - 1]?.level);
    }
  };

  if (!step) return null;
  const band = levelBandColor(step.level);

  return (
    <View
      style={[styles.root, style]}
      accessible
      accessibilityLabel={`${gained} XP earned. ${levelSpoken({
        level: last.level,
        maxed: last.level >= MAX_LEVEL,
        toXp: last.toXp,
        span: last.span,
      })}`}
    >
      <CountUpText
        value={gained}
        from={0}
        delay={delay}
        durationMs={BAR_MS}
        format={fmtGain}
        style={styles.gain}
      />

      <View style={styles.head}>
        {leveledUp ? (
          // THE LEVEL UP takes the row over. Popped on the level itself, so a
          // gain that crosses two levels pops twice.
          <Pop trigger={step.level} style={styles.levelWrap}>
            <Text style={[styles.levelUp, { color: brand.pink }]}>LEVEL UP!</Text>
            <Text style={styles.levelText}>{`${first.level} → ${step.level}`}</Text>
          </Pop>
        ) : (
          <View style={styles.levelWrap}>
            <View style={[styles.dot, { backgroundColor: band, borderColor: nbInk('light', band) }]} />
            <Text style={styles.levelText}>{`LEVEL ${step.level}`}</Text>
          </View>
        )}

        {maxed ? (
          <Text style={[styles.max, { color: brand.pink }]}>MAX LEVEL</Text>
        ) : (
          <View style={styles.countRow}>
            <CountUpText
              value={step.toXp}
              from={step.fromXp}
              delay={stepIndex === 0 ? delay : 0}
              durationMs={step.ms}
              format={fmtXp}
              style={styles.countStrong}
            />
            <Text style={styles.count}>{` / ${step.span} XP`}</Text>
          </View>
        )}
      </View>

      {/* Outline on the wrapper, never on the measured track: see Bar. */}
      <View style={[styles.track, { backgroundColor: colors.cardAlt }]}>
        <SteppedBar
          steps={steps}
          delay={delay}
          onStep={onStep}
          trackStyle={StyleSheet.absoluteFill}
          fillStyle={styles.fill}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: brand.teal }]} />
        </SteppedBar>
      </View>
    </View>
  );
}

// Height the payoff's fit prices this block at. Gain line + head row + bar and
// the air between them; keep it in step with the styles below.
export const CLAIM_PROGRESS_HEIGHT = 30 + 4 + 20 + 6 + 14;

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  root: { alignSelf: 'stretch' },
  gain: {
    fontFamily: type.title.fontFamily,
    fontSize: 22,
    lineHeight: 30,
    color: brand.teal,
    textAlign: 'center',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 6,
    minHeight: 20,
  },
  levelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The band colour, as a mark beside the words rather than a chip round them.
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  levelText: { ...type.bodySmBold, color: colors.text, letterSpacing: 0.6 },
  levelUp: { ...type.bodySmBold, letterSpacing: 0.8 },
  max: { ...type.labelSm, letterSpacing: 0.8 },
  countRow: { flexDirection: 'row', alignItems: 'center' },
  count: { ...type.caption, color: colors.textDim },
  countStrong: { ...type.caption, color: colors.textMuted },
  track: {
    height: 14,
    borderRadius: toonRadius.pill,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.cardAlt),
    overflow: 'hidden',
  },
  fill: { height: '100%' },
});
