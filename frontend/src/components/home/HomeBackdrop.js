// HomeBackdrop — the outdoors the feed happens in.
//
// Home was a flat `colors.bg` page: a wordmark, a hero card, a row of tiles and
// a column of run cards, all standing on nothing. It is the screen every runner
// lands on, and it was the one that looked least like the game. The painting
// gives it a place — open sky over the header, the city behind a hedgerow along
// the bottom — and the feed runs down the street between them.
//
// A FRAME, NOT A SCENE, WHICH IS WHY A SCROLL CAN STAND ON IT. The art has
// three parts: a sky band across the top, a flat cream field down the middle,
// and the skyline and hedges across the bottom. Only the two painted bands
// carry anything, so they are PINNED, one to each edge of the window, and the
// field between them is painted in its own colour and stretches to whatever
// height is left:
//
//     sky band     width x HOME_STREET.top      pinned to the top
//     field        everything between            HOME_STREET.ground
//     hedgerow     width x HOME_STREET.bottom   pinned to the bottom
//
// This is the same construction as components/rivals/RivalsBackdrop.js, and
// Home is where it matters most. The backdrop does not scroll: the sky sits
// behind the header and the hedge above the tab bar on every phone and at every
// scroll position, and the cards pass through the field. `cover` would scale by
// the LARGER ratio, so a tall window would push the hedge off the sides while a
// short one would swallow the sky behind the header.
//
// ONE ASSET, DRAWN TWICE. The shipped plate is the two bands STACKED with the
// field removed (scripts/install-home-backdrop.py), so each band is a window
// onto the same picture: the top one shows it from row 0, the bottom one from
// the seam down. One decode and one slot against the OTA asset budget.
//
// ONE PAINTING, TWO THEMES. There is no night street, and a midday sky behind a
// dark page reads as a bug, so dark mode lays the page's own near-black over
// the whole thing — the same dusk treatment, and the same reasoning, as the
// pass plaza and the rivals park.
//
// Absolutely positioned and non-interactive: the backdrop adds no layout height
// and can never take a tap from the feed standing on it.

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Image } from '../../ui/image';
import { art, HOME_STREET } from '../../config/onboardingArt';
import { useTheme } from '../../theme';

const SRC = art('homeStreet');

// Dark mode's dusk wash: the page's own base surface (theme/dark.js) at the
// strength that leaves the skyline and the hedges readable and the sky no
// longer daylight. Exported for anything drawing ON the backdrop that has to
// know which of the two it is sitting on.
export const HOME_NIGHT = 'rgba(11,13,16,0.72)';

// The most of the window the two bands may take between them, so a short one
// (a small phone with the text size wound up, or a window we don't ship today)
// closes on a sliver of field rather than growing the hedge up into the sky. At
// the master's proportions the pair want 0.34 of a stock phone's height, so
// this only ever engages in shapes we don't ship.
const MAX_BANDS = 0.66;

export default function HomeBackdrop() {
  const { scheme } = useTheme();
  const { width, height } = useWindowDimensions();

  if (!SRC) return null;

  // Both bands scale by WIDTH — one honest scale for the whole picture, which
  // is what keeps the seam between them a straight continuation of the field.
  const wanted = { top: width * HOME_STREET.top, bottom: width * HOME_STREET.bottom };
  const room = (MAX_BANDS * height) / (wanted.top + wanted.bottom);
  const shrink = Math.min(1, room);
  const topH = Math.round(wanted.top * shrink);
  const bottomH = Math.round(wanted.bottom * shrink);
  // The plate is the two bands and nothing else, so its drawn height is simply
  // their sum, and the bottom window reaches its band by sliding the whole
  // plate up by the top one.
  const plateH = topH + bottomH;
  const plateW = Math.round(width * shrink);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: HOME_STREET.ground }]}
    >
      {/* `stretch` in both windows: the box IS the art's shape at this scale,
          so there is nothing to crop or centre, and it is the one fit that
          cannot quietly re-frame the picture if the two drift by a pixel.
          The sky window carries the sky's own colour rather than the field's —
          the clamp above can leave a margin either side of the plate, and what
          the sky opens onto is sky. */}
      <View style={[styles.band, { height: topH, backgroundColor: HOME_STREET.sky }]}>
        <Image source={SRC} style={{ width: plateW, height: plateH }} resizeMode="stretch" />
      </View>
      <View style={[styles.band, styles.foot, { height: bottomH }]}>
        <Image
          source={SRC}
          style={{ width: plateW, height: plateH, marginTop: -topH }}
          resizeMode="stretch"
        />
      </View>
      {scheme === 'dark' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: HOME_NIGHT }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred, because the clamp above scales the picture UNIFORMLY — a band
  // squashed on one axis is a hedge squashed on one axis.
  band: { overflow: 'hidden', alignItems: 'center' },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
