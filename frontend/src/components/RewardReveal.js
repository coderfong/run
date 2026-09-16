// RewardReveal — the payoff moment when a tier is claimed or a box is opened.
//
// THREE ACTS, one timeline: WIND-UP, HIT, SETTLE. Both shapes run it.
//
//   claim      the wind-up is the screen itself tightening: the fan spins up
//              and brightens, two rings close on the middle, and a ring of
//              sparks falls into the point where the reward is about to be.
//   lootbox    the same wind-up with a CLOSED BOX standing in the middle of
//              it, trembling harder as the build goes on. `fromLootbox` is
//              what selects this; the caller knows, because only the caller
//              knows whether a box was opened to get here.
//
// THE WIND-UP IS THE POINT. This used to hand the reward over 120ms after the
// modal opened, on a spring that overshot to 1.12 and settled back — which is
// a receipt with a bounce on it, not a reveal. Nothing was ever WAITED for.
// The second in which the screen is visibly building to something is the whole
// reason the hit lands, so a claim now gets a full second of build and the box
// gets longer still.
//
// AND NOTHING OVERSHOOTS. The card grows out of the flash in one move on an
// ease-out. An object that springs past its size and comes back reads as light
// and rubbery, and the hit is supposed to have weight. The only motion left at
// rest is a slow breath and the sparkles riding the card's corners, because a
// reveal that freezes into a still the instant it arrives is a screenshot.
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
// state with the whole build collapsed — a reveal that makes you wait through
// an animation you have turned off is just a delay.

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
  withTiming,
} from 'react-native-reanimated';

import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import RewardArt, { RARITY_COLOR, RARITY_LABEL } from './RewardArt';
import GameAnimation from './GameAnimation';
import { getItem } from '../config/cosmetics';
import { brand, radius, space, toon, toonType, useTheme, useThemedType } from '../theme';
import { OutlinedText } from './ui';
import { Confetti, useReduceMotion } from '../ui/motion';

// How many rewards get named under the card before the rest become a count.
const MAX_NAMED = 6;

function rewardRarity(reward) {
  if (!reward) return null;
  if (reward.rarity) return reward.rarity;
  if (reward.kind === 'lootbox') return reward.key;
  if (reward.kind !== 'cosmetic') return null;
  const [slot, id] = String(reward.key || '').split(':');
  return slot && id ? getItem(slot, id)?.rarity || null : null;
}

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

// ---------------------------------------------------------------------------
// THE TIMELINE
//
// Every beat lives here because the acts have to stay in proportion to each
// other: lengthening the wind-up without moving the label is how a reveal ends
// up with a caption that arrives before the thing it captions.
// ---------------------------------------------------------------------------

// The build. A claim gets a beat just under a second — long enough to be a
// wait, short enough that a tenth claim in a row is not a chore. The box gets
// nearly twice that, because a box standing on screen is its own reason to
// wait, and because the tremor needs room to go from a shiver to a rattle.
const CHARGE_MS = 950;
const BOX_CHARGE_MS = 1600;

// The hit: a hard white frame with a long fall-off. The rise is shorter than a
// frame at 60Hz so it reads as an impact rather than as a fade to white.
const FLASH_UP_MS = 60;
const FLASH_DOWN_MS = 340;

// The settle.
const CARD_IN_MS = 460;
const WAVE_MS = 700;
const LABEL_DELAY = 240;
const LABEL_IN_MS = 320;
// The hint comes LAST, and alone. Offering "tap to continue" while the reveal
// is still resolving is an invitation to skip the thing you just built.
const HINT_DELAY = 1100;
// The resting breath. Slow enough that you notice it only if you stay.
const FLOAT_MS = 2600;

const BOX_SIZE = 132;
// Wider than the card it fires behind — a burst that stops at the card's edge
// reads as a texture on the card rather than as something bursting out of it.
const BURST_SIZE = 300;

// The wind-up furniture: two rings closing on the centre, and sparks falling
// into it. DRAWN, for the same reason the fan is (see `RevealRays`) — this is
// geometry at screen scale, and it has to take the reward's own tint.
const RING_SIZE = 210;
const MOTE_COUNT = 14;
const MOTE_RADIUS = 190;
const MOTES = Array.from({ length: MOTE_COUNT }, (_, i) => i);

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
export function RevealRays({ size, tint, sunburst = false }) {
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

// One spark falling into the centre.
//
// Every mote reads the SAME `charge` value and derives its own angle and lag
// from its index, so fourteen of them cost one animation instead of fourteen —
// and they can never drift out of step with the rings or the fan, because
// there is nothing for them to drift against.
function ChargeMote({ charge, fade, index, color }) {
  const angle = (index / MOTE_COUNT) * Math.PI * 2 + (index % 3) * 0.34;
  const lag = (index % 5) * 0.07;
  const size = index % 3 === 0 ? 8 : 5;
  const style = useAnimatedStyle(() => {
    const c = Math.max(0, Math.min(1, (charge.value - lag) / (1 - lag)));
    // Squared: a mote drifts at first and is FALLING by the end. A spark that
    // travels at a constant rate is a loading spinner.
    const d = MOTE_RADIUS * (1 - c) * (1 - c);
    return {
      opacity: (c <= 0 ? 0 : Math.min(1, c * 4)) * (1 - fade.value),
      transform: [
        { translateX: Math.cos(angle) * d },
        { translateY: Math.sin(angle) * d },
        { scale: 0.5 + c * 0.8 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color },
        style,
      ]}
    />
  );
}

// A ring closing on the centre. `phase` holds the second one back so the pair
// reads as a pulse rather than as one thick line.
function ChargeRing({ charge, fade, color, phase = 0 }) {
  const style = useAnimatedStyle(() => {
    const c = Math.max(0, Math.min(1, (charge.value - phase) / (1 - phase)));
    return {
      opacity: (c <= 0 ? 0 : Math.min(1, c * 3) * (1 - c * 0.3)) * (1 - fade.value),
      transform: [{ scale: 2.5 - 1.75 * c }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: RING_SIZE,
          height: RING_SIZE,
          borderRadius: RING_SIZE,
          borderWidth: 3,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

// The hit's own shockwave: one ring thrown back OUT of the point everything
// just fell into. It is the release the whole wind-up was for, so it is drawn
// rather than keyed — it has to be able to leave the screen without softening.
function Shockwave({ wave, color }) {
  const style = useAnimatedStyle(() => ({
    opacity: wave.value <= 0 || wave.value >= 1 ? 0 : (1 - wave.value) * 0.8,
    transform: [{ scale: 0.25 + wave.value * 2.6 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: RING_SIZE,
          height: RING_SIZE,
          borderRadius: RING_SIZE,
          borderWidth: 6,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

export default function RewardReveal({ visible, rewards, equipped, accent, fromLootbox = false, onClose }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();

  // 'box' = the chest is on screen and still shut. Reduce Motion skips it, and
  // with it the whole build.
  const staged = false; // LootboxGamble already opened the chest.
  // `opened` is the hit. BOTH shapes start closed now — the claim's wind-up is
  // the change — so this stays false until the build finishes or a tap cuts it
  // short.
  const [opened, setOpened] = useState(reduced || fromLootbox);
  const chargeMs = staged ? BOX_CHARGE_MS : CHARGE_MS;

  const scrim = useSharedValue(0);
  const box = useSharedValue(0);
  const charge = useSharedValue(0);
  const shake = useSharedValue(0.5);
  const flash = useSharedValue(0);
  const wave = useSharedValue(0);
  const pop = useSharedValue(0);
  const spin = useSharedValue(0);
  const float = useSharedValue(0);
  const label = useSharedValue(0);
  const hint = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      // The shine, the tremor and the breath are INFINITE repeats: left
      // running they would keep going on the UI thread behind whatever screen
      // you went back to, for the rest of the session. Fading one out is not
      // the same as stopping it.
      cancelAnimation(spin);
      cancelAnimation(shake);
      cancelAnimation(float);
      spin.value = 0;
      shake.value = 0.5;
      float.value = 0;
      scrim.value = 0;
      box.value = 0;
      charge.value = 0;
      flash.value = 0;
      wave.value = 0;
      pop.value = 0;
      label.value = 0;
      hint.value = 0;
      setOpened(reduced || fromLootbox);
      return undefined;
    }
    scrim.value = reduced ? 1 : withTiming(1, { duration: 160 });
    if (fromLootbox) setOpened(true);
    if (reduced) return undefined;
    // The shine turns behind everything for as long as the reveal is up. The
    // lootbox fan turns at the rate its master was authored at, so the drawn
    // rays and the bolts riding over them stay in step.
    spin.value = 0;
    spin.value = withRepeat(
      withTiming(1, { duration: fromLootbox ? LOOT_SPIN_MS : SPIN_MS, easing: Easing.linear }),
      -1,
      false
    );
    // THE BUILD. One accelerating value that every part of the wind-up reads:
    // the rings, the motes, the fan's extra turn and its brightness, the box's
    // tremor. Sharing one number is why they tighten TOGETHER instead of
    // merely happening at the same time.
    charge.value = 0;
    charge.value = withTiming(1, { duration: chargeMs, easing: Easing.in(Easing.cubic) });
    // The tremor runs flat out and takes its AMPLITUDE from the build, so it
    // starts as a shiver and ends as a rattle without needing a second clock.
    shake.value = 0.5;
    shake.value = withRepeat(withTiming(1, { duration: 84, easing: Easing.inOut(Easing.quad) }), -1, true);
    // The box arrives on an ease-out, not a spring. It is a heavy object.
    if (staged) box.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => setOpened(true), chargeMs);
    return () => {
      clearTimeout(timer);
      cancelAnimation(spin);
      cancelAnimation(shake);
      cancelAnimation(float);
    };
  }, [
    visible, reduced, staged, fromLootbox, chargeMs,
    scrim, box, charge, shake, flash, wave, pop, label, hint, spin, float,
  ]);

  // THE HIT, and everything after it — fired when the build finishes, or when
  // an impatient tap ends it early.
  useEffect(() => {
    if (!visible || !opened) return;
    if (reduced) {
      charge.value = 1;
      pop.value = 1;
      label.value = 1;
      hint.value = 1;
      box.value = 0;
      return;
    }
    cancelAnimation(shake);
    shake.value = 0.5;
    // A tap can land mid-build. FINISHING the charge in one short move rather
    // than cutting it means the rings still land on the centre — the wind-up
    // is compressed, not thrown away, so a skipped reveal still resolves.
    charge.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
    flash.value = withSequence(
      withTiming(1, { duration: FLASH_UP_MS, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: FLASH_DOWN_MS, easing: Easing.in(Easing.quad) })
    );
    wave.value = 0;
    wave.value = withTiming(1, { duration: WAVE_MS, easing: Easing.out(Easing.cubic) });
    // The box gives way as the item comes through it.
    box.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) });
    // ONE move, ease-out, no overshoot. Starts small at the burst's own centre
    // so the card is born out of the flash rather than fading in over it.
    pop.value = withDelay(50, withTiming(1, { duration: CARD_IN_MS, easing: Easing.out(Easing.cubic) }));
    label.value = withDelay(LABEL_DELAY, withTiming(1, { duration: LABEL_IN_MS, easing: Easing.out(Easing.quad) }));
    hint.value = withDelay(HINT_DELAY, withTiming(1, { duration: 420 }));
    // The resting state is not a still: the card breathes for as long as you
    // leave it there. It starts only once the card has arrived, so the
    // entrance and the breath never fight over the same pixels.
    float.value = withDelay(
      CARD_IN_MS,
      withRepeat(withTiming(1, { duration: FLOAT_MS, easing: Easing.inOut(Easing.quad) }), -1, true)
    );
  }, [visible, opened, reduced, charge, shake, flash, wave, pop, label, hint, box, float]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.92 }));
  const popStyle = useAnimatedStyle(() => ({
    // Doubled, so the card is solid well before it is full size — it should
    // read as an object growing, not as one dissolving in.
    opacity: Math.min(1, pop.value * 2.2),
    transform: [
      { scale: 0.55 + pop.value * 0.45 },
      // Rises OUT of the box: at pop 0 the card sits down where the lid was
      // and travels up into place as it grows. Without the lift the item
      // simply materialises in front of the box, which is a dissolve, not a
      // reveal. A claim gets a shorter version of the same lift, and the
      // resting breath rides on top of it once the entrance is over.
      { translateY: (1 - pop.value) * (staged ? BOX_SIZE * 0.42 : 18) - float.value * 5 },
    ],
  }));
  const boxStyle = useAnimatedStyle(() => {
    // The tremor: displacement and tilt both scale with the build, so the box
    // is dead still when it lands and shaking itself apart by the end.
    const swing = (shake.value - 0.5) * 2 * charge.value;
    return {
      opacity: Math.min(1, box.value),
      transform: [
        { translateX: swing * 5 },
        { rotate: `${swing * 5}deg` },
        { scale: box.value * (1 + charge.value * 0.06) },
      ],
    };
  });
  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 14 }, { scale: 0.86 + label.value * 0.14 }],
  }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));
  // The claim's shine sits at 55% because it is laid OVER a backdrop; the
  // lootbox fan is the backdrop and goes on at full strength.
  const rayAlpha = fromLootbox ? 1 : 0.55;
  // The extra turn the build winds onto the fan is a CLAIM-only move. The
  // lootbox fan is pinned to the rate its bolts were authored at, and a fan
  // that spins up under bolts that do not is two pieces of art again.
  const windUp = fromLootbox ? 0 : 200;
  // ...and the sunburst may never scale BELOW 1. It is sized to the screen's
  // diagonal exactly (see `raySize`), so shrinking it by even a few percent
  // sweeps bare gold through the corners once a second.
  const rayFloor = fromLootbox ? 1 : 0.94;
  const raysStyle = useAnimatedStyle(() => ({
    opacity: rayAlpha * scrim.value * (0.34 + 0.66 * charge.value),
    transform: [
      { rotate: `${spin.value * 360 + charge.value * charge.value * windUp}deg` },
      { scale: rayFloor + charge.value * 0.1 + flash.value * 0.08 },
    ],
  }));

  const list = rewards || [];
  const headline = list.length > 1 ? `${list.length} rewards` : list[0]?.label;
  const rarity = rewardRarity(list[0]);
  const tint = (rarity && RARITY_COLOR[rarity]) || accent || brand.pink;
  // The build's own ink. A rarity tint on the deep ink reads; the same tint on
  // the lootbox gold does not, so the gold gets white and keeps the contrast.
  const buildInk = fromLootbox ? '#FFFFFF' : tint;

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

  // A tap during the build ends it NOW. Only once the reward is out does a tap
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
        accessibilityLabel={opened ? 'Dismiss reward' : staged ? 'Open the box' : 'Skip the reveal'}
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
              Thrown at the HIT, not when the modal opens — paper already
              falling while the screen is still winding up gives the ending
              away. No-ops under Reduce Motion on its own. */}
          {opened ? <Confetti count={40} /> : null}
        </View>

        <View style={styles.center} pointerEvents="none">
          {/* The stage groups the build, the box, the burst and the card so
              they all share ONE centre. Centring them on the whole screen
              instead would put the burst halfway between the card and its
              caption. */}
          <View style={styles.stage}>
            {/* THE WIND-UP. Rings and sparks close on the point the reward is
                about to occupy. `pop` is what fades them, so they are gone by
                the time the card is full size without needing a clock of their
                own — the thing arriving is what clears them away. */}
            {!reduced ? (
              <>
                <ChargeRing charge={charge} fade={pop} color={buildInk} />
                <ChargeRing charge={charge} fade={pop} color={buildInk} phase={0.35} />
                {MOTES.map((i) => (
                  <ChargeMote key={i} index={i} charge={charge} fade={pop} color={buildInk} />
                ))}
                <Shockwave wave={wave} color={buildInk} />
              </>
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
                      size={list.length > 1 ? 92 : 136}
                      // One card, one focal reward — this is the moment the
                      // chest should be moving.
                      animated
                    />
                  ))}
                </View>
              </View>
              {/* Twinkles on the card's own corners, riding its transform so
                  they arrive with it. These are what keep the RESTING state
                  alive: the burst is over in a second and a half, and without
                  them the thing you are looking at while you read the label is
                  a static picture. */}
              {opened && !reduced ? (
                <>
                  <View style={[styles.spark, styles.sparkTop]} pointerEvents="none">
                    <GameAnimation name="sparkleStar" size={62} loop />
                  </View>
                  <View style={[styles.spark, styles.sparkBottom]} pointerEvents="none">
                    <GameAnimation name="sparkleStar" size={44} loop />
                  </View>
                </>
              ) : null}
            </Animated.View>
          </View>

          <Animated.View style={[styles.labelWrap, labelStyle]}>
            <OutlinedText style={[toonType.sub, { color: '#fff' }]} outline={toon.ink} width={2}>
              {headline || 'Claimed'}
            </OutlinedText>
            {rarity ? (
              <Text style={[styles.rarity, { color: tint }]}>
                {(RARITY_LABEL[rarity] || rarity).toUpperCase()}
              </Text>
            ) : null}
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
                {list.slice(0, MAX_NAMED).map((r) => r.label).join(', ')}
                {list.length > MAX_NAMED ? `, plus ${list.length - MAX_NAMED} more` : ''}
              </Text>
            ) : null}
            {/* Last in, on its own fade. The reveal has to look finished
                before it asks to be dismissed. */}
            <Animated.Text
              style={[
                type.caption,
                { color: fromLootbox ? INK_ON_GOLD_SOFT : 'rgba(255,255,255,0.5)', marginTop: space.sm },
                hintStyle,
              ]}
            >
              Tap to continue
            </Animated.Text>
          </Animated.View>
        </View>

        {/* THE HIT, over everything INCLUDING the card. A flash the card sits
            on top of is a flash behind the card, which is a glow. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.fill, { backgroundColor: '#FFFFFF' }, flashStyle]}
        />
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
    minWidth: 224,
    minHeight: 204,
    paddingHorizontal: space.xxl,
    paddingVertical: space.xxl,
    borderRadius: radius.card,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  spark: { position: 'absolute' },
  sparkTop: { top: -26, right: -22 },
  sparkBottom: { bottom: -20, left: -24 },
  labelWrap: { alignItems: 'center', marginTop: space.lg, paddingHorizontal: space.xl },
  rarity: { ...toonType.label, marginTop: 6, letterSpacing: 1.8 },
});
