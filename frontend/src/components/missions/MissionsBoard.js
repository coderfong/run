// The Daily Missions board: the outdoor wooden board the missions are pinned
// to, and the worm in the grass at its foot.
//
// LAYERS, back to front, all behind the mission UI and none of them touchable:
//   board   missions-board-bg.png: sky, trees, board, parchment, grass, rocks.
//           Fixed to the window; the missions scroll over the parchment.
//   shadow  a soft ellipse under the worm that stretches with it.
//   worm    missions-worm.png, cut out of the delivered art by
//           scripts/cut-missions-worm.mjs so there is never a painted worm
//           under the moving one.
//
// WHAT MOVES, AND HOW MUCH. The board settles in once when the screen opens
// (0.99 → 1, a 320ms fade) and is then still: the sky, the plants and the
// paper are painted into one image, and wobbling a whole screenshot behind
// text people are reading is exactly the wrong kind of alive. The worm is the
// one thing that moves, and it spends most of its loop resting (see
// wormTimeline.js).
//
// ONE CLOCK. The worm reads one shared value that runs 0 → LOOP_MS and wraps.
// It runs only while `active` (the screen is focused) and Reduce Motion is
// off, and it is cancelled on unmount, so nothing keeps ticking on the UI
// thread behind another screen.

import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Image } from '../../ui/image';
import { useReduceMotion } from '../../ui/motion';
import { LOOP_MS, wormPose, wormTransform } from './wormTimeline';

const BOARD_ART = require('../../../assets/art/panel/missions-board-bg.png');
const WORM_ART = require('../../../assets/art/panel/missions-worm.png');

// The art's own size, and where things are on it (from the art itself; the
// worm box is what scripts/cut-missions-worm.mjs printed).
export const BOARD = { width: 941, height: 1672 };
export const WORM_BOX = { x: 186, y: 1523, width: 136, height: 89 };
// The beam across the top, and the part of the parchment that is clear of
// its pins at the top and of its torn edge at the bottom.
export const BEAM = { top: 190, bottom: 270 };
export const PAPER = { left: 95, right: 845, top: 292, bottom: 1262 };

/**
 * Where the art lands on a `width`×`height` window, drawn `cover` and centred.
 * `x` / `y` map a point on the art to the window.
 */
export function boardFrame(width, height) {
  const scale = Math.max(width / BOARD.width, height / BOARD.height);
  const left = (width - BOARD.width * scale) / 2;
  const top = (height - BOARD.height * scale) / 2;
  return { scale, x: (ax) => left + ax * scale, y: (ay) => top + ay * scale };
}

export default function MissionsBoard({ active = true }) {
  const { width, height } = useWindowDimensions();
  const reduced = useReduceMotion();
  const frame = boardFrame(width, height);
  const w = WORM_BOX.width * frame.scale;
  const h = WORM_BOX.height * frame.scale;

  const enter = useSharedValue(reduced ? 1 : 0);
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return undefined;
    }
    enter.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(enter);
    // Once, on entry: not on every focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(clock);
      clock.value = 0;
      return undefined;
    }
    clock.value = 0;
    clock.value = withRepeat(withTiming(LOOP_MS, { duration: LOOP_MS, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(clock);
      clock.value = 0;
    };
  }, [active, reduced, clock]);

  const boardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.99 + 0.01 * enter.value }],
  }));
  const wormStyle = useAnimatedStyle(() => ({
    transform: wormTransform(wormPose(clock.value, w), w, h),
  }));
  const shadowStyle = useAnimatedStyle(() => {
    const pose = wormPose(clock.value, w);
    return {
      transform: [{ translateX: pose.tailX + ((pose.scaleX - 1) * w) / 2 }, { scaleX: pose.scaleX }],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, boardStyle]}>
      <Image
        source={BOARD_ART}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}
        pointerEvents="none"
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: frame.x(WORM_BOX.x), top: frame.y(WORM_BOX.y), width: w, height: h }}
      >
        <Animated.View
          style={[
            styles.shadow,
            { left: w * 0.06, width: w * 0.88, height: Math.max(4, h * 0.14), bottom: -h * 0.05, borderRadius: h },
            shadowStyle,
          ]}
        />
        <Animated.View style={[{ width: w, height: h }, wormStyle]}>
          <Image source={WORM_ART} style={{ width: w, height: h }} resizeMode="stretch" fadeDuration={0} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', backgroundColor: 'rgba(20, 60, 10, 0.28)' },
});
