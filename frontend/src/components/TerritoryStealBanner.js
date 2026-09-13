// TerritoryStealBanner — the four beats of a steal, played on one bar.
//
//   1. a bomb arcs up out of the territory bar and drops back onto it
//   2. it detonates, and the blast punches the STOLEN label onto the bar
//   3. the runners you hit are thrown out of the blast as their own heads
//   4. they land back in a row and keep pulling a sad face
//
// The detonation is DRAWN ART, not shapes: two sprite sheets out of the curated
// FX library play together off one trigger — `bomb_blast_01`, the fireball that
// erupts from the bar's top edge and rolls over into smoke and debris, and
// `impact_shock_01`, the shrapnel that sprays sideways along the bar underneath
// it. Both are anchored to the bar's top edge, which is where the bomb lands,
// so the three beats read as one hit rather than three effects in a stack.
//
// The heads are NOT pre-baked PNG pairs: PASER avatars are composited at
// runtime by CharacterRig, so a "sad" head is the same runner with the face
// slot swapped to `sad`. The rig draws both faces in the face's own place in
// the stack and cross-fades them (`altFace`), so hair, hat and colours can
// never jump between the two.
//
// One shared `clock` (0 → TIMING.total ms) drives every interpolation, which
// keeps the beats locked to each other no matter what the frame rate does.
// Reduce Motion skips straight to the settled bar.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { brand, fonts, toon, toonType, useTheme, withAlpha } from '../theme';
import EffectPlayer from '../effects/EffectPlayer';
import { haptic, useOnScreen, useReduceMotion } from '../ui/motion';
import AppIcon, { STEAL_ICON_SIZE } from './AppIcon';
import { CharacterBust } from './character/CharacterRig';
import { OutlinedText } from './ui';

const BLAST = {
  yellow: '#FFD84D',
  orange: '#FF8A30',
  bomb: '#17191C',
  bombEdge: '#050607',
  bombHighlight: '#545A61',
  fuse: '#7A5A32',
};

// Both sheets are drawn at their own pixel size: the fireball is a 128x80 frame
// and plays at 1:1, so nothing in it is resampled. The shrapnel is stretched to
// a flat 1.2x, which is a whole-pixel step and stays crisp.
export const STEAL_FX = {
  blast: { id: 'bomb_blast_01', width: 128, height: 80 },
  shock: { id: 'impact_shock_01', width: 168, height: 60 },
};

const TIMING = {
  total: 2850,

  bombStart: 0,
  bombPeak: 500,
  bombImpact: 640,

  // The sheets are triggered here and then run on their own clock: the fireball
  // is 10 frames at 14fps (714ms), the shrapnel 7 at 15fps (467ms).
  flashStart: 630,

  stolenStart: 720,
  stolenSettled: 1080,

  avatarBurstStart: 760,
  avatarBurstEnd: 1710,

  finalAvatarsStart: 1510,
  finalAvatarsSettled: 1930,

  faceLoopStart: 2050,
};

// Where each head is thrown. One path per head shown; the paths beyond the cap
// are kept because the cap is a display decision that has moved once already
// and may move again, and they cost nothing sitting here.
const PARTICLE_PATHS = [
  { x: -118, peak: 48, rotation: -22, delay: 0, scale: 0.92 },
  { x: 110, peak: 38, rotation: 20, delay: 55, scale: 1.0 },
  { x: -68, peak: 58, rotation: -14, delay: 110, scale: 0.84 },
  { x: 72, peak: 28, rotation: 13, delay: 165, scale: 0.78 },
  { x: -154, peak: 30, rotation: -28, delay: 220, scale: 0.7 },
  { x: 148, peak: 50, rotation: 26, delay: 275, scale: 0.74 },
];

/**
 * How many victims get a FACE. Everybody else is a count.
 *
 * FOUR. The old cap of two came from a centred label the heads had to stay
 * clear of — past two, the row of busts ran under "STOLEN" in the middle of
 * the bar. That constraint is gone: when a steal hits more than two runners
 * the label moves to the RIGHT edge (see `styles.labelRight`) and the heads
 * get the whole left half of the bar to themselves, so more of the people who
 * actually lost ground are shown as themselves rather than folded into a
 * `+N`. Anyone past the cap is still counted there, and every name is in the
 * accessibility label regardless.
 *
 * Four and not more because four full-size faces already fill that left half;
 * a fifth would have to shrink, and a shrunken PASER bust stops being legible
 * as a specific character — which is the whole reason to show a face at all.
 */
export const MAX_STEAL_HEADS = 4;

// The heads always draw at full size — the layout (heads left, label right
// once there are more than two) is what guarantees the row fits, so there is
// nothing left for a step-down to rescue.
const HEAD_SIZE = 31;

// ---------------------------------------------------------------------------
// The bomb (drawn, so it needs no asset)
// ---------------------------------------------------------------------------

function Bomb({ clock }) {
  const animatedStyle = useAnimatedStyle(() => {
    // It has to come back DOWN onto the bar: the blast sheet is a ground burst
    // with a flat bottom edge, and it erupts from where the bomb stopped.
    const translateY = interpolate(
      clock.value,
      [TIMING.bombStart, 140, TIMING.bombPeak, 590, TIMING.bombImpact],
      [12, -8, -58, -34, -17],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      clock.value,
      [TIMING.bombStart, 120, 300, 590, TIMING.bombImpact],
      [0, 1.14, 1, 1.04, 0],
      Extrapolation.CLAMP
    );
    const rotation = interpolate(
      clock.value,
      [0, 220, 410, 590, TIMING.bombImpact],
      [-8, 8, -7, 5, 0],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      clock.value,
      [0, 60, 590, TIMING.bombImpact],
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
// The blast — two sheets from the FX library, played off one trigger
// ---------------------------------------------------------------------------

function Blast({ token }) {
  return (
    <>
      <View pointerEvents="none" style={styles.shockAnchor}>
        <EffectPlayer effect={STEAL_FX.shock.id} size={STEAL_FX.shock.width} playToken={token} />
      </View>
      <View pointerEvents="none" style={styles.blastAnchor}>
        <EffectPlayer effect={STEAL_FX.blast.id} size={STEAL_FX.blast.width} playToken={token} />
      </View>
    </>
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
      {/* Decoded for the size it is drawn at, like the heads on the bar. It
          overshoots to 1.14 for a few frames of flight, which a bitmap sized
          for the bust carries without anybody seeing it. A full-resolution
          decode here meant eight 512px layers per head, taken at the very
          moment the blast is trying to play. */}
      <CharacterBust equipped={victim.avatar || {}} size={size} bg="transparent" />
    </Animated.View>
  );
}

// The head that stays on the bar, pulling a sad face on a loop — while the bar
// is on the screen being looked at. It matters more here than almost anywhere:
// a feed carries one of these per head per steal, Home stays mounted behind
// every other tab, and a sulk nobody can see is still a whole-tree commit on
// every frame it moves (see useOnScreen). `looping` is also off while the card
// is scrolled away inside the feed, which keeps two screens of rows either side
// mounted.
//
// ONE RUNNER PER HEAD. The sad face used to be a whole second bust stacked on
// this one and cross-faded, so every head was two complete rigs, and with the
// head thrown by the blast a four-victim steal carried thirteen rigs on one
// card. Only the FACE changes, so only the face is doubled, inside the rig. And
// no full-resolution decode: the bust passes 1.0 only during its entry, by 12%,
// for under half a second, and a 31pt head does not need eight 512px layers
// held in memory for that. A feed of steals was keeping hundreds of them.
function SettledHead({ victim, clock, index, size, reduced, looping, trigger, playToken }) {
  const faceMix = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(faceMix);
    faceMix.value = 0;
    if (reduced || !looping) return undefined;

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
  }, [faceMix, index, looping, reduced, trigger, playToken]);

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

  return (
    <Animated.View style={[{ width: size, height: size, marginRight: 4 }, entryStyle]}>
      <Animated.View style={[{ width: size, height: size }, reactionStyle]}>
        {/* No ring: on the bar the heads read as a row of faces, and a clan
            stroke around each one turned that into a row of bordered chips.
            The face alone is the thing that says who lost the ground. */}
        <CharacterBust
          equipped={victim.avatar || {}}
          size={size}
          bg="transparent"
          altFace="sad"
          altFaceMix={faceMix}
        />
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
 * @param {boolean} active         false while the bar is scrolled off screen
 *                                 inside a screen that IS focused (a feed row
 *                                 still mounted two screens away): the heads
 *                                 hold still. Focus itself is useOnScreen's.
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
  active = true,
}) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const clock = useSharedValue(0);
  const done = useRef(onComplete);
  done.current = onComplete;
  // 0 = settled, no blast. Bumped to replay; reset whenever the subject changes.
  const [playToken, setPlayToken] = useState(autoPlay ? 1 : 0);
  const [blastFx, setBlastFx] = useState(0);
  // Is a detonation playing? The bomb, the blast sheets and the thrown heads
  // exist only while one is. Settled, which is how a feed shows every steal but
  // at most one, they used to stay mounted at opacity zero: a hidden bomb and a
  // whole extra runner per head, on every card, for as long as it was mounted.
  const [bursting, setBursting] = useState(false);
  useEffect(() => { setPlayToken(autoPlay ? 1 : 0); }, [trigger, autoPlay]);

  const heads = useMemo(() => (victims || []).slice(0, MAX_STEAL_HEADS), [victims]);
  const sulking = useOnScreen(!reduced && heads.length > 0);
  // `useOnScreen` answers yes when it is not asked, so the row's own answer is
  // applied here rather than passed into it.
  const looping = sulking && active;
  const size = HEAD_SIZE;

  // The end of a play, called from the timing's worklet callback. One stable
  // function for the life of the banner, which reads the CURRENT callbacks
  // when it fires rather than the ones captured when the timing started.
  const settleRef = useRef(null);
  settleRef.current = () => {
    setBursting(false);
    done.current?.();
  };
  const settle = useCallback(() => settleRef.current?.(), []);

  useEffect(() => {
    cancelAnimation(clock);

    if (reduced || playToken === 0) {
      // Straight to the settled bar: label on, heads in place, no blast.
      clock.value = TIMING.total;
      settle();
      return undefined;
    }

    // The sheets mount at the flash, not now: a player mounted with the last
    // play's token would go off before the bomb has landed.
    setBlastFx(0);
    setBursting(true);
    clock.value = 0;
    clock.value = withTiming(
      TIMING.total,
      { duration: TIMING.total, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(settle)();
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
  }, [clock, haptics, playToken, reduced, settle]);

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
              looping={looping}
              trigger={trigger}
              playToken={playToken}
            />
          ))}
          {extra > 0 ? (
            <Text style={[styles.extra, { color: colors.textMuted }]}>{`+${extra}`}</Text>
          ) : null}
        </View>

        {/* Centred for one or two heads; shoved to the right edge once there
            are more, so the row of faces on the left never runs under it. */}
        <Animated.View
          style={[heads.length > 2 ? styles.labelRight : styles.label, labelStyle]}
          pointerEvents="none"
        >
          <OutlinedText style={[toonType.label, styles.labelText]} outline={toon.ink} width={1.5}>
            {label}
          </OutlinedText>
          {/* Bigger than the shared STEAL_ICON_SIZE (26), same reasoning as
              TerritoryVictoryBeat's own steal icon: this banner IS the
              celebratory moment, not a chip in a list — sized directly so
              the notifications-inbox icon (which also reads STEAL_ICON_SIZE)
              is untouched. */}
          <AppIcon name="steal" size={STEAL_ICON_SIZE * 1.6} style={styles.labelIcon} />
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

      {!reduced && bursting && (
        <>
          <Bomb clock={clock} />
          {blastFx > 0 ? <Blast token={blastFx} /> : null}
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
const BAR_H = 46;

/**
 * The transparent stage above the bar, in points.
 *
 * It is real layout — it has to be, or Android clips the fireball — but it is
 * EMPTY, so anything stacking this under something else has to pay for it and
 * gets nothing back. On a feed card that was 90pt of white between the route
 * and the bar, which read as the card having forgotten to draw something.
 *
 * Pull the banner up by this much and the blast plays over whatever is above
 * it instead of over a reserved hole. The bar itself does not move.
 */
export const STEAL_HEADROOM = ROOT_H - BAR_H;

const styles = StyleSheet.create({
  root: { height: ROOT_H, justifyContent: 'flex-end', overflow: 'visible' },

  bar: {
    height: BAR_H,
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
  // Reads beside two full-size heads rather than after six shrunken ones,
  // so it carries the whole remainder and is sized to be noticed.
  extra: { fontSize: 13, marginLeft: 4, fontFamily: fonts.bold },

  label: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // More than two heads: the label leaves the centre and anchors to the right
  // edge, handing the busts the left half of the bar. Vertically centred with
  // top/bottom rather than the static position the centred variant relies on.
  labelRight: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelText: { color: '#fff' },
  labelIcon: { marginLeft: 8, marginVertical: -4 },
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

  // The blast sheet is a GROUND burst: its flat bottom edge is the bar's top
  // edge, 46px up, and it is drawn 4px into the bar so the two never separate
  // by a hairline. 80px of art above that leaves the 136px root uncropped,
  // which matters on Android, where a bounded parent clips its children.
  blastAnchor: {
    position: 'absolute',
    zIndex: 25,
    left: '50%',
    bottom: 42,
    width: STEAL_FX.blast.width,
    height: STEAL_FX.blast.height,
    marginLeft: -STEAL_FX.blast.width / 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // The shrapnel sprays sideways from the same point, under the fireball, so it
  // is centred on the bar's edge rather than sitting on it.
  shockAnchor: {
    position: 'absolute',
    zIndex: 24,
    left: '50%',
    bottom: 46 - STEAL_FX.shock.height / 2,
    width: STEAL_FX.shock.width,
    height: STEAL_FX.shock.height,
    marginLeft: -STEAL_FX.shock.width / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  burstAnchor: { position: 'absolute', zIndex: 20, left: '50%', bottom: 61 },
});
