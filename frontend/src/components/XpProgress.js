// The XP a run paid, as MOVEMENT on the level ladder.
//
// The result card used to state it: a small outlined pill reading "+23 XP". A
// number on its own is a receipt — it says what you were given without saying
// what it was FOR, and the ladder it belongs to was two screens away. This is
// the same number as a position: the track starts where the runner stood before
// the run, fills to where they stand now, and rolls over the level boundary if
// the run crossed one.
//
// Everything is derived from one total (`xp`) plus what this session added
// (`gained`), so it never needs its own endpoint: the start of the animation is
// simply the total minus the gain. A claim's XP arriving later moves it a
// second time, from where it came to rest rather than from the beginning.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import GameAnimation from './GameAnimation';
import { MAX_LEVEL, levelBandColor, levelFromXp, xpForLevel } from '../config/progression';
import {
  NB,
  nbInk,
  nbTextOn,
  radius,
  space,
  toonRadius,
  useTheme,
  useThemedStyles,
  withAlpha,
} from '../theme';
import { CountUpText, Pop, Reveal, SteppedBar, haptic } from '../ui/motion';

// How long the whole move takes, shared out between the level boundaries it
// crosses in proportion to how much of each one it covers. A run that crosses
// two levels therefore takes no longer than one that crosses none — it just
// travels faster, which is the right way round.
const TOTAL_MS = 900;
const MIN_STEP_MS = 260;

// The ladder as passes over one track: [{ level, from, to, fromXp, toXp, span }]
// where `from`/`to` are fractions of that level's own band. One entry per level
// the gain touches, in order.
export function xpSteps(fromXp, toXp) {
  const end = Math.max(0, toXp);
  let cursor = Math.max(0, Math.min(fromXp, end));
  let level = levelFromXp(cursor);
  const out = [];

  // Bounded by the ladder itself — a gain can cross at most every level there
  // is, and the loop must not depend on the numbers behaving.
  for (let guard = 0; guard <= MAX_LEVEL; guard++) {
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const span = Math.max(1, next - base);
    if (level >= MAX_LEVEL) {
      // There is no level 51 to be part-way to. The ladder being finished fills
      // the track rather than leaving it a third full under "Max level".
      out.push({ level, from: 1, to: 1, fromXp: span, toXp: span, span });
      break;
    }
    if (end < next) {
      out.push({
        level,
        from: (cursor - base) / span,
        to: (end - base) / span,
        fromXp: cursor - base,
        toXp: end - base,
        span,
      });
      break;
    }
    out.push({ level, from: (cursor - base) / span, to: 1, fromXp: cursor - base, toXp: span, span });
    cursor = next;
    level += 1;
  }
  return out;
}

function withDurations(steps) {
  // Zero-width passes still have to be seen — a run that lands exactly on a
  // boundary crosses it, and a step of no duration would swallow the level-up.
  const covered = steps.map((s) => Math.max(0.02, s.to - s.from));
  const total = covered.reduce((a, b) => a + b, 0) || 1;
  return steps.map((s, i) => ({
    ...s,
    ms: Math.max(MIN_STEP_MS, Math.round((TOTAL_MS * covered[i]) / total)),
  }));
}

const fmtXp = (n) => {
  'worklet';
  return String(Math.round(n));
};

const fmtGain = (n) => {
  'worklet';
  return `+${Math.round(n)} XP`;
};

export default function XpProgress({ xp, gained = 0, accent = '#7CF0D0', delay = 420, style }) {
  const { colors: D, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The window this bar is animating across. Held in state and only moved when
  // the total actually moves: the result screen re-renders constantly (options
  // landing, the energy meter, the claim sequence) and deriving the window from
  // the current total on every render would restart the fill each time.
  const [range, setRange] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (xp == null) return;
    setRange((current) => {
      // First total we ever see: the run has already been paid, so where the
      // runner STOOD is the total minus everything this session added.
      if (!current) return { from: Math.max(0, xp - (gained || 0)), to: xp };
      // A later gain (the claim) carries on from where the bar came to rest.
      if (xp !== current.to) return { from: current.to, to: xp };
      return current;
    });
  }, [xp, gained]);

  const steps = useMemo(() => (range ? withDurations(xpSteps(range.from, range.to)) : []), [range]);
  const step = steps[Math.min(stepIndex, steps.length - 1)] || null;
  const leveledUp = steps.length > 1 && stepIndex > 0;
  const maxed = step ? step.level >= MAX_LEVEL : false;
  const totalMs = steps.reduce((a, s) => a + s.ms, 0) || TOTAL_MS;

  const onStep = (i) => {
    setStepIndex(i);
    // The one haptic this block is allowed: a level is rare and it is the
    // reason the bar is being watched. Ordinary XP does not buzz.
    if (i > 0) haptic.success();
  };

  const band = step ? levelBandColor(step.level) : D.cardAlt;
  // The chip carries a real stroke now rather than floating as a bare fill.
  // Judged against the BAND it is drawn on, not against the page: the bands
  // run from bronze up through the top of the ladder, and one stroke colour
  // picked off the scheme disappears on some of them.
  const chipInk = nbInk(scheme, band);

  return (
    <View style={[styles.root, style]}>
      <View style={styles.head}>
        {step ? (
          <Reveal key={step.level} from="none" duration={220} style={styles.levelWrap}>
            {/* THE ROLLOVER, as something that actually happens.
                The chip used to cross-fade from one number to the next, which
                is the same motion the bar underneath makes while it is merely
                filling — so the rarest moment on this screen looked exactly
                like the ordinary one. It POPS now, and only on a real level
                change: `trigger` is the level itself, so the first level a
                runner sees pops once as it arrives and every later one pops as
                it rolls over. */}
            <Pop trigger={step.level}>
              <View style={[styles.levelChip, { backgroundColor: band, borderColor: chipInk }]}>
                <Text style={[styles.levelChipText, { color: nbTextOn(band) }]}>
                  {`LEVEL ${step.level}`}
                </Text>
              </View>
            </Pop>
            {leveledUp && (
              <>
                {/* Behind the words, not beside them: the burst is the
                    celebration and the words are what it is for. Sized to the
                    row rather than to the screen — the full-screen confetti
                    already firing on this page is the big gesture, and a
                    second one that size would be two celebrations arguing. */}
                <View style={styles.levelUpBurst} pointerEvents="none">
                  <GameAnimation name="levelUpBronze" size={64} trigger={step.level} />
                </View>
                <Pop trigger={step.level} delay={90}>
                  <Text style={[styles.levelUp, { color: accent }]}>LEVEL UP</Text>
                </Pop>
              </>
            )}
          </Reveal>
        ) : (
          <View style={styles.levelWrap}>
            <View style={[styles.levelChip, { backgroundColor: D.cardAlt, borderColor: chipInk }]}>
              <Text style={[styles.levelChipText, { color: D.textDim }]}>LEVEL ·</Text>
            </View>
          </View>
        )}
        {gained > 0 && (
          <CountUpText
            value={gained}
            from={0}
            delay={delay}
            durationMs={totalMs}
            format={fmtGain}
            style={[styles.gain, { color: accent }]}
          />
        )}
      </View>

      {/* Outline on the wrapper, never on the measured track — see Bar. */}
      <View style={styles.track}>
        <SteppedBar
          steps={steps}
          delay={delay}
          onStep={onStep}
          trackStyle={StyleSheet.absoluteFill}
          fillStyle={styles.fill}
        >
          <LinearGradient
            colors={[withAlpha(accent, 0.65), accent]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </SteppedBar>
      </View>

      {/* A row rather than one string: the count-up is a sized box of its own
          (see CountUpText), and an inline view inside a Text is a different
          layout on each platform. */}
      <View style={styles.captionRow}>
        {!step || maxed ? (
          <Text style={styles.caption} numberOfLines={1}>
            {!step ? '·' : 'Max level reached'}
          </Text>
        ) : (
          <>
            <CountUpText
              value={step.toXp}
              from={step.fromXp}
              delay={stepIndex === 0 ? delay : 0}
              durationMs={step.ms}
              format={fmtXp}
              style={styles.captionStrong}
            />
            <Text style={styles.caption} numberOfLines={1}>
              {` / ${step.span} XP to level ${step.level + 1}`}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  root: { alignSelf: 'stretch', marginTop: space.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  levelWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  levelChip: {
    borderRadius: radius.pill,
    borderWidth: NB.strokeThin,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  // Colour is passed at the call site — it is judged against the level band
  // behind it, which changes as the ladder is climbed.
  levelChipText: { ...type.labelSm, letterSpacing: 0.8 },
  levelUp: { ...type.labelSm, letterSpacing: 1.2 },
  // Centred on the LEVEL UP words and sitting behind them. Absolute so it
  // takes no space in the row: the burst appearing must not shove the chip
  // sideways at the exact moment the chip is being looked at.
  levelUpBurst: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -20,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  gain: { ...type.bodySmBold },
  // A 1pt hairline round the ladder read as disabled next to anything else on
  // this page. The bar is the thing the level-up is measured on, so it gets a
  // real edge and the height to carry it.
  track: {
    height: 18,
    borderRadius: toonRadius.pill,
    backgroundColor: colors.cardAlt,
    borderWidth: NB.strokeThin,
    borderColor: nbInk(scheme, colors.cardAlt),
    overflow: 'hidden',
  },
  fill: { height: '100%' },
  captionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  caption: { ...type.caption, color: colors.textDim },
  captionStrong: { ...type.caption, color: colors.textMuted },
});
