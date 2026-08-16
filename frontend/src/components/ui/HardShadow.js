// HardShadow — a zero-blur offset drop that works on Android too.
//
// The neo-brutalist shadow is not a shadow in the compositor's sense. It has no
// blur, no falloff and full opacity: it is a solid rectangle the same shape as
// the box, moved down and right. iOS can be asked for that with
// `shadowRadius: 0` (see `shadow.hard` in theme/tokens.js), but Android cannot
// — `elevation` is always a blurred material shadow pointing straight down, and
// no combination of props produces a hard offset block.
//
// So this draws the rectangle. It is not a fallback or an approximation; on
// both platforms it is more faithful than the iOS shadow props, because it is
// literally the shape the style asks for.
//
// THE CHILD MUST PAINT ITS OWN BACKGROUND. The block sits behind the content at
// full size, so a transparent child shows the shadow straight through itself
// and reads as a doubled outline.

import React from 'react';
import { View } from 'react-native';

import { NB, nbDrop, useTheme } from '../../theme';

/**
 * `offset`  displacement on both axes. Defaults to the neo-brutalist 4.
 * `color`   the block's colour. Left off, it is chosen for the scheme — near
 *           black on light, the accent on dark. See `nbDrop`.
 * `accent`  the dark scheme's shadow colour, when the default teal is wrong
 *           for this box (a clan colour, a card that is already teal).
 * `on`      what the box sits on, for the light-box-on-a-dark-page case.
 * `radius`  match it to the child's own border radius, or the block's square
 *           corners poke out past the child's rounded ones.
 */
export default function HardShadow({
  children,
  offset = NB.offset,
  color,
  accent,
  on,
  radius = 0,
  style,
}) {
  const { scheme } = useTheme();
  const block = color || nbDrop(scheme, { on, accent });

  return (
    <View style={style}>
      {/* Same size as the container, moved down-right by `offset`. Inset
          rather than sized: a width/height would need measuring, and this
          needs none — which matters because these wrap cards whose height is
          whatever their text came out at. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: offset,
          top: offset,
          right: -offset,
          bottom: -offset,
          backgroundColor: block,
          borderRadius: radius,
        }}
      />
      {children}
    </View>
  );
}
