// The greeting — what happens when somebody NEW turns up in your plaza.
//
// It used to be a WAVE. Up to six newcomers hopped in at once, 240 ms apart,
// each landing with a jump while your own runner jumped back on a throttle
// that swallowed most of them. Six people arriving in a second and a half is
// not six arrivals; it is a flock landing, and nobody in it was anybody.
//
// Now it is a CEREMONY, and it is one person at a time:
//
//   1. the plaza dims. Everybody already standing there goes under a scrim,
//      which leaves exactly two characters lit — the newcomer and YOU.
//   2. they walk on, slower than the old hop and in the same three arcs, up
//      the near path from off the side of the frame.
//   3. you MEET. Both of you jump, both of you laugh (CharacterRig's
//      `celebrate` is one gesture that does both), on the same frame rather
//      than a beat apart.
//   4. it goes off. A burst fires where they landed, picked by how well you
//      know them — see `RUNG_BURST` — so a first crossing and a local legend
//      do not arrive to the same firework.
//   5. they drop back under the scrim and join the crowd, and the next
//      newcomer steps up.
//
// The scrim comes down ONCE at the top and lifts ONCE at the end. Dimming and
// undimming between every beat reads as a strobe; leaving it down is what
// turns each arrival into its own lit moment, because a runner who has landed
// dims as the next one lights up.
//
// THREE OF THEM, and it is skippable. Ceremony costs time — about 1.8 s each —
// and a plaza that has been saving up thirty new faces must not make you watch
// a receiving line. Past `MAX_ARRIVALS` the rest are simply standing there when
// you look up, and a tap anywhere on the scrim ends the whole thing at once.
//
// Under Reduce Motion none of this runs: no scrim, no walk on, no burst.
// Everybody is already standing in the square. Same rule as everywhere else
// (see ui/motion.js).

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import GameAnimation from '../GameAnimation';
import { animationSpec } from '../../config/gameAnimations';

// The walk on, from off frame to standing on their own paving spot. 1180 ms
// against the old 920: the trip is the same three hops, taken at a pace you
// can watch somebody arrive at rather than one that reads as a card being
// dealt onto the table.
export const ARRIVE_MS = 1180;
// How long the two of you hold the meeting before the next newcomer starts
// walking. The jump itself is 380 ms of the rig's own animation, so this is
// that plus a breath.
export const MEET_MS = 640;
// Past this many, the rest are already standing there. See the header.
export const MAX_ARRIVALS = 3;

// The shape of the walk itself, kept here with the timing it belongs to.
// Three arcs with a real landing between each; the trip shrinks them as it
// goes because the approach path is nearer the camera than the paving is —
// the same perspective `plazaDepth` gives the standing crowd, in motion.
// Without it they slid across the picture at a fixed size and read as a
// sticker being dragged.
export const HOPS = 3;
export const HOP_RISE = 0.15;
export const HOP_SCALE = 0.24;

// How big the burst is drawn, as a multiple of the newcomer's body width. It
// has to read as going off AROUND them rather than as a badge pinned to their
// chest, and they are a 30-40pt character.
export const BURST_SCALE = 3.4;

// The app's darkest ink rather than pure black, and at a little over half:
// the plaza is painted art in full sun, and a wash heavy enough to black it
// out would leave the two lit characters standing in a hole rather than in a
// square with the lights turned down. Same colour and same reasoning as the
// capture cutscene's map scrim (components/claim/CutsceneBackdrop.js).
const SCRIM_COLOR = '#05070C';
const SCRIM_OPACITY = 0.58;
const SCRIM_IN_MS = 320;
const SCRIM_OUT_MS = 460;

// WHICH firework, by how well you know them. The familiarity ladder already
// exists and is already coloured on the runner's card (`RUNG_COLOR` in
// CrossroadsScreen), so an arrival can be told apart by the same rung rather
// than by a second scale invented for it. A stranger you passed once gets a
// sparkle; somebody you cross every week gets the confetti.
const RUNG_BURST = {
  crossed_paths: 'sparkleStar',
  familiar_face: 'sparklesGreen',
  running_regular: 'confettiBurst',
  local_legend: 'confettiRibbons',
};

/** The burst a given runner arrives to. */
export function arrivalBurst(encounter) {
  return RUNG_BURST[encounter?.familiarity] || RUNG_BURST.crossed_paths;
}

// How long a burst is left on screen. It outlives its own beat on purpose —
// it is still fading where the last runner landed while the next one walks in,
// which is what stops three arrivals reading as three identical cycles.
//
// MEASURED off the assets rather than picked, because the four in `RUNG_BURST`
// run from 1970 ms to 2900 ms and a flat hold cut the long one off mid-play.
// Swapping any of them for a longer clip now moves this with it.
export const BURST_MS =
  Math.max(...Object.values(RUNG_BURST).map((name) => animationSpec(name)?.duration || 0)) + 140;

/**
 * The dim. An absolute-fill wash that the caller stacks BETWEEN the standing
 * crowd and the pair having the moment — which is why it takes a `style`: the
 * z-order is the caller's geometry, not this component's.
 *
 * It is also the skip control. While it is up it takes touches, so a tap
 * anywhere on the dimmed plaza ends the ceremony; while it is down it takes
 * none, and the plaza is a plaza again.
 */
export default function ArrivalSpotlight({ on, onSkip, style }) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(on ? SCRIM_OPACITY : 0, {
      duration: on ? SCRIM_IN_MS : SCRIM_OUT_MS,
      easing: on ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
    });
  }, [on, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.scrim, style, fade]}
      pointerEvents={on ? 'auto' : 'none'}
    >
      {on ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip the arrivals"
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * The thing that goes off when you meet. Centred on a point of the PLAZA that
 * the caller measured (`plazaPoint`), not on a fraction of the screen, so it
 * lands on the character at any screen shape.
 *
 * `token` replays it: `GameAnimation` remounts on a changed trigger, which is
 * the only way to play a WebP again from frame one.
 */
export function MeetingBurst({ name, x, y, size, token }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.burst, { left: x - size / 2, top: y - size / 2, width: size, height: size }]}
    >
      <GameAnimation name={name} size={size} trigger={token} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: SCRIM_COLOR },
  // Over the dim and over the pair having the moment — see `crowd` in
  // screens/CrossroadsScreen for the whole stack.
  burst: { position: 'absolute', zIndex: 3, alignItems: 'center', justifyContent: 'center' },
});
