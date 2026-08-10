// The three volunteers behind the counter.
//
// They are ordinary PASER avatars: real loadouts from the cosmetics catalogue
// rendered through CharacterRig, the same paper doll used on the profile and
// in the studio. Nothing here is bespoke art, which is what makes expression
// changes exact — only the face image swaps, so the head, shoulders and
// clothes cannot shift by a pixel between frames.
//
// Motion offsets are in DEVICE pixels, not scene units: a 3px idle bob should
// be 3px on every phone, while layout scales with the screen.

import React, { memo, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import CharacterRig, { BODY_RATIO } from '../character/CharacterRig';
import { PIT_STOP_ANIM, PIT_STOP_CREW, PIT_STOP_LAYOUT } from '../../config/pitStop';
import { useBlink, useHeldExpression } from './useShopkeeperState';

// CharacterRig draws the body plus 14% headroom for tall hair; the frame we
// position has to account for both or the crew floats.
const RIG_HEADROOM = 0.14;
const rigHeight = (bodyWidth) => bodyWidth * BODY_RATIO * (1 + RIG_HEADROOM);

/**
 * Which expression a state calls for — a ladder that only ever climbs from
 * happy to happier. `happy` is the floor, not a neutral face, so the crew is
 * pleased to see you before you have done anything.
 *
 * Only the SHORT beats escalate. Selecting an item deliberately does NOT move
 * the face: it is a state a user sits in while they read a price, the body and
 * the item art already react, and one more face swap on every tap through the
 * grid was most of what made the counter feel jumpy.
 */
function expressionFor(state, offerPhase) {
  switch (state) {
    case 'purchase-success':
    case 'rare-reveal':
      return 'cheer';
    case 'unavailable':
      return 'sorry';
    case 'offer':
      return offerPhase === 'present' ? 'happier' : 'happy';
    default:
      return 'happy';
  }
}

/** Reactions to something the user just did must not wait out the hold. */
function isUrgent(state) {
  return state === 'purchase-success' || state === 'rare-reveal' || state === 'unavailable';
}

/**
 * Blinking is allowed while the crew is idle or simply presenting a selected
 * item — the two states a user can sit in for a long time, where a frozen
 * stare is what breaks the illusion. Both resolve to `content`, the one face
 * with an eyes-only partner, so the blink always has something to swap to. It
 * is suppressed for every reaction the brief protects: the cup presentation,
 * purchase success, a rare reveal and the apologetic shrug.
 */
function blinkAllowed(state, offerPhase) {
  if (state === 'idle') return true;
  if (state === 'selected-item') return true;
  if (state === 'offer') return offerPhase === 'prep';
  return false;
}

/** Positions a rig frame from the layout table. */
function crewFrame({ x, y, width }, scale) {
  const w = width * scale;
  return {
    position: 'absolute',
    left: (x - width / 2) * scale,
    top: y * scale,
    width: w,
    height: rigHeight(w),
  };
}

/**
 * A crew member's face, resolved from the state plus the blink overlay.
 * Memoised on the resulting face id so the rig re-renders only when the
 * picture actually changes.
 */
function useCrewEquipped(crew, expression, closed) {
  const shown = crew.faces[expression] || crew.faces.happy;
  const face = closed ? crew.blink[shown] || shown : shown;
  return useMemo(() => ({ ...crew.equipped, face }), [crew.equipped, face]);
}

// ---------------------------------------------------------------------------
// Centre attendant
// ---------------------------------------------------------------------------

export const MainAttendant = memo(function MainAttendant({
  state,
  offerPhase,
  scale,
  active,
  reduced,
}) {
  const crew = PIT_STOP_CREW.keeper;
  const closed = useBlink(active && !reduced && blinkAllowed(state, offerPhase));
  const expression = useHeldExpression(expressionFor(state, offerPhase), {
    minHold: PIT_STOP_ANIM.expression.minHold,
    urgent: isUrgent(state),
  });
  const equipped = useCrewEquipped(crew, expression, closed);

  const bob = useSharedValue(0);
  const pose = useSharedValue(0);
  const tilt = useSharedValue(0);
  const squash = useSharedValue(1);

  // Idle: a 3px rise with a hair of counter-squash and a quarter-degree of
  // sway. Small enough to read as breathing rather than bouncing.
  useEffect(() => {
    if (!active || reduced) {
      bob.value = withTiming(0, { duration: 200 });
      squash.value = withTiming(1, { duration: 200 });
      return;
    }
    const { duration } = PIT_STOP_ANIM.idle.keeper;
    bob.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
    squash.value = withRepeat(
      withTiming(0.992, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [active, reduced, bob, squash]);

  // Reactions. Under Reduce Motion the body holds still and the expression
  // swap carries the whole message.
  useEffect(() => {
    if (reduced) {
      pose.value = 0;
      tilt.value = 0;
      return;
    }
    const { purchase, shrug, select } = PIT_STOP_ANIM;
    switch (state) {
      case 'purchase-success':
      case 'rare-reveal':
        pose.value = withSequence(
          withTiming(-5, { duration: purchase.pop, easing: Easing.out(Easing.back(2)) }),
          withSpring(0, { damping: 14, stiffness: 180 })
        );
        tilt.value = 0;
        break;
      case 'unavailable':
        // A small apologetic shrug — never a big sad reaction.
        pose.value = withSequence(
          withTiming(-2, { duration: shrug.duration / 2, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: shrug.duration / 2, easing: Easing.inOut(Easing.sin) })
        );
        tilt.value = withSequence(
          withTiming(1, { duration: shrug.duration / 2 }),
          withTiming(0, { duration: shrug.duration / 2 })
        );
        break;
      case 'selected-item':
        pose.value = withTiming(-2, { duration: select.react, easing: Easing.out(Easing.quad) });
        tilt.value = 0;
        break;
      case 'offer':
        // prep settles the body down, present lifts it into the offer.
        pose.value = withTiming(offerPhase === 'present' ? -3 : offerPhase === 'prep' ? 2 : 0, {
          duration: offerPhase === 'present' ? PIT_STOP_ANIM.offer.rise : PIT_STOP_ANIM.offer.prep,
          easing: Easing.inOut(Easing.quad),
        });
        tilt.value = 0;
        break;
      default:
        pose.value = withTiming(0, { duration: 320, easing: Easing.inOut(Easing.quad) });
        tilt.value = withTiming(0, { duration: 320 });
    }
  }, [state, offerPhase, reduced, pose, tilt]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: pose.value - bob.value * PIT_STOP_ANIM.idle.keeper.travel },
      { rotateZ: `${tilt.value + (bob.value - 0.5) * 0.5}deg` },
      { scaleY: squash.value },
    ],
  }));

  return (
    <Animated.View style={[crewFrame(PIT_STOP_LAYOUT.keeper, scale), style]} pointerEvents="none">
      <CharacterRig equipped={equipped} size={PIT_STOP_LAYOUT.keeper.width * scale} animate={false} />
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Support characters
// ---------------------------------------------------------------------------

/**
 * `beat` is the shared 0→1 ramp from useActionBeat: the restocker lifts a
 * reward crate on it, the helper raises the gel tray, and the matching prop
 * in the scene rides the same value so character and object never separate.
 */
export const SupportCharacter = memo(function SupportCharacter({
  role,
  state,
  scale,
  active,
  reduced,
  beat,
  lean = 0,
}) {
  const crew = PIT_STOP_CREW[role];
  const layout = PIT_STOP_LAYOUT[role];
  const tuning = PIT_STOP_ANIM.idle[role];
  const celebrating = state === 'purchase-success' || state === 'rare-reveal';

  const closed = useBlink(active && !reduced && !celebrating && state !== 'unavailable');
  const expression = useHeldExpression(celebrating ? 'cheer' : 'happy', {
    minHold: PIT_STOP_ANIM.expression.minHold,
    urgent: celebrating,
  });
  const equipped = useCrewEquipped(crew, expression, closed);

  const bob = useSharedValue(0);
  const cheer = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced) {
      bob.value = withTiming(0, { duration: 200 });
      return;
    }
    bob.value = withDelay(
      tuning.delay,
      withRepeat(withTiming(1, { duration: tuning.duration, easing: Easing.inOut(Easing.sin) }), -1, true)
    );
  }, [active, reduced, bob, tuning.delay, tuning.duration]);

  // The support bounce lands ~300ms after the attendant's pop, so the three
  // of them celebrate as a group rather than in unison.
  useEffect(() => {
    if (reduced || !celebrating) {
      cheer.value = withTiming(0, { duration: 200 });
      return;
    }
    cheer.value = withDelay(
      100,
      withSequence(
        withTiming(1, { duration: 220, easing: Easing.out(Easing.back(2)) }),
        withSpring(0, { damping: 15, stiffness: 200 })
      )
    );
  }, [celebrating, reduced, cheer]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: beat ? beat.value * lean : 0 },
      { translateY: -bob.value * tuning.travel - cheer.value * 3 - (beat ? beat.value * 4 : 0) },
      { rotateZ: `${beat ? beat.value * (lean > 0 ? 3 : -3) : 0}deg` },
    ],
  }));

  return (
    <Animated.View style={[crewFrame(layout, scale), style]} pointerEvents="none">
      <CharacterRig equipped={equipped} size={layout.width * scale} animate={false} />
    </Animated.View>
  );
});

/** Both supports, so the scene layer stays declarative. */
export const SupportCharacters = memo(function SupportCharacters({
  state,
  scale,
  active,
  reduced,
  restockBeat,
  presentBeat,
}) {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none">
      <SupportCharacter
        role="restocker"
        state={state}
        scale={scale}
        active={active}
        reduced={reduced}
        beat={restockBeat}
        lean={-6}
      />
      <SupportCharacter
        role="helper"
        state={state}
        scale={scale}
        active={active}
        reduced={reduced}
        beat={presentBeat}
        lean={5}
      />
    </View>
  );
});
