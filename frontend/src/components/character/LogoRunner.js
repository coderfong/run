// LogoRunner — the PASER mark running, wearing the player's own head.
//
// The mark IS the running pose the brand already owns: side-on, front knee up,
// trailing leg extended, arms driving. Nothing cut out of the front-facing
// paper doll gets close to it, because that pose lives in the depth axis the
// doll does not have. So the body is the logo, and the only thing swapped in is
// the head — which is where the player's face, hair and headwear live anyway.
//
// `assets/brand/paser-mark-body.png` is the mark with its own head removed
// (scripts/make-brand-mark.py; the head is a separate shape in the art, so the
// cut is exact). HEAD_SLOT below is where that head sat — the script prints
// these numbers, so re-run it if the mark ever changes.

import React from 'react';
import { Image, View } from 'react-native';

import CharacterRig, { BODY_RATIO, HEADROOM } from './CharacterRig';

const MARK_BODY = require('../../../assets/brand/paser-mark-body.png');

// Where the mark's own head was, as fractions of the (square) mark.
const HEAD_SLOT = { cx: 0.619, cy: 0.122, width: 0.223 };

// The head inside CharacterRig's body box: the skull is 157 wide in 248, its
// top edge 8px down the 640-tall art (the same HEAD constant the rig uses).
const HEAD_W_OF_BODY = 157 / 248;
const HEAD_CY_OF_BODY = (8 + 218 / 2) / 640;

// The logo's head is tilted into the run. A front-facing head is not, so it
// gets nudged — enough to sit with the body's line, not so much that the face
// reads as falling over.
const HEAD_TILT_DEG = 12;

// Mascot proportions: the logo's body drawn under its natural size and the head
// over it. Straight 1:1 gives a correctly-proportioned little man who reads as
// nobody in particular at card scale; shrinking the body and growing the head
// makes the face — the part that is actually the player — legible.
const BODY_SCALE = 0.74;
const HEAD_SCALE = 1.4;

// Cut the head window at the CHIN — the head plate's own outline then forms the
// bottom edge. Any lower and the rig's shoulders come through as a cream band
// across the logo's chest.
const CHIN_OF_BODY = (8 + 218) / 640;

// Nudge down: the mark's head sat slightly proud of the shoulders, and a
// rounder head needs to sit into them.
const HEAD_DROP = 0.01;

// Where the mark's feet sit inside its own square — not at the bottom edge of
// the image. The component uses this to stand the figure on the bottom of its
// box, so callers can treat the box bottom AS the soles.
const FEET_IN_MARK = 0.971;
export const MARK_FEET = 1;

/**
 * @param {object}  props.equipped  avatar, as CharacterRig takes it
 * @param {number}  props.size      width of the mark (it is square)
 * @param {string}  props.color     tint for the logo body
 * @param {boolean} props.flip      face the other way
 */
export default function LogoRunner({ equipped, size = 120, color = '#FFFFFF', flip = false, style }) {
  // The mark is drawn smaller than the box and stood on its floor, so `size` is
  // the height from the soles up and the oversized head simply overhangs the
  // top. Nothing clips it — the box is `overflow: visible`.
  const bodySize = size * BODY_SCALE;
  const bodyLeft = (size - bodySize) / 2;
  const bodyTop = size - FEET_IN_MARK * bodySize;

  // Scale the rig so ITS head matches the slot the mark's head came out of.
  const headTarget = HEAD_SLOT.width * bodySize * HEAD_SCALE;
  const rigW = headTarget / HEAD_W_OF_BODY;
  const rigH = rigW * BODY_RATIO;
  const headroom = HEADROOM * rigH;

  // The window that shows the head and nothing below the collar. Full width,
  // because hair and headwear reach past the skull on both sides.
  const windowH = headroom + CHIN_OF_BODY * rigH;
  const headCentreY = headroom + HEAD_CY_OF_BODY * rigH;

  return (
    <View
      pointerEvents="none"
      style={[
        { width: size, height: size },
        flip ? { transform: [{ scaleX: -1 }] } : null,
        style,
      ]}
    >
      <Image
        source={MARK_BODY}
        style={{
          position: 'absolute',
          left: bodyLeft,
          top: bodyTop,
          width: bodySize,
          height: bodySize,
          tintColor: color,
        }}
        resizeMode="contain"
        fadeDuration={0}
      />

      <View
        style={{
          position: 'absolute',
          left: bodyLeft + HEAD_SLOT.cx * bodySize - rigW / 2,
          top: bodyTop + (HEAD_SLOT.cy + HEAD_DROP) * bodySize - headCentreY,
          width: rigW,
          height: windowH,
          overflow: 'hidden',
          transform: [{ rotate: `${HEAD_TILT_DEG}deg` }],
        }}
      >
        {/* The whole rig, offset so only the head shows through. Drawing the
            rig rather than a head image is what keeps face, hair, headwear and
            skin tone in step with whatever the player is wearing. */}
        <View style={{ position: 'absolute', left: 0, top: 0 }}>
          <CharacterRig equipped={equipped} size={rigW} animate={false} />
        </View>
      </View>
    </View>
  );
}
