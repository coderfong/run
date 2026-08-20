// BackButton — the neo-brutalist back control.
//
// Every header used to draw its own back affordance as a SOFT DISC: a 40pt
// circle filled with translucent black (or, on a bright panel, translucent
// white) and a thin rim. Beside a page full of 3pt-stroked, hard-shadowed
// boxes that disc was the one piece of chrome that still read as a web button —
// no stroke worth the name, no drop, and a radius the rest of the style does
// not own. It was also copied by hand into `toon.js` twice and into a handful
// of screens, so "the back arrow" was really five back arrows.
//
// This is the one box they all become: a squared tile (radius 12, the button
// family's corner), a full stroke judged against its own fill, a hard offset
// drop, and the same PressableShift press as every other NB box — it slides
// into its shadow when touched instead of dimming. `offsetSm`, not the full 4:
// a 40pt tile is small enough that the larger drop reads as the tile being
// knocked askew rather than as depth, the same call ToonChip makes.
//
// A panel header passes an explicit `fill`/`ink` because a panel is a fixed
// saturated brand colour in BOTH schemes, so its tile stays a white square with
// black ink whatever the device theme is — the same reason panel copy is a
// fixed PANEL_INK. Everywhere else the scheme decides.

import React from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

import { NB, nbInk, nbRadius, useTheme } from '../../theme';
import { PressableShift } from '../../ui/motion';
import HardShadow from './HardShadow';

export default function BackButton({
  onPress,
  // What the tile sits ON, so the drop is judged correctly when the tile is a
  // light box on the dark page. Defaults to the tile's own fill.
  on,
  // The tile's fill. Defaults to the card colour; a panel header passes white.
  fill,
  // The stroke/icon colour. Left off, chosen from the scheme against the fill.
  ink,
  size = 40,
  style,
}) {
  const { colors, scheme } = useTheme();
  const surface = fill || colors.card;
  const line = ink || nbInk(scheme, on || surface);
  return (
    <HardShadow offset={NB.offsetSm} radius={nbRadius.sm} on={on || surface} style={style}>
      <PressableShift
        onPress={onPress}
        offset={NB.offsetSm}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={[
          styles.box,
          { width: size, height: size, backgroundColor: surface, borderColor: line },
        ]}
      >
        {/* Nudged a point left of centre: a chevron is visually right-heavy, so
            dead-centring it leaves the point looking shoved against the edge. */}
        <ChevronLeft size={Math.round(size * 0.55)} color={line} strokeWidth={2.75} />
      </PressableShift>
    </HardShadow>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: nbRadius.sm,
    borderWidth: NB.stroke,
    alignItems: 'center',
    justifyContent: 'center',
    // The icon's optical-centre nudge (see above).
    paddingRight: 1,
  },
});
