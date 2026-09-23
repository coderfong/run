// RunnerBust — the runner from the top of the hat down to the hips.
//
// The MEDIUM mode of the player identity system (see PlayerIdentity.js). The
// circular portrait (CharacterBust) is a head with a sliver of collar: right
// for a 40pt avatar, and it hides the top a player picked. This keeps the
// whole upper body — hat, hair, glasses, face, the top and whatever is worn on
// it — in a rounded window, with the cut low enough that the waistband shows
// and it reads as a person rather than a head.
//
// The window clips (that is the point of a bust), but only at the bottom: the
// top edge is placed from the loadout's measured reach (`figureBounds`), so a
// tall hat is never sliced, and the sides leave the shoulders their sleeves.

import React, { useMemo } from 'react';
import { View } from 'react-native';

import CharacterRig, { BODY_RATIO, HEADROOM, figureBounds } from '../character/CharacterRig';

// Where the window ends, as a fraction of body height from the body's top.
// Bottoms start at 0.554; this shows the top's hem and a band of the
// waistband under it, which is what makes an outfit read as an outfit.
export const BUST_CUT = 0.63;
// Air above the tallest thing worn, as a fraction of the window's height.
const TOP_AIR = 0.04;

export function bustLayout(equipped, height) {
  const b = figureBounds(equipped);
  const usable = height * (1 - TOP_AIR);
  const size = usable / (BODY_RATIO * (b.up + BUST_CUT));
  const bodyH = size * BODY_RATIO;
  return {
    size,
    // The rig's layout box top, measured from the window's top edge.
    rigTop: height * TOP_AIR + (b.up - HEADROOM) * bodyH,
  };
}

/**
 * @param {number} height  window height
 * @param {number} width   window width (default 0.82 of the height, which
 *                         keeps both sleeves of an ordinary top)
 * @param {string} bg      window fill
 * @param {number} radius  corner radius (default a fifth of the width)
 * @param {string} ring    optional outline colour
 */
function RunnerBust({ equipped, height = 96, width, bg = 'transparent', radius, ring, crisp, style }) {
  const w = width || Math.round(height * 0.82);
  const geo = useMemo(() => bustLayout(equipped, height), [equipped, height]);
  return (
    <View
      style={[
        {
          width: w,
          height,
          borderRadius: radius ?? Math.round(w * 0.2),
          overflow: 'hidden',
          backgroundColor: bg,
        },
        ring ? { borderWidth: 2, borderColor: ring } : null,
        style,
      ]}
      pointerEvents="none"
    >
      <CharacterRig
        equipped={equipped}
        size={geo.size}
        animate={false}
        crisp={crisp}
        style={{ position: 'absolute', left: (w - geo.size) / 2, top: geo.rigTop }}
      />
    </View>
  );
}

export default React.memo(RunnerBust);
