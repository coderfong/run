// The capture encounter — the moment the ground changes hands, played out on
// the map with the real runners involved.
//
// Characters are composed at runtime by CharacterBust from live cosmetics, not
// static sprites: the attacker is whatever the player is actually wearing, and
// the defenders are the avatars the claim response returned for the people
// they just took land from. An "expression" is a face-slot swap (see
// expressions.js), so nobody's hair or hat jumps between beats.
//
// Three variants, all playful arcade contact — a shoulder-check, not violence:
//
//   grin-knock  the default: size them up, wind up, dash, knock them spinning
//   bonk        a hop and a squash-and-stretch pop
//   chomp       cartoon and abstract: they shrink in behind the attacker
//
// With no defenders this becomes the empty-ground landing beat instead: the
// attacker drops onto the claim point and plants themselves there.
//
// `onImpact` fires at CONTACT, not at the end — the territory reveal starts on
// it, and the defenders finish leaving over the top of the reveal.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '../../ui/motion';
import { CharacterBust } from '../character/CharacterRig';
import { attackerFace, defenderFace, withFace } from './expressions';
import { timingFor } from './timing';
import GameLottie from '../GameLottie';

// The scene box the whole encounter is laid out in. Clamped so no part of it
// leaves the map card.
const SCENE = { width: 224, height: 148 };
const ATTACKER_SIZE = 60;
const DEFENDER_SIZE = 40;
// Three characters is the cap; beyond that the rest become a +N badge. More
// than three full composed rigs on a map is both unreadable and expensive.
const MAX_DEFENDERS = 3;

const SPARK = { white: '#FFFFFF' };

// Beat offsets from the start of the encounter, derived from the shared
// timing table so retuning one place retunes the component.
function buildSchedule(T, isLanding) {
  if (isLanding) {
    const impact = T.emptyLanding;
    return { defenders: 0, grin: 0, anticipate: 0, dash: 0, impact, end: impact + T.handoff };
  }
  const grin = T.encounterIntro;
  const anticipate = grin + T.grinHold;
  const dash = anticipate + T.attackAnticipation;
  const impact = dash + T.attackDash;
  return {
    defenders: Math.round(T.encounterIntro * 0.55),
    grin,
    anticipate,
    dash,
    impact,
    end: impact + T.defenderExit,
  };
}

// Keep the scene inside the map card so nobody is clipped by its edges.
function clampOrigin(point, bounds) {
  if (!bounds?.width || !bounds?.height) return point;
  const halfW = SCENE.width / 2;
  const halfH = SCENE.height / 2;
  // A map card narrower than the scene can't satisfy both margins — centring
  // is the least-bad answer, and Math.max keeps the range non-inverted.
  const minX = Math.min(halfW + 6, bounds.width / 2);
  const maxX = Math.max(minX, bounds.width - halfW - 6);
  const minY = Math.min(halfH + 6, bounds.height / 2);
  const maxY = Math.max(minY, bounds.height - halfH - 6);
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  };
}

// ---------------------------------------------------------------------------
// One defender
// ---------------------------------------------------------------------------

function Defender({ defender, index, variant, schedule, reducedMotion, playToken, registerTimer }) {
  const offsetX = 108 + index * 26;
  const offsetY = index % 2 === 0 ? 6 : -14;

  const translateX = useSharedValue(offsetX);
  const translateY = useSharedValue(offsetY);
  const scale = useSharedValue(0);
  const rotation = useSharedValue(0);
  const opacity = useSharedValue(0);
  const [struck, setStruck] = useState(false);

  useEffect(() => {
    setStruck(false);
    translateX.value = offsetX;
    translateY.value = offsetY;
    rotation.value = 0;
    scale.value = 0;
    opacity.value = 0;

    const appearAt = schedule.defenders + index * 60;
    const exit = schedule.impact;
    // A shared value holds ONE animation — a second assignment in the same
    // tick cancels the first. Appear and exit therefore have to be a single
    // chain per value, with an explicit hold between them, and the hold has to
    // be computed from fixed durations so it lands exactly on the impact beat.
    const appearDur = reducedMotion ? 90 : 140;
    const hold = Math.max(0, exit - appearAt - appearDur);

    registerTimer(setTimeout(() => setStruck(true), exit));

    if (reducedMotion) {
      opacity.value = withDelay(
        appearAt,
        withSequence(
          withTiming(1, { duration: appearDur }),
          withDelay(hold, withTiming(0, { duration: 140 }))
        )
      );
      scale.value = withDelay(appearAt, withTiming(1, { duration: appearDur }));
      return;
    }

    // Arrive with a small overshoot so they read as "planted here already".
    // Easing.back gives the overshoot without a spring's open-ended duration,
    // which is what keeps the chain in step with the schedule.
    opacity.value = withDelay(
      appearAt,
      withSequence(
        withTiming(1, { duration: appearDur }),
        withDelay(hold + (variant === 'chomp' ? 200 : 260), withTiming(0, { duration: 150 }))
      )
    );

    // The overshoot arrival, shared by every variant. Only chomp animates
    // scale again on exit, so only chomp continues this chain.
    const arrive = withTiming(1, {
      duration: appearDur,
      easing: Easing.out(Easing.back(2.2)),
    });

    if (variant === 'chomp') {
      // Shrink in towards the attacker and vanish behind them. No chewing,
      // no detail — the joke is that they're simply gone.
      translateX.value = withDelay(
        exit,
        withTiming(8, { duration: 260, easing: Easing.in(Easing.cubic) })
      );
      translateY.value = withDelay(exit, withTiming(6, { duration: 260 }));
      scale.value = withDelay(
        appearAt,
        withSequence(
          arrive,
          withDelay(hold, withTiming(0, { duration: 260, easing: Easing.in(Easing.back(1.4)) }))
        )
      );
    } else if (variant === 'bonk') {
      // Popped straight up, then out.
      scale.value = withDelay(appearAt, arrive);
      translateY.value = withDelay(
        exit,
        withSequence(
          withTiming(-58 - index * 6, { duration: 190, easing: Easing.out(Easing.quad) }),
          withTiming(70, { duration: 260, easing: Easing.in(Easing.quad) })
        )
      );
      translateX.value = withDelay(
        exit,
        withTiming(offsetX + 60, { duration: 450, easing: Easing.out(Easing.cubic) })
      );
      rotation.value = withDelay(exit, withTiming(index % 2 === 0 ? 220 : -200, { duration: 450 }));
    } else {
      // grin-knock: knocked away diagonally, spinning, fading out.
      scale.value = withDelay(appearAt, arrive);
      translateX.value = withDelay(
        exit,
        withTiming(offsetX + 118 + index * 24, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
        })
      );
      translateY.value = withDelay(
        exit,
        withSequence(
          withTiming(offsetY - 40 - index * 6, { duration: 140 }),
          withTiming(offsetY + 72, { duration: 280, easing: Easing.in(Easing.quad) })
        )
      );
      rotation.value = withDelay(
        exit,
        withTiming(index % 2 === 0 ? 300 : -260, { duration: 420 })
      );
    }
  }, [playToken, variant, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
  }));

  const reactionKey = struck ? defenderFace(variant, 'impact') : null;
  const equipped = useMemo(
    () => (reactionKey ? withFace(defender.avatar, reactionKey) : defender.avatar || {}),
    [defender.avatar, reactionKey]
  );

  return (
    <Animated.View style={[styles.defender, style]} pointerEvents="none">
      <CharacterBust
        equipped={equipped}
        size={DEFENDER_SIZE}
        ring={defender.clan_color?.stroke}
        bg="rgba(21,24,29,0.9)"
      />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------

export default function CaptureEncounter({
  visible,
  variant = 'grin-knock',
  attacker,
  defenders = [],
  claimScreenPoint,
  bounds,
  onImpact,
  onComplete,
  reducedMotion = false,
  playToken = 0,
}) {
  const T = timingFor(reducedMotion);
  const shown = useMemo(() => (defenders || []).slice(0, MAX_DEFENDERS), [defenders]);
  const overflow = Math.max(0, (defenders?.length || 0) - shown.length);
  const isLanding = shown.length === 0;
  const schedule = useMemo(() => buildSchedule(T, isLanding), [T, isLanding]);

  // Callbacks change identity every render in the parent; refs keep the
  // timeline effect from re-running (and re-firing impact) because of it.
  const impactRef = useRef(onImpact);
  const completeRef = useRef(onComplete);
  impactRef.current = onImpact;
  completeRef.current = onComplete;

  // Every timer this component starts, so unmount can't leave one running.
  const timers = useRef(new Set());
  const registerTimer = useCallback((id) => {
    timers.current.add(id);
    return id;
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const translateX = useSharedValue(-96);
  const translateY = useSharedValue(0);
  const scaleX = useSharedValue(0.8);
  const scaleY = useSharedValue(0.8);
  const opacity = useSharedValue(0);
  const streakOpacity = useSharedValue(0);

  const [beat, setBeat] = useState('intro');
  const [impactFx, setImpactFx] = useState(0);

  useEffect(() => {
    if (!visible || !claimScreenPoint) return undefined;
    clearTimers();
    setBeat('intro');

    streakOpacity.value = 0;

    const fireImpact = () => {
      haptic.medium();
      setImpactFx((token) => token + 1);
      impactRef.current?.();
    };

    if (isLanding) {
      // Empty ground: drop in from above and stick the landing on the point.
      translateX.value = -8;
      translateY.value = reducedMotion ? 0 : -84;
      scaleX.value = 0.8;
      scaleY.value = 0.8;
      opacity.value = withTiming(1, { duration: 90 });

      if (reducedMotion) {
        scaleX.value = withTiming(1, { duration: 140 });
        scaleY.value = withTiming(1, { duration: 140 });
      } else {
        translateY.value = withSequence(
          withTiming(4, { duration: T.emptyLanding - 90, easing: Easing.in(Easing.quad) }),
          withSpring(0, { damping: 11, stiffness: 300, mass: 0.5 })
        );
        // Squash on touchdown, then recover.
        scaleX.value = withSequence(
          withTiming(0.94, { duration: T.emptyLanding - 90 }),
          withTiming(1.16, { duration: 70 }),
          withSpring(1, { damping: 12, stiffness: 300, mass: 0.45 })
        );
        scaleY.value = withSequence(
          withTiming(1.08, { duration: T.emptyLanding - 90 }),
          withTiming(0.8, { duration: 70 }),
          withSpring(1, { damping: 12, stiffness: 300, mass: 0.45 })
        );
      }

      registerTimer(setTimeout(() => {
        setBeat('victory');
        fireImpact();
      }, schedule.impact));
      registerTimer(setTimeout(() => completeRef.current?.(), schedule.end));
      return clearTimers;
    }

    // --- occupied ground -------------------------------------------------
    translateX.value = -96;
    translateY.value = 4;
    scaleX.value = 0.8;
    scaleY.value = 0.8;
    opacity.value = withTiming(1, { duration: 90 });

    if (reducedMotion) {
      // No dash, no wind-up — arrive, land the beat, move on.
      translateX.value = withTiming(-18, { duration: T.encounterIntro });
      scaleX.value = withTiming(1, { duration: T.encounterIntro });
      scaleY.value = withTiming(1, { duration: T.encounterIntro });
      registerTimer(setTimeout(() => setBeat('attack'), schedule.dash));
      registerTimer(setTimeout(fireImpact, schedule.impact));
      registerTimer(setTimeout(() => completeRef.current?.(), schedule.end));
      return clearTimers;
    }

    // Each shared value gets exactly ONE chained assignment covering all of
    // its beats — a second assignment would cancel the first outright. Fixed
    // durations (not springs) carry the timed section so the chain stays in
    // lockstep with `schedule`; springs only ever finish a chain.
    const introDur = T.encounterIntro;
    const holdDur = T.grinHold;
    const antDur = T.attackAnticipation;
    const dashDur = T.attackDash;
    const dashTarget = variant === 'chomp' ? -4 : 44;

    // 1 → 4 → 5 → 10. enter, hold, wind back, dash, rebound and settle
    translateX.value = withSequence(
      withTiming(-46, { duration: introDur, easing: Easing.out(Easing.back(1.4)) }),
      withTiming(-46, { duration: holdDur }),
      withTiming(-58, { duration: antDur, easing: Easing.out(Easing.quad) }),
      withTiming(dashTarget, { duration: dashDur, easing: Easing.in(Easing.cubic) }),
      withSpring(14, { damping: 12, stiffness: 210, mass: 0.55 })
    );

    // bonk hops through the hit; the others stay grounded.
    translateY.value =
      variant === 'bonk'
        ? withSequence(
            withTiming(4, { duration: introDur + holdDur + antDur }),
            withTiming(-26, { duration: dashDur * 0.6, easing: Easing.out(Easing.quad) }),
            withTiming(4, { duration: dashDur * 0.4, easing: Easing.in(Easing.quad) }),
            withSpring(0, { damping: 11, stiffness: 260, mass: 0.5 })
          )
        : withTiming(4, { duration: introDur, easing: Easing.out(Easing.quad) });

    // Squash and stretch through contact.
    scaleX.value = withSequence(
      withTiming(1, { duration: introDur, easing: Easing.out(Easing.back(1.4)) }),
      withTiming(1, { duration: holdDur + antDur }),
      withTiming(1.14, { duration: dashDur }),
      withTiming(0.86, { duration: 90 }),
      withSpring(1, { damping: 13, stiffness: 280, mass: 0.45 })
    );
    scaleY.value = withSequence(
      withTiming(1, { duration: introDur, easing: Easing.out(Easing.back(1.4)) }),
      withTiming(1, { duration: holdDur + antDur }),
      withTiming(0.88, { duration: dashDur }),
      withTiming(1.14, { duration: 90 }),
      withSpring(1, { damping: 13, stiffness: 280, mass: 0.45 })
    );

    // 3. the look — smug, held, so the wind-up has a reason
    registerTimer(setTimeout(() => setBeat('grin'), schedule.grin));

    // 5 + 8. the dash, and the speed streaks behind it
    registerTimer(setTimeout(() => {
      setBeat('attack');
      streakOpacity.value = withSequence(
        withTiming(1, { duration: 60 }),
        withTiming(0, { duration: 260 })
      );
    }, schedule.dash));

    // 6/7/8. contact: callback, haptic, burst
    registerTimer(setTimeout(fireImpact, schedule.impact));
    registerTimer(setTimeout(() => setBeat('victory'), schedule.impact + 180));
    registerTimer(setTimeout(() => completeRef.current?.(), schedule.end));

    return clearTimers;
  }, [visible, playToken, variant, isLanding, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const attackerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
    ],
  }));

  const streakStyle = useAnimatedStyle(() => ({ opacity: streakOpacity.value }));

  const faceKey = attackerFace(variant, beat === 'grin' ? 'intro' : beat);
  const attackerEquipped = useMemo(() => withFace(attacker, faceKey), [attacker, faceKey]);

  if (!visible || !claimScreenPoint) return null;

  const origin = clampOrigin(claimScreenPoint, bounds);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.scene,
        { left: origin.x - SCENE.width / 2, top: origin.y - SCENE.height / 2 },
      ]}
    >
      {impactFx > 0 ? (
        <GameLottie name="captureImpact" size={138} trigger={impactFx} style={styles.impactLottie} />
      ) : null}

      {shown.map((defender, index) => (
        <Defender
          key={defender.id || defender.user_id || index}
          defender={defender}
          index={index}
          variant={variant}
          schedule={schedule}
          reducedMotion={reducedMotion}
          playToken={playToken}
          registerTimer={registerTimer}
        />
      ))}

      {overflow > 0 && (
        <View style={styles.overflowBadge}>
          <Text style={styles.overflowText}>{`+${overflow}`}</Text>
        </View>
      )}

      {/* speed streaks trailing the dash */}
      {!reducedMotion && (
        <Animated.View style={[styles.streaks, streakStyle]} pointerEvents="none">
          <View style={[styles.streak, { top: 6, width: 26 }]} />
          <View style={[styles.streak, { top: 18, width: 38 }]} />
          <View style={[styles.streak, { top: 30, width: 20 }]} />
        </Animated.View>
      )}

      <Animated.View style={[styles.attacker, attackerStyle]} pointerEvents="none">
        <CharacterBust
          equipped={attackerEquipped}
          size={ATTACKER_SIZE}
          bg="rgba(21,24,29,0.92)"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    position: 'absolute',
    width: SCENE.width,
    height: SCENE.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attacker: {
    position: 'absolute',
    left: SCENE.width / 2 - ATTACKER_SIZE / 2,
    top: SCENE.height / 2 - ATTACKER_SIZE / 2,
  },
  defender: {
    position: 'absolute',
    left: SCENE.width / 2 - DEFENDER_SIZE / 2,
    top: SCENE.height / 2 - DEFENDER_SIZE / 2,
  },
  impactLottie: { position: 'absolute', zIndex: 2 },
  streaks: {
    position: 'absolute',
    left: SCENE.width / 2 - 74,
    top: SCENE.height / 2 - 20,
    width: 44,
    height: 44,
  },
  streak: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    backgroundColor: SPARK.white,
    opacity: 0.8,
  },
  overflowBadge: {
    position: 'absolute',
    left: SCENE.width / 2 + 76,
    top: SCENE.height / 2 - 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
    backgroundColor: 'rgba(21,24,29,0.92)',
  },
  overflowText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
