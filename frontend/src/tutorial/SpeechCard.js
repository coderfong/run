// What the runner reads.
//
// A cream panel in one of the app's hand-drawn frames, sitting on the dimmed
// screen with the runner standing on its top edge. Cream rather than themed,
// deliberately: the scrim behind it is dark in BOTH schemes, so a card that
// followed the theme would be a dark card on a dark screen half the time.
// This is the one surface in PASER that is allowed to ignore the palette,
// because what it sits on is not the page.
//
// THREE PRESENTATIONS, one component:
//   card    the ordinary coach mark
//   loop    RUN → CLAIM → DEFEND, the one moment the tutorial gets to be big
//   payoff  the first claim landing
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

export default function SpeechCard({
  title,
  lines = [],
  kind = 'card',
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
