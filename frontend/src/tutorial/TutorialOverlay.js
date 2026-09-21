// The coach mark itself: dim, hole, card, runner.
//
// MOUNTED TWICE, AND IT HAS TO BE. `presentation: 'fullScreenModal'` presents a
// real view controller ABOVE the React root on iOS, so an overlay sitting
// beside the NavigationContainer — which is where every other host in this app
// lives (RivalPopupHost, the toast, the offline banner) — is behind the run and
// claim screens and cannot draw a single pixel on them. So there are two
// hosts: `root`, next to the navigator, and `record`, inside the run/claim
// modal. Each step names the one it belongs to, and the other renders nothing.
//
// HOW A REAL BUTTON STAYS PRESSABLE. There is no view over the hole. The scrim
// that blocks touches is four plain views laid AROUND the spotlight
// (layout.js `blockerSlabs`), and the dim you can see is a separate SVG layer
// with `pointerEvents="none"`. A press inside the hole therefore hits whatever
// was already there — the actual record button, the actual hold to finish, the
// actual claim. Nothing is duplicated, nothing is proxied, and the tutorial
// cannot get out of step with what the control really does.

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { brand, space, type } from '../theme';
import { haptic, useReduceMotion } from '../ui/motion';
import { PHASE, CORE_ORDER, phaseIndex } from './phases';
import { CARD_ESTIMATE_H, blockerSlabs, placeCard, placeCoach, spotlightRect } from './layout';
import Coach, { COACH_HEIGHT, COACH_WIDTH } from './Coach';
import SpeechCard from './SpeechCard';
import Spotlight from './Spotlight';
import { useTutorial, useTutorialState } from './TutorialContext';

// The ring is teal and the card's emphasis is pink: the brand CTA colour stays
// on the thing you press, and the light pointing at the screen is the app's
// other accent so the two never read as the same instruction.
const RING = brand.teal;
const ACCENT = brand.pink;

// How much of the top of the screen an action step may never block. One row of
// chrome plus the inset: the close button on the run screen, the back button
// anywhere else. See `blockerSlabs`.
const ESCAPE_STRIP = 52;

// The tour through the world, for the progress dots. The run and claim steps
// are not counted: by then the runner is playing, and a progress bar over a
// real game action reads as homework.
const TOUR = CORE_ORDER.slice(0, phaseIndex(PHASE.START_RUN) + 1);

// --- host slots -------------------------------------------------------------
// Two overlays with the same host name can be mounted at once if two modals
// ever stack. Only the one mounted LAST draws, so a doubled scrim is not
// something a future navigation change can reintroduce.
const slots = new Map();
const watchers = new Set();
let nextSlotId = 1;

function notify() {
  watchers.forEach((fn) => fn());
}

function claimSlot(host, id) {
  const stack = slots.get(host) || [];
  slots.set(host, [...stack, id]);
  notify();
}

function releaseSlot(host, id) {
  const stack = slots.get(host) || [];
  slots.set(host, stack.filter((entry) => entry !== id));
  notify();
}

function subscribeSlots(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function useIsFrontHost(host) {
  const idRef = useRef(null);
  if (idRef.current == null) idRef.current = nextSlotId++;
  const id = idRef.current;

  useEffect(() => {
    claimSlot(host, id);
    return () => releaseSlot(host, id);
  }, [host, id]);

  const read = useCallback(() => {
    const stack = slots.get(host) || [];
    return stack.length === 0 || stack[stack.length - 1] === id;
  }, [host, id]);

  return useSyncExternalStore(subscribeSlots, read, read);
}

// --- the overlay ------------------------------------------------------------

export default function TutorialOverlay({ host = 'root' }) {
  const { step, tip, rect, facts } = useTutorialState();
  const { advance, skip, dismissTip } = useTutorial();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const reduced = useReduceMotion();
  const isFront = useIsFrontHost(host);

  // The card measures itself so it can be placed against its real height. The
  // estimate is only ever used for the first frame of an entrance that is
  // fading in anyway.
  const [cardH, setCardH] = useState(CARD_ESTIMATE_H);
  const onCardLayout = useCallback((e) => {
    const next = Math.round(e.nativeEvent.layout.height);
    setCardH((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  // A tip belongs to the root host: they are all first-opens of a tab.
  const showingStep = !!step && step.host === host;
  const showingTip = !!tip && host === 'root' && !step;
  const visible = isFront && (showingStep || showingTip);

  // Reset the measured height when the content changes, or a tall card leaves
  // a short one placed as though it were still tall.
  const contentKey = showingStep ? step.phase : showingTip ? tip.key : null;
  useEffect(() => {
    setCardH(CARD_ESTIMATE_H);
  }, [contentKey]);

  if (!visible) return null;

  const interactive = showingStep ? step.interactive : false;
  const spot = spotlightRect(rect, screen);
  const card = placeCard({ rect: spot, screen, insets, height: cardH });
  const coach = placeCoach({
    rect: spot,
    card,
    screen,
    insets,
    width: COACH_WIDTH,
    height: COACH_HEIGHT,
  });

  // The copy is a function of what is actually on screen: a runner who owns
  // land is told which colour is theirs, one who owns none is told what the
  // colours mean. Both sentences are true of the map behind the card.
  const copy = showingStep ? step.copy(facts) : { title: tip.title, lines: tip.lines };
  const kind = showingStep ? step.kind : 'card';
  const payoff = kind === 'payoff';

  // Tap to continue, or tap to be told that is not the way on. An action step
  // whose control could not be found blocks nothing, so its scrim is inert.
  const onScrim = () => {
    if (showingTip) {
      haptic.light();
      dismissTip();
      return;
    }
    // CTA cards also advance from the surrounding screen. The button remains
    // a clear visual invitation, but a player never has to hit that exact
    // target to move through an informational or simulated lesson.
    if (step.dismiss === 'tap' || step.dismiss === 'cta') {
      haptic.light();
      advance();
    }
  };

  // An escape is offered whenever the step allows it, AND whenever an action
  // step could not find its control — a card telling somebody to press
  // something the tutorial cannot point at must never be the last word.
  const canEscape = showingStep && (step.skippable || (step.interactive && !spot));

  const tapToContinue = showingStep && (step.dismiss === 'tap' || step.dismiss === 'cta');
  const progress = showingStep && TOUR.includes(step.phase)
    ? { index: TOUR.indexOf(step.phase), total: TOUR.length }
    : null;

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      // `box-none` so this container never takes a touch itself: everything is
      // decided by the children below it, and a press that reaches none of
      // them falls through to the real app.
      pointerEvents="box-none"
      entering={reduced ? undefined : FadeIn.duration(200)}
      exiting={reduced ? undefined : FadeOut.duration(140)}
    >
      {/* SEEN, not felt. */}
      <Spotlight
        rect={spot}
        screen={screen}
        color={RING}
        strong={interactive}
        reduced={reduced}
        dim={payoff ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.72)'}
      />

      {/* FELT, not seen. An informational step is one pressable over the whole
          window; an action step is four slabs with a gap where the real
          control is. */}
      {/* An action step with no measurable control blocks NOTHING: the step
          still ends when the real action reports in, and in the meantime the
          app stays completely usable. That is the whole answer to "what if the
          target never mounts" — it degrades to an instruction, never a trap. */}
      {interactive
        ? spot
          && blockerSlabs(spot, screen, { safeTop: insets.top + ESCAPE_STRIP }).map((slab, i) => (
            <Pressable
              key={`slab-${i}`}
              style={[styles.slab, slab]}
              onPress={onScrim}
              accessible={false}
            />
          ))
        : (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onScrim}
            accessibilityRole={tapToContinue || showingTip ? 'button' : 'none'}
            accessibilityLabel={tapToContinue || showingTip ? 'Tap anywhere to continue' : undefined}
          />
        )}

      {canEscape ? (
        <View style={[styles.skip, { top: insets.top + space.sm }]}>
          <Pressable
            onPress={skip}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Skip the tutorial"
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>
        </View>
      ) : null}

      {coach.visible ? (
        <Coach
          facing={coach.facing}
          width={coach.width}
          celebrate={payoff}
          reduced={reduced}
          style={[styles.coach, { left: coach.left, top: coach.top }]}
        />
      ) : null}

      <SpeechCard
        key={contentKey}
        title={copy.title}
        lines={copy.lines}
        kind={kind}
        scene={showingStep ? step.scene : undefined}
        cta={showingStep && step.dismiss === 'cta' ? step.cta : undefined}
        onPress={advance}
        hint={tapToContinue ? 'Tap anywhere to continue' : showingTip ? 'Tap anywhere to continue' : undefined}
        accent={ACCENT}
        progress={progress}
        reduced={reduced}
        onLayout={onCardLayout}
        style={[styles.card, { left: card.left, top: card.top, width: card.width }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slab: { position: 'absolute', backgroundColor: 'transparent' },
  card: { position: 'absolute' },
  coach: { position: 'absolute' },
  skip: { position: 'absolute', right: space.gutter, zIndex: 2 },
  skipLabel: {
    ...type.labelSm,
    color: 'rgba(255,255,255,0.86)',
  },
});
