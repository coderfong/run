// The Pit Stop's animation director.
//
// ONE clock for the whole scene. The attendant's expression, the cup, the two
// support beats and the effect layer all read from the values produced here,
// so nothing can drift out of sync and there is exactly one set of timers to
// tear down. Everything is paused when the screen isn't focused.
//
// The state model follows the brief with one rename: PASER has no sold-out
// stock (the rotation is deterministic and infinite), so the "can't sell you
// this one" branch is called `unavailable` and covers the two cases that
// actually exist — you already own it, or you can't afford it.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Easing,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PIT_STOP_ANIM, REVEAL_INTENSITY } from '../../config/pitStop';

/** Shopkeeper states, highest priority first. */
export const SHOPKEEPER_STATES = [
  'rare-reveal',
  'purchase-success',
  'unavailable',
  'selected-item',
  'offer',
  'idle',
];

const RARE = new Set(['rare', 'epic', 'legendary']);

/**
 * Pure state derivation — the priority ladder from the brief. Purchase
 * success is never inferred from a tap: `purchaseStatus` only becomes
 * 'success' once the API call has resolved.
 */
export function getShopkeeperState({
  purchaseStatus,
  selectedProductId,
  selectedRarity,
  isSelectedUnavailable,
  isOfferWindow,
}) {
  if (purchaseStatus === 'success' && RARE.has(selectedRarity)) return 'rare-reveal';
  if (purchaseStatus === 'success') return 'purchase-success';
  if (isSelectedUnavailable) return 'unavailable';
  if (selectedProductId) return 'selected-item';
  if (isOfferWindow) return 'offer';
  return 'idle';
}

const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * The 7s cup-offer cycle, as a phase rather than a boolean, so the face, the
 * body and the cup can each pick up their own part of the beat.
 *
 * idle -> prep (smile, settle) -> present (cup up, excited) -> lower -> idle
 */
export function useOfferCycle(active) {
  const [phase, setPhase] = useState('idle');
  const timer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const schedule = (fn, delay) => {
      timer.current = setTimeout(() => {
        if (!cancelled) fn();
      }, delay);
    };
    const clear = () => clearTimeout(timer.current);
    if (!active) {
      clear();
      setPhase('idle');
      return clear;
    }

    const { gap, prep, rise, present, lower } = PIT_STOP_ANIM.offer;
    const run = () => {
      schedule(() => {
        setPhase('prep');
        schedule(() => {
          setPhase('present');
          schedule(() => {
            setPhase('lower');
            schedule(() => {
              setPhase('idle');
              run();
            }, lower);
          }, rise + present);
        }, prep);
      }, gap);
    };
    run();
    return () => {
      cancelled = true;
      clear();
    };
  }, [active]);

  return phase;
}

/**
 * Random blink scheduling. Returns true for the ~90ms the eyes are shut.
 * Suppressed entirely while `enabled` is false, which is how a blink is kept
 * from cutting into a purchase reaction.
 */
export function useBlink(enabled) {
  const [closed, setClosed] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const scheduleAfter = (fn, delay) => {
      timer.current = setTimeout(() => {
        if (!cancelled) fn();
      }, delay);
    };
    const clear = () => clearTimeout(timer.current);
    if (!enabled) {
      clear();
      setClosed(false);
      return clear;
    }

    const { minGap, maxGap, closed: shut, doubleChance, doubleGap } = PIT_STOP_ANIM.blink;
    const schedule = () => {
      scheduleAfter(() => {
        setClosed(true);
        scheduleAfter(() => {
          setClosed(false);
          if (Math.random() < doubleChance) {
            // The occasional double blink is most of what makes the rhythm
            // read as a person rather than a metronome.
            scheduleAfter(() => {
              setClosed(true);
              scheduleAfter(() => { setClosed(false); schedule(); }, shut);
            }, doubleGap);
          } else {
            schedule();
          }
        }, shut);
      }, randomBetween(minGap, maxGap));
    };
    schedule();
    return () => {
      cancelled = true;
      clear();
    };
  }, [enabled]);

  return closed;
}

/**
 * Holds an expression on screen for a minimum time before letting the next one
 * replace it.
 *
 * The scene's state can change far faster than a face should: flicking through
 * the product grid re-derives `selected-item` on every tap, and the offer cycle
 * hands over three times in a row. Without a floor the crew's faces strobe.
 *
 * `urgent` jumps the queue — a purchase reaction has to land on the frame the
 * purchase lands, or it stops reading as a reaction to what you did. Anything
 * arriving inside the hold window is coalesced: only the LATEST pending value
 * is applied when the window closes, so a burst of taps costs one swap, not a
 * queue of them.
 */
export function useHeldExpression(next, { minHold, urgent = false }) {
  const [shown, setShown] = useState(next);
  const shownAt = useRef(Date.now());
  const timer = useRef(null);

  useEffect(() => {
    if (next === shown) return undefined;

    const apply = () => {
      shownAt.current = Date.now();
      setShown(next);
    };
    if (urgent) {
      clearTimeout(timer.current);
      apply();
      return undefined;
    }
    const waited = Date.now() - shownAt.current;
    if (waited >= minHold) {
      apply();
      return undefined;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(apply, minHold - waited);
    return () => clearTimeout(timer.current);
  }, [next, shown, minHold, urgent]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return shown;
}

/**
 * A recurring "do a thing" beat for a support character: a 0 -> 1 -> 0 ramp
 * on a shared value, fired on a jittered interval. Returned as a shared value
 * so the character AND the prop they lift can both drive off it without a
 * re-render.
 */
export function useActionBeat({ active, minGap, maxGap, duration }) {
  const progress = useSharedValue(0);
  const timer = useRef(null);

  useEffect(() => {
    if (!active) {
      progress.value = withTiming(0, { duration: 160 });
      return () => clearTimeout(timer.current);
    }
    const fire = () => {
      const up = duration * 0.32;
      progress.value = withSequence(
        withTiming(1, { duration: up, easing: Easing.out(Easing.quad) }),
        withDelay(duration * 0.36, withTiming(0, { duration: up, easing: Easing.inOut(Easing.quad) }))
      );
      timer.current = setTimeout(fire, randomBetween(minGap, maxGap));
    };
    // Stagger the first fire too, so the two supports never open together.
    timer.current = setTimeout(fire, randomBetween(minGap * 0.4, maxGap * 0.6));
    return () => clearTimeout(timer.current);
  }, [active, minGap, maxGap, duration, progress]);

  return progress;
}

/**
 * The scene's full direction: which state we're in, where the offer cycle is,
 * and how hard the effects layer should push for the selected rarity.
 */
export function useShopkeeperDirector({
  active,
  purchaseStatus,
  selectedProductId,
  selectedRarity,
  isSelectedUnavailable,
}) {
  // The cup offer is an idle flourish: it must never start while the crew is
  // reacting to something the user did.
  const offerAllowed = active && purchaseStatus === 'idle' && !selectedProductId;
  const offerPhase = useOfferCycle(offerAllowed);

  const state = getShopkeeperState({
    purchaseStatus,
    selectedProductId,
    selectedRarity,
    isSelectedUnavailable,
    isOfferWindow: offerPhase !== 'idle',
  });

  const intensity = useMemo(
    () => REVEAL_INTENSITY[selectedRarity] || REVEAL_INTENSITY.common,
    [selectedRarity]
  );

  return { state, offerPhase, intensity };
}
