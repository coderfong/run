// The coach mark itself: dim, hole, card, and (rarely) the runner.
//
// MOUNTED TWICE, AND IT HAS TO BE. `presentation: 'fullScreenModal'` presents a
// real view controller ABOVE the React root on iOS, so an overlay sitting
// beside the NavigationContainer cannot draw on the run and claim screens. So
// there are two hosts: `root`, next to the navigator, and `record`, inside the
// run/claim modal. The provider resolves which one each step belongs to; the
// other renders nothing.
//
// HOW A REAL BUTTON STAYS PRESSABLE. There is no view over the hole. The scrim
// that blocks touches is four plain views laid AROUND the spotlight
// (layout.js `blockerSlabs`), and the dim you can see is a separate SVG layer
// with `pointerEvents="none"`. A press inside the hole hits the actual LET'S
// RUN card, the actual Start button, the actual slider. Nothing is duplicated.
//
// NOTHING HERE MOVES THE APP ON. The scrim swallows stray taps and does
// nothing with them: the only ways on are the real control in the hole, or an
// explicit button on the card.

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { brand, space } from '../theme';
import { useReduceMotion } from '../ui/motion';
import { plainText } from './highlight';
import { CARD_ESTIMATE_H, blockerSlabs, cardWidth, placeCard, placeCoach, spotlightRect } from './layout';
import Coach, { COACH_HEIGHT, COACH_WIDTH } from './Coach';
import SpeechCard, { TutorialBanner } from './SpeechCard';
import Spotlight from './Spotlight';
import { useTutorial, useTutorialState } from './TutorialContext';

// The pulse around the target is pink: it is the thing to press, and pink is
// the colour of the thing to press everywhere in PASER.
const ACCENT = brand.pink;

// "Slightly" dimmed. The real screen has to stay readable around the hole:
// the point is to show the runner where they are, not to hide it.
const DIM_ACTION = 'rgba(0,0,0,0.5)';
const DIM_CARD = 'rgba(0,0,0,0.58)';

// On the run and claim screens the close button in the top strip stays
// pressable during an action step, so the runner can always leave the demo.
// On Home nothing outside the hole is: the bell and the tabs are not what the
// step is about.
const ESCAPE_STRIP = 52;

// --- host slots -------------------------------------------------------------
// Two overlays with the same host name can be mounted at once if two modals
// ever stack. Only the one mounted LAST draws.
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
  const { step, tip, rect, host: activeHost } = useTutorialState();
  const { facts } = useTutorialState();
  const { advance, secondary, skip, dismissTip } = useTutorial();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const reduced = useReduceMotion();
  const isFront = useIsFrontHost(host);

  const [cardH, setCardH] = useState(CARD_ESTIMATE_H);
  const onCardLayout = useCallback((e) => {
    const next = Math.round(e.nativeEvent.layout.height);
    setCardH((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  const showingStep = !!step;
  const showingTip = !step && !!tip;
  const visible = isFront && activeHost === host && (showingStep || showingTip);

  const contentKey = showingStep ? step.phase : showingTip ? tip.key : null;
  useEffect(() => {
    setCardH(CARD_ESTIMATE_H);
  }, [contentKey]);

  // Say it. VoiceOver reads the card as it arrives, instruction included.
  const copy = showingStep ? step.copy(facts) : showingTip ? { title: tip.title, lines: tip.lines } : null;
  const spoken = copy
    ? [copy.ack, plainText(copy.title), ...(copy.lines || []).map(plainText), copy.action]
        .filter(Boolean)
        .join('. ')
    : null;
  useEffect(() => {
    if (!visible || !spoken) return;
    AccessibilityInfo.announceForAccessibility?.(spoken);
    // Announce once per card, not on every re-render of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contentKey]);

  if (!visible) return null;

  // --- the banner: one line while the demo route draws. No dim, no block.
  if (showingStep && step.kind === 'banner') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <TutorialBanner
          title={copy.title}
          accent={ACCENT}
          onSkip={step.skippable ? skip : undefined}
          reduced={reduced}
          style={{
            position: 'absolute',
            top: insets.top + ESCAPE_STRIP + space.sm,
            left: space.gutter,
            right: space.gutter,
          }}
        />
      </View>
    );
  }

  const interactive = showingStep ? step.interactive : false;
  const spot = spotlightRect(rect, screen);
  const card = placeCard({ rect: spot, screen, insets, height: cardH });
  const coachWanted = showingStep && step.coach;
  const coach = coachWanted
    ? placeCoach({ rect: spot, card, screen, insets, width: COACH_WIDTH, height: COACH_HEIGHT })
    : { visible: false };
  const kind = showingStep ? step.kind : 'card';
  const payoff = kind === 'payoff';

  const onCta = showingTip ? () => dismissTip(true) : advance;
  const cta = showingStep
    ? step.dismiss === 'cta' ? step.cta : undefined
    : tip.cta || 'GOT IT';

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      entering={reduced ? undefined : FadeIn.duration(200)}
      exiting={reduced ? undefined : FadeOut.duration(140)}
    >
      {/* SEEN, not felt. */}
      <Spotlight
        rect={spot}
        screen={screen}
        color={ACCENT}
        strong={interactive}
        reduced={reduced}
        dim={interactive ? DIM_ACTION : DIM_CARD}
      />

      {/* FELT, not seen. A card step blocks the whole screen and does nothing
          with a stray tap; an action step blocks everything except the real
          control in the hole. */}
      {interactive ? (
        blockerSlabs(spot, screen, { safeTop: host === 'record' ? insets.top + ESCAPE_STRIP : 0 }).map(
          (slab, i) => (
            <Pressable
              key={`slab-${i}`}
              style={[styles.slab, slab]}
              onPress={noop}
              accessible={false}
              importantForAccessibility="no"
            />
          )
        )
      ) : (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={noop}
          accessible={false}
          importantForAccessibility="no"
        />
      )}

      {coach.visible ? (
        <Coach
          facing={coach.facing}
          width={coach.width}
          celebrate={payoff || kind === 'loop'}
          reduced={reduced}
          style={[styles.coach, { left: coach.left, top: coach.top }]}
        />
      ) : null}

      <SpeechCard
        key={contentKey}
        title={copy.title}
        lines={copy.lines}
        ack={copy.ack}
        action={copy.action}
        kind={kind}
        cta={cta}
        onPress={onCta}
        secondary={showingStep ? step.secondary?.label : tip.dismissLabel}
        onSecondary={showingStep ? secondary : () => dismissTip(false)}
        onSkip={showingStep && step.skippable ? skip : undefined}
        stage={showingStep ? step.stage : undefined}
        accent={ACCENT}
        // An action step must leave VoiceOver free to reach the real control.
        modal={!interactive}
        reduced={reduced}
        onLayout={onCardLayout}
        style={[styles.card, { left: card.left, top: card.top, width: cardWidth(screen) }]}
      />
    </Animated.View>
  );
}

function noop() {}

const styles = StyleSheet.create({
  slab: { position: 'absolute', backgroundColor: 'transparent' },
  card: { position: 'absolute' },
  coach: { position: 'absolute' },
});
