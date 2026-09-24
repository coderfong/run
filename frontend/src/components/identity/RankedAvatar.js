// RankedAvatar — the player's character portrait wearing their rank frame.
//
// THE RANK FRAME IS A PLAYER STATUS FRAME. It goes round the runner's face and
// nowhere else: not round a tier numeral, not round a crest, not round the
// whole figure. This is the one component that draws that pairing, so the feed
// header, the rank ladder's summary and its rail marker, notifications, rival
// and club rows all put the same frame round the same crop of the same face.
//
// Both layers live in ONE square (see PortraitBorder's `frameGeometry`): the
// portrait is centred in it and the frame's opening is centred on the same
// point, at every size and for every tier. Nothing here is a point offset, so
// a 24pt marker and a 104pt hero are the same drawing scaled.
//
//   <RankedAvatar equipped={avatar} rankKey="mythic" size={46} />
//
// `size` is the PORTRAIT's diameter; the component's footprint is
// `rankedAvatarBox(size)`. A runner with no avatar yet gets their initials on
// the same disc, in the same frame, so a row never changes shape for it.

import React from 'react';
import { Text, View } from 'react-native';

import { CharacterBust } from '../character/CharacterRig';
import PortraitBorder, { FRAME_BOX, frameGeometry } from '../PortraitBorder';
import { fonts } from '../../theme';

/** The square footprint a RankedAvatar of portrait diameter `size` takes. */
export function rankedAvatarBox(size) {
  return size * FRAME_BOX;
}

/** The portrait diameter that gives a RankedAvatar footprint of `box`. */
export function rankedAvatarSizeFor(box) {
  return box / FRAME_BOX;
}

export { frameGeometry };

/**
 * @param {object} equipped   the loadout (nullable)
 * @param {string} rankKey    the frame's tier key; 'wood' when unknown
 * @param {number} size       portrait diameter
 * @param {string} bg         the disc behind the bust (opaque, so nothing shows
 *                            through the frame's opening)
 * @param {string} initials   drawn instead of the bust when there is no avatar
 * @param {string} initialsColor
 */
function RankedAvatar({
  equipped,
  rankKey,
  size = 44,
  bg,
  initials,
  initialsColor,
  crisp,
  style,
  accessibilityLabel,
}) {
  const showBust = equipped != null || !initials;
  return (
    <PortraitBorder
      borderKey={rankKey || 'wood'}
      size={size}
      style={style}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
    >
      {showBust ? (
        <CharacterBust equipped={equipped} size={size} bg={bg} crisp={crisp} />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            allowFontScaling={false}
            style={{ fontFamily: fonts.bold, fontSize: Math.round(size * 0.32), color: initialsColor }}
          >
            {String(initials).slice(0, 2).toUpperCase()}
          </Text>
        </View>
      )}
    </PortraitBorder>
  );
}

export default React.memo(RankedAvatar);
