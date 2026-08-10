// The plaza — where the running paths meet, and where CROSSED PATHS plays.
//
// Three layers, back to front:
//
//   1. the painted plaza (art `paserbyPlaza`). Its sky is deliberately empty
//      and its ground carries six circles, so the scene supplies its own marks
//      and the reveal only has to stand characters on them.
//   2. clouds — the same seamlessly tiling strip the Pit Stop sky uses, drifted
//      here at three widths, speeds and opacities for parallax. One still frame
//      scrolled in the scene rather than an animated clip, because that is what
//      lets ONE asset serve three layers at three different speeds (the reason
//      is written out in full in components/shop/PitStopScene.js).
//   3. butterflies, drawn as vectors — see Butterflies.js for why the supplied
//      clip could not be the sprite.
//
// Everything above the children is `pointerEvents="none"`, so the scene can
// never take a tap away from what is standing on it.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Image } from '../../ui/image';
import { art } from '../../config/onboardingArt';
import { useReduceMotion } from '../../ui/motion';
import Butterflies from './Butterflies';

const PLAZA = art('paserbyPlaza');
const PLAZA_SIZE = PLAZA ? Image.resolveAssetSource(PLAZA) : null;

/**
 * Where a point of the ARTWORK lands on screen, given the box the scene was
 * laid out in. `cover` scales by the larger ratio and centres the overflow, so
 * this is the only honest way to put anything ON the painting — a fraction of
 * the BOX is only the same thing as a fraction of the ART when the two happen
 * to share an aspect ratio, which is true on a 19.5:9 phone and false on a
 * tablet, in landscape, and inside any smaller frame the scene is dropped into.
 *
 * Returns `scale` as well, so art-sized things (a character standing on a
 * painted circle, a cloud sitting under a painted treeline) can size with it.
 */
export function plazaPoint(box, fx, fy) {
  const aw = PLAZA_SIZE?.width || 860;
  const ah = PLAZA_SIZE?.height || 1290;
  const scale = Math.max(box.width / aw, box.height / ah);
  const w = aw * scale;
  const h = ah * scale;
  return {
    x: (box.width - w) / 2 + fx * w,
    y: (box.height - h) / 2 + fy * h,
    scale,
  };
}

// Standing room, measured off the master (read from a gridded render). The deck
// is an ellipse centred at (0.505, 0.649) with semi-axes about 0.375 x 0.105 of
// the art, so each row is as wide as the ellipse is at its own depth — which is
// why the back row holds four and the front row holds six rather than all of
// them holding five. Every spot is inset from the kerb: a character standing on
// the paving edge reads as standing in the flowerbed.
//
// TWENTY to a plaza. Past that the crowd is a second page — the plaza itself
// never scrolls.
//
// DELIBERATELY NOT A GRID. The positions are scattered rather than ruled into
// rows: no two share a y, the x steps are uneven, and `flip` mirrors about half
// of them so they are not all facing the same way. Four tidy rows of identical
// people read as a team photo; this reads as a square with people in it.
//
// Every one of them is ON THE PAVING, inset from the kerb at its own depth —
// the deck is an ellipse, so the usable width shrinks as it recedes, and a spot
// at the geometric edge puts a foot in the flowerbed.
//
// Listed NEAREST FIRST, because spots are filled in order and one visitor
// should be at the front rather than alone at the back at two-thirds size.
// Callers draw in ASCENDING y so the back of the crowd goes down first and the
// near ones overlap it correctly.
export const PLAZA_SPOTS = [
  // Nearest the camera, but still ON the paving — the very front of the deck,
  // just inside its kerb. They were out on the approach paths at 0.79; that put
  // them in front of the plaza rather than in it. Filled first, so a single
  // visitor is standing at the front of the square at full size.
  { x: 0.545, y: 0.735 },
  { x: 0.352, y: 0.728, flip: true },
  { x: 0.688, y: 0.720 },
  // A step behind them.
  { x: 0.430, y: 0.707 },
  { x: 0.288, y: 0.695, flip: true },
  { x: 0.578, y: 0.689 },
  { x: 0.722, y: 0.701, flip: true },
  // The deck's widest line.
  { x: 0.352, y: 0.653 },
  { x: 0.648, y: 0.659, flip: true },
  { x: 0.222, y: 0.641 },
  { x: 0.500, y: 0.637, flip: true },
  { x: 0.786, y: 0.633 },
  // Behind the middle.
  { x: 0.398, y: 0.607 },
  { x: 0.742, y: 0.602, flip: true },
  { x: 0.262, y: 0.598 },
  { x: 0.545, y: 0.593 },
  // The back of the deck, where the paving has narrowed to almost nothing.
  { x: 0.655, y: 0.577, flip: true },
  { x: 0.352, y: 0.573 },
  { x: 0.448, y: 0.556 },
  { x: 0.560, y: 0.551, flip: true },
];

/**
 * How big a character standing at depth `y` should be, as a multiple of the
 * front-of-deck size. Continuous rather than one value per row: banded scales
 * made four straight lines of identically-sized people, which is a school
 * photo, not a crowd.
 *
 * Calibrated so the deck's front kerb is 1.0 and its back edge about two
 * thirds, which is the ratio the painted paving itself recedes at.
 */
export function plazaDepth(y) {
  return 0.62 + (y - 0.545) * 2.171;
}
export const PLAZA_TREELINE = 0.388;
// The cloud strip belongs to no one screen — it is a tiling band of sky, and
// the Pit Stop simply got there first. Reusing the shipped asset rather than
// cutting a second identical one keeps both skies on one file.
const CLOUD_BAND = art('pitStopCloudBand');
const CLOUD_SIZE = CLOUD_BAND ? Image.resolveAssetSource(CLOUD_BAND) : null;
const CLOUD_ASPECT =
  CLOUD_SIZE && CLOUD_SIZE.height ? CLOUD_SIZE.width / CLOUD_SIZE.height : 150 / 32;

// How long the slowest band takes to travel one tile. Clouds are weather, not
// traffic: at anything under half a minute they read as scenery being dragged.
const CLOUD_TRAVEL_MS = 48000;

// One entry per parallax band. `y` is a fraction of the ARTWORK (mapped through
// `plazaPoint`, so the bands stay in the painted sky at any aspect); `width` is
// a fraction of the box, because a tile is sized to read on the screen it is
// drawn on.
//
// `width` is a TILE width and the strip holds about four cloud clumps, so 0.34
// draws clouds roughly 33pt across — the size a cloud reads at above a city
// skyline. An early pass used tiles up to 1.15 of the width, and the result was
// a bank of fog filling the top third rather than weather behind it.
//
// They sit LOW, between 0.26 and the treeline at 0.388. Two reasons: the page
// header is an opaque panel across the top quarter, and clouds tucked under it
// were clouds nobody ever saw; and the plaza's own buildings start at 0.388, so
// anything below that is a cloud drifting through a tower. Nearer bands are
// larger, faster and more opaque, which is what distance looks like.
const CLOUD_BANDS = [
  { y: 0.258, width: 0.34, speed: 0.55, offset: 0.0, opacity: 0.5 },
  { y: 0.292, width: 0.44, speed: 0.85, offset: 0.4, opacity: 0.72 },
  { y: 0.325, width: 0.56, speed: 1.3, offset: 0.75, opacity: 0.92 },
];

function useCloudClock(active, reduced) {
  const t = useSharedValue(0);
  React.useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(t);
      t.value = 0;
      return undefined;
    }
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: CLOUD_TRAVEL_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(t);
  }, [active, reduced, t]);
  return t;
}

/**
 * One strip of sky, scrolling. Enough tiles are laid to cover the scene PLUS
 * ONE: the strip is translated by up to a whole tile, and without the spare the
 * right edge would run out of cloud in the frame before the phase wraps.
 */
function CloudBand({ clock, band, box, reduced }) {
  const tileW = band.width * box.width;
  const tileH = tileW / CLOUD_ASPECT;
  const tiles = Math.ceil(box.width / tileW) + 1;
  // Positioned against the PAINTING, not the box — see `plazaPoint`.
  const top = plazaPoint(box, 0, band.y).y;

  const style = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ translateX: 0 }] };
    const phase = (clock.value * band.speed + band.offset) % 1;
    return { transform: [{ translateX: -phase * tileW }] };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          top,
          width: tileW * tiles,
          height: tileH,
          flexDirection: 'row',
          opacity: band.opacity,
        },
        style,
      ]}
      pointerEvents="none"
    >
      {Array.from({ length: tiles }, (_, i) => (
        <Image
          key={i}
          source={CLOUD_BAND}
          style={{ width: tileW, height: tileH }}
          resizeMode="stretch"
          fadeDuration={0}
        />
      ))}
    </Animated.View>
  );
}

/**
 * @param {boolean} active   pause everything when the scene is off screen
 * @param {number}  butterflies  how many to fly (0 = none)
 * @param {node}    children  drawn ON the plaza, above every ambient layer
 */
export default function PlazaScene({
  active = true,
  butterflies = 6,
  children,
  style,
  contentStyle,
}) {
  const reduced = useReduceMotion();
  const [box, setBox] = useState(null);
  const clock = useCloudClock(active, reduced);

  return (
    <View
      style={[styles.root, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
      }}
    >
      {PLAZA ? (
        // `cover`, not `contain`: this is a backdrop, and letterboxing it would
        // put bars across a scene whose whole job is to fill the screen.
        <Image
          source={PLAZA}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          fadeDuration={0}
          accessible={false}
        />
      ) : null}

      {box && CLOUD_BAND
        ? CLOUD_BANDS.map((band, i) => (
            <CloudBand key={i} clock={clock} band={band} box={box} reduced={reduced} />
          ))
        : null}

      {box && butterflies > 0 ? (
        <Butterflies box={box} count={butterflies} active={active} />
      ) : null}

      {/* `box-none` so the scene can be used as a page BACKDROP with the real
          screen laid over it: an absolute-fill wrapper with no children of its
          own would otherwise sit in front of nothing and still swallow taps. */}
      <View style={[styles.content, contentStyle]} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#40B4FA' },
  content: { ...StyleSheet.absoluteFillObject },
});
