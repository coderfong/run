// The victory beat — the runner standing on the ground they just took, before
// the numbers arrive.
//
// Uses the full CharacterRig (not a bust) because this beat calls the app's
// existing celebration: `rig.play('celebrate')`. The rig no-ops that under
// Reduce Motion on its own, so this component does not special-case it.
//
// The label reuses TerritoryStealBanner's visual language — outlined toon text
// and the steal glyph — rather than the banner itself. The full bomb-and-blast
// playout stays exclusively in ClaimPayoff, so a steal is never announced
// twice with two competing banners.
//
// LAYOUT: one centred column, not three anchored boxes. The words used to be
// centred on the CARD (left: 0, right: 0) while the character was anchored to
// the claim point on the MAP, so the two almost never shared a centre line and
// the whole announcement read as off to one side. They are now stacked as a
// single column — word, runner, word — centred in the map box, so the three
// pieces always agree with each other and with the middle of the screen. The
// border pulse still follows the real territory, because that one IS the map.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fonts, toon } from '../../theme';
import { CAPTURE_LAYER } from '../../effects/layers';
import { haptic } from '../../ui/motion';
import AppIcon, { STEAL_ICON_SIZE } from '../AppIcon';
import { AnimationStack } from '../GameAnimation';
import CharacterRig, { BODY_RATIO, HEADROOM } from '../character/CharacterRig';
import { OutlinedText } from '../ui';
import { withFace } from './expressions';
import { ringsToPath } from './geometry';
import { timingFor } from './timing';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const RIG_SIZE = 78;
const FX_SIZE = 250;
// Grown alongside the headline's own size bump, so it stays in proportion
// with the now-bigger word next to it.
const STEAL_ICON_SCALE = 2.8;
// The rig draws its body plus headroom for tall hair. Derived from the rig's
// own constants rather than copied as numbers, because the stacked layout
// below positions the effects off it and would drift the day either changes.
const RIG_HEIGHT = RIG_SIZE * BODY_RATIO * (1 + HEADROOM);

// The column: a line of type, the runner, a line of type.
const LABEL_LINE = 40;
const TOP_GAP = 2;
const BOTTOM_GAP = 6;

// The slam itself. A word enters from above at two and a half times its size
// and stops dead — `SLAM_MS` is the whole of that travel, and it is short on
// purpose: an impact is a fast move with a hard stop, and anything longer
// reads as the word floating into place.
const SLAM_MS = 120;
const SLAM_RISE = 54;
const SLAM_SCALE = 2.5;
// The hard stop. Quintic ease-out, built with `poly(5)` because Reanimated's
// Easing has no `quint` member — reaching for one hands `out()` an undefined
// callee, which does not fail until the first frame of the animation actually
// runs it, on the UI thread, where a release build has no error boundary and
// aborts the process outright.
const SLAM_EASING = Easing.out(Easing.poly(5));

/**
 * Which headline this claim earned. Empty ground is never "stolen" — there was
 * nobody to steal it from, and ground the runner already held is not NEW: a
 * claim placed on their own land moves no border, and calling that new
 * territory is the same overstatement the payoff used to make with the merged
 * holding's area.
 */
export function victoryLabel(claim) {
  const victims = claim?.victims || [];
  const taken = victims.filter((v) => !v.defended);
  if (taken.length > 0) return 'TERRITORY STOLEN';
  if (victims.length > 0) return 'TERRITORY CAPTURED';
  // Under a square metre is a rounding artefact, not a border. The `?? 1`
  // keeps an older backend that sends no figure on the old headline.
  if ((claim?.gained_m2 ?? 1) < 1) return 'TERRITORY REINFORCED';
  return 'NEW TERRITORY';
}

// The shields are deliberately absent. A red shield over a claim you just WON
// reads as a warning — as if something had gone wrong or the ground were about
// to be taken back — which is the opposite of what this beat is for. The
// impact and the smoke already say "this was taken off somebody"; the badge
// on top only muddied it.
function victoryEffects(label) {
  if (label === 'TERRITORY STOLEN') return ['impactRed', 'smokePuff'];
  if (label === 'TERRITORY CAPTURED') return ['impactGold', 'bubbleBurst'];
  return ['victoryRays', 'bubbleBurst'];
}

/**
 * One word's slam, as a hit effect rather than an entrance: the word drops in
 * oversized, snaps to size on an ease-OUT (fast in, hard stop — that stop is
 * the whole effect), squashes on the landing frame and springs back, while a
 * ghost copy of the same word blows past it and fades so the impact leaves a
 * shockwave instead of just ending.
 *
 * Called twice, unconditionally, once per word.
 */
function useSlam() {
  const drop = useSharedValue(0);
  const punch = useSharedValue(1);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const opacity = useSharedValue(0);
  const echo = useSharedValue(0);

  const reset = useCallback(() => {
    opacity.value = 0;
    drop.value = 0;
    punch.value = 1;
    squashX.value = 1;
    squashY.value = 1;
    echo.value = 0;
  }, [drop, echo, opacity, punch, squashX, squashY]);

  const play = useCallback((reduced) => {
    if (reduced) {
      opacity.value = withTiming(1, { duration: 120 });
      return;
    }
    // No fade in front of the drop — the word is already at full strength on
    // its way down, which is what lets the landing be the only event.
    opacity.value = withTiming(1, { duration: 40 });

    drop.value = -SLAM_RISE;
    drop.value = withTiming(0, { duration: SLAM_MS, easing: SLAM_EASING });

    punch.value = SLAM_SCALE;
    punch.value = withSequence(
      withTiming(1, { duration: SLAM_MS, easing: SLAM_EASING }),
      // The recoil: a touch under size, then sprung back. Without it the word
      // simply stops, and a stop with no consequence does not read as a hit.
      withTiming(0.94, { duration: 70, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 9, stiffness: 360, mass: 0.45 })
    );

    squashX.value = withDelay(
      SLAM_MS,
      withSequence(
        withTiming(1.16, { duration: 70 }),
        withSpring(1, { damping: 11, stiffness: 300, mass: 0.4 })
      )
    );
    squashY.value = withDelay(
      SLAM_MS,
      withSequence(
        withTiming(0.82, { duration: 70 }),
        withSpring(1, { damping: 11, stiffness: 300, mass: 0.4 })
      )
    );

    echo.value = 0;
    echo.value = withDelay(
      SLAM_MS,
      withTiming(1, { duration: 340, easing: Easing.out(Easing.quad) })
    );
  }, [drop, echo, opacity, punch, squashX, squashY]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: drop.value },
      { scale: punch.value },
      { scaleX: squashX.value },
      { scaleY: squashY.value },
    ],
  }));

  const echoStyle = useAnimatedStyle(() => ({
    // Held at nothing until the landing frame starts it, so the ghost is never
    // visible sitting on top of the word during the drop.
    opacity: echo.value > 0 ? 0.5 * (1 - echo.value) : 0,
    transform: [{ scale: 1 + echo.value * 0.9 }],
  }));

  return { reset, play, style, echoStyle };
}

function SlamWord({ word, style, echoStyle, height, children }) {
  return (
    <Animated.View pointerEvents="none" style={[styles.label, height ? { height } : null, style]}>
      <View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.echo, echoStyle]}>
          <OutlinedText style={styles.labelText} outline={toon.ink} width={3}>
            {word}
          </OutlinedText>
        </Animated.View>
        <OutlinedText style={styles.labelText} outline={toon.ink} width={3}>
          {word}
        </OutlinedText>
      </View>
      {children}
    </Animated.View>
  );
}

function TerritoryVictoryBeat({
  visible,
  attacker,
  rings,
  claimScreenPoint,
  bounds,
  label,
  victims = [],
  strokeColor = '#EC4899',
  reducedMotion = false,
  playToken = 0,
  onComplete,
}) {
  const T = timingFor(reducedMotion);
  const rigRef = useRef(null);
  const timers = useRef(new Set());
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const drop = useSharedValue(reducedMotion ? 0 : -46);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const opacity = useSharedValue(0);
  // The headline is TWO words landing one after another — "TERRITORY" above
  // the character, then the status word ("STOLEN"/"CAPTURED") below it a beat
  // later — rather than one line sharing a single entrance. Each is its own
  // hit (see useSlam), so the announcement reads as two impacts in order.
  const top = useSlam();
  const bottom = useSlam();
  const pulse = useSharedValue(0);
  // The whole column jolts on each landing. This is the camera shake half of
  // the hit effect: the word stopping is only half of it, the scene flinching
  // is what sells the weight.
  const shake = useSharedValue(0);

  const outlinePath = useMemo(() => (rings ? ringsToPath(rings) : null), [rings]);

  useEffect(() => {
    if (!visible) return undefined;

    const track = (id) => { timers.current.add(id); return id; };
    const clearTimers = () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
    clearTimers();

    const landAt = reducedMotion ? 90 : 260;

    opacity.value = withTiming(1, { duration: 110 });
    top.reset();
    bottom.reset();
    pulse.value = 0;
    shake.value = 0;

    const jolt = () => {
      shake.value = 1;
      shake.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) });
      // `heavy` is the impact frame of a capture cutscene — the one place the
      // haptics constitution allows it, and this is one (see theme/haptics).
      haptic.heavy();
    };

    if (reducedMotion) {
      drop.value = 0;
      squashX.value = 1;
      squashY.value = 1;
    } else {
      // 1 + 2. drop into the middle of the card and land with a squash
      drop.value = withSequence(
        withTiming(0, { duration: landAt, easing: Easing.in(Easing.quad) }),
        withSpring(0, { damping: 12, stiffness: 300, mass: 0.5 })
      );
      squashX.value = withDelay(
        landAt,
        withSequence(
          withTiming(1.18, { duration: 80 }),
          withSpring(1, { damping: 12, stiffness: 300, mass: 0.45 })
        )
      );
      squashY.value = withDelay(
        landAt,
        withSequence(
          withTiming(0.82, { duration: 80 }),
          withSpring(1, { damping: 12, stiffness: 300, mass: 0.45 })
        )
      );
    }

    // 3 + 4 + 5. border pulse, the app's own celebration, victory face
    track(setTimeout(() => {
      rigRef.current?.play('celebrate');
      pulse.value = withSequence(
        withTiming(1, { duration: 130 }),
        withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) })
      );
    }, landAt));

    // 6. the headline — the territory and the rig have already landed by now
    // (this fires 60ms after THEIR landing, which itself is after the ground
    // has finished changing hands in the phases before this component ever
    // mounts — see useClaimSequence). "TERRITORY" slams down above the
    // character FIRST; the status word slams down below it a beat later. The
    // gap is long enough to read as two separate hits and short enough that
    // they still belong to one sentence.
    const topStart = landAt + 60;
    const bottomStart = topStart + (reducedMotion ? 90 : 260);

    track(setTimeout(() => top.play(reducedMotion), topStart));
    track(setTimeout(() => bottom.play(reducedMotion), bottomStart));
    if (!reducedMotion) {
      track(setTimeout(jolt, topStart + SLAM_MS));
      track(setTimeout(jolt, bottomStart + SLAM_MS));
    }

    // 7. hold, then hand over to the payoff
    track(setTimeout(() => completeRef.current?.(), T.victoryBeat));

    return clearTimers;
  }, [visible, playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach(clearTimeout);
      set.clear();
    };
  }, []);

  const rigStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: drop.value },
      { scaleX: squashX.value },
      { scaleY: squashY.value },
    ],
  }));

  // A decaying wobble on both axes rather than a single nudge — one frame of
  // offset is a glitch, a couple of shrinking oscillations is an impact.
  const shakeStyle = useAnimatedStyle(() => {
    const s = shake.value;
    return {
      transform: [
        { translateX: Math.sin(s * Math.PI * 5) * 9 * s },
        { translateY: Math.cos(s * Math.PI * 4) * 5 * s },
      ],
    };
  });

  const pulseProps = useAnimatedProps(() => ({
    strokeWidth: 2 + pulse.value * 9,
    strokeOpacity: 0.85 * pulse.value,
  }));

  const equipped = useMemo(() => withFace(attacker, 'victory'), [attacker]);
  const outcome = useMemo(() => {
    const defended = victims.filter((v) => v?.defended).length;
    const captured = victims.length - defended;
    return { defended, captured };
  }, [victims]);

  if (!visible || !claimScreenPoint) return null;

  // Two words, one above the character and one below it — always exactly two
  // ("TERRITORY STOLEN", "TERRITORY CAPTURED", "NEW TERRITORY"), so a plain
  // split is safe, and it always puts the noun first.
  const [topWord, bottomWord] = (label || '').split(' ');

  // The map box is the pixel space everything in this beat is laid out in; the
  // window is only a fallback for the frame before it has been measured.
  const win = Dimensions.get('window');
  const W = bounds?.width || win.width;
  const H = bounds?.height || win.height;

  // The bottom row's height has to fit whichever of its two children is taller
  // — usually the 40px text line, but on "TERRITORY STOLEN" the steal icon
  // (STEAL_ICON_SIZE * STEAL_ICON_SCALE ≈ 73px) is the tall one, and the row
  // sizes to its tallest child regardless of label.
  const bottomRowHeight = Math.max(LABEL_LINE, STEAL_ICON_SIZE * STEAL_ICON_SCALE);
  const groupHeight = LABEL_LINE + TOP_GAP + RIG_HEIGHT + BOTTOM_GAP + bottomRowHeight;
  // Centred in the card, and never pushed off the top of it on a short one.
  const groupTop = Math.max(8, (H - groupHeight) / 2);
  // The character's feet, which is where the impact effects are aimed.
  const footY = groupTop + LABEL_LINE + TOP_GAP + RIG_HEIGHT;
  const fxLeft = Math.max(0, Math.min(W / 2 - FX_SIZE / 2, W - FX_SIZE));
  const fxTop = Math.max(0, footY - FX_SIZE + 20);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: CAPTURE_LAYER.VICTORY }]}>
      {victims.length > 0 && (
        <View style={styles.outcomeRow}>
          <Text style={[styles.outcomeText, styles.captured]}>{`CAPTURED ${outcome.captured}`}</Text>
          <Text style={[styles.outcomeText, styles.defended]}>{`DEFENDED ${outcome.defended}`}</Text>
        </View>
      )}
      {/* 3. one pulse of the territory border, drawn from the same projected
          rings the reveal used. Anchored to the map, not to the column — this
          is the actual ground, wherever on screen it sits. */}
      {outlinePath && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <AnimatedPath
            d={outlinePath}
            fill="none"
            stroke={strokeColor}
            strokeLinejoin="round"
            animatedProps={pulseProps}
          />
        </Svg>
      )}

      <AnimationStack
        names={victoryEffects(label)}
        size={FX_SIZE}
        trigger={playToken}
        style={[styles.fxAnchor, { left: fxLeft, top: fxTop }]}
      />

      <Animated.View pointerEvents="none" style={[styles.column, { top: groupTop }, shakeStyle]}>
        <SlamWord word={topWord} style={top.style} echoStyle={top.echoStyle} />

        <Animated.View pointerEvents="none" style={[styles.rigAnchor, rigStyle]}>
          <CharacterRig ref={rigRef} equipped={equipped} size={RIG_SIZE} />
        </Animated.View>

        <SlamWord
          word={bottomWord}
          style={bottom.style}
          echoStyle={bottom.echoStyle}
          height={bottomRowHeight}
        >
          {/* Bigger than the shared STEAL_ICON_SIZE (26) on purpose — this is
              the one headline moment the icon exists to punctuate, not a chip
              in a list. Sized directly rather than retuning the shared
              constant, which would also inflate the notifications-inbox icon. */}
          {label === 'TERRITORY STOLEN' && (
            <AppIcon name="steal" size={STEAL_ICON_SIZE * STEAL_ICON_SCALE} style={styles.labelIcon} />
          )}
        </SlamWord>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  outcomeRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 18,
  },
  outcomeText: { fontFamily: fonts.heading, fontSize: 15, letterSpacing: 0.8 },
  captured: { color: '#2DD4BF' },
  defended: { color: '#FBBF24' },
  fxAnchor: { position: 'absolute' },
  // The column is the only thing positioned: everything inside it is in flow,
  // which is what guarantees the words and the character share a centre line.
  column: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  rigAnchor: { marginTop: TOP_GAP, marginBottom: BOTTOM_GAP },
  label: {
    height: LABEL_LINE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  echo: { alignItems: 'center', justifyContent: 'center' },
  // Was `toonType.label` (Inter SemiBold, a UI-chip weight) stretched to 27px
  // — the wrong font family for a slam-down headline, not just the wrong
  // size. `fonts.hero` is Poppins Black (900), the app's actual chunky
  // display face — same family `toonType.hero`/`headline` use for real
  // headlines. Bigger again too (27→34) and the outline width above went
  // 2→3 to match.
  labelText: {
    fontFamily: fonts.hero,
    color: '#fff',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: 0.6,
  },
  labelIcon: { marginLeft: 10 },
});

// Memoized for the same reason as CaptureStylePlayer (see that file's note).
export default React.memo(TerritoryVictoryBeat);
