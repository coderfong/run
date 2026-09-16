// RivalsBackdrop — the dog park the rivalries are fought in.
//
// The Rivals page was a flat `colors.bg` page with a teal panel header on it.
// It is a page about two runners taking ground off each other, and it was the
// one page in the app where that read as a spreadsheet. The painting puts the
// list somewhere: trees over the header, the city behind the treeline, and two
// dogs in the grass at the bottom pulling on the same bone, which is the whole
// feature in one picture.
//
// A FRAME, NOT A SCENE, AND THAT IS WHY IT FITS EVERY PHONE. The art has three
// parts — a canopy across the top, a flat cream field down the middle, and the
// park across the bottom — and only the two painted bands carry anything. So
// the bands are PINNED, one to each edge of the window, and the field between
// them is painted in its own colour and stretches to whatever height is left:
//
//     top band     width x RIVALS_PARK.top      pinned to the top
//     field        everything between            RIVALS_PARK.ground
//     bottom band  width x RIVALS_PARK.bottom   pinned to the bottom
//
// Nothing is cropped, nothing is letterboxed, and the dogs sit the same
// distance above the tab bar on a 375pt phone as on a 430pt one. `cover` would
// have done none of that: it scales by the LARGER ratio, so a tall window
// would push both dogs and treeline off the sides while a short one would
// swallow the canopy behind the header.
//
// ONE ASSET, DRAWN TWICE. The shipped plate is the two bands STACKED with the
// field removed (scripts/install-rivals-backdrop.py), so each band is a window
// onto the same picture: the top one shows it from row 0, the bottom one from
// the seam down. That is one decode and one slot against the OTA asset budget
// rather than two, and it drops the 774 rows of flat cream that used to be
// most of the file.
//
// THE TREELINE HANGS OFF THE HEADER, NOT OFF A NUMBER. The canopy is 148pt
// tall on a stock 390pt phone and the header over it is about 156 — near
// enough that they read as one thing, and not near enough to leave alone: wind
// the reader's text size up and the header grows past the canopy, so the
// treeline ends up half way up the title with cream behind the rest of it. So
// the page MEASURES its header and passes the height in, and anything the
// canopy is short by is added above it in the sky's own colour. The trees then
// sit directly under the header at every text size, which is the only place
// they look deliberate. Same correction, and the same reasoning, as
// components/pass/PassBackdrop.js.
//
// ONE PAINTING, TWO THEMES. There is no night park, and a midday sky behind a
// dark page reads as a bug, so dark mode lays the page's own night colour over
// the whole thing — the same dusk treatment, and the same reasoning, as
// components/pass/PassBackdrop.js. The header that sits on this is told about
// the wash so its copy can flip with it; see ToonHeader's `onArt`.
//
// Absolutely positioned and non-interactive: the backdrop adds no layout
// height and can never take a tap from the list standing on it.

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Image } from '../../ui/image';
import { art, RIVALS_PARK } from '../../config/onboardingArt';
import { darkColors, useTheme, withAlpha } from '../../theme';

const SRC = art('rivalsPark');

// Dark mode's dusk wash: the page's own base surface (theme/dark.js) at the
// strength that leaves the treeline and the dogs readable and the sky no
// longer daylight. Exported because the header on top has to know whether it
// is drawing on a bright sky or a dark one. Derived from the palette rather
// than typed out, so it follows the night colour (see HomeBackdrop's).
export const RIVALS_NIGHT = withAlpha(darkColors.bg, 0.72);

// The most of the window the two bands may take between them, so a short one
// (a small phone with the text size wound up, or a window we don't ship today)
// closes on a sliver of field rather than overlapping the dogs into the trees.
// At the master's proportions the pair want 0.44 of a stock phone's height, so
// this only ever engages in shapes we don't ship.
const MAX_BANDS = 0.72;

// How far the canopy may be pushed down to meet a tall header, as a fraction
// of the canopy's own height. A header blown up by accessibility text can ask
// for more than this; past it the treeline would be sitting in the middle of
// the card list, which costs more than the join is worth.
const MAX_PUSH = 0.3;

/**
 * `headerHeight` is the measured height of the header standing in the canopy.
 * Leave it out and the canopy simply sits at the top of the window.
 */
export default function RivalsBackdrop({ headerHeight = 0 }) {
  const { scheme } = useTheme();
  const { width, height } = useWindowDimensions();

  if (!SRC) return null;

  // Both bands scale by WIDTH — one honest scale for the whole picture, which
  // is what keeps the seam between them a straight continuation of the field.
  const wanted = { top: width * RIVALS_PARK.top, bottom: width * RIVALS_PARK.bottom };
  const room = (MAX_BANDS * height) / (wanted.top + wanted.bottom);
  const shrink = Math.min(1, room);
  const topH = Math.round(wanted.top * shrink);
  const bottomH = Math.round(wanted.bottom * shrink);
  // The plate is the two bands and nothing else, so its drawn height is simply
  // their sum, and the bottom window reaches its band by sliding the whole
  // plate up by the top one.
  const plateH = topH + bottomH;
  const plateW = Math.round(width * shrink);
  // What the canopy is short of the header, if anything. Never negative:
  // pulling it UP would crop the sky off a picture whose header is shorter
  // than its canopy, which is the one case that needs no correction at all.
  const push = Math.round(Math.min(Math.max(0, headerHeight - topH), MAX_PUSH * topH));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: RIVALS_PARK.ground }]}
    >
      {/* The gap the push leaves above the canopy, in the sky's own colour, as
          a SPACER in the column rather than a margin on the band — one thing
          owns the offset that way. It is behind the header in every layout we
          ship, but a page that relies on being covered is a page that breaks
          the day it isn't. */}
      {push > 0 ? <View style={{ height: push, backgroundColor: RIVALS_PARK.sky }} /> : null}
      {/* `stretch` in both windows: the box IS the art's shape at this scale,
          so there is nothing to crop or centre, and it is the one fit that
          cannot quietly re-frame the picture if the two drift by a pixel. */}
      <View style={[styles.band, { height: topH }]}>
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
        <View style={[StyleSheet.absoluteFill, { backgroundColor: RIVALS_NIGHT }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred, because the clamp above scales the picture UNIFORMLY — a band
  // squashed on one axis is a dog squashed on one axis. Whatever the clamp
  // leaves either side is the field's own colour, which is what the band opens
  // onto anyway.
  band: { overflow: 'hidden', alignItems: 'center' },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
