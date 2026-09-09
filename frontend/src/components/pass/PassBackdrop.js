// PassBackdrop — the race plaza the reward ladder climbs.
//
// The pass page used to be a flat `colors.bg` page with a pink panel header on
// it. It is the busiest screen in the app — fifty tiers, two tracks, a spine of
// diamonds down the middle — and every one of those things is a hand-drawn
// object standing on nothing. The painting gives them a floor: sky, skyline and
// start-line hoardings across the top, then flat paving all the way down.
//
// SCALED BY WIDTH, PLACED BY THE HEADER. `cover` is wrong here twice over. It
// scales by the LARGER of the two ratios, so the painting grows and centres on
// a short phone and the start line slides off under the header; and even at the
// right scale it has no idea where the header ends. So the art is laid out at
// the window WIDTH and its own aspect — one honest scale, no cropping of the
// sides — and then pushed DOWN until the start line clears the header:
//
//     offset = headerHeight - SCENE_TOP x artHeight
//
// SCENE_TOP is where the flag tops begin (0.185 of the master). Everything the
// painting is actually about — flags, hoardings, hedges, skyline — lives in the
// band between there and the horizon at 0.319, and that band is 114pt tall on a
// 390pt phone. Without the push, a 197pt header covers all but the last 70 of
// it and the reader gets bare paving; with it, the start line sits directly
// under the panel and the plaza opens below. What is pushed off the top is the
// sun and the upper clouds, which are corner decoration, and the gap they leave
// is filled with the sky's own colour behind a header that is opaque anyway.
//
// Measured rather than assumed, because the header's height is not a constant:
// it grows with the reader's text size, and a hardcoded number would quietly
// bury the start line again on the setting that most needs the page to stay
// legible. `headerHeight` is what the page measured; the default is only what
// the first frame draws with, and it is the same number the header settles at
// on a stock phone, so the correction is usually invisible.
//
// THE PAINTING IS ONE SCREEN AND THE LADDER IS FIFTY LEVELS. There is no
// version of this art that reaches the bottom of that scroll, so the page is
// painted in the paving's own colour and the art simply runs out into it. The
// seam is invisible only while `PASS_BACKDROP_GROUND` matches the pixels it
// continues — that colour is sampled off the master and exported from the art
// manifest for exactly this reason.
//
// ONE PAINTING, TWO THEMES. There is no night version of the plaza and a
// daylight sky behind a dark page reads as a bug, so dark mode puts the page's
// own near-black over the whole thing at 72%: the same plaza at dusk, with the
// hoardings and the skyline still legible under it. Painting a second scene is
// the better answer if the page ever earns it.
//
// Absolutely positioned and non-interactive — the backdrop adds no layout
// height and can never take a tap from the ladder standing on it.

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Image } from '../../ui/image';
import { art, PASS_BACKDROP_GROUND } from '../../config/onboardingArt';
import { useTheme } from '../../theme';

const SRC = art('passBackdrop');
const META = SRC ? Image.resolveAssetSource(SRC) : null;
// Read off the asset rather than hardcoded, so a repaint at a different size
// keeps the scale honest instead of silently letterboxing. The fallback is the
// master's own shape.
const ASPECT = META?.height ? META.width / META.height : 853 / 1844;

// Where the flag tops begin, as a fraction of the master's HEIGHT. Measured off
// the art; the paving it opens onto starts at 0.319. Re-measure if the plaza is
// ever repainted.
const SCENE_TOP = 0.185;

// The sky at the master's top edge, for the spacer the push leaves above it.
const SKY = '#67D4FF';

// How far down the art may be pushed, as a fraction of its own height. A header
// blown up by accessibility text can ask for more than the picture has sky to
// give; past this the plaza would open below the middle of the screen, which
// costs more than the start line is worth.
const MAX_OFFSET = 0.25;

// What the FIRST frame draws with, before the page has measured its header:
// the compact panel's own height on a stock phone (safe-area inset + about
// 150pt of eyebrow, title, subtitle, bar line and padding). Being close is the
// whole job — the measured value replaces it on the next frame.
export const PASS_HEADER_ESTIMATE = 197;

// Dark mode's dusk wash: the page's own base surface (theme/dark.js) at the
// strength that leaves the skyline readable and the sky no longer daylight.
const NIGHT = 'rgba(11,13,16,0.72)';

/**
 * Drop it as the FIRST child of the page, with the page itself transparent —
 * everything after it draws on top.
 *
 * `headerHeight` is the measured height of the panel that sits over it. Pass
 * what the page measured; leave it out and the estimate above is used.
 */
export default function PassBackdrop({ headerHeight }) {
  const { scheme } = useTheme();
  const { width } = useWindowDimensions();

  if (!SRC) return null;

  const height = width / ASPECT;
  const wanted = (headerHeight || PASS_HEADER_ESTIMATE) - SCENE_TOP * height;
  // Never negative: pulling the art UP would crop the sky off the top of a
  // page whose header is shorter than the sky, which is the one case that
  // needs no correction at all.
  const offset = Math.max(0, Math.min(wanted, MAX_OFFSET * height));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: PASS_BACKDROP_GROUND }]}
    >
      {/* The gap the push leaves above the art, in the sky's own colour, as a
          SPACER in the column rather than a margin on the image — one thing
          owns the offset that way. It is behind an opaque header in every
          layout we ship, but a page that relies on being covered is a page that
          breaks the day it isn't. */}
      {offset > 0 ? <View style={{ height: Math.ceil(offset), backgroundColor: SKY }} /> : null}
      {/* `stretch` rather than `cover`: the box IS the art's shape, so there is
          nothing to crop or centre, and stretch is the one fit that cannot
          quietly re-frame the picture if the two ever drift by a pixel. */}
      <Image source={SRC} style={{ width, height }} resizeMode="stretch" />
      {scheme === 'dark' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: NIGHT }]} />
      ) : null}
    </View>
  );
}
