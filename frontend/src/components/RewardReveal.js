// RewardReveal — the payoff moment when a pass tier is claimed.
//
// Replaces a toast, which is the weakest possible feedback for the thing the
// whole ladder exists to deliver. The sequence is deliberately staged so the
// outcome lands a beat AFTER the tap:
//
//   1. scrim fades in, rays start turning
//   2. the reward pops in with a spring overshoot
//   3. name + rarity fade up under it
//
// That short gap is the "what did I get" beat. Everything is Reanimated (no
// Lottie dependency), and it respects reduce-motion by skipping straight to
// the resting state.

import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

import RewardArt, { RARITY_COLOR } from './RewardArt';
import { art } from '../config/onboardingArt';
import { brand, radius, space, toon, toonType, useTheme, useThemedType, withAlpha } from '../theme';
import { OutlinedText } from './ui';
import { useReduceMotion } from '../ui/motion';

export default function RewardReveal({ visible, rewards, equipped, accent, onClose }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();

  const scrim = useSharedValue(0);
  const pop = useSharedValue(0);
  const spin = useSharedValue(0);
  const label = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      scrim.value = 0;
      pop.value = 0;
      label.value = 0;
      return;
    }
    if (reduced) {
      scrim.value = 1;
      pop.value = 1;
      label.value = 1;
      return;
    }
    scrim.value = withTiming(1, { duration: 160 });
    pop.value = withDelay(
      120,
      withSequence(
        withSpring(1.12, { damping: 9, stiffness: 260 }),
        withSpring(1, { damping: 14, stiffness: 200 })
      )
    );
    label.value = withDelay(340, withTiming(1, { duration: 220 }));
    spin.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
      -1,
      false
    );
  }, [visible, reduced, scrim, pop, label, spin]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const popStyle = useAnimatedStyle(() => ({
    opacity: pop.value > 0 ? 1 : 0,
    transform: [{ scale: pop.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 10 }],
  }));
  const raysStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * scrim.value,
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  const list = rewards || [];
  const headline = list.length > 1 ? `${list.length} rewards` : list[0]?.label;
  const rarity = list[0]?.kind === 'lootbox' ? list[0].key : null;
  const tint = (rarity && RARITY_COLOR[rarity]) || accent || brand.pink;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Dismiss reward">
        <Animated.View style={[styles.fill, styles.scrim, scrimStyle]} />
        <View style={styles.center} pointerEvents="none">
          {art('burstRays') ? (
            <Animated.Image
              source={art('burstRays')}
              style={[styles.rays, raysStyle]}
              resizeMode="contain"
            />
          ) : null}
          <Animated.View style={popStyle}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: tint }]}>
              <View style={styles.artRow}>
                {list.slice(0, 2).map((r, i) => (
                  <RewardArt
                    key={`${r.kind}:${r.key}:${i}`}
                    reward={r}
                    equipped={equipped}
                    accent={tint}
                    size={list.length > 1 ? 72 : 96}
                  />
                ))}
              </View>
            </View>
          </Animated.View>
          <Animated.View style={[styles.labelWrap, labelStyle]}>
            <OutlinedText style={[toonType.sub, { color: '#fff' }]} outline={toon.ink} width={2}>
              {headline || 'Claimed'}
            </OutlinedText>
            {list.length > 1 ? (
              <Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>
                {list.map((r) => r.label).join(' · ')}
              </Text>
            ) : null}
            <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>
              Tap to continue
            </Text>
          </Animated.View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  scrim: { backgroundColor: 'rgba(0,0,0,0.72)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  rays: { position: 'absolute', width: 340, height: 340 },
  card: {
    minWidth: 168,
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    borderRadius: radius.card,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  labelWrap: { alignItems: 'center', marginTop: space.lg, paddingHorizontal: space.xl },
});
