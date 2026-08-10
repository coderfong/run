// TerritoryStealBanner — the four beats of a steal, played on one bar.
//
//   1. a bomb arcs up out of the territory bar
//   2. it detonates, and the blast punches the STOLEN label onto the bar
//   3. the runners you hit are thrown out of the blast as their own heads
//   4. they land back in a row and keep pulling a sad face
//
// The heads are NOT pre-baked PNG pairs: PASER avatars are composited at
// runtime by CharacterRig, so a "sad" head is the same equipped set with the
// face slot swapped to `sad`. Both variants render stacked and cross-fade, so
// hair, hat and colours can never jump between the two.
//
// One shared `clock` (0 → TIMING.total ms) drives every interpolation, which
// keeps the beats locked to each other no matter what the frame rate does.
// Reduce Motion skips straight to the settled bar.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { brand, toon, toonType, useTheme, withAlpha } from '../theme';
import { haptic, useReduceMotion } from '../ui/motion';
import AppIcon from './AppIcon';
import { CharacterBust } from './character/CharacterRig';
import { OutlinedText } from './ui';
import GameLottie from './GameLottie';

const BLAST = {
  white: '#FFFFFF',
  yellow: '#FFD84D',
  orange: '#FF8A30',
  smoke: '#E8E2D4',
  smokeInk: '#BDB6A8',
  bomb: '#17191C',
  bombEdge: '#050607',
  bombHighlight: '#545A61',
  fuse: '#7A5A32',
};

const TIMING = {
  total: 2850,

  bombStart: 0,
  bombPeak: 500,
  bombImpact: 690,

  flashStart: 630,
  flashEnd: 810,

  shockwaveStart: 650,
  shockwaveEnd: 1040,

  smokeStart: 680,
  smokeEnd: 1170,

  stolenStart: 720,
  stolenSettled: 1080,

  avatarBurstStart: 760,
  avatarBurstEnd: 1710,

  finalAvatarsStart: 1510,
  finalAvatarsSettled: 1930,

  faceLoopStart: 2050,
};

// Where each head is thrown. Six paths = the cap on heads shown; extra
// victims are counted in the label instead of being flung.
const PARTICLE_PATHS = [
  { x: -118, peak: 48, rotation: -22, delay: 0, scale: 0.92 },
  { x: 110, peak: 38, rotation: 20, delay: 55, scale: 1.0 },
  { x: -68, peak: 58, rotation: -14, delay: 110, scale: 0.84 },
  { x: 72, peak: 28, rotation: 13, delay: 165, scale: 0.78 },
  { x: -154, peak: 30, rotation: -28, delay: 220, scale: 0.7 },
  { x: 148, peak: 50, rotation: 26, delay: 275, scale: 0.74 },
];

export const MAX_STEAL_HEADS = PARTICLE_PATHS.length;

// A head reads at 31px; past three of them the row would run under the
// centred label, so they step down instead of overlapping it.
function headSize(count) {
  if (count <= 3) return 31;
  if (count === 4) return 28;
  return 25;
}

// ---------------------------------------------------------------------------
// The bomb (drawn, so it needs no asset)
// ---------------------------------------------------------------------------

function Bomb({ clock }) {
  const animatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      clock.value,
      [TIMING.bombStart, 140, TIMING.bombPeak, 610, TIMING.bombImpact],
      [12, -8, -58, -54, -48],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      clock.value,
      [TIMING.bombStart, 120, 300, 610, TIMING.bombImpact],
      [0, 1.14, 1, 1.04, 0],
      Extrapolation.CLAMP
    );
    const rotation = interpolate(
      clock.value,
      [0, 220, 410, 610, TIMING.bombImpact],
      [-8, 8, -7, 5, 0],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      clock.value,
      [0, 60, 625, TIMING.bombImpact],
      [0, 1, 1, 0],
      Extrapolation.CLAMP
    );
    return {
      opacity,
      transform: [{ translateY }, { rotate: `${rotation}deg` }, { scale }],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.bombAnchor, animatedStyle]}>
      <View style={styles.bomb}>
        <View style={styles.bombHighlight} />
        <View style={styles.fuse}>
          <View style={styles.fuseSparkOuter}>
            <View style={styles.fuseSparkInner} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// The blast
// ---------------------------------------------------------------------------

function SparkRay({ angle, clock }) {
  const style = useAnimatedStyle(() => {
    const progress = interpolate(
      clock.value,
      [TIMING.flashStart, TIMING.shockwaveEnd],
      [0, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: interpolate(progress, [0, 0.12, 0.72, 1], [0, 1, 0.8, 0]),
      transform: [
        { rotate: `${angle}deg` },
        { translateY: interpolate(progress, [0, 1], [-6, -36], Extrapolation.CLAMP) },
        { scaleY: interpolate(progress, [0, 0.3, 1], [0.25, 1, 0.4], Extrapolation.CLAMP) },
      ],
    };
  });

  return <Animated.View style={[styles.sparkRay, style]} />;
}

function SmokePuff({ clock, x, y, size, delay }) {
  const style = useAnimatedStyle(() => {
    const start = TIMING.smokeStart + delay;
    const end = TIMING.smokeEnd + delay;
    const progress = interpolate(clock.value, [start, end], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(
        clock.value,
        [start, start + 80, end - 140, end],
        [0, 0.95, 0.78, 0],
        Extrapolation.CLAMP
      ),
      transform: [
        { translateX: x * progress },
        { translateY: y * progress },
        { scale: interpolate(progress, [0, 0.35, 1], [0.25, 1, 1.35], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.smokePuff,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          marginLeft: -size / 2,
          marginTop: -size / 2,
        },
        style,
      ]}
    />
  );
}

function Explosion({ clock }) {
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      clock.value,
      [TIMING.flashStart, TIMING.flashStart + 45, TIMING.flashStart + 105, TIMING.flashEnd],
      [0, 1, 0.88, 0],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          clock.value,
          [TIMING.flashStart, TIMING.flashStart + 95, TIMING.flashEnd],
          [0.15, 1.35, 2],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const coreStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      clock.value,
      [TIMING.flashStart + 20, TIMING.flashStart + 90, TIMING.smokeStart + 180, TIMING.smokeEnd],
      [0, 1, 0.9, 0],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          clock.value,
          [TIMING.flashStart, TIMING.flashStart + 150, TIMING.smokeEnd],
          [0.2, 1.1, 1.65],
          Extrapolation.CLAMP
        ),
      },
      {
        rotate: `${interpolate(
          clock.value,
          [TIMING.flashStart, TIMING.smokeEnd],
          [0, 18],
          Extrapolation.CLAMP
        )}deg`,
      },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      clock.value,
      [TIMING.shockwaveStart, TIMING.shockwaveStart + 80, TIMING.shockwaveEnd],
      [0, 0.95, 0],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          clock.value,
          [TIMING.shockwaveStart, TIMING.shockwaveEnd],
          [0.25, 3.15],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  return (
    <View pointerEvents="none" style={styles.explosionAnchor}>
      <Animated.View style={[styles.explosionFlash, flashStyle]} />
      <Animated.View style={[styles.explosionCore, coreStyle]} />
      <Animated.View style={[styles.shockwaveRing, ringStyle]} />

      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <SparkRay key={angle} angle={angle} clock={clock} />
      ))}

      <SmokePuff clock={clock} x={-28} y={-18} size={26} delay={0} />
      <SmokePuff clock={clock} x={27} y={-22} size={30} delay={30} />
      <SmokePuff clock={clock} x={-36} y={8} size={24} delay={75} />
      <SmokePuff clock={clock} x={35} y={10} size={22} delay={95} />
      <SmokePuff clock={clock} x={0} y={-34} size={25} delay={45} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The heads
// ---------------------------------------------------------------------------

// The head thrown out of the blast — the runner's own face, not a particle.
function BurstHead({ victim, clock, index, size }) {
  const spec = PARTICLE_PATHS[index % PARTICLE_PATHS.length];

  const style = useAnimatedStyle(() => {
    const start = TIMING.avatarBurstStart + spec.delay;
    const end = TIMING.avatarBurstEnd + spec.delay;
    const progress = interpolate(clock.value, [start, end], [0, 1], Extrapolation.CLAMP);

    return {
      opacity: interpolate(
        clock.value,
        [start, start + 65, end - 180, end],
        [0, 1, 1, 0],
        Extrapolation.CLAMP
      ),
      transform: [
        { translateX: interpolate(progress, [0, 1], [0, spec.x], Extrapolation.CLAMP) },
        {
          translateY: interpolate(
            progress,
            [0, 0.34, 0.72, 0.88, 1],
            [0, -spec.peak, -7, -14, 0],
            Extrapolation.CLAMP
          ),
        },
        {
          rotate: `${interpolate(progress, [0, 1], [0, spec.rotation], Extrapolation.CLAMP)}deg`,
        },
        {
          scale: interpolate(
            progress,
            [0, 0.18, 0.82, 1],
            [0.2, 1.14 * spec.scale, spec.scale, 0.72 * spec.scale],
            Extrapolation.CLAMP
          ),
        },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.burstAnchor,
        { width: size, height: size, marginLeft: -size / 2, marginBottom: -size / 2 },
        style,
      ]}
    >
      <CharacterBust equipped={victim.avatar || {}} size={size} bg="transparent" />
    </Animated.View>
  );
}

// The head that stays on the bar, pulling a sad face on a loop.
function SettledHead({ victim, clock, index, size, reduced, trigger, playToken }) {
  const faceMix = useSharedValue(0);
  const sadAvatar = useMemo(() => ({ ...(victim.avatar || {}), face: 'sad' }), [victim.avatar]);

  useEffect(() => {
    cancelAnimation(faceMix);
    faceMix.value = 0;
    if (reduced) return undefined;

    // default → sad → default, held either side, forever. The stagger keeps a
    // row of heads from blinking in lockstep.
    faceMix.value = withDelay(
      TIMING.faceLoopStart + index * 90,
      withRepeat(
        withSequence(
          withDelay(520, withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic) })),
          withDelay(470, withTiming(0, { duration: 170, easing: Easing.inOut(Easing.cubic) })),
          withDelay(420, withTiming(0, { duration: 1 }))
        ),
        -1,
        false
      )
    );

    return () => cancelAnimation(faceMix);
  }, [faceMix, index, reduced, trigger, playToken]);

  const entryStyle = useAnimatedStyle(() => {
    const delay = index * 70;
    const progress = interpolate(
      clock.value,
      [TIMING.finalAvatarsStart + delay, TIMING.finalAvatarsSettled + delay],
      [0, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: progress,
      transform: [
        { translateY: interpolate(progress, [0, 0.6, 1], [8, -3, 0], Extrapolation.CLAMP) },
        { scale: interpolate(progress, [0, 0.65, 1], [0.3, 1.12, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  // The sulk: the whole head sags and tilts as the face changes.
  const reactionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(faceMix.value, [0, 1], [0, 2.5], Extrapolation.CLAMP) },
      {
        rotate: `${interpolate(
          faceMix.value,
          [0, 1],
          [0, index % 2 === 0 ? -3 : 3],
          Extrapolation.CLAMP
        )}deg`,
      },
      { scale: interpolate(faceMix.value, [0, 1], [1, 0.96], Extrapolation.CLAMP) },
    ],
  }));

  const defaultStyle = useAnimatedStyle(() => ({ opacity: 1 - faceMix.value }));
  const sadStyle = useAnimatedStyle(() => ({ opacity: faceMix.value }));

  return (
    <Animated.View style={[{ width: size, height: size, marginRight: 4 }, entryStyle]}>
      <Animated.View style={[{ width: size, height: size }, reactionStyle]}>
        <Animated.View style={defaultStyle}>
          <CharacterBust
            equipped={victim.avatar || {}}
            size={size}
            ring={victim.clan_color?.stroke}
            bg="transparent"
          />
        </Animated.View>
        <Animated.View style={[styles.stackedHead, sadStyle]}>
          <CharacterBust
            equipped={sadAvatar}
            size={size}
            ring={victim.clan_color?.stroke}
            bg="transparent"
          />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------

/**
 * @param {string|number} trigger  change it to replay (e.g. the claim id)
 * @param {object[]} victims       [{ user_id, username, avatar, clan_color }]
 * @param {string|number} amount   what was taken, already formatted
 * @param {string} label           defaults to STOLEN
 * @param {boolean} autoPlay       false starts on the SETTLED bar — the blast
 *                                 is there to be replayed, not to go off. What
 *                                 the feed uses: twenty cards detonating
 *                                 themselves as you scroll is not a payoff.
 * @param {boolean} haptics        the detonation buzz. Off in a list.
 */
export default function TerritoryStealBanner({
  trigger,
  victims,
  amount,
  label = 'STOLEN',
  style,
  onComplete,
  autoPlay = true,
  haptics = true,
}) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const clock = useSharedValue(0);
  const done = useRef(onComplete);
  done.current = onComplete;
  // 0 = settled, no blast. Bumped to replay; reset whenever the subject changes.
  const [playToken, setPlayToken] = useState(autoPlay ? 1 : 0);
  const [blastFx, setBlastFx] = useState(0);
  useEffect(() => { setPlayToken(autoPlay ? 1 : 0); }, [trigger, autoPlay]);

  const heads = useMemo(() => (victims || []).slice(0, MAX_STEAL_HEADS), [victims]);
  const size = headSize(heads.length);

  const finish = () => done.current?.();

  useEffect(() => {
    cancelAnimation(clock);

    if (reduced || playToken === 0) {
      // Straight to the settled bar: label on, heads in place, no blast.
      clock.value = TIMING.total;
      finish();
      return undefined;
    }

    clock.value = 0;
    clock.value = withTiming(
      TIMING.total,
      { duration: TIMING.total, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(finish)();
      }
    );

    // The detonation is the only beat worth a haptic.
    const bang = haptics ? setTimeout(() => haptic.medium(), TIMING.flashStart) : null;
    const lottieBang = setTimeout(() => setBlastFx((token) => token + 1), TIMING.flashStart);
    return () => {
      if (bang) clearTimeout(bang);
      clearTimeout(lottieBang);
      cancelAnimation(clock);
    };
  }, [clock, haptics, playToken, reduced]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      clock.value,
      [TIMING.stolenStart, TIMING.stolenStart + 120],
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        translateX: interpolate(
          clock.value,
          [
            TIMING.stolenStart,
            TIMING.stolenStart + 45,
            TIMING.stolenStart + 90,
            TIMING.stolenStart + 135,
            TIMING.stolenStart + 180,
          ],
          [0, -4, 4, -2, 0],
          Extrapolation.CLAMP
        ),
      },
      {
        scale: interpolate(
          clock.value,
          [TIMING.stolenStart, TIMING.stolenStart + 130, TIMING.stolenSettled],
          [0.72, 1.12, 1],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  // The bar takes the hit too — a squash and a bounce on impact.
  const barStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          clock.value,
          [
            TIMING.flashStart,
            TIMING.flashStart + 45,
            TIMING.flashStart + 90,
            TIMING.flashStart + 135,
          ],
          [0, 2, -1, 0],
          Extrapolation.CLAMP
        ),
      },
      {
        scaleX: interpolate(
          clock.value,
          [TIMING.flashStart, TIMING.flashStart + 55, TIMING.flashStart + 140],
          [1, 1.018, 1],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const extra = (victims?.length || 0) - heads.length;

  const a11yLabel = heads.length
    ? `${label} ${amount ?? ''} from ${heads.map((v) => v.username).join(', ')}`
    : `${label} ${amount ?? ''}`;

  return (
    <Pressable
      onPress={() => { if (!reduced) setPlayToken((n) => n + 1); }}
      style={[styles.root, style]}
      accessible
      accessibilityRole={reduced ? 'text' : 'button'}
      accessibilityLabel={reduced ? a11yLabel : `${a11yLabel}. Tap to replay.`}
    >
      <Animated.View
        style={[
          styles.bar,
          { backgroundColor: colors.cardAlt || colors.card, borderColor: colors.border },
          barStyle,
        ]}
      >
        <View style={[styles.slashLeft, { backgroundColor: withAlpha(brand.teal, 0.34) }]} />
        <View style={[styles.slashRight, { backgroundColor: withAlpha(brand.teal, 0.34) }]} />

        <View style={styles.headRow}>
          {heads.map((victim, index) => (
            <SettledHead
              key={victim.user_id ?? index}
              victim={victim}
              index={index}
              clock={clock}
              size={size}
              reduced={reduced}
              trigger={trigger}
              playToken={playToken}
            />
          ))}
          {extra > 0 ? (
            <Text style={[styles.extra, { color: colors.textMuted }]}>{`+${extra}`}</Text>
          ) : null}
        </View>

        {/* Centred, unless a long row of heads would run underneath it. */}
        <Animated.View
          style={[heads.length >= 5 ? styles.labelRight : styles.label, labelStyle]}
          pointerEvents="none"
        >
          <OutlinedText style={[toonType.label, styles.labelText]} outline={toon.ink} width={1.5}>
            {label}
          </OutlinedText>
          <AppIcon name="steal" size={17} style={styles.labelIcon} />
          {amount != null ? (
            <OutlinedText
              style={[toonType.sub, styles.labelAmount]}
              outline={toon.ink}
              width={2}
            >
              {String(amount)}
            </OutlinedText>
          ) : null}
        </Animated.View>
      </Animated.View>

      {!reduced && (
        <>
          <Bomb clock={clock} />
          <Explosion clock={clock} />
          {blastFx > 0 ? (
            <GameLottie name="bombBlast" size={150} trigger={blastFx} style={styles.lottieBlast} />
          ) : null}
          {heads.map((victim, index) => (
            <BurstHead
              key={`burst-${victim.user_id ?? index}`}
              victim={victim}
              clock={clock}
              index={index}
              size={size}
            />
          ))}
        </>
      )}
    </Pressable>
  );
}

// Tall enough to CONTAIN the whole blast rather than relying on overflow
// (Android clips children of a bounded parent): the bar sits at the bottom,
// and the bomb's peak — the highest thing here — is 131px above it.
const ROOT_H = 136;

const styles = StyleSheet.create({
  root: { height: ROOT_H, justifyContent: 'flex-end', overflow: 'visible' },
  lottieBlast: { position: 'absolute', left: '50%', top: -35, marginLeft: -75, zIndex: 8 },

  bar: {
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },

  slashLeft: {
    position: 'absolute',
    left: 10,
    width: 50,
    height: 1,
    transform: [{ rotate: '16deg' }],
  },
  slashRight: {
    position: 'absolute',
    right: 10,
    width: 50,
    height: 1,
    transform: [{ rotate: '-16deg' }],
  },

  headRow: {
    position: 'absolute',
    left: 13,
    height: 32,
    top: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackedHead: { position: 'absolute', left: 0, top: 0 },
  extra: { fontSize: 12, marginLeft: 2 },

  label: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelRight: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelText: { color: '#fff' },
  labelIcon: { marginLeft: 7 },
  labelAmount: { color: '#fff', marginLeft: 6 },

  bombAnchor: {
    position: 'absolute',
    zIndex: 30,
    left: '50%',
    bottom: 25,
    width: 48,
    height: 48,
    marginLeft: -24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bomb: {
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: BLAST.bomb,
    borderWidth: 2,
    borderColor: BLAST.bombEdge,
  },
  bombHighlight: {
    position: 'absolute',
    left: 8,
    top: 7,
    width: 9,
    height: 7,
    borderRadius: 5,
    backgroundColor: BLAST.bombHighlight,
    opacity: 0.72,
    transform: [{ rotate: '-22deg' }],
  },
  fuse: {
    position: 'absolute',
    right: -6,
    top: -10,
    width: 22,
    height: 5,
    borderRadius: 3,
    backgroundColor: BLAST.fuse,
    transform: [{ rotate: '-42deg' }],
  },
  fuseSparkOuter: {
    position: 'absolute',
    right: -7,
    top: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLAST.orange,
  },
  fuseSparkInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: BLAST.yellow },

  explosionAnchor: {
    position: 'absolute',
    zIndex: 25,
    left: '50%',
    bottom: 62,
    width: 1,
    height: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explosionFlash: {
    position: 'absolute',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
    backgroundColor: BLAST.white,
  },
  explosionCore: {
    position: 'absolute',
    width: 42,
    height: 42,
    marginLeft: -21,
    marginTop: -21,
    borderRadius: 12,
    backgroundColor: BLAST.orange,
    borderWidth: 5,
    borderColor: BLAST.yellow,
  },
  shockwaveRing: {
    position: 'absolute',
    width: 36,
    height: 36,
    marginLeft: -18,
    marginTop: -18,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: BLAST.yellow,
  },
  sparkRay: {
    position: 'absolute',
    width: 4,
    height: 22,
    marginLeft: -2,
    marginTop: -11,
    borderRadius: 3,
    backgroundColor: BLAST.yellow,
  },
  smokePuff: {
    position: 'absolute',
    backgroundColor: BLAST.smoke,
    borderWidth: 2,
    borderColor: BLAST.smokeInk,
  },

  burstAnchor: { position: 'absolute', zIndex: 20, left: '50%', bottom: 61 },
});
