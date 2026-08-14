// The cast: everybody who is in this claim, each with their own body.
//
// The thing this replaces is the reason every capture looked the same. Rivals
// used to be handled by CaptureEncounter, which ran ONE choreography — get
// bumped, spin off screen — before any style played, and then deleted them. So
// a meteor, a paint bomb and a black hole all opened with a shoulder-check, and
// by the time the style's own event happened there was nobody left for it to
// happen to.
//
// Here they are cast members. Every defender the claim returned is mounted,
// stays mounted, and leaves only when the choreography says they leave. What
// they do is decided by the STYLE, addressed by role and index:
//
//     cast.play({ role: 'defender', index: 1, name: 'dodgeLeft' })
//
// Two properties are load-bearing:
//
//   * one Reanimated body per character, never a shared container. Each
//     ClaimActor owns its own shared values, so defender 0 can be mid-dodge
//     while defender 2 is still bracing. Moving the group as one view was the
//     other half of the old sameness: three people cannot react individually
//     to anything if they are one transform.
//   * positions come from OUTSIDE. The parent lays the cast out once with
//     `layoutDefenders` and passes the same rects both here and into the
//     anchor context, so `defender[1].head` resolves to the head of the rig
//     that is actually drawn there. Computing them in two places is how an
//     effect ends up aimed at where somebody nearly is.
//
// Characters are composed at runtime by CharacterBust from live cosmetics, so
// the attacker is whatever the player is wearing and the defenders are the
// avatars the claim response returned. No pose sprites, no new art.

import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import ClaimActor, { ACTOR_SIZE } from './ClaimActor';
import { ROLE } from './choreography';
import { CAPTURE_LAYER } from './layers';
import { faceForAction } from '../components/claim/expressions';

// RETUNED 2026-08-14 alongside ACTOR_SIZE, twice — see the note there. Kept
// smaller than the attacker so the runner still reads as the one the scene is
// about.
export const DEFENDER_SIZE = 72;

const CaptureCast = React.forwardRef(function CaptureCast(
  {
    attacker,
    attackerPoint,
    attackerVisible = true,
    defenders = [],
    defenderRects = [],
    bounds,
    reducedMotion = false,
    fadeIn = 0,
  },
  ref
) {
  const attackerRef = useRef(null);
  // A ref per defender, allocated up front so `play` never races the render
  // that would have created one.
  const defenderRefs = useRef([]);
  if (defenderRefs.current.length !== defenders.length) {
    defenderRefs.current = defenders.map((_, i) => defenderRefs.current[i] || React.createRef());
  }

  // An expression per body, because a character composited from cosmetics
  // changes face by swapping one slot — nobody's hat moves. The action implies
  // the face (see faceForAction), so thirty styles get expressions without
  // authoring one, and a step may still override with `face`.
  const [faces, setFaces] = useState({});

  const play = useCallback((step) => {
    if (!step) return;
    const face = step.face || faceForAction(step.name);
    if (face) {
      const slot = step.role === ROLE.DEFENDER ? `d${step.index}` : 'a';
      setFaces((current) => (current[slot] === face ? current : { ...current, [slot]: face }));
    }
    if (step.role === ROLE.DEFENDER) {
      // A step addressed to a rival who is not in this cast is dropped rather
      // than redirected. The expansion in choreography.js only ever emits
      // indices that exist, so this is a guard, not a code path.
      defenderRefs.current[step.index]?.current?.play(step);
      return;
    }
    attackerRef.current?.play(step);
  }, []);

  const reset = useCallback(() => {
    setFaces({});
    attackerRef.current?.reset();
    defenderRefs.current.forEach((item) => item.current?.reset());
  }, []);

  useImperativeHandle(ref, () => ({ play, reset, size: defenders.length }), [defenders.length, play, reset]);

  const rigs = useMemo(() => defenders.map((defender, index) => ({
    key: defender?.id || defender?.user_id || `defender-${index}`,
    equipped: defender?.avatar || {},
    ring: defender?.clan_color?.stroke,
    // Feet on the ground the layout picked. The rect is the whole body box, so
    // its centre is where the rig is drawn.
    anchor: defenderRects[index]
      ? {
        x: defenderRects[index].x + defenderRects[index].width / 2,
        y: defenderRects[index].y + defenderRects[index].height / 2,
      }
      : null,
  })), [defenders, defenderRects]);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.cast]}
    >
      {/* Rivals first, so the runner's own character reads as in front of the
          people whose ground they are taking. */}
      {rigs.map((rig, index) => (
        rig.anchor ? (
          <ClaimActor
            key={rig.key}
            ref={defenderRefs.current[index]}
            equipped={rig.equipped}
            ring={rig.ring}
            face={faces[`d${index}`]}
            anchor={rig.anchor}
            bounds={bounds}
            size={DEFENDER_SIZE}
            reducedMotion={reducedMotion}
            fadeIn={fadeIn}
          />
        ) : null
      ))}

      {attackerVisible && attackerPoint ? (
        <ClaimActor
          ref={attackerRef}
          equipped={attacker}
          face={faces.a}
          anchor={attackerPoint}
          bounds={bounds}
          size={ACTOR_SIZE}
          reducedMotion={reducedMotion}
          fadeIn={fadeIn}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  cast: { zIndex: CAPTURE_LAYER.CHARACTER },
});

export default CaptureCast;
