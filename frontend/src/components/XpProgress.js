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

import GameAnimation from './GameAnimation';
import Framed from './ui/Framed';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { MAX_LEVEL, levelBandColor, levelFromXp, xpForLevel } from '../config/progression';
import {
  NB,
  nbInk,
  nbTextOn,
  space,
  toonRadius,
  useTheme,
  useThemedStyles,
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

export default function XpProgress({
  xp,
  gained = 0,
  accent = '#7CF0D0',
  delay = 420,
  // Fired once per level the bar rolls THROUGH, with the level just reached.
  // The bar is the only thing that knows when that happens — the totals it is
  // handed say where the runner ended up, not which boundaries were crossed on
  // the way — and the celebration is far too big a thing for this row to own,
  // so it is announced rather than played here. See LevelUpCelebration.
  onLevelUp,
  style,
}) {
  const { colors: D } = useTheme();
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
    if (i > 0) {
      // The one haptic this block is allowed: a level is rare and it is the
      // reason the bar is being watched. Ordinary XP does not buzz.
      haptic.success();
      // `steps[i]` is the level the bar has just ARRIVED in, which is the one
      // that was reached. Read off the steps rather than off `stepIndex`,
      // which has not been committed yet at this point in the callback.
      const reached = steps[i]?.level;
      if (reached != null) onLevelUp?.(reached);
    }
  };

  const band = step ? levelBandColor(step.level) : D.cardAlt;

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
              {/* A DRAWN BOX, like every other chip in the app. The band is its
                  paper, so the ink is judged against the band and not against
                  the page — the ladder runs from bronze to the top and one
                  stroke colour picked off the scheme disappears on some of
                  them. `Framed` makes that call in one place; this used to
                  make it here with `nbInk`. */}
              <Framed
                frame={frameVariant('chip', `level:${step.level}`)}
                fill={band}
                on={band}
                weight={INK.thin}
                pose={framePose(`level:${step.level}`)}
                inset={3}
              >
                <Text style={[styles.levelChipText, { color: nbTextOn(band) }]}>
                  {`LEVEL ${step.level}`}
                </Text>
              </Framed>
            </Pop>
            {leveledUp && (
              <>
                {/* IN THE ROW, NOT OVER IT. This was absolutely positioned
                    across the whole head with `alignItems: 'flex-end'`, which
                    put a 64pt opaque burst down on top of the words it was
                    celebrating — the "LEVEL UP" underneath it was unreadable,
                    which is a strange thing to do to the rarest line on the
                    screen. It takes its own space now and cannot collide with
                    anything.
                    It is also SMALL on purpose. The real celebration is the
                    full-screen one (LevelUpCelebration); this is the mark left
                    behind on the card once that has played, not a second
                    celebration arguing with the first. */}
                <GameAnimation
                  name="sparkleStar"
                  size={26}
                  trigger={step.level}
                  style={styles.levelUpSpark}
                />
                <Pop trigger={step.level} delay={90}>
                  <Text style={[styles.levelUp, { color: accent }]}>LEVEL UP</Text>
                </Pop>
              </>
            )}
          </Reveal>
        ) : (
          <View style={styles.levelWrap}>
            <Framed
              frame={frameVariant('chip', 'level:pending')}
              fill={D.cardAlt}
              on={D.cardAlt}
              weight={INK.thin}
              inset={3}
            >
              <Text style={[styles.levelChipText, { color: D.textDim }]}>LEVEL ·</Text>
            </Framed>
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
          <View style={[StyleSheet.absoluteFill, { backgroundColor: accent }]} />
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
  // Colour is passed at the call site — it is judged against the level band
  // behind it, which changes as the ladder is climbed. The horizontal air is
  // here rather than on the frame's content row, which `Framed` owns: that
  // padding is the drawing's measured ink clearance and must not be overwritten.
  levelChipText: { ...type.labelSm, letterSpacing: 0.8, paddingHorizontal: space.xs },
  levelUp: { ...type.labelSm, letterSpacing: 1.2 },
  // Pulled tight against the words it introduces. The star's art carries its
  // own margin of transparency, so a gap measured off the box would read as
  // twice the gap between the chip and the star.
  levelUpSpark: { marginRight: -4, marginLeft: -2 },
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
