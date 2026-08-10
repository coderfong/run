// RewardReveal — the payoff moment when a tier is claimed or a box is opened.
//
// TWO SHAPES, one component:
//
//   claim      the reward pops straight in. Nothing was hiding it.
//   lootbox    a CLOSED BOX lands first, sits for a beat, then bursts — and
//              the thing that was inside rises out of where the box was.
//              `fromLootbox` is what selects this; the caller knows, because
//              only the caller knows whether a box was opened to get here.
//
// The lootbox staging is the whole point of the second shape. Handing over the
// contents and mentioning a box in the caption is a receipt, not a reveal: the
// tension is in the second where the box is on screen and you don't yet know
// what is in it. So the item does not merely appear after the box — it comes
// OUT of it, starting small at the box's own position and rising into place as
// the box shrinks away underneath it.
//
// THE BACKGROUND IS THE BACKGROUND. It used to be a 72%-black scrim with a
// 320pt square of effects floating in the middle of it, and a square of
// animation on a dark page reads as a box of animation — you can see its
// edges. It is now a flat opaque fill with the shine and the confetti running
// FULL BLEED across it, clipped by the screen rather than by a layout box.
//
// THE TWO SHAPES DO NOT SHARE A BACKDROP. A claim keeps the deep ink and a
// soft shine tinted by the reward's rarity — it is a receipt for something you
// had already earned. Opening a box is the loud one, so it gets the yellow
// lightning burst: a hard gold sunburst turning behind everything with white
// bolts cracking across it. Both are the same two layers (a fill, and
// `RevealRays` over it); only the numbers differ.
//
// Everything is Reanimated (no Lottie), and Reduce Motion skips to the resting
// state with the box phase collapsed — a reveal that makes you wait through an
// animation you have turned off is just a delay.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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

import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import RewardArt, { RARITY_COLOR } from './RewardArt';
import GameAnimation from './GameAnimation';
import { brand, radius, space, toon, toonType, useTheme, useThemedType, withAlpha } from '../theme';
import { OutlinedText } from './ui';
import { Confetti, useReduceMotion } from '../ui/motion';

// How many rewards get named under the card before the rest become a count.
const MAX_NAMED = 6;

// The flat fill behind everything. Deliberately a CONSTANT and not a themed
// colour: this is a lightbox, and a reveal that is charcoal-on-charcoal in
// dark mode and ink-on-cream in light is two different moments. It is the same
// deep ink the pass banner scrims to, so the two screens feel related.
const BACKDROP = '#140E24';

// The lootbox backdrop, taken off the lightning master rather than guessed:
// the card is #FDD60C, its bright wedges are #FCFD0D, there are eight of them
// on a 45-degree pitch at 12.8 degrees wide, and the fan turns 45 deg/s
// clockwise — one full turn every 8s. Keeping those numbers here is what lets
// the drawn fan and the keyed bolts look like one piece of art, because they
// were one piece of art.
const LOOT_BACKDROP = '#FDD60C';
const LOOT_RAY = '#FCFD0D';
const LOOT_RAY_COUNT = 8;
const LOOT_RAY_SPAN = 12.8 / 45;
const LOOT_SPIN_MS = 8000;
const SPIN_MS = 14000;

// reveal-lightning.webp, so the bolts can be positioned without measuring the
// asset at runtime.
const BOLT_ASPECT = 1400 / 788;

// White captions vanish on the gold. The lootbox reads them in ink instead —
// same two weights, inverted.
const INK_ON_GOLD = 'rgba(12,12,16,0.78)';
const INK_ON_GOLD_SOFT = 'rgba(12,12,16,0.55)';

// How long the closed box holds before it bursts. Long enough to register as
// an object, short enough that nobody taps through it.
const BOX_HOLD_MS = 850;

const BOX_SIZE = 132;
// Wider than the card it fires behind — a burst that stops at the card's edge
// reads as a texture on the card rather than as something bursting out of it.
const BURST_SIZE = 300;

// The shine behind everything, DRAWN rather than scaled.
//
// This used to be `victoryRays.webp` blown up to the long edge of the screen —
// roughly a 6x magnification of a small master, which is why the backdrop read
// as a smear. A ray fan is four lines of geometry and stays sharp at any size,
// costs no decode, and can take the reward's own rarity tint instead of being
// stuck with whatever colour was baked into the file.
const RAY_COUNT = 18;

// `sunburst` swaps the soft shine for the lightning master's own fan: fewer,
// narrower wedges, flat and fully opaque, no fade. The fade exists to hide the
// edge of a square laid over a backdrop; the sunburst IS the backdrop, drawn
// over its own base gold, so a wedge that stops short would read as a wedge
// that stops short. Same geometry either way, which is why it is one component
// and not two.
function RevealRays({ size, tint, sunburst = false }) {
  const r = size / 2;
  // Wedges spanning half of each slice, so the gaps between them are the same
  // width as the rays — a fan with no gap is just a disc.
  const count = sunburst ? LOOT_RAY_COUNT : RAY_COUNT;
  const span = sunburst ? LOOT_RAY_SPAN : 0.5;
  const step = (Math.PI * 2) / count;
  const wedges = [];
  for (let i = 0; i < count; i += 1) {
    const a0 = i * step;
    const a1 = a0 + step * span;
    wedges.push(
      `M ${r} ${r} L ${r + r * Math.cos(a0)} ${r + r * Math.sin(a0)} ` +
        `L ${r + r * Math.cos(a1)} ${r + r * Math.sin(a1)} Z`
    );
  }
  if (sunburst) {
    return (
      <Svg width={size} height={size}>
        {wedges.map((d, i) => (
          <Path key={i} d={d} fill={LOOT_RAY} />
        ))}
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size}>
      <Defs>
        {/* Fades the rays out before they reach the edge, so the fan has no
            visible rim — the thing that would give away that it is a square. */}
        <RadialGradient id="rayFade" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
          <Stop offset="55%" stopColor="#ffffff" stopOpacity="0.10" />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={tint} stopOpacity="0.55" />
          <Stop offset="45%" stopColor={tint} stopOpacity="0.16" />
          <Stop offset="100%" stopColor={tint} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} fill="url(#coreGlow)" />
      {wedges.map((d, i) => (
        <Path key={i} d={d} fill="url(#rayFade)" />
      ))}
    </Svg>
  );
}

export default function RewardReveal({ visible, rewards, equipped, accent, fromLootbox = false, onClose }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  // 'box' = the chest is on screen and still shut. Claims skip it entirely,
  // and so does Reduce Motion.
  const staged = fromLootbox && !reduced;
  const [opened, setOpened] = useState(!staged);

  const scrim = useSharedValue(0);
  const box = useSharedValue(0);
  const pop = useSharedValue(0);
  const spin = useSharedValue(0);
  const label = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      // The shine is an INFINITE repeat: left running it would keep turning on
      // the UI thread behind whatever screen you went back to, for the rest of
      // the session. Fading it out is not the same as stopping it.
      cancelAnimation(spin);
      spin.value = 0;
      scrim.value = 0;
      box.value = 0;
      pop.value = 0;
      label.value = 0;
      setOpened(!staged);
      return undefined;
    }
    scrim.value = reduced ? 1 : withTiming(1, { duration: 160 });
    // The shine turns behind everything for as long as the reveal is up. The
    // lootbox fan turns at the rate its master was authored at, so the drawn
    // rays and the bolts riding over them stay in step.
    if (!reduced) {
      spin.value = 0;
      spin.value = withRepeat(
        withTiming(1, { duration: fromLootbox ? LOOT_SPIN_MS : SPIN_MS, easing: Easing.linear }),
        -1,
        false
      );
    }
    let timer;
    if (staged) {
      // The box drops in, breathes once, and is on its own clock — `opened`
      // only flips when the hold is up (or when an impatient tap jumps it).
      box.value = withSequence(
        withSpring(1, { damping: 11, stiffness: 220 }),
        withDelay(BOX_HOLD_MS * 0.45, withTiming(1.08, { duration: 200, easing: Easing.inOut(Easing.quad) }))
      );
      timer = setTimeout(() => setOpened(true), BOX_HOLD_MS);
    }
    return () => {
      clearTimeout(timer);
      cancelAnimation(spin);
    };
  }, [visible, reduced, staged, fromLootbox, scrim, box, pop, label, spin]);

  // The item's own entrance, fired when the box is out of the way (or
  // immediately, for a plain claim).
  useEffect(() => {
    if (!visible || !opened) return;
    if (reduced) {
      pop.value = 1;
      label.value = 1;
      box.value = 0;
      return;
    }
    // The box gives way as the item comes through it.
    box.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
    pop.value = withDelay(
      staged ? 60 : 120,
      withSequence(
        withSpring(1.12, { damping: 9, stiffness: 260 }),
        withSpring(1, { damping: 14, stiffness: 200 })
      )
    );
    label.value = withDelay(staged ? 280 : 340, withTiming(1, { duration: 220 }));
  }, [visible, opened, reduced, staged, pop, label, box]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const popStyle = useAnimatedStyle(() => ({
    opacity: pop.value > 0 ? 1 : 0,
    transform: [
      { scale: pop.value },
      // Rises OUT of the box: at pop 0 the card sits down where the lid was
      // and travels up into place as it grows. Without the lift the item
      // simply materialises in front of the box, which is a dissolve, not a
      // reveal.
      { translateY: staged ? (1 - Math.min(1, pop.value)) * (BOX_SIZE * 0.42) : 0 },
    ],
  }));
  const boxStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, box.value),
    transform: [{ scale: box.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 10 }],
  }));
  // The claim's shine sits at 55% because it is laid OVER a backdrop; the
  // lootbox fan is the backdrop and goes on at full strength.
  const rayAlpha = fromLootbox ? 1 : 0.55;
  const raysStyle = useAnimatedStyle(() => ({
    opacity: rayAlpha * scrim.value,
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  const list = rewards || [];
  const headline = list.length > 1 ? `${list.length} rewards` : list[0]?.label;
  const rarity = list[0]?.kind === 'lootbox' ? list[0].key : null;
  const tint = (rarity && RARITY_COLOR[rarity]) || accent || brand.pink;

  // Sized off the LONG edge so a square clip spans the whole screen rather
  // than sitting in it as a visible square. The container clips the overhang;
  // that is what makes this a background instead of a picture of one.
  //
  // The sunburst needs the DIAGONAL instead. Its wedges are opaque and reach
  // exactly the half-width of their box, so they cover a disc — and a disc has
  // to clear the screen's corners, at every angle it turns through, or the fan
  // sweeps bare gold across them once a second.
  const fxSize = Math.max(width, height);
  const raySize = fromLootbox ? Math.ceil(Math.hypot(width, height)) : fxSize;
  const centredBox = (w, h) => ({
    position: 'absolute',
    left: (width - w) / 2,
    top: (height - h) / 2,
    width: w,
    height: h,
  });
  const fxBox = centredBox(raySize, raySize);
  // The bolts keep the long edge, not the diagonal: they were drawn striking
  // out from the centre of a 16:9 frame, and blowing that frame up to the
  // diagonal would push their tips off screen and leave only the stubs.
  const boltBox = centredBox(fxSize, fxSize / BOLT_ASPECT);

  // A tap during the box phase opens it now. Only once it is open does a tap
  // dismiss — otherwise the first impatient tap throws away the reveal.
  const onTap = () => {
    if (!opened) return setOpened(true);
    onClose?.();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        style={styles.fill}
        onPress={onTap}
        accessibilityLabel={opened ? 'Dismiss reward' : 'Open the box'}
      >
        {/* flat fill, then the full-bleed shine and confetti over it */}
        <Animated.View
          style={[styles.fill, { backgroundColor: fromLootbox ? LOOT_BACKDROP : BACKDROP }, scrimStyle]}
        />
        <View style={[styles.fill, styles.bleed]} pointerEvents="none">
          {/* The shine, turning slowly behind everything — DRAWN, so it is
              sharp at whatever size the screen is. It used to be a small webp
              magnified to the long edge of the display, which is the blur this
              backdrop was known for. Same reasoning as the confetti below,
              which has always been drawn for exactly this reason. */}
          <Animated.View style={[fxBox, raysStyle]}>
            <RevealRays size={raySize} tint={tint} sunburst={fromLootbox} />
          </Animated.View>
          {/* The bolts, the one part of that backdrop SVG cannot cheaply be.
              They ride over the fan, not under it, and they run for the whole
              reveal rather than firing on the open — the crackle is what makes
              the second the box is still shut feel like a wait for something.

              Not mounted at all under Reduce Motion: this is an effect, and
              the gold fan behind it is a complete backdrop without it. */}
          {visible && fromLootbox && !reduced ? (
            <Animated.View style={[boltBox, scrimStyle]}>
              <GameAnimation name="revealLightning" size={fxSize} />
            </Animated.View>
          ) : null}
          {/* Real full-screen confetti, at whatever resolution the device has.
              No-ops under Reduce Motion on its own. */}
          {visible ? <Confetti count={34} /> : null}
        </View>

        <View style={styles.center} pointerEvents="none">
          {/* The stage groups the box, the burst and the card so all three
              share ONE centre. Centring them on the whole screen instead would
              put the burst halfway between the card and its caption. */}
          <View style={styles.stage}>
            {/* The closed box, drawn UNDER the card — so when the two overlap
                mid-reveal, the item is the thing in front. */}
            {staged ? (
              <Animated.View style={[styles.box, boxStyle]} pointerEvents="none">
                <GameAnimation name="giftBox" size={BOX_SIZE} loop />
              </Animated.View>
            ) : null}

            {/* The burst: fired at the box's position the instant it gives way.
                rewardBurst carries alpha now — it used to ship an opaque black
                card, which is why this moment had a black square in it. */}
            {opened ? (
              <View style={styles.burst} pointerEvents="none">
                <GameAnimation name="rewardBurst" size={BURST_SIZE} trigger={headline || 'reward'} />
                <View style={StyleSheet.absoluteFill}>
                  <GameAnimation name="confettiBurst" size={BURST_SIZE} trigger={headline || 'reward'} />
                </View>
              </View>
            ) : null}

            <Animated.View style={[styles.rewardWrap, popStyle]}>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: tint }]}>
                <View style={styles.artRow}>
                  {list.slice(0, 2).map((r, i) => (
                    <RewardArt
                      key={`${r.kind}:${r.key}:${i}`}
                      reward={r}
                      equipped={equipped}
                      accent={tint}
                      size={list.length > 1 ? 72 : 96}
                      // One card, one focal reward — this is the moment the
                      // chest should be moving.
                      animated
                    />
                  ))}
                </View>
              </View>
            </Animated.View>
          </View>

          <Animated.View style={[styles.labelWrap, labelStyle]}>
            <OutlinedText style={[toonType.sub, { color: '#fff' }]} outline={toon.ink} width={2}>
              {headline || 'Claimed'}
            </OutlinedText>
            {/* Claim-all can hand over a hundred things at once. Naming a few
                of them tells you what kind of haul it was; naming all hundred
                is a paragraph nobody reads. */}
            {list.length > 1 ? (
              <Text
                style={[
                  type.caption,
                  { color: fromLootbox ? INK_ON_GOLD : 'rgba(255,255,255,0.72)', marginTop: 2 },
                ]}
                numberOfLines={2}
              >
                {list.slice(0, MAX_NAMED).map((r) => r.label).join(' · ')}
                {list.length > MAX_NAMED ? ` · +${list.length - MAX_NAMED} more` : ''}
              </Text>
            ) : null}
            <Text
              style={[
                type.caption,
                { color: fromLootbox ? INK_ON_GOLD_SOFT : 'rgba(255,255,255,0.5)', marginTop: space.sm },
              ]}
            >
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
  // The shine is wider than the screen on purpose; this is what keeps it a
  // background instead of a visible square of animation.
  bleed: { overflow: 'hidden' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  box: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  burst: { position: 'absolute', width: BURST_SIZE, height: BURST_SIZE, alignItems: 'center', justifyContent: 'center' },
  rewardWrap: { alignItems: 'center' },
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
