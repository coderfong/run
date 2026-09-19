// One continuous lootbox opening: charge, build, impact, reward.
// The screen carries no explanatory copy. Motion teaches the input; after the
// hit, the item and Collect button are the only things left to read.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { ChestBase, ChestLid, ChestLidInside, ChestSilhouette, chestColors, chestSize } from './Chest';
import { AmbientSparkles, Beam, ChargeCells, ChargeMotes, DriftMotes, Glow, LightFan, REVEAL_LIGHT, Ring, SeamGlow, SparkBurst, SwipeCue, Swoosh, TIER_LIGHT, TIER_SPARKS, Vignette } from './LootboxFx';
import { openingPlan } from './openingPlan';
import RewardArt, { RARITY_COLOR } from '../RewardArt';
import { AnimationStack } from '../GameAnimation';
import { Framed, OutlinedText } from '../ui';
import { Confetti, haptic, useReduceMotion } from '../../ui/motion';
import { fonts, space, toon, useTheme, useThemedType } from '../../theme';
import { INK } from '../../ui/frameRegistry';

export const MYSTERY_SWIPES = 3;
const INPUT_LOCK_MS = 340;

function later(bucket, fn, ms) {
  const id = setTimeout(fn, ms);
  bucket.current.push(id);
}

export default function LootboxGamble({ visible, sequence, reward, onCollect, onOpened, onClose }) {
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const { colors } = useTheme();
  const type = useThemedType();
  const finalRarity = sequence?.final_rarity || sequence?.rarity || 'common';
  const plan = useMemo(() => openingPlan(finalRarity), [finalRarity]);
  const [spent, setSpent] = useState(0);
  const [act, setAct] = useState('charge');
  const [lightTier, setLightTier] = useState('common');
  const [swipeKey, setSwipeKey] = useState(0);
  const [impactKey, setImpactKey] = useState(0);
  const busy = useRef(false);
  const spentRef = useRef(0);
  const timers = useRef([]);

  const chestW = Math.min(286, width * 0.68);
  const metrics = chestSize(chestW);
  const stageH = Math.min(530, height * 0.61);
  const seamY = stageH * 0.61;

  const idle = useSharedValue(0);
  const press = useSharedValue(0);
  const stream = useSharedValue(0);
  const charge = useSharedValue(0);
  const calm = useSharedValue(0);
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const reveal = useSharedValue(0);
  const rays = useSharedValue(0);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearTimers();
    if (!visible) return undefined;
    busy.current = false;
    spentRef.current = 0;
    setSpent(0);
    setAct('charge');
    setLightTier('common');
    setSwipeKey(0);
    setImpactKey(0);
    press.value = 0;
    charge.value = 0;
    calm.value = 0;
    shake.value = 0;
    flash.value = 0;
    reveal.value = 0;
    return clearTimers;
  }, [visible, sequence]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible || reduced || act === 'reveal') {
      cancelAnimation(idle);
      cancelAnimation(stream);
      idle.value = 0;
      stream.value = 0;
      return undefined;
    }
    idle.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    stream.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false);
    return () => { cancelAnimation(idle); cancelAnimation(stream); };
  }, [visible, reduced, act]);

  const beginOpening = useCallback(() => {
    setAct('build');
    busy.current = true;
    haptic.medium();
    charge.value = reduced ? 1 : withTiming(1, { duration: plan.flashAt, easing: Easing.in(Easing.quad) });
    if (!reduced) shake.value = withRepeat(withSequence(withTiming(1, { duration: 55 }), withTiming(-1, { duration: 55 })), -1, true);

    plan.steps.forEach((step) => later(timers, () => {
      setLightTier(step.rarity);
      haptic.light();
    }, step.at));

    if (plan.hitch) {
      later(timers, () => {
        calm.value = reduced ? 1 : withTiming(1, { duration: 180 });
        cancelAnimation(shake);
        shake.value = 0;
      }, plan.hitch.at);
      later(timers, () => {
        calm.value = reduced ? 0 : withTiming(0, { duration: 90 });
        if (!reduced) shake.value = withRepeat(withSequence(withTiming(1, { duration: 38 }), withTiming(-1, { duration: 38 })), -1, true);
      }, plan.hitch.at + plan.hitch.ms);
    }

    later(timers, () => {
      setAct('flash');
      cancelAnimation(shake);
      shake.value = 0;
      flash.value = reduced ? 1 : withSequence(
        withTiming(1, { duration: plan.flash.up }),
        withTiming(1, { duration: plan.flash.hold }),
        withTiming(0, { duration: plan.flash.down, easing: Easing.out(Easing.quad) })
      );
      haptic[plan.reveal.haptic]?.();
    }, plan.flashAt);

    later(timers, () => {
      setAct('reveal');
      setImpactKey((k) => k + 1);
      reveal.value = reduced ? 1 : withSpring(1, { damping: 11, stiffness: 125 });
      rays.value = reduced ? 0 : withRepeat(withTiming(1, { duration: plan.reveal.spinMs, easing: Easing.linear }), -1, false);
      // Auto-collect immediately after reveal animation for smoother transition
      later(timers, () => {
        haptic.success();
        (onCollect || onOpened)?.(finalRarity, reward);
      }, 800);
    }, plan.swapAt);
  }, [calm, charge, flash, plan, rays, reduced, reveal, shake]);

  const spend = useCallback(() => {
    if (busy.current || act !== 'charge' || spentRef.current >= MYSTERY_SWIPES) return;
    spentRef.current += 1;
    setSpent(spentRef.current);
    setSwipeKey((k) => k + 1);
    haptic.light();
    if (!reduced) press.value = withSequence(withTiming(1, { duration: 100 }), withSpring(0, { damping: 9, stiffness: 220 }));
    if (spentRef.current === MYSTERY_SWIPES) beginOpening();
    else {
      busy.current = true;
      later(timers, () => { busy.current = false; }, INPUT_LOCK_MS);
    }
  }, [act, beginOpening, press, reduced]);

  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 16 || Math.abs(g.dy) > 16,
    onPanResponderRelease: (_, g) => { if (Math.hypot(g.dx, g.dy) >= 48) spend(); },
  }), [spend]);

  const chestStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: shake.value * (3 + charge.value * 7) },
      { translateY: -5 * idle.value + 10 * press.value },
      { scaleX: 1 + press.value * 0.08 },
      { scaleY: 1 - press.value * 0.1 },
    ],
  }));
  const chargeGlowStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + charge.value * 0.82 - calm.value * 0.65,
    transform: [{ scale: 0.7 + charge.value * 0.55 - calm.value * 0.12 }],
  }));
  const fanStyle = useAnimatedStyle(() => ({ opacity: charge.value * (1 - calm.value), transform: [{ scaleY: 0.25 + charge.value * 0.75 }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const itemStyle = useAnimatedStyle(() => ({ opacity: reveal.value, transform: [{ translateY: 54 * (1 - reveal.value) }, { scale: 0.55 + reveal.value * 0.45 }] }));
  const rayStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rays.value * 360}deg` }] }));

  if (!visible || !sequence) return null;
  const revealed = act === 'reveal';
  const light = revealed ? REVEAL_LIGHT[plan.tier] : TIER_LIGHT[lightTier];
  const rewardSize = Math.min(190, width * 0.44, height * 0.24);

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={act === 'charge' ? onClose : undefined} statusBarTranslucent>
      <View style={[styles.page, { backgroundColor: chestColors(revealed ? plan.tier : 'mystery').page }]}>
        <DriftMotes clock={stream} width={width} height={height} />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}><Vignette width={width} height={height} id="loot-vignette" /></View>
        {revealed && plan.reveal.confetti ? <Confetti key={impactKey} count={plan.reveal.confetti} /> : null}
        {revealed ? (
          <Animated.View pointerEvents="none" style={[styles.rays, { width: width * 1.35, height: width * 1.35 }, rayStyle]}>
            <LightFan width={width * 1.35} height={width * 1.35} color={light} id="loot-rays" />
          </Animated.View>
        ) : null}

        <Pressable {...gesture.panHandlers} style={styles.input} onPress={spend} disabled={act !== 'charge'} accessibilityRole="button" accessibilityLabel={revealed ? `${plan.tier} reward, ${reward?.label || 'collectible'}` : `Mystery chest. ${MYSTERY_SWIPES - spent} charges remaining. Swipe or tap.`}>
          <View style={[styles.stage, { height: stageH }]}>
            {!revealed ? <Text style={styles.mystery}>MYSTERY</Text> : null}
            <Animated.View pointerEvents="none" style={[styles.chargeGlow, chargeGlowStyle]}><Glow size={chestW * 1.85} color={light} id="loot-charge" /></Animated.View>
            <Animated.View pointerEvents="none" style={[styles.fan, { bottom: stageH - seamY, width: chestW * 1.55, height: stageH * 0.52 }, fanStyle]}><LightFan width={chestW * 1.55} height={stageH * 0.52} color={light} id="loot-fan" /></Animated.View>
            <View style={[styles.seam, { top: seamY - 18, width: chestW * 1.05 }]} pointerEvents="none"><SeamGlow width={chestW * 1.05} height={36} color={light} id="loot-seam" /></View>
            <View style={[styles.chargeMotes, { top: seamY }]} pointerEvents="none"><ChargeMotes stream={stream} charge={charge} calm={calm} color={light} radius={chestW * 0.65} /></View>

            <Animated.View style={[styles.chest, { top: seamY - metrics.lidH, width: chestW, height: metrics.height }, chestStyle]}>
              <AmbientSparkles box={chestW} live={act === 'charge' && !reduced} />
              {revealed ? (
                <><View style={[styles.piece, { top: metrics.lidH - metrics.insideH }]}><ChestLidInside width={chestW} rarity={plan.tier} /></View><View style={[styles.piece, { top: metrics.lidH }]}><ChestBase width={chestW} rarity={plan.tier} open /></View></>
              ) : (
                <><View style={[styles.piece, { top: metrics.lidH }]}><ChestBase width={chestW} rarity="mystery" /></View><View style={styles.piece}><ChestLid width={chestW} rarity="mystery" /></View>{act === 'flash' ? <View style={styles.piece}><ChestSilhouette width={chestW} /></View> : null}</>
              )}
              {act === 'charge' && !reduced ? <Swoosh trigger={swipeKey} size={chestW * 1.08} /> : null}
            </Animated.View>

            {revealed ? (
              <>
                <View pointerEvents="none" style={[styles.beam, { top: 30, width: chestW * 0.9, height: seamY - 10 }]}><Beam width={chestW * 0.9} height={seamY - 10} color={light} id="loot-beam" /></View>
                <View pointerEvents="none" style={[styles.impact, { top: seamY }]}>{Array.from({ length: plan.reveal.rings }, (_, i) => <Ring key={i} trigger={impactKey} color={light} size={chestW * 0.48} delay={i * 90} to={2.4 + i * 0.35} />)}<SparkBurst trigger={impactKey} count={plan.reveal.sparks} reach={chestW * 0.72} colors={TIER_SPARKS[plan.tier]} /></View>
                <AnimationStack names={plan.reveal.bursts} size={Math.min(width, 330)} trigger={impactKey} style={[styles.bursts, { top: seamY - 165 }]} />
                <Animated.View style={[styles.reward, { top: Math.max(34, seamY - rewardSize - 58) }, itemStyle]}><Framed frame="card" fill="#FFF8E8" tint={toon.ink} weight={INK.base} inset={10} style={styles.rewardFrame} boil={!reduced}><RewardArt reward={reward} size={rewardSize} accent={RARITY_COLOR[plan.tier]} animated /></Framed></Animated.View>
              </>
            ) : null}
          </View>
          {act === 'charge' ? <View style={styles.controls}><ChargeCells total={MYSTERY_SWIPES} spent={spent} live={!busy.current} reduced={reduced} /><SwipeCue live={!busy.current} /></View> : null}
        </Pressable>

        {revealed ? <View style={styles.revealCopy}><OutlinedText style={[styles.rarity, { color: colors.text }]} outline={toon.ink} width={3}>{plan.tier.toUpperCase()}</OutlinedText><Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{reward?.label || 'New collectible'}</Text></View> : null}
        {onClose && act === 'charge' ? <Pressable style={styles.close} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><Svg width={24} height={24} viewBox="0 0 24 24"><Path d="M15 5 L8 12 L15 19" stroke="#FFFFFF" strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg></Pressable> : null}
        <Animated.View pointerEvents="none" style={[styles.whiteout, flashStyle]} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden' },
  input: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { width: '100%', alignItems: 'center' },
  mystery: { position: 'absolute', top: 8, color: '#FFFFFF', fontFamily: fonts.display, fontSize: 27, letterSpacing: 5 },
  chargeGlow: { position: 'absolute', alignSelf: 'center', top: '16%' },
  fan: { position: 'absolute', alignSelf: 'center' },
  seam: { position: 'absolute', alignSelf: 'center' },
  chargeMotes: { position: 'absolute', alignSelf: 'center' },
  chest: { position: 'absolute', alignSelf: 'center' },
  piece: { position: 'absolute', left: 0 },
  beam: { position: 'absolute', alignSelf: 'center' },
  impact: { position: 'absolute', alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  bursts: { position: 'absolute', alignSelf: 'center' },
  rays: { position: 'absolute', alignSelf: 'center', top: '-7%' },
  reward: { position: 'absolute', alignSelf: 'center' },
  rewardFrame: { transform: [{ rotate: '-1.5deg' }] },
  controls: { alignItems: 'center', gap: space.lg, marginTop: space.md },
  revealCopy: { position: 'absolute', left: space.gutter, right: space.gutter, bottom: 80, alignItems: 'center' },
  rarity: { fontFamily: fonts.display, fontSize: 32, letterSpacing: 3 },
  itemName: { fontFamily: fonts.bold, fontSize: 20, marginTop: 2, maxWidth: '86%' },
  close: { position: 'absolute', left: space.gutter, top: 52, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.42)' },
  whiteout: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFFFFF', opacity: 0 },
});
