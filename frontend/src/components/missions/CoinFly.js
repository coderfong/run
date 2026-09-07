// The coins going from the card you tapped to the counter at the top.
//
// WHY IT IS WORTH THE CODE. A claim without it is a card that dims and a
// number that is suddenly different, and the two events look unrelated — the
// reward reads as having been taken away rather than paid. An arc from one to
// the other is the cheapest possible way to say "that became this", and it is
// the single most copied moment in the reference for exactly that reason.
//
// FIRE AND FORGET. The overlay owns no state the screen depends on: it is
// handed two points and a key, it plays, and it tells nobody when it is done
// except to take itself off screen. The claim has already landed by then, so
// nothing is waiting on this and a dropped frame costs nothing.

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import AppIcon from '../AppIcon';
import { useReduceMotion } from '../../ui/motion';

const COUNT = 9;
const FLIGHT_MS = 620;
const STAGGER_MS = 45;

/**
 * One coin, thrown up and out before being pulled to the target.
 *
 * The horizontal path is a straight interpolation; the ARC comes from a
 * separate vertical lift that peaks in the middle. Two independent axes is
 * three lines of maths, where a real bezier would have been a worklet full of
 * control points to look very slightly better.
 */
function Coin({ from, to, index, spread }) {
  const life = useSharedValue(0);

  useEffect(() => {
    life.value = withDelay(
      index * STAGGER_MS,
      withTiming(1, { duration: FLIGHT_MS, easing: Easing.inOut(Easing.quad) })
    );
    return () => cancelAnimation(life);
  }, [life, index]);

  const style = useAnimatedStyle(() => {
    const t = life.value;
    // Scatter at the start, converge at the end: the coins leave the card as a
    // handful and arrive as a stream.
    const scatter = spread * (1 - t);
    const lift = Math.sin(t * Math.PI) * 70;
    return {
      opacity: t > 0.92 ? (1 - t) / 0.08 : 1,
      transform: [
        { translateX: from.x + (to.x - from.x) * t + scatter },
        { translateY: from.y + (to.y - from.y) * t - lift },
        { scale: 0.6 + 0.5 * Math.sin(t * Math.PI) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.coin, style]} pointerEvents="none">
      <AppIcon name="coin" size={26} />
    </Animated.View>
  );
}

/**
 * @param {{x:number,y:number}} from  where the coins leave (screen coords)
 * @param {{x:number,y:number}} to    where they land
 * @param {number} flight             bump to replay; falsy renders nothing
 */
export default function CoinFly({ from, to, flight }) {
  const reduced = useReduceMotion();
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (!flight || !from || !to || reduced) return undefined;
    setLive(flight);
    const id = setTimeout(() => setLive(null), FLIGHT_MS + COUNT * STAGGER_MS + 120);
    return () => clearTimeout(id);
  }, [flight, from, to, reduced]);

  if (!live || !from || !to) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: COUNT }, (_, i) => (
        <Coin
          key={`${live}:${i}`}
          from={from}
          to={to}
          index={i}
          // Deterministic fan rather than Math.random, so the burst is the same
          // shape every time and cannot occasionally stack all nine coins.
          spread={((i % 5) - 2) * 16}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  coin: { position: 'absolute', left: -13, top: -13 },
});
