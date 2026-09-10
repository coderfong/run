// Three mystery swipes for every box; the server outcome stays hidden until opening.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import Chest, { Sparkle, chestColors } from './Chest';
import { haptic, useReduceMotion } from '../../ui/motion';
import { fonts, space } from '../../theme';

// How long a single tap's reveal takes end to end. The swoosh reads at 320ms
// and the wash needs to finish inside the same beat or two quick taps overlap
// each other's colours.
const TAP_MS = 340;
export const MYSTERY_SWIPES = 3;
// The lid lift. Long enough to see the chest actually open, short enough that
// it is not standing between the player and their reward.
const OPEN_MS = 620;
const OPEN_HOLD_MS = 520;

// Where the ambient sparkles sit, as fractions of the chest box. Fixed rather
// than random so they do not re-scatter on every render, and hand placed so
// none of them lands on the clasp.
const AMBIENT = [
  { x: -0.22, y: 0.06, size: 20, delay: 0 },
  { x: 1.06, y: 0.22, size: 15, delay: 420 },
  { x: -0.1, y: 0.62, size: 12, delay: 900 },
  { x: 1.14, y: 0.68, size: 18, delay: 1300 },
  { x: 0.18, y: -0.16, size: 14, delay: 700 },
  { x: 0.82, y: -0.1, size: 11, delay: 1600 },
];

// The upgrade burst. Angles in degrees around the chest, distance in points.
const BURST = [
  { angle: -90, dist: 150, size: 26 }, { angle: -40, dist: 130, size: 18 },
  { angle: -140, dist: 135, size: 20 }, { angle: 0, dist: 145, size: 22 },
  { angle: 180, dist: 150, size: 16 }, { angle: 40, dist: 120, size: 15 },
  { angle: 140, dist: 125, size: 19 }, { angle: 90, dist: 110, size: 14 },
];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** One ambient glint, breathing on its own clock. */
function AmbientSparkle({ spot, box, reduced }) {
  const life = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      life.value = 0.7;
      return undefined;
    }
    life.value = withDelay(
      spot.delay,
      withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true)
    );
    return () => cancelAnimation(life);
  }, [life, reduced, spot.delay]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.25 + life.value * 0.6,
    transform: [{ scale: 0.7 + life.value * 0.5 }, { rotate: `${life.value * 45}deg` }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sparkle,
        { left: box * spot.x, top: box * spot.y },
        style,
      ]}
    >
      <Sparkle size={spot.size} />
    </Animated.View>
  );
}

/** One petal of the upgrade burst, thrown outward and fading as it goes. */
function BurstSparkle({ spec, trigger, reduced }) {
  const life = useSharedValue(0);
  useEffect(() => {
    if (!trigger || reduced) return undefined;
    life.value = 0;
    life.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(life);
  }, [trigger, life, reduced]);

  const rad = (spec.angle * Math.PI) / 180;
  const style = useAnimatedStyle(() => ({
    opacity: life.value === 0 ? 0 : 1 - life.value,
    transform: [
      { translateX: Math.cos(rad) * spec.dist * life.value },
      { translateY: Math.sin(rad) * spec.dist * life.value },
      { scale: 0.4 + life.value * 0.9 },
      { rotate: `${life.value * 160}deg` },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.burstItem, style]}>
      <Sparkle size={spec.size} />
    </Animated.View>
  );
}

/**
 * The white arc that sweeps over the chest on every tap.
 *
 * It is the tap's receipt. Without it a tap that did not upgrade produced no
 * change on screen at all, which reads as a dropped input rather than as an
 * unlucky roll — the one thing this screen could not afford, since most taps
 * do not upgrade.
 */
function Swoosh({ trigger, size }) {
  const life = useSharedValue(0);
  useEffect(() => {
    if (!trigger) return undefined;
    life.value = 0;
    life.value = withTiming(1, { duration: TAP_MS, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(life);
  }, [trigger, life]);

  const style = useAnimatedStyle(() => ({
    opacity: life.value === 0 || life.value > 0.85 ? 0 : 0.9,
    transform: [
      { rotate: `${-30 + life.value * 60}deg` },
      { scale: 0.8 + life.value * 0.5 },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.swoosh, { width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path
          d="M 14 62 Q 24 16 62 10 Q 44 22 34 44 Q 27 58 24 74 Z"
          fill="#ffffff"
        />
      </Svg>
    </Animated.View>
  );
}

/** The chance pips. Spent, next, and still to come. */
function Pips({ total, spent, tint }) {
  if (!total) return null;
  return (
    <View style={styles.pips}>
      {Array.from({ length: total }, (_, i) => {
        const used = i < spent;
        const active = i === spent;
        return (
          <View
            key={i}
            style={[
              styles.pip,
              used && { backgroundColor: tint.deep },
              active && styles.pipActive,
              !used && !active && styles.pipWaiting,
            ]}
          >
            {!used ? (
              <Svg width={14} height={14} viewBox="0 0 24 24">
                <Path
                  d="M12 4 L20 13 L15.5 13 L15.5 20 L8.5 20 L8.5 13 L4 13 Z"
                  fill={active ? tint.body : '#ffffff'}
                />
              </Svg>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * @param {boolean}  visible
 * @param {object}   sequence  the server's roll: { rarity, final_rarity, chances, steps }
 * @param {Function} onOpened  called with the final rarity once the lid is off
 * @param {Function} onClose   dismissed without opening (the back arrow)
 */
export default function LootboxGamble({ visible, sequence, onOpened, onClose }) {
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  const base = sequence?.rarity || 'common';
  const finalRarity = sequence?.final_rarity || base;

  // Reduce Motion starts at the answer; everyone else starts at the floor and
  // taps their way up.
  const [spent, setSpent] = useState(0);
  const [rarity, setRarity] = useState('common');
  const [opening, setOpening] = useState(false);
  const [tapKey, setTapKey] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const busy = useRef(false);
  const handoff = useRef(null);
  const inputTimer = useRef(null);
  const spentRef = useRef(0);

  const chestW = Math.min(280, width * 0.62);
  const chestH = chestW * 0.82;

  const bob = useSharedValue(0);
  const squash = useSharedValue(0);
  const shake = useSharedValue(0);
  const lid = useSharedValue(0);
  const beam = useSharedValue(0);
  const labelPop = useSharedValue(0);

  // Reset for each box. A second box opened in the same session must not
  // inherit the first one's spent pips.
  //
  // KEYED ON THE BOX, AND ON NOTHING ELSE. This effect resets USER FACING
  // state, so the one thing it must never depend on is an animation handle:
  // under the reanimated jest mock those get a fresh identity every render, so
  // listing them re-fires this on every render and silently undoes the tap
  // that caused it — `spent` went back to nought and the chest could never be
  // opened. They are stable refs in the real app and stale-proof either way
  // (a shared value is read through `.value`), so leaving them out is correct
  // in both environments rather than a test accommodation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return;
    clearTimeout(handoff.current);
    busy.current = false;
    clearTimeout(inputTimer.current);
    spentRef.current = 0;
    setSpent(0);
    setTapKey(0);
    setBurstKey(0);
    setRarity('common');
    setOpening(false);
    lid.value = 0;
    beam.value = 0;
    squash.value = 0;
    shake.value = 0;
  }, [visible, sequence, reduced]);

  // The resting breath. The chest is never completely still until it opens.
  // Same rule: `bob` out of the deps, or the loop is cancelled and restarted
  // on every render and the chest never actually breathes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible || reduced || opening) {
      bob.value = 0;
      return undefined;
    }
    bob.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true
    );
    return () => cancelAnimation(bob);
  }, [visible, reduced, opening]);

  const finish = useCallback(() => {
    onOpened?.(finalRarity);
  }, [onOpened, finalRarity]);

  // ---- the open --------------------------------------------------------
  const openChest = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setOpening(true);
    setRarity(finalRarity);
    haptic.success();

    if (reduced) {
      finish();
      return;
    }
    beam.value = withTiming(1, { duration: OPEN_MS });
    lid.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.back(1.4)) });
    setBurstKey((k) => k + 1);
    // The hold is the point: the lid comes off, the light gets out, and THEN
    // the reward arrives. Handing it over on the same frame the lid moves
    // wastes the only build up this screen has.
    //
    // A timer rather than a third animation callback, because the hand off has
    // to happen once whether or not the lid's spring is still settling — and a
    // callback on an animation that gets cancelled (the modal dismissed
    // mid-open) would never fire at all. Cleared on unmount below.
    handoff.current = setTimeout(finish, OPEN_MS + OPEN_HOLD_MS);
  }, [reduced, beam, lid, finish, finalRarity]);

  useEffect(() => () => {
    clearTimeout(handoff.current);
    clearTimeout(inputTimer.current);
  }, [visible, sequence]);

  const tap = useCallback(() => {
    if (busy.current || spentRef.current >= MYSTERY_SWIPES) return;
    spentRef.current += 1;
    setSpent(spentRef.current);
    setTapKey((k) => k + 1);
    haptic.light();
    if (spentRef.current === MYSTERY_SWIPES) {
      openChest();
      return;
    }
    busy.current = true;
    inputTimer.current = setTimeout(() => { busy.current = false; }, TAP_MS);
    if (!reduced) {
      squash.value = withSequence(
        withTiming(1, { duration: 110 }),
        withSpring(0, { damping: 9, stiffness: 200 })
      );
    }
  }, [openChest, reduced, squash]);

  const gesture = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 18 || Math.abs(g.dy) > 18,
    onPanResponderRelease: (_, g) => {
      if (Math.hypot(g.dx, g.dy) >= 55) tap();
    },
  });

  // ---- styles ----------------------------------------------------------
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value * 7 }],
  }));
  const chestStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -6 * bob.value + 10 * squash.value },
      { scaleX: 1 + 0.1 * squash.value },
      { scaleY: 1 - 0.12 * squash.value },
    ],
  }));
  const lidStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 600 },
      { translateY: -chestW * 0.18 * lid.value },
      { rotateX: `${-65 * lid.value}deg` },
    ],
  }));
  const beamStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, beam.value * 1.6),
    transform: [{ scaleY: 0.3 + beam.value * 0.7 }, { scaleX: 0.6 + beam.value * 0.4 }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.22 * labelPop.value }],
  }));

  if (!visible || !sequence) return null;

  const tint = chestColors(rarity);
  const remaining = Math.max(0, MYSTERY_SWIPES - spent);
  const shown = opening ? finalRarity : 'mystery';
  const caption = opening ? '' : `Swipe to unlock · ${remaining} left`;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.page, { backgroundColor: tint.page }]}>
        <Pressable
          {...gesture.panHandlers}
          style={styles.tapArea}
          onPress={tap}
          disabled={opening}
          accessibilityRole="button"
          accessibilityLabel={`${shown} chest. ${remaining} swipes remaining. Swipe or tap to unlock.`}
        >
          <Animated.View style={[styles.stage, shakeStyle]}>
            <Animated.Text style={[styles.rarity, labelStyle]}>
              {String(shown).toUpperCase()}
            </Animated.Text>

            <View style={[styles.chestBox, { width: chestW, height: chestH }]}>
              {AMBIENT.map((spot, i) => (
                <AmbientSparkle key={i} spot={spot} box={chestW} reduced={reduced} />
              ))}

              {/* The light getting out, drawn behind the chest so the lid
                  passes in front of it as it lifts. */}
              <Animated.View
                pointerEvents="none"
                style={[styles.beam, { width: chestW * 0.7, backgroundColor: '#fffdf0' }, beamStyle]}
              />

              <Animated.View style={chestStyle}>
                {/* The shadow travels with the chest, so the bob reads as
                    hovering rather than as the whole picture sliding. */}
                <View style={[styles.shadow, { backgroundColor: tint.shade, width: chestW * 0.72, top: chestH * 0.93 }]} />
                <Chest width={chestW} rarity={rarity} open={opening} lidStyle={lidStyle} />

              </Animated.View>

              <View style={styles.burst} pointerEvents="none">
                {BURST.map((spec, i) => (
                  <BurstSparkle key={i} spec={spec} trigger={burstKey} reduced={reduced} />
                ))}
              </View>

              {!reduced ? <Swoosh trigger={tapKey} size={chestW * 1.05} /> : null}
            </View>

            {!opening ? (
              <>
                <Pips total={MYSTERY_SWIPES} spent={spent} tint={tint} />
                <Text style={styles.caption}>{caption}</Text>
                <Text style={styles.note}>What’s inside? Tap also works.</Text>
              </>
            ) : null}
          </Animated.View>
        </Pressable>

        {onClose && !opening ? (
          <Pressable
            style={[styles.back, { top: Math.max(44, height * 0.06) }]}
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path d="M15 5 L8 12 L15 19" stroke="#ffffff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  tapArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },

  rarity: {
    fontFamily: fonts.display,
    fontSize: 26,
    letterSpacing: 3,
    color: '#ffffff',
    marginBottom: space.xl,
  },

  chestBox: { alignItems: 'center', justifyContent: 'center' },
  shadow: {
    position: 'absolute',
    alignSelf: 'center',
    height: 16,
    borderRadius: 8,
    opacity: 0.45,
  },
  beam: {
    position: 'absolute',
    top: '4%',
    height: '96%',
    borderRadius: 40,
    opacity: 0,
  },

  sparkle: { position: 'absolute' },
  burst: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  burstItem: { position: 'absolute' },
  swoosh: { position: 'absolute' },

  pips: { flexDirection: 'row', gap: space.lg, marginTop: space.huge },
  pip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  pipActive: { backgroundColor: '#ffffff' },
  pipWaiting: { backgroundColor: 'rgba(255,255,255,0.28)' },

  caption: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: '#ffffff',
    marginTop: space.xl,
    letterSpacing: 0.4,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginTop: space.sm,
  },

  back: {
    position: 'absolute',
    left: space.gutter,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
