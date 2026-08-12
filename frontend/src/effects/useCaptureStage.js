// The stage: what "camera" means when you cannot move the camera.
//
// A capture style asks for zooms, whips and tilts. None of those can touch the
// real Mapbox camera, and that is a hard constraint rather than a shortcut.
// The reveal is screen-space: the claim's polygon is projected from lat/lng to
// pixels ONCE, from a camera that has been levelled and allowed to stop (see
// the note on runReplayLevel in claim/timing.js and useClaimReveal.focus). Move
// the camera after that projection and every overlay is drawing the wrong
// ground — which is the bug the flyover's tilt-unwind exists to prevent.
//
// So a camera cue transforms the OVERLAY STACK instead: the reveal, the actor
// and the effects, together, in one wrapper. The map underneath does not move.
// At 1.1x over 300ms that still reads as a push, because everything that is
// moving is on the stage and the ground is a backdrop. It is a real limit
// though, and worth knowing before tuning: a slow zoom on a static map is the
// one cue here that can look like a zooming overlay rather than a camera.
//
// One hook, one wrapper, so a shake cannot rattle the sprites while leaving
// the ground they are standing on still — which is what happened when the
// shake lived inside CaptureStylePlayer and the reveal canvas was its sibling.

import { useCallback, useMemo, useRef } from 'react';
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CAMERA_ACTION } from './choreography';

const REST = { scale: 1, rotate: 0, x: 0, y: 0 };

export default function useCaptureStage(reducedMotion = false) {
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const offsetY = useSharedValue(0);

  // Where the stage should return to after a transient cue. A punch inside a
  // held zoom has to settle back to the ZOOM, not to 1 — otherwise the first
  // impact of a style silently cancels its own framing.
  const hold = useRef(REST.scale);

  const stop = useCallback(() => {
    [shakeX, shakeY, scale, rotate, offsetY].forEach(cancelAnimation);
  }, [offsetY, rotate, scale, shakeX, shakeY]);

  const reset = useCallback(() => {
    stop();
    hold.current = REST.scale;
    shakeX.value = 0;
    shakeY.value = 0;
    scale.value = 1;
    rotate.value = 0;
    offsetY.value = 0;
  }, [offsetY, rotate, scale, shakeX, shakeY, stop]);

  /** A rattle on whichever axis the style asked for. */
  const runShake = useCallback((step) => {
    if (reducedMotion) return;
    const amount = 7 * (step.intensity || 1);
    // Sideways reads as an impact from the side, up-and-down as something
    // landing, both as a detonation — three events out of one primitive. The
    // sequence chooses; the stage does not decide for it.
    const rattle = (factor) => withSequence(
      withTiming(-amount * factor, { duration: 42, easing: Easing.linear }),
      withTiming(amount * factor, { duration: 55, easing: Easing.linear }),
      withTiming(-amount * 0.45 * factor, { duration: 50, easing: Easing.linear }),
      withTiming(0, { duration: 65, easing: Easing.out(Easing.quad) })
    );
    const axis = step.axis || 'x';
    if (axis === 'x' || axis === 'both') shakeX.value = rattle(1);
    if (axis === 'y' || axis === 'both') shakeY.value = rattle(axis === 'both' ? 0.7 : 1);
  }, [reducedMotion, shakeX, shakeY]);

  /** A scene move. */
  const runCamera = useCallback((step) => {
    if (reducedMotion) return;
    const duration = step.duration || 300;
    switch (step.name) {
      case CAMERA_ACTION.ZOOM_IN:
      case CAMERA_ACTION.ZOOM_OUT: {
        // Holds until something releases it. validateChoreography rejects a
        // style that never does, so the victory beat can never inherit a
        // zoomed stage.
        const to = step.amount || (step.name === CAMERA_ACTION.ZOOM_IN ? 1.08 : 0.94);
        hold.current = to;
        scale.value = withTiming(to, { duration, easing: Easing.inOut(Easing.cubic) });
        break;
      }
      case CAMERA_ACTION.PUNCH_IN: {
        // The only cue that moves the scene in depth quickly. Settles back to
        // whatever the current hold is.
        const base = hold.current;
        const to = base * (step.amount || 1.1);
        scale.value = withSequence(
          withTiming(to, { duration: 90, easing: Easing.out(Easing.quad) }),
          withTiming(base - (to - base) * 0.3, { duration: 130, easing: Easing.inOut(Easing.quad) }),
          withTiming(base, { duration: 160, easing: Easing.out(Easing.quad) })
        );
        break;
      }
      case CAMERA_ACTION.WHIP_DOWN:
      case CAMERA_ACTION.WHIP_UP: {
        // Following something fast. The overshoot and the return are both
        // short; a slow whip is just a pan.
        const sign = step.name === CAMERA_ACTION.WHIP_DOWN ? 1 : -1;
        const amount = (step.amount || 26) * sign;
        offsetY.value = withSequence(
          withTiming(-amount * 0.35, { duration: duration * 0.25, easing: Easing.out(Easing.quad) }),
          withTiming(amount, { duration: duration * 0.4, easing: Easing.inOut(Easing.cubic) }),
          withTiming(0, { duration: duration * 0.35, easing: Easing.out(Easing.quad) })
        );
        break;
      }
      case CAMERA_ACTION.TILT: {
        const amount = step.amount || 2;
        rotate.value = withSequence(
          withTiming(amount, { duration: duration * 0.4, easing: Easing.inOut(Easing.quad) }),
          withTiming(-amount * 0.5, { duration: duration * 0.3, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: duration * 0.3, easing: Easing.out(Easing.quad) })
        );
        break;
      }
      case CAMERA_ACTION.FREEZE: {
        // Everything stops where it is. This is the beat before an implosion
        // lands, and it only works if nothing is still easing underneath it.
        stop();
        break;
      }
      case CAMERA_ACTION.RELEASE: {
        hold.current = REST.scale;
        scale.value = withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) });
        rotate.value = withTiming(0, { duration, easing: Easing.out(Easing.quad) });
        offsetY.value = withTiming(0, { duration, easing: Easing.out(Easing.quad) });
        break;
      }
      default:
        break;
    }
  }, [offsetY, reducedMotion, rotate, scale, stop]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: shakeX.value },
      { translateY: shakeY.value + offsetY.value },
      { rotate: `${rotate.value}deg` },
      { scale: scale.value },
    ],
  }));

  return useMemo(
    () => ({ style, runShake, runCamera, reset, stop }),
    [reset, runCamera, runShake, stop, style]
  );
}
