// What the runner reads.
//
// A cream panel in one of the app's hand-drawn frames. Cream rather than
// themed, deliberately: the scrim behind it is dark in BOTH schemes, so a card
// that followed the theme would be a dark card on a dark screen half the time.
//
// SMALL ON PURPOSE. A title, one or two short sentences, and at most one
// instruction. The tutorial layer must never be busier than the screen it is
// explaining, so pink is kept for three things only: the highlighted keyword,
// the pulse around the target, and the primary button.
//
// PRESENTATIONS:
//   card     an anchored callout next to the real control
//   welcome  the first card: the four lines of the game
//   payoff   the demo claim landing
//   loop     "you're ready": RUN CLAIM DEFEND CLIMB
//   banner   one line across the top while the demo route draws
//
// Every way on is an explicit button: SHOW ME, GOT IT, START EXPLORING, or the
// real control the card points at. There is no "tap anywhere to continue".

import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { NB, brand, fonts, space, type } from '../theme';
import { Framed, ToonButton } from '../components/ui';
import { framePose } from '../ui/frameRegistry';
import { STAGES } from './phases';
import { parseHighlights, plainText } from './highlight';

// The four verbs of the game, spelled once.
const LOOP_BEATS = ['RUN', 'CLAIM', 'DEFEND', 'CLIMB'];

// A button pressed within this long of its card appearing was meant for the
// card before it. Swallowing it is what stops a fast double tap from carrying
// the runner through two cards at once.
const PRESS_GUARD_MS = 350;

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

// RUN → CLAIM → DEFEND → READY. Subtle: small caps, the current stage in ink
// and underlined (so it reads without colour), the rest faded.
function StageStrip({ stage, accent }) {
  const at = STAGES.indexOf(stage);
  if (at < 0) return null;
  return (
    <View
      style={styles.stages}
      accessible
      accessibilityLabel={`Step ${at + 1} of ${STAGES.length}: ${stage.toLowerCase()}`}
    >
      {STAGES.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 ? <Text style={styles.stageArrow}>→</Text> : null}
          <View style={[styles.stageItem, i === at && { borderBottomColor: accent }]}>
            <Text style={[styles.stageWord, i === at && styles.stageWordOn, i < at && styles.stageWordDone]}>
              {s}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function LoopRow({ accent }) {
  return (
    <View style={styles.loop} accessibilityLabel="Run. Claim. Defend. Climb.">
      {LOOP_BEATS.map((beat, i) => (
        <Text key={beat} style={[styles.loopWord, i === 0 && { color: accent }]}>
          {beat}.
        </Text>
      ))}
    </View>
  );
}

export function TutorialBanner({ title, accent = brand.pink, onSkip, style, reduced }) {
  return (
    <Animated.View
      style={[styles.banner, style]}
      entering={reduced ? undefined : FadeIn.duration(180)}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
    >
      <Copy text={title} accent={accent} style={styles.bannerTitle} />
      {onSkip ? (
        <Pressable
          onPress={onSkip}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Skip tutorial"
        >
          <Text style={styles.bannerSkip}>Skip tutorial</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export default function SpeechCard({
  title,
  lines = [],
  ack,
  action,
  kind = 'card',
  cta,
  onPress,
  secondary,
  onSecondary,
  onSkip,
  stage,
  accent = brand.pink,
  modal = true,
  onLayout,
  style,
  reduced = false,
}) {
  const shownAt = useRef(Date.now());
  const guarded = useCallback(
    (fn) => () => {
      if (!fn || Date.now() - shownAt.current < PRESS_GUARD_MS) return;
      fn();
    },
    []
  );

  const payoff = kind === 'payoff';
  const welcome = kind === 'welcome';
  return (
    <Animated.View
      style={style}
      onLayout={onLayout}
      entering={reduced ? undefined : FadeIn.duration(190)}
      // Only a card that blocks the screen traps VoiceOver. An action step's
      // card must let VoiceOver reach the real control it is pointing at.
      accessibilityViewIsModal={modal}
    >
      <Framed
        frame="panel"
        fill={NB.paper}
        pose={framePose(`tutorial-${kind}`)}
        inset={space.sm}
        contentStyle={[styles.body, kind === 'card' && styles.bodyCompact]}
      >
        {stage ? <StageStrip stage={stage} accent={accent} /> : null}

        {ack ? <Text style={styles.ack}>{ack}</Text> : null}

        <Copy
          text={title}
          accent={accent}
          style={[
            payoff ? styles.payoffTitle : welcome ? styles.welcomeTitle : styles.title,
          ]}
        />

        {kind === 'loop' ? <LoopRow accent={accent} /> : null}

        {lines.map((line) => (
          <Copy
            key={line}
            text={line}
            accent={accent}
            style={[styles.line, welcome && styles.welcomeLine, payoff && styles.payoffLine]}
          />
        ))}

        {action ? (
          <View style={styles.actionRow} accessibilityRole="text">
            <View style={[styles.actionDot, { backgroundColor: accent }]} />
            <Text style={styles.action}>{action}</Text>
          </View>
        ) : null}

        {cta ? (
          <ToonButton
            title={cta}
            onPress={guarded(onPress)}
            size="sm"
            fill={{ color: accent, border: NB.ink }}
            containerStyle={styles.cta}
            accessibilityLabel={cta}
          />
        ) : null}

        {secondary ? (
          <Pressable
            onPress={guarded(onSecondary)}
            hitSlop={8}
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel={secondary}
          >
            <Text style={styles.secondaryLabel}>{secondary}</Text>
          </Pressable>
        ) : null}

        {onSkip ? (
          <Pressable
            onPress={onSkip}
            hitSlop={8}
            style={styles.skip}
            accessibilityRole="button"
            accessibilityLabel="Skip tutorial"
          >
            <Text style={styles.skipLabel}>Skip tutorial</Text>
          </Pressable>
        ) : null}
      </Framed>
    </Animated.View>
  );
}

const INK_FADED = 'rgba(12,12,16,0.45)';

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.sm,
  },
  bodyCompact: {
    paddingVertical: space.md,
    gap: 6,
  },

  stages: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  stageItem: { borderBottomWidth: 2, borderBottomColor: 'transparent', paddingBottom: 1 },
  stageWord: { ...type.caption, fontSize: 10, letterSpacing: 0.8, color: INK_FADED },
  stageWordOn: { color: NB.ink, fontFamily: fonts.bold },
  stageWordDone: { color: 'rgba(12,12,16,0.7)' },
  stageArrow: { ...type.caption, fontSize: 10, color: INK_FADED },

  ack: { ...type.bodySmBold, color: NB.ink },

  // Every text style restates the ink: the tokens bake in the dark palette's
  // text colour and this card is cream.
  title: { ...type.title, color: NB.ink },
  welcomeTitle: { ...type.display, color: NB.ink },
  payoffTitle: { ...type.display, color: NB.ink },
  line: {
    ...type.bodyMedium,
    fontSize: 15,
    lineHeight: 21,
    color: NB.ink,
  },
  welcomeLine: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 23 },
  payoffLine: { fontSize: 16 },

  loop: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: space.xs },
  loopWord: { fontFamily: fonts.hero, fontSize: 20, lineHeight: 26, color: NB.ink },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  actionDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: NB.ink },
  action: { ...type.bodySmBold, fontSize: 14, color: NB.ink, letterSpacing: 0.3 },

  cta: { alignSelf: 'stretch', marginTop: space.xs },
  secondary: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 },
  secondaryLabel: { ...type.bodySmBold, color: NB.ink, textDecorationLine: 'underline' },
  // Visually secondary, but a real, labelled button with a full hit area.
  skip: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10, minHeight: 32, justifyContent: 'center' },
  skipLabel: { ...type.caption, color: 'rgba(12,12,16,0.6)', textDecorationLine: 'underline' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    backgroundColor: NB.paper,
    borderWidth: 2.5,
    borderColor: NB.ink,
    borderRadius: 16,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  bannerTitle: { ...type.bodySmBold, fontSize: 15, color: NB.ink, flexShrink: 1 },
  bannerSkip: { ...type.caption, color: 'rgba(12,12,16,0.6)', textDecorationLine: 'underline' },
});
