// What the runner reads.
//
// A cream panel in one of the app's hand-drawn frames, sitting on the dimmed
// screen with the runner standing on its top edge. Cream rather than themed,
// deliberately: the scrim behind it is dark in BOTH schemes, so a card that
// followed the theme would be a dark card on a dark screen half the time.
// This is the one surface in PASER that is allowed to ignore the palette,
// because what it sits on is not the page.
//
// FOUR PRESENTATIONS, one component:
//   card    the ordinary coach mark
//   loop    RUN → CLAIM → DEFEND, the one moment the tutorial gets to be big
//   payoff  the first claim landing
//   training a safe illustrated simulation of the rest of the game
//
// The copy comes in with *asterisks* round the words that carry the idea; they
// come out in PASER pink. See highlight.js.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { NB, brand, fonts, space, type } from '../theme';
import { Framed, ToonButton } from '../components/ui';
import { framePose } from '../ui/frameRegistry';
import { parseHighlights, plainText } from './highlight';

// The three beats of the game, spelled out once. Not copy that changes: this
// IS the loop, and if it ever reads differently here than it plays, the game
// has moved and this is the thing that should have been updated.
const LOOP_BEATS = ['RUN', 'CLAIM', 'DEFEND'];

function Copy({ text, style, accent }) {
  const runs = parseHighlights(text);
  return (
    <Text style={style} accessibilityLabel={plainText(text)}>
      {runs.map((run, i) => (
        <Text
          key={`${i}:${run.text}`}
          style={run.strong ? { color: accent, fontFamily: fonts.bold } : null}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

function LoopLadder({ accent }) {
  return (
    <View style={styles.ladder} accessibilityLabel="Run, then claim, then defend">
      {LOOP_BEATS.map((beat, i) => (
        <View key={beat} style={styles.ladderRow}>
          <Text style={[styles.ladderWord, { color: i === 0 ? accent : NB.ink }]}>{beat}</Text>
          {i < LOOP_BEATS.length - 1 ? <Text style={styles.ladderArrow}>↓</Text> : null}
        </View>
      ))}
    </View>
  );
}

const TRAINING_SCENES = {
  run: { icon: '🏃', track: '● ━━ ● ━━ ●', stat: '2.40 km   14:32   0.18 km²' },
  claim: { icon: '📍', track: '○ ━━ ◉ ━━ ○', stat: 'CLAIM READY   0.18 km²' },
  rival: { icon: '⚔️', track: 'YOU  ▶  RIVAL LAND', stat: 'POWER 82   VS   64' },
  captured: { icon: '🚨', track: 'YOUR LAND  ▶  RIVAL LAND', stat: 'CAPTURED   RUN TO RESPOND' },
  crossroads: { icon: '🤝', track: 'YOUR ROUTE  ✕  THEIR ROUTE', stat: 'NEW CROSSROADS ENCOUNTER' },
  customise: { icon: '👕', track: '🧢   👕   👟   ✨', stat: 'EQUIP YOUR LOOK AND EFFECTS' },
  shop: { icon: '🛒', track: 'EARN  ▶  UNLOCK  ▶  EQUIP', stat: 'COSMETICS ONLY   NO POWER' },
  progress: { icon: '🏆', track: 'MISSIONS   RANK   CLUBS', stat: 'RUNS BUILD YOUR SEASON' },
  defend: { icon: '🛡️', track: 'RUN  ▶  CLAIM  ▶  DEFEND', stat: 'YOUR CITY CHANGES WITH YOU' },
};

function TrainingScene({ scene, accent }) {
  const item = TRAINING_SCENES[scene];
  if (!item) return null;
  return (
    <View style={styles.training} accessibilityLabel={`${item.track}. ${item.stat}`}>
      <Text style={styles.trainingIcon}>{item.icon}</Text>
      <Text style={[styles.trainingTrack, { color: accent }]}>{item.track}</Text>
      <View style={styles.trainingMeter}>
        <View style={[styles.trainingMeterFill, { backgroundColor: accent }]} />
      </View>
      <Text style={styles.trainingStat}>{item.stat}</Text>
    </View>
  );
}

export default function SpeechCard({
  title,
  lines = [],
  kind = 'card',
  scene,
  cta,
  onPress,
  hint,
  accent = brand.pink,
  progress,
  onLayout,
  style,
  reduced = false,
}) {
  const payoff = kind === 'payoff';
  return (
    <Animated.View
      style={style}
      onLayout={onLayout}
      // Small and quick: 0.94 up to 1 with the fade, which reads as the card
      // arriving rather than as it being inflated.
      entering={reduced ? undefined : FadeIn.duration(190)}
      accessibilityViewIsModal
    >
      <Framed
        frame="panel"
        fill={NB.paper}
        pose={framePose(`tutorial-${kind}`)}
        inset={space.sm}
        contentStyle={styles.body}
      >
        {progress ? (
          <View style={styles.dots}>
            {Array.from({ length: progress.total }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === progress.index && [styles.dotOn, { backgroundColor: accent }],
                ]}
              />
            ))}
          </View>
        ) : null}

        <Copy
          text={title}
          accent={accent}
          style={[payoff ? styles.payoffTitle : styles.title, payoff && { color: accent }]}
        />

        {kind === 'loop' ? <LoopLadder accent={accent} /> : null}
        {kind === 'training' ? <TrainingScene scene={scene} accent={accent} /> : null}

        {lines.map((line) => (
          <Copy key={line} text={line} accent={accent} style={styles.line} />
        ))}

        {cta ? (
          <ToonButton
            title={cta}
            onPress={onPress}
            size="sm"
            fill={{ color: accent, border: NB.ink }}
            containerStyle={styles.cta}
          />
        ) : null}

        {/* Only where a tap is the way on. An action step says what to press in
            its copy, and a second instruction under it competes with the
            first. */}
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </Framed>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.sm,
  },

  title: {
    ...type.title,
    color: NB.ink,
    // The token bakes in the dark palette's text colour and this card is
    // cream, so the colour is restated on every text style in this file.
  },
  payoffTitle: {
    ...type.display,
    color: NB.ink,
  },
  line: {
    ...type.bodyMedium,
    fontSize: 15,
    lineHeight: 21,
    color: NB.ink,
  },

  ladder: { alignItems: 'center', paddingVertical: space.xs, gap: 2 },
  ladderRow: { alignItems: 'center' },
  ladderWord: {
    fontFamily: fonts.hero,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 0.5,
    color: NB.ink,
  },
  ladderArrow: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 18,
    color: 'rgba(12,12,16,0.45)',
  },
  training: {
    alignItems: 'center',
    gap: 7,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: 12,
    backgroundColor: 'rgba(12,12,16,0.06)',
  },
  trainingIcon: { fontSize: 31, lineHeight: 38 },
  trainingTrack: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
  },
  trainingMeter: {
    width: '88%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(12,12,16,0.14)',
  },
  trainingMeterFill: { width: '72%', height: '100%', borderRadius: 4 },
  trainingStat: {
    ...type.labelSm,
    color: 'rgba(12,12,16,0.62)',
    textAlign: 'center',
  },

  cta: { alignSelf: 'stretch', marginTop: space.xs },
  hint: {
    ...type.caption,
    color: 'rgba(12,12,16,0.5)',
    textAlign: 'center',
    marginTop: space.xs,
  },

  dots: { flexDirection: 'row', gap: 5, alignSelf: 'flex-start', marginBottom: 2 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(12,12,16,0.2)',
  },
  dotOn: { width: 16 },
});
