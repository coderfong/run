// The runner who does the talking.
//
// The player's OWN character, not a mascot: they built it two minutes ago in
// the intro, and having it be the thing that shows them around is most of the
// reason this reads as a game tutorial rather than a product tour.
//
// It looks at what the card is about. `facing` is +1 when the spotlight is to
// its right and -1 when it is to its left, and the rig is mirrored by it — so
// the character turns toward the button it is telling you to press.

import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import CharacterRig, { BODY_RATIO, HEADROOM } from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';

// The rig's `size` is its WIDTH; everything else follows the art's aspect.
export const COACH_WIDTH = 46;
export const COACH_HEIGHT = Math.round(COACH_WIDTH * BODY_RATIO * (1 + HEADROOM));

export default function Coach({ facing = 1, width = COACH_WIDTH, celebrate = false, style, reduced = false }) {
  const { equipped } = useAvatar();
  const rig = useRef(null);

  useEffect(() => {
    // A wave on arrival, a jump when the first claim lands. Both go through
    // the rig's own imperative API, which no-ops under Reduce Motion.
    const timer = setTimeout(() => rig.current?.play(celebrate ? 'celebrate' : 'wave'), 180);
    return () => clearTimeout(timer);
  }, [celebrate]);

  return (
    <Animated.View
      pointerEvents="none"
      style={style}
      entering={reduced ? undefined : FadeInDown.duration(240)}
    >
      <View style={{ transform: [{ scaleX: facing >= 0 ? 1 : -1 }] }}>
        <CharacterRig ref={rig} equipped={equipped} size={width} animate={!reduced} />
      </View>
    </Animated.View>
  );
}
