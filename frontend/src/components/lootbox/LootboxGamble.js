// One continuous lootbox opening: swipes, build, hit, the item out of the
// chest, Tap to continue. ONE mounted scene from the first swipe to the tap.
//
// WHY ONE SCENE. The item reveal used to be a second modal (RewardReveal)
// that a caller mounted once this one had closed itself on a timer, so the
// screen underneath showed through between the chest and the item, and the
// item arrived as an unrelated animation. Now the chest, the item, the flash,
// the particles and the captions are layers of this one screen, and nothing
// leaves it until the player taps after the item has landed.
//
// THE REWARD IS KNOWN BEFORE THE FIRST SWIPE. Callers grant and resolve it
// before mounting this (`reward` prop), and warm its art with
// `warmLootReward`. The item is also mounted here, invisible, from the first
// frame, so its drawing is decoded and laid out long before the hit.
//
// ONE CLOCK. Every animated style reads one shared value, `t` (ms since the
// last swipe), through the poses in revealTimeline.js; the discrete beats
// (haptics, captions, the tap unlocking) come off the same table through one
// cue clock. See revealTimeline.js for why.
//
// LAYERS, back to front: page (mystery → tier), rarity rays, glow, chest,
// ITEM, impact rings/sparks/bursts, white flash, confetti, captions. The item
// is over the chest but under the flash, so the flash hides the moment the
// item starts coming out of it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useDerivedValue, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { ChestBase, ChestLid, ChestLidInside, ChestSilhouette, chestColors, chestSize } from './Chest';
import { AmbientSparkles, Beam, ChargeCells, ChargeMotes, DriftMotes, Glow, LightFan, REVEAL_LIGHT, Ring, SeamGlow, SparkBurst, SwipeCue, Swoosh, TIER_LIGHT, TIER_SPARKS, Vignette } from './LootboxFx';
import { REVEAL_PHASE, calmAt, chargeAt, chestPose, copyPose, flashAt, itemPose, peakAt, reached, revealTimeline, stagePose } from './revealTimeline';
import RewardArt, { RARITY_COLOR, RARITY_LABEL } from '../RewardArt';
import { RevealRays } from '../RewardReveal';
import GameAnimation, { AnimationStack } from '../GameAnimation';
import { Framed, OutlinedText } from '../ui';
import { getItem, itemPreviewImage } from '../../config/cosmetics';
import { Confetti, haptic, useReduceMotion } from '../../ui/motion';
import { fonts, space, toon } from '../../theme';
import { INK } from '../../ui/frameRegistry';
import { preloadImage } from '../../utils/imagePreload';

export const MYSTERY_SWIPES = 3;
const INPUT_LOCK_MS = 340;

/**
 * Warm a reward's art before its reveal. Fire and forget (utils/imagePreload
 * rule 1): callers start it as soon as the item is picked, so it decodes while
 * the grant request is still in flight.
 */
export function warmLootReward(reward) {
  if (reward?.kind !== 'cosmetic') return Promise.resolve(true);
  const [slot, id] = String(reward.key || '').split(':');
  const item = slot && id ? getItem(slot, id) : null;
  return item ? preloadImage(itemPreviewImage(slot, item)) : Promise.resolve(true);
}

// The cue clock. Walks a sorted cue list against wall time, one timer alive
// at a time, re-reading the clock on every wake so a late timer catches up
// instead of drifting. `stop` bumps the run id, so a timer already queued can
// never fire into a reveal that has been cancelled or unmounted.
function useCueClock() {
  const clock = useRef({ timer: null, run: 0 });
  const stop = useCallback(() => {
    clearTimeout(clock.current.timer);
    clock.current.timer = null;
    clock.current.run += 1;
  }, []);
  const play = useCallback((cues, onCue) => {
    stop();
    const c = clock.current;
    const run = c.run;
    const start = Date.now();
    let next = 0;
    const tick = () => {
      if (c.run !== run) return;
      const elapsed = Date.now() - start;
      while (next < cues.length && cues[next].at <= elapsed) {
        onCue(cues[next]);
        next += 1;
        if (c.run !== run) return;
      }
      if (next < cues.length) c.timer = setTimeout(tick, cues[next].at - elapsed);
    };
    tick();
  }, [stop]);
  useEffect(() => stop, [stop]);
  return useMemo(() => ({ play, stop }), [play, stop]);
}

export default function LootboxGamble({ visible, sequence, reward, onCollect, onClose }) {
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const finalRarity = sequence?.final_rarity || sequence?.rarity || 'common';
  const timeline = useMemo(() => revealTimeline(finalRarity), [finalRarity]);
  const { plan, marks } = timeline;
  const [spent, setSpent] = useState(0);
  const [phase, setPhase] = useState(REVEAL_PHASE.ENTER);
  const [copy, setCopy] = useState(0);
  const [lightTier, setLightTier] = useState('common');
  const [swipeKey, setSwipeKey] = useState(0);
  const [impactKey, setImpactKey] = useState(0);
  const busy = useRef(false);
  const started = useRef(false);
  const collected = useRef(false);
  const spentRef = useRef(0);
  const inputLock = useRef(null);
  const cueClock = useCueClock();

  const chestW = Math.min(286, width * 0.68);
  const metrics = chestSize(chestW);
  const stageH = Math.min(530, height * 0.61);
  const seamY = stageH * 0.61;
  const rewardSize = Math.min(190, width * 0.44, height * 0.24);
  // The card's box is the art plus the frame's inset on each side.
  const cardH = rewardSize + 20;
  const heroTop = Math.max(34, seamY - cardH - 58);
  // How far below its hero spot the chest's mouth is: where the item starts.
  const rise = seamY - (heroTop + cardH / 2);

  // THE clock. Everything that moves after the last swipe reads this.
  const t = useSharedValue(0);
  // Ambient loops, not beats: the idle bob and mote stream before the swipe,
  // the swipe squash, and the rays' slow turn once they are out.
  const idle = useSharedValue(0);
  const stream = useSharedValue(0);
  const press = useSharedValue(0);
  const spin = useSharedValue(0);
  // ChargeMotes takes shared values; these are views of `t`, not clocks.
  const charge = useDerivedValue(() => chargeAt(t.value, marks));
  const calm = useDerivedValue(() => calmAt(t.value, marks));

  const stopAll = useCallback(() => {
    cueClock.stop();
    clearTimeout(inputLock.current);
    cancelAnimation(t);
    cancelAnimation(spin);
    cancelAnimation(press);
  }, [cueClock, t, spin, press]);

  // A new box (or the modal closing) resets everything and cancels whatever
  // was mid-flight — timers and UI-thread animations alike.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    stopAll();
    busy.current = false;
    started.current = false;
    collected.current = false;
    spentRef.current = 0;
    setSpent(0);
    setPhase(REVEAL_PHASE.ENTER);
    setCopy(0);
    setLightTier('common');
    setSwipeKey(0);
    setImpactKey(0);
    t.value = 0;
    press.value = 0;
    spin.value = 0;
    if (visible) warmLootReward(reward);
    return stopAll;
  }, [visible, sequence]);

  const entering = phase === REVEAL_PHASE.ENTER;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible || reduced || !entering) {
      cancelAnimation(idle);
      cancelAnimation(stream);
      idle.value = 0;
      stream.value = 0;
      return undefined;
    }
    idle.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    stream.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false);
    return () => { cancelAnimation(idle); cancelAnimation(stream); };
  }, [visible, reduced, entering]);

  const onCue = useCallback((cue) => {
    if (cue.phase) setPhase(cue.phase);
    if (cue.light) setLightTier(cue.light);
    if (cue.copy) setCopy(cue.copy);
    if (cue.impact) {
      setImpactKey((k) => k + 1);
      spin.value = withRepeat(withTiming(1, { duration: plan.reveal.spinMs, easing: Easing.linear }), -1, false);
    }
    if (cue.haptic) haptic[cue.haptic]?.();
  }, [plan, spin]);

  const beginOpening = useCallback(() => {
    if (started.current) return;
    started.current = true;
    busy.current = true;
    haptic.medium();
    if (reduced) {
      // Reduce Motion: the whole build collapses to its resting state. A
      // reveal that makes you sit through motion you turned off is a delay.
      t.value = timeline.end;
      setPhase(REVEAL_PHASE.COMPLETE);
      setLightTier(plan.tier);
      setCopy(3);
      setImpactKey((k) => k + 1);
      haptic.success();
      return;
    }
    // The UI-thread clock and the cue clock start on the same tick.
    t.value = 0;
    t.value = withTiming(timeline.end, { duration: timeline.end, easing: Easing.linear });
    cueClock.play(timeline.cues, onCue);
  }, [cueClock, onCue, plan, reduced, t, timeline]);

  const spend = useCallback(() => {
    if (busy.current || started.current || phase !== REVEAL_PHASE.ENTER || spentRef.current >= MYSTERY_SWIPES) return;
    spentRef.current += 1;
    setSpent(spentRef.current);
    setSwipeKey((k) => k + 1);
    haptic.light();
    if (!reduced) press.value = withSequence(withTiming(1, { duration: 100 }), withSpring(0, { damping: 9, stiffness: 220 }));
    if (spentRef.current === MYSTERY_SWIPES) beginOpening();
    else {
      busy.current = true;
      clearTimeout(inputLock.current);
      inputLock.current = setTimeout(() => { busy.current = false; }, INPUT_LOCK_MS);
    }
  }, [beginOpening, phase, press, reduced]);

  // The ONLY way out once the chest is opening: a tap after the item landed.
  // Guarded so a burst of taps (or a tap plus the back button) collects once.
  const collect = useCallback(() => {
    if (phase !== REVEAL_PHASE.COMPLETE || collected.current) return;
    collected.current = true;
    stopAll();
    onCollect?.(finalRarity, reward);
  }, [finalRarity, onCollect, phase, reward, stopAll]);

  const onPress = phase === REVEAL_PHASE.ENTER ? spend : collect;
  // Android back: leaves before the opening starts, collects once it is done,
  // and does nothing in between — the reveal cannot be cut off halfway.
  const onBack = useCallback(() => {
    if (phase === REVEAL_PHASE.ENTER && !started.current) onClose?.();
    else collect();
  }, [collect, onClose, phase]);

  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 16 || Math.abs(g.dy) > 16,
    onPanResponderRelease: (_, g) => { if (Math.hypot(g.dx, g.dy) >= 48) spend(); },
  }), [spend]);

  // ---- styles, all off `t` ----
  const chestStyle = useAnimatedStyle(() => {
    const p = chestPose(t.value, marks);
    const s = p.exitScale;
    return {
      opacity: p.opacity,
      transform: [
        { translateX: p.shakeX },
        { translateY: -5 * idle.value + 10 * press.value + p.exitY },
        { scaleX: (1 + press.value * 0.08) * p.squashX * s },
        { scaleY: (1 - press.value * 0.1) * p.squashY * s },
      ],
    };
  });
  const closedStyle = useAnimatedStyle(() => ({ opacity: chestPose(t.value, marks).closed }));
  const silhouetteStyle = useAnimatedStyle(() => ({ opacity: chestPose(t.value, marks).silhouette }));
  const openStyle = useAnimatedStyle(() => ({ opacity: chestPose(t.value, marks).open }));
  const chargeGlowStyle = useAnimatedStyle(() => {
    const c = chargeAt(t.value, marks);
    const k = calmAt(t.value, marks);
    const gone = chestPose(t.value, marks).opacity;
    return {
      opacity: (0.18 + c * 0.82 - k * 0.65) * gone,
      transform: [{ scale: 0.7 + c * 0.55 - k * 0.12 }],
    };
  });
  const fanStyle = useAnimatedStyle(() => {
    const c = chargeAt(t.value, marks);
    const out = t.value >= marks.flashAt ? 0 : 1;
    return { opacity: c * (1 - calmAt(t.value, marks)) * out, transform: [{ scaleY: 0.25 + c * 0.75 }] };
  });
  // Light leaking from the seam, and the lock flashing through the peak.
  const seamStyle = useAnimatedStyle(() => ({
    opacity: (0.55 + 0.45 * chargeAt(t.value, marks)) * chestPose(t.value, marks).opacity,
  }));
  const lockStyle = useAnimatedStyle(() => {
    const o = peakAt(t.value, marks);
    return { opacity: o * (0.55 + 0.45 * Math.sin(t.value / 38)), transform: [{ scale: 0.8 + 0.5 * o }] };
  });
  const pageStyle = useAnimatedStyle(() => ({ opacity: stagePose(t.value, marks).page }));
  const burstGlowStyle = useAnimatedStyle(() => {
    const s = stagePose(t.value, marks);
    return { opacity: s.glowOpacity, transform: [{ scale: s.glowScale }] };
  });
  const rayAlpha = plan.reveal.rayAlpha;
  const rayStyle = useAnimatedStyle(() => {
    const s = stagePose(t.value, marks);
    return { opacity: s.rays * rayAlpha, transform: [{ rotate: `${spin.value * 360}deg` }, { scale: s.raysScale }] };
  });
  const itemStyle = useAnimatedStyle(() => {
    const p = itemPose(t.value, marks, rise);
    return { opacity: p.opacity, transform: [{ translateY: p.translateY }, { scale: p.scale }, { rotate: `${p.rotate}deg` }] };
  });
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashAt(t.value, marks) }));
  const nameStyle = useAnimatedStyle(() => {
    const p = copyPose(t.value, marks.nameAt);
    return { opacity: p.opacity, transform: [{ translateY: p.translateY }] };
  });
  const rarityStyle = useAnimatedStyle(() => {
    const p = copyPose(t.value, marks.rarityAt, 200);
    return { opacity: p.opacity, transform: [{ scale: 1.35 - 0.35 * p.opacity }] };
  });
  const hintStyle = useAnimatedStyle(() => ({ opacity: copyPose(t.value, marks.hintAt, 320).opacity }));

  if (!visible || !sequence) return null;
  const burst = reached(phase, REVEAL_PHASE.BURST);
  const complete = phase === REVEAL_PHASE.COMPLETE;
  const light = burst ? REVEAL_LIGHT[plan.tier] : TIER_LIGHT[lightTier];
  const raySize = Math.ceil(Math.hypot(width, height));
  const label = reward?.label || 'New collectible';
  const tierWord = (RARITY_LABEL[plan.tier] || plan.tier).toUpperCase();

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onBack} statusBarTranslucent>
      <View style={[styles.page, { backgroundColor: chestColors('mystery').page }]}>
        {/* The page morphs into the tier's colour under the flash. */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: chestColors(plan.tier).page }, pageStyle]} />
        <Animated.View pointerEvents="none" style={[styles.rays, { left: (width - raySize) / 2, top: (height - raySize) / 2 - height * 0.08, width: raySize, height: raySize }, rayStyle]}>
          {plan.reveal.sunburst
            ? <RevealRays size={raySize} tint={REVEAL_LIGHT[plan.tier]} sunburst />
            : <LightFan width={raySize} height={raySize} color={REVEAL_LIGHT[plan.tier]} id="loot-rays" />}
        </Animated.View>
        {burst && plan.reveal.bolts && !reduced ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
            <GameAnimation name="revealLightning" size={Math.max(width, height)} />
          </View>
        ) : null}
        <DriftMotes clock={stream} width={width} height={height} />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}><Vignette width={width} height={height} id="loot-vignette" /></View>

        <Pressable
          {...gesture.panHandlers}
          style={styles.input}
          onPress={onPress}
          disabled={!entering && !complete}
          accessibilityRole="button"
          accessibilityLabel={complete
            ? `${plan.tier} reward, ${label}. Tap to continue`
            : entering
              ? `Mystery chest. ${MYSTERY_SWIPES - spent} charges remaining. Swipe or tap.`
              : 'Opening chest'}
        >
          <View style={[styles.stage, { height: stageH }]}>
            {!burst ? <Text style={styles.mystery}>MYSTERY</Text> : null}
            <Animated.View pointerEvents="none" style={[styles.chargeGlow, chargeGlowStyle]}><Glow size={chestW * 1.85} color={light} id="loot-charge" /></Animated.View>
            <Animated.View pointerEvents="none" style={[styles.fan, { bottom: stageH - seamY, width: chestW * 1.55, height: stageH * 0.52 }, fanStyle]}><LightFan width={chestW * 1.55} height={stageH * 0.52} color={light} id="loot-fan" /></Animated.View>
            {/* The gold glow thrown out of the mouth at the hit. */}
            <Animated.View pointerEvents="none" style={[styles.impact, { top: seamY - chestW * 0.5, width: chestW, height: chestW }, burstGlowStyle]}><Glow size={chestW} color={REVEAL_LIGHT[plan.tier]} id="loot-burst-glow" /></Animated.View>
            <Animated.View style={[styles.seam, { top: seamY - 18, width: chestW * 1.05 }, seamStyle]} pointerEvents="none"><SeamGlow width={chestW * 1.05} height={36} color={light} id="loot-seam" /></Animated.View>
            {!burst ? <View style={[styles.chargeMotes, { top: seamY }]} pointerEvents="none"><ChargeMotes stream={stream} charge={charge} calm={calm} color={light} radius={chestW * 0.65} /></View> : null}

            {/* CHEST. Shut, white-hot and open drawings are all mounted; the
                clock picks which shows, so the swap lands on the exact frame
                the screen is white rather than whenever a timer wakes. */}
            <Animated.View pointerEvents="none" style={[styles.chest, { top: seamY - metrics.lidH, width: chestW, height: metrics.height }, chestStyle]}>
              <AmbientSparkles box={chestW} live={entering && !reduced} />
              <Animated.View style={[StyleSheet.absoluteFill, closedStyle]}>
                <View style={[styles.piece, { top: metrics.lidH }]}><ChestBase width={chestW} rarity="mystery" /></View>
                <View style={styles.piece}><ChestLid width={chestW} rarity="mystery" /></View>
                <Animated.View style={[styles.lock, { top: metrics.lidH - 40, left: chestW / 2 - 40 }, lockStyle]}><Glow size={80} color="#FFFFFF" id="loot-lock" /></Animated.View>
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, silhouetteStyle]}>
                <View style={styles.piece}><ChestSilhouette width={chestW} /></View>
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, openStyle]}>
                <View style={[styles.piece, { top: metrics.lidH - metrics.insideH }]}><ChestLidInside width={chestW} rarity={plan.tier} /></View>
                <View style={[styles.piece, { top: metrics.lidH }]}><ChestBase width={chestW} rarity={plan.tier} open /></View>
              </Animated.View>
              {entering && !reduced ? <Swoosh trigger={swipeKey} size={chestW * 1.08} /> : null}
            </Animated.View>

            {burst ? <View pointerEvents="none" style={[styles.beam, { top: 30, width: chestW * 0.9, height: seamY - 10 }]}><Beam width={chestW * 0.9} height={seamY - 10} color={light} id="loot-beam" /></View> : null}

            {/* ITEM. Mounted, invisible, from the first frame, so its art is
                decoded before it is needed. Over the chest, under the flash. */}
            <Animated.View pointerEvents="none" style={[styles.reward, { top: heroTop }, itemStyle]}>
              <Framed frame="card" fill="#FFF8E8" tint={toon.ink} weight={INK.base} inset={10} style={styles.rewardFrame} boil={!reduced && burst}>
                <RewardArt reward={reward} size={rewardSize} accent={RARITY_COLOR[plan.tier]} animated={burst} />
              </Framed>
            </Animated.View>

            {burst ? (
              <>
                <View pointerEvents="none" style={[styles.impact, { top: seamY }]}>{Array.from({ length: plan.reveal.rings }, (_, i) => <Ring key={i} trigger={impactKey} color={light} size={chestW * 0.48} delay={i * 90} to={2.4 + i * 0.35} />)}<SparkBurst trigger={impactKey} count={plan.reveal.sparks} reach={chestW * 0.72} colors={TIER_SPARKS[plan.tier]} /></View>
                <AnimationStack names={plan.reveal.bursts} size={Math.min(width, 330)} trigger={impactKey} style={[styles.bursts, { top: seamY - 165 }]} />
              </>
            ) : null}
          </View>
          {entering ? <View style={styles.controls}><ChargeCells total={MYSTERY_SWIPES} spent={spent} live={!busy.current} reduced={reduced} /><SwipeCue live={!busy.current} /></View> : null}
        </Pressable>

        <Animated.View pointerEvents="none" style={[styles.whiteout, flashStyle]} />
        {burst && plan.reveal.confetti ? <Confetti key={impactKey} count={plan.reveal.confetti} /> : null}

        {/* Captions: the item first, then its name, then its tier, then the
            hint, each on its own beat. */}
        <View pointerEvents="none" style={styles.revealCopy}>
          {copy >= 1 ? <Animated.View style={nameStyle}><OutlinedText style={styles.itemName} outline={toon.ink} width={3} fit>{label}</OutlinedText></Animated.View> : null}
          {copy >= 2 ? <Animated.View style={rarityStyle}><OutlinedText style={styles.rarity} outline={chestColors(plan.tier).ink} width={2}>{tierWord}</OutlinedText></Animated.View> : null}
          {copy >= 3 ? <Animated.Text style={[styles.hint, hintStyle]}>Tap to continue</Animated.Text> : null}
        </View>
        {onClose && entering ? <Pressable style={styles.close} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><Svg width={24} height={24} viewBox="0 0 24 24"><Path d="M15 5 L8 12 L15 19" stroke="#FFFFFF" strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg></Pressable> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { width: '100%', alignItems: 'center' },
  mystery: { position: 'absolute', top: 8, color: '#FFFFFF', fontFamily: fonts.display, fontSize: 27, letterSpacing: 5 },
  chargeGlow: { position: 'absolute', alignSelf: 'center', top: '16%' },
  fan: { position: 'absolute', alignSelf: 'center' },
  seam: { position: 'absolute', alignSelf: 'center' },
  chargeMotes: { position: 'absolute', alignSelf: 'center' },
  chest: { position: 'absolute', alignSelf: 'center' },
  piece: { position: 'absolute', left: 0 },
  lock: { position: 'absolute', width: 80, height: 80 },
  beam: { position: 'absolute', alignSelf: 'center' },
  impact: { position: 'absolute', alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  bursts: { position: 'absolute', alignSelf: 'center' },
  rays: { position: 'absolute' },
  reward: { position: 'absolute', alignSelf: 'center' },
  rewardFrame: { transform: [{ rotate: '-1.5deg' }] },
  controls: { alignItems: 'center', gap: space.lg, marginTop: space.md },
  revealCopy: { position: 'absolute', left: space.gutter, right: space.gutter, bottom: 72, alignItems: 'center' },
  itemName: { fontFamily: fonts.display, fontSize: 34, letterSpacing: 1.5, color: '#FFFFFF' },
  rarity: { fontFamily: fonts.display, fontSize: 20, letterSpacing: 4, marginTop: 4, color: '#FFFFFF' },
  hint: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF', marginTop: space.md, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  close: { position: 'absolute', left: space.gutter, top: 52, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.42)' },
  whiteout: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFFFFF', opacity: 0 },
});
