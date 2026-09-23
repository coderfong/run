// RunnerFigure — the WHOLE runner, head to shoes, fitted into a box.
//
// The full body mode of the player identity system (see PlayerIdentity.js for
// the rule of which mode goes where). Everything a player has put on is
// visible: hat, hair, glasses, face, top, bottoms, shoes, accessory.
//
// CONTAIN, NEVER CROP. CharacterRig's `size` is the BODY'S WIDTH and its layout
// box is the body plus a little headroom for hair. Callers that treated `size`
// as a height got a runner almost three times taller than the slot they had
// reserved for it; callers that fitted the layout box got the tallest hats,
// the shoe soles and the wings cut off. This component reads how far the
// loadout's drawing really reaches (`figureBounds`) and scales the rig so that
// whole drawing lands inside the box, aspect ratio untouched. The feet stand
// on the box's floor by default, which is where a runner on a scene, a podium
// or a card wants to be.
//
// Nothing clips here. The box is a layout reservation, not a mask: the rig
// draws with overflow visible, so even a loadout nobody measured cannot lose a
// piece to this component. Keep ancestors unclipped too where you can.
//
// COST. A full rig is roughly ten image layers. That is fine for a hero, a
// podium of three, a payoff; it is not fine for every row of a long list —
// use the portrait or the bust there (PlayerIdentity documents the rule).

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { View } from 'react-native';

import CharacterRig, { BODY_RATIO, HEADROOM, figureBounds } from '../character/CharacterRig';
import { POSES, resolvePose } from './poses';

/**
 * The geometry, as pure arithmetic, so layouts can reserve room without
 * mounting anything (and tests can check it on every phone size).
 *
 * Give a `height`, a `width`, or both. Returns the rig's `size` (body width),
 * the drawn figure's own width/height, and where the rig's layout box sits
 * inside the figure.
 */
export function figureLayout(equipped, { width, height } = {}) {
  const b = figureBounds(equipped);
  const perH = BODY_RATIO * (b.up + b.down);
  const perW = 2 * b.half;
  let size = Infinity;
  if (height > 0) size = Math.min(size, height / perH);
  if (width > 0) size = Math.min(size, width / perW);
  if (!Number.isFinite(size)) size = 0;
  const bodyH = size * BODY_RATIO;
  return {
    size,
    figW: size * perW,
    figH: size * perH,
    // The rig's layout box starts HEADROOM above the body; the figure starts
    // `up` above it.
    rigTop: (b.up - HEADROOM) * bodyH,
    rigLeft: (size * perW - size) / 2,
  };
}

/** The width a figure of this height needs, for a caller laying out beside it. */
export function figureWidthFor(equipped, height) {
  return figureLayout(equipped, { height }).figW;
}

/**
 * @param {object}  equipped   the loadout (null is fine: the default runner)
 * @param {number}  height     box height; the figure fits inside it
 * @param {number}  width      box width (optional; defaults to the figure's)
 * @param {string}  align      'bottom' (stand on the floor, default) | 'center'
 * @param {string}  pose       see poses.js; unknown names fall back to neutral
 * @param {boolean} animate    idle bob
 * @param {number}  poseDelay  ms before the pose's motion plays (lets a screen
 *                             finish arriving first)
 */
const RunnerFigure = forwardRef(function RunnerFigure(
  {
    equipped,
    height,
    width,
    align = 'bottom',
    pose = 'neutral',
    poseDelay = 450,
    animate = false,
    captureSafe = false,
    crisp,
    style,
    accessibilityLabel,
  },
  ref
) {
  const geo = useMemo(() => figureLayout(equipped, { width, height }), [equipped, width, height]);
  const boxW = width > 0 ? width : geo.figW;
  const boxH = height > 0 ? height : geo.figH;
  const offY = align === 'center' ? (boxH - geo.figH) / 2 : boxH - geo.figH;

  const rig = useRef(null);
  useImperativeHandle(ref, () => ({
    play: (name) => rig.current?.play(name),
  }));

  // The pose's motion, once, after the screen has had a moment to arrive.
  const move = POSES[resolvePose(pose)]?.play;
  useEffect(() => {
    if (!move) return undefined;
    const t = setTimeout(() => rig.current?.play(move), poseDelay);
    return () => clearTimeout(t);
  }, [move, poseDelay]);

  return (
    <View
      style={[{ width: boxW, height: boxH, overflow: 'visible' }, style]}
      pointerEvents="none"
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
    >
      <CharacterRig
        // Only hand the rig a ref when something will play on it (a pose, or
        // a caller holding ours): a ref flips the rig's decode to crisp (see
        // CharacterRig), which a still figure never needs.
        ref={move || ref ? rig : undefined}
        equipped={equipped}
        size={geo.size}
        animate={animate}
        captureSafe={captureSafe}
        crisp={crisp}
        style={{
          position: 'absolute',
          left: (boxW - geo.figW) / 2 + geo.rigLeft,
          top: offY + geo.rigTop,
        }}
      />
    </View>
  );
});

export default React.memo(RunnerFigure);
