// ArtFrame — a hand-drawn box drawn around anything, at any size.
//
// The app's panels are rounded rectangles with a border colour, which is fine
// and completely silent. These are drawn boxes: wobbly ink with rounded ends
// and, on the banner, one corner cut off. They carry the same toon voice as the
// character art and the buttons.
//
// NINE SLICE. Corners are drawn at their fitted size and never stretched;
// edges stretch along one axis only. Stretching a hand drawn line lengthways
// just makes it a slightly straighter hand drawn line, which is exactly what
// you want; stretching a CORNER is what makes a nine slice look broken, and is
// what the measured insets exist to prevent.
//
// THERE ARE TWO WAYS THAT HAPPENS HERE, and which one runs is decided per
// frame, per render:
//
//   * NATIVELY, in one view, by handing iOS a `capInsets` image. This is the
//     path almost everything takes. See the long note on NATIVE_NINE_SLICE
//     below for how the point-valued line weight survives it.
//   * BY HAND, as eight clipped Images — minus the middle, since a frame's
//     interior is empty. This is what runs on Android, on a boiling frame, and
//     anywhere the cut poses are missing. It is sixteen views per layer, which
//     is why it stopped being the default.
//
// Both draw the same box; `sliceLayout` is the spec, and frameNineSlice.test.js
// holds the native path to it.
//
// THE SCALE. Corners at their natural size is right until the box is SMALLER
// than its own corners, and then it is badly wrong: a label whose art wants
// 17pt of corner at the top and 16 at the bottom, drawn round a 30pt line of
// text, has no middle left at all, and the eight slices pile into each other
// and render as a blot with the text on top of it. Clamping each corner to half
// the box — which is what this used to do — keeps the arithmetic valid and the
// picture broken.
//
// So the frame FITS itself: `frameScale` works out the largest scale at which
// the corners still leave a middle to stretch, and everything is drawn at that.
// A small box gets a proportionally finer line, which is what drawing one by
// hand would have done anyway. The same knob works upwards — `scale` above 1
// gives a chunkier line on a big box, so a full width panel does not end up
// with a hairline while a badge beside it has a 12pt stroke.
//
// THE PAPER. `fill` draws the box's INSIDE, from the second drawing the cutter
// emits. It is not a background colour behind the frame: a rectangle behind a
// wobbly outline pokes out past every corner, which is why the framed Card used
// to need a border radius to hide its own fill. The paper is the outline's own
// silhouette, so it stops exactly where the ink does.
//
// THE BOIL. Each frame is three drawings of the same box. Cycling them makes
// the ink crawl — the classic hand animated look. It is OFF by default: a
// screen with six boiling panels on it is a screen that will not sit still, and
// the effect is worth having on one thing at a time. Where it IS on, the frame
// index is driven by a shared value, so the eight slices restyle on the UI
// thread and React never re-renders for it. The value STEPS rather than
// sweeps — each drawing is held, then swapped — so it changes three times a
// cycle instead of on every frame, and the slices are only restyled when there
// is a new drawing to show.
//
// Reduced motion pins the boil to a single frame, and so does a screen nobody
// is looking at (see `useOnScreen`). The box stays; only the crawling stops.

import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Image, PixelRatio, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useOnScreen, useReduceMotion } from './motion';
import { getFrame } from './frameRegistry';

// Nothing below this line reads the registry directly; `spec` carries both the
// ink and the paper drawing, and which one a slice shows is passed in.

const AnimatedImage = Animated.createAnimatedComponent(Image);

// How much of each axis the two corners are allowed to take between them. The
// rest is middle, and a frame with no middle cannot be stretched — it can only
// be drawn at exactly its source size, which for a box that is supposed to fit
// round arbitrary content means never.
const MAX_CORNER_SHARE = 0.8;

/**
 * The scale a frame will actually be drawn at: the caller's, reduced until the
 * corners fit. Exported because padding has to agree with it.
 *
 * Only ever reduces. Asking for a bigger frame than the box can hold is a
 * request that cannot be honoured; asking for a smaller one is just a thinner
 * line, which every one of these drawings survives.
 */
export function frameScale(spec, width, height, scale = 1) {
  if (!spec?.insets || !width || !height) return 0;
  const { insets } = spec;
  return Math.min(
    scale,
    (width * MAX_CORNER_SHARE) / (insets.left + insets.right),
    (height * MAX_CORNER_SHARE) / (insets.top + insets.bottom)
  );
}

/**
 * The whole nine slice, as pure arithmetic — exported because this is where
 * the bugs live and a rendered frame is a poor place to catch them.
 *
 * Returns one entry per slice: `rect` is the region of the SOURCE drawing it
 * shows, `box` is where it lands and how far the sheet must be scaled to put
 * it there. Null when there is nothing to draw.
 *
 * The invariants a caller (or a test) should hold it to:
 *   - the four corners are drawn at one scale, the same on both axes, so they
 *     are never distorted — at `scale` 1 that is their source size;
 *   - the edges scale on ONE axis, matching their corners on the other;
 *   - the eight slices tile the border exactly: no gap, no overlap;
 *   - the corners always leave a middle between them, at every size.
 */
export function sliceLayout(spec, width, height, scale = 1) {
  if (!spec?.insets || !width || !height) return null;
  const { frameWidth: w, frameHeight: h, insets } = spec;

  // Corners keep their drawn PROPORTIONS at whatever scale fits. The halving
  // clamp stays as a floor under the arithmetic, but `frameScale` should have
  // made it unreachable — if it ever bites, the layout is already wrong.
  const fitted = frameScale(spec, width, height, scale);
  const l = Math.min(Math.round(insets.left * fitted), Math.floor(width / 2));
  const r = Math.min(Math.round(insets.right * fitted), Math.floor(width / 2));
  const t = Math.min(Math.round(insets.top * fitted), Math.floor(height / 2));
  const b = Math.min(Math.round(insets.bottom * fitted), Math.floor(height / 2));
  const midW = Math.max(0, width - l - r);
  const midH = Math.max(0, height - t - b);

  // Source-space middle runs, and the factors that map them onto the box.
  const srcMidW = Math.max(1, w - insets.left - insets.right);
  const srcMidH = Math.max(1, h - insets.top - insets.bottom);
  const midX = midW / srcMidW;
  const midY = midH / srcMidH;
  const leftX = l / insets.left;
  const rightX = r / insets.right;
  const topY = t / insets.top;
  const bottomY = b / insets.bottom;

  const at = (key, rect, left, top, fx, fy) => ({
    key,
    rect,
    box: { left, top, sheetW: fx * w, sheetH: fy * h },
  });

  return [
    at('tl', { x: 0, y: 0, w: insets.left, h: insets.top }, 0, 0, leftX, topY),
    at('tr', { x: w - insets.right, y: 0, w: insets.right, h: insets.top }, width - r, 0, rightX, topY),
    at('bl', { x: 0, y: h - insets.bottom, w: insets.left, h: insets.bottom }, 0, height - b, leftX, bottomY),
    at('br', { x: w - insets.right, y: h - insets.bottom, w: insets.right, h: insets.bottom }, width - r, height - b, rightX, bottomY),
    at('top', { x: insets.left, y: 0, w: srcMidW, h: insets.top }, l, 0, midX, topY),
    at('bottom', { x: insets.left, y: h - insets.bottom, w: srcMidW, h: insets.bottom }, l, height - b, midX, bottomY),
    at('left', { x: 0, y: insets.top, w: insets.left, h: srcMidH }, 0, t, leftX, midY),
    at('right', { x: w - insets.right, y: insets.top, w: insets.right, h: srcMidH }, width - r, t, rightX, midY),
  ].filter((slice) => slice.box.sheetW > 0 && slice.box.sheetH > 0);
}

/**
 * The rectangle the eight slices enclose — the box's inside.
 *
 * The paper's own middle is solid by construction (it is the interior of a
 * filled box; the cutter asserts nothing else is in there), so this is filled
 * with a plain coloured View rather than a ninth stretched Image. Same pixels,
 * one less texture per frame, and no bilinear seam where it meets the edges.
 */
export function frameMiddle(spec, width, height, scale = 1) {
  if (!spec?.insets || !width || !height) return null;
  const { insets } = spec;
  const fitted = frameScale(spec, width, height, scale);
  const left = Math.round(insets.left * fitted);
  const top = Math.round(insets.top * fitted);
  return {
    left,
    top,
    width: Math.max(0, width - left - Math.round(insets.right * fitted)),
    height: Math.max(0, height - top - Math.round(insets.bottom * fitted)),
  };
}

// ---------------------------------------------------------------------------
// The native nine slice.
//
// Everything below the slice maths draws a frame as EIGHT clipped windows —
// eight <View overflow:hidden> each holding an offset <Image>. Sixteen native
// views for a line, thirty-two once there is a fill behind it, and a feed card
// carries four or five frames: measured, a single feed card was 241 native
// views and about 150 of them were this.
//
// iOS does the identical job in one view. `capInsets` maps straight onto
// UIImage's `resizableImageWithCapInsets:resizingMode:UIImageResizingModeStretch`,
// which keeps the four corners at a fixed size and stretches the edges and the
// middle — the same contract `sliceLayout` documents, done by the compositor.
// The middle costs nothing either way: every ink drawing is transparent inside
// (checked, all seventeen) and every paper drawing is solid inside, so the
// stretched centre is either nothing at all or the fill itself. That is also
// why the fast path needs no separate `middle` rectangle.
//
// TWO THINGS MAKE IT NOT A DROP IN, and both are handled here.
//
// 1. THE POSES HAVE TO BE APART. A frame's art is a strip of three drawings and
//    the middle of that strip is the second drawing, so stretching the whole
//    image is nonsense. scripts/split-frame-poses.py cuts them; the strips stay
//    for the boil, which cannot swap an image source on the UI thread.
//
// 2. CAP INSETS ARE IN THE IMAGE'S OWN POINTS, AND OUR LINE WEIGHT IS A POINT
//    VALUE. This is the part worth reading twice, because it has shipped broken
//    twice. The frames were drawn at wildly different sizes, so the app never
//    draws them at their own scale: `weightScale` works out the factor that
//    turns a given drawing into a 5pt (or 3.75pt, or 6.5pt) line, and it lands
//    around a third for every frame in the pack. A cap inset is fixed in the
//    UIImage's point space, and a corner is drawn at exactly that size.
//
//    This used to be answered by DECLARING a density on the source (`scale:
//    1 / fitted`), which is a documented field and does nothing at all on the
//    new architecture. Fabric overwrites every image request's scale with the
//    screen's before it is sent (ImageShadowNode::getImageSource), and the
//    loader for a bundled file ignores the request anyway: it hands back
//    UIImage imageNamed:, whose density comes off the FILE NAME. In a dev build
//    the art streams from Metro and is decoded at the screen's 3x — and a
//    third is about what `fitted` happens to be, so every dev build looked
//    right. In a release build the same files load at 1x, the cut landed a
//    third of the way into every corner and the rest of each corner smeared
//    along its edges: heavy, streaky borders over the text, on every box in
//    the app.
//
//    So nothing is declared any more. The density is the one the device will
//    actually use (`capImageDensity`), the insets are stated in THAT, and the
//    line weight is reached with a transform instead: the layer is laid out
//    1 / zoom times the size of the box, the image's corners come out at their
//    own point size inside it, and `scale: zoom` brings the whole layer onto
//    the box — which puts every corner at `inset * fitted`, the same number
//    `sliceLayout` rounds to. The cut no longer moves with the weight or the
//    box, only the zoom does, so a box that resizes restyles one view rather
//    than reloading an image.
//
// If this ever needs turning off, it is one constant. The slice path is
// untouched and still runs on Android, on every boiling frame, on anything
// whose poses are missing, and — see the safety net below — everywhere, the
// moment a device reports an image the arithmetic did not expect.
const NATIVE_NINE_SLICE = Platform.OS === 'ios';

export function isRemoteImage(uri) {
  return typeof uri === 'string' && /^https?:/i.test(uri);
}

/**
 * The density iOS will give the UIImage behind a frame, which is the unit its
 * `capInsets` are read in. Decided by where the image is loaded FROM, never by
 * anything the source declares:
 *
 *   - over http(s) — Metro, in a dev build — it is decoded at the SCREEN's
 *     scale, because that is the scale Fabric puts on every image request and
 *     the network decoder honours it;
 *   - from a file — the app bundle in a release build, or an update's assets —
 *     RCTLocalAssetImageLoader loads it with UIImage imageNamed: (falling back
 *     to imageWithContentsOfFile:), which reads the density off the file name:
 *     `@3x` is 3, no suffix is 1. The request is never consulted.
 */
export function capImageDensity(uri, pixelRatio = PixelRatio.get()) {
  if (isRemoteImage(uri)) return pixelRatio > 0 ? pixelRatio : 1;
  const suffix = typeof uri === 'string'
    ? /@(\d+(?:\.\d+)?)x\.[a-z0-9]+(?:[?#].*)?$/i.exec(uri)
    : null;
  return suffix ? Number(suffix[1]) : 1;
}

/**
 * What to hand a capInsets <Image> so it draws the frame `sliceLayout` would.
 *
 * Exported and pure because it is the whole of the risk: the pixels are the
 * compositor's business, but whether the numbers agree with the slice path is
 * arithmetic, and arithmetic can be pinned. Null when there is nothing to draw.
 *
 * `density` is the UIImage's, from `capImageDensity`. The cut depends on that
 * and on nothing else; the weight and the box only move `zoom`, the scale the
 * layer is drawn at so its corners land at `inset * fitted` points.
 */
export function capFrameGeometry(spec, width, height, scale = 1, density = 1) {
  if (!spec?.insets || !width || !height || !(density > 0)) return null;
  const fitted = frameScale(spec, width, height, scale);
  if (!(fitted > 0)) return null;
  const { insets } = spec;
  // Image points to box points. A corner is drawn at its cap's point size
  // inside the layer, and the layer is then scaled onto the box by this.
  const zoom = fitted * density;
  const layerWidth = width / zoom;
  const layerHeight = height / zoom;
  return {
    fitted,
    density,
    zoom,
    // NOT rounded, unlike the slice path's corners. Rounding here would cut the
    // image somewhere other than the corner boundary it was measured at, which
    // is a sub-pixel slice of the wrong drawing along every edge.
    capInsets: {
      left: insets.left / density,
      right: insets.right / density,
      top: insets.top / density,
      bottom: insets.bottom / density,
    },
    // Centred on the box, because a transform scales about the view's centre:
    // scaled by `zoom` about that point, the layer covers the box exactly.
    layer: {
      width: layerWidth,
      height: layerHeight,
      left: (width - layerWidth) / 2,
      top: (height - layerHeight) / 2,
    },
  };
}

// ---------------------------------------------------------------------------
// The safety net.
//
// Everything above is arithmetic on what iOS is PROMISED to do with an image,
// and it is exactly that promise that broke twice. No test can see a UIImage,
// so the first few frames to load on a device check: Fabric's load event
// reports the decoded image's size, which is the density read straight back
// off the device. If it is not what `capImageDensity` said, the corners would
// be cut in the wrong place, so every frame in the app drops to the eight
// slices — slower, and known good — and the disagreement goes to Sentry
// instead of onto the screen.
// ---------------------------------------------------------------------------

// How many loads must agree before the check stops listening. Every frame goes
// through the same loader, so a handful is proof; checking all fifty on a
// screen would be fifty load events for one answer.
const CAP_CHECKS = 4;
// A decoded size a rounding away from the promise is not a different density.
const CAP_TOLERANCE = 0.03;

let capAgreements = 0;
let capDisagreement = null;
const capListeners = new Set();

function subscribeCapTrust(listener) {
  capListeners.add(listener);
  return () => capListeners.delete(listener);
}

function readCapTrust() {
  return capDisagreement === null;
}

/**
 * Did an image come back at the density the cut was made for?
 *
 * `reported` is the load event's `source`: on RN 0.81 that is the decoded
 * image's point size times the screen scale (ImageEventEmitter::onLoad), so it
 * can be predicted exactly from the drawing's pixels and the density.
 */
export function capDensityHolds(spec, density, reported, { pixelRatio = PixelRatio.get(), remote = false } = {}) {
  const width = reported?.width;
  const height = reported?.height;
  if (!spec || !(density > 0) || !(width > 0) || !(height > 0)) return true;
  const overW = width / ((spec.frameWidth / density) * pixelRatio);
  const overH = height / ((spec.frameHeight / density) * pixelRatio);
  // Bigger than promised is THE failure — the cut lands short of every corner
  // and the rest of the corner smears along the edges. Wrong on every path.
  if (overW > 1 + CAP_TOLERANCE || overH > 1 + CAP_TOLERANCE) return false;
  // Smaller is just as wrong for a file, which is loaded at its own size and
  // never resampled. Over the network (Metro, in dev) the decoder may shrink an
  // image to the view it is going into, so there, smaller proves nothing.
  if (!remote && (overW < 1 - CAP_TOLERANCE || overH < 1 - CAP_TOLERANCE)) return false;
  return true;
}

function noteCapLoad(spec, density, remote, event) {
  if (capDisagreement || capAgreements >= CAP_CHECKS) return;
  const reported = event?.nativeEvent?.source;
  if (capDensityHolds(spec, density, reported, { remote })) {
    capAgreements += 1;
    return;
  }
  capDisagreement = {
    frame: spec.id,
    density,
    remote,
    pixelRatio: PixelRatio.get(),
    reported: { width: reported.width, height: reported.height },
  };
  if (__DEV__) {
    console.warn(
      '[frames] the native nine slice was cut for a different image density than ' +
      'the device loaded; every frame is falling back to the eight slices.',
      capDisagreement
    );
  }
  try {
    // Required here rather than at the top: this is the one place a primitive
    // drawn fifty times a screen needs Sentry, and it only runs if the device
    // has just contradicted the arithmetic above.
    require('@sentry/react-native').captureException(
      new Error('frames: cap inset density mismatch'),
      { extra: capDisagreement }
    );
  } catch {
    // Reporting must never be the thing that breaks a frame.
  }
  capListeners.forEach((listener) => listener());
}

/** For tests: forget what earlier loads said, and redraw anything listening. */
export function resetCapTrust() {
  capAgreements = 0;
  capDisagreement = null;
  capListeners.forEach((listener) => listener());
}

/**
 * One layer of a frame, nine-sliced by iOS. One native view.
 *
 * `tint` recolours the drawing the same way the slices do — the art is one flat
 * colour and `tintColor` is what makes it wear a clan colour or the theme's
 * line. Template rendering is applied before the image is made resizable (see
 * RCTImageComponentView), so the two compose.
 */
function CapLayer({ spec, source, width, height, scale, tint, opacity }) {
  // Where the image is loaded from decides the density it comes back at, and
  // so the units of the cut — see `capImageDensity`.
  const uri = useMemo(() => Image.resolveAssetSource(source)?.uri, [source]);
  const density = capImageDensity(uri);
  const geometry = useMemo(
    () => capFrameGeometry(spec, width, height, scale, density),
    [spec, width, height, scale, density]
  );

  if (!geometry) return null;
  const { capInsets, layer, zoom } = geometry;
  const checking = readCapTrust() && capAgreements < CAP_CHECKS;
  return (
    <Image
      // The bundled asset exactly as required. Nothing is declared on it: a
      // density or a size here would be thrown away by Fabric, and the old
      // code's reliance on one is what drew every release build's frames wrong.
      source={source}
      capInsets={capInsets}
      resizeMode="stretch"
      fadeDuration={0}
      pointerEvents="none"
      onLoad={checking ? (event) => noteCapLoad(spec, density, isRemoteImage(uri), event) : undefined}
      style={[
        styles.cap,
        // THE LAYER, STATED IN FULL. RN's Image puts the SOURCE's own point
        // size in front of the caller's style:
        //
        //   style = [{width, height}, styles.base, props.style]   Image.ios.js
        //
        // so a layer that left its size to offsets would be drawn at the
        // drawing's natural size, pinned to one corner — which shipped once.
        // Every dimension is stated here, after that prefix, so it cannot.
        {
          left: layer.left,
          top: layer.top,
          width: layer.width,
          height: layer.height,
          opacity,
          transform: [{ scale: zoom }],
        },
        tint ? { tintColor: tint } : null,
      ]}
    />
  );
}

// Slow. The source is three drawings, and cycled quickly three drawings read as
// a flicker rather than as a line being redrawn.
const BOIL_MS = 420;

// The geometry every slice needs, whether or not it boils.
//
// `box.sheetW`/`sheetH` are what the WHOLE source frame would measure if it
// were drawn so that this slice comes out at the size the layout wants. The
// window then crops that scaled sheet down to the slice itself. Doing it this
// way is what lets an edge stretch on one axis while its corners do not: each
// slice scales the same sheet by a different pair of factors.
function sliceGeometry(spec, rect, box, tint, opacity) {
  const scaleX = box.sheetW / spec.frameWidth;
  const scaleY = box.sheetH / spec.frameHeight;
  const frameCount = Math.max(1, spec.frameCount || 1);
  return {
    scaleX,
    scaleY,
    frameCount,
    window: { left: box.left, top: box.top, width: rect.w * scaleX, height: rect.h * scaleY },
    sheet: {
      width: spec.frameWidth * frameCount * scaleX,
      height: spec.frameHeight * scaleY,
      opacity,
      tintColor: tint || undefined,
    },
  };
}

// A frame that is not boiling has NOTHING to animate — its transform is a
// constant. This is therefore a plain Image with a plain style, and NOT the
// animated component with a shared value that happens never to change.
//
// The difference is not cosmetic. Slices come eight at a time, and the You
// page alone puts a frame on six stat tiles and three section headings: going
// through Reanimated unconditionally would install and maintain seventy-two
// mappers for seventy-two boxes that sit perfectly still. Non-boiling is the
// common path by a wide margin, so it is the cheap one, and the split is at
// the component boundary because a hook cannot be skipped inside one.
function StillSlice({ spec, source, pose, rect, box, tint, opacity }) {
  const { scaleX, scaleY, frameCount, window: win, sheet } = sliceGeometry(spec, rect, box, tint, opacity);
  const index = Math.abs(Math.trunc(pose || 0)) % frameCount;
  return (
    <View pointerEvents="none" style={[styles.window, win]}>
      <Image
        source={source}
        resizeMode="stretch"
        fadeDuration={0}
        style={[
          styles.sheet,
          sheet,
          {
            transform: [
              { translateX: -(rect.x * scaleX) - index * spec.frameWidth * scaleX },
              { translateY: -(rect.y * scaleY) },
            ],
          },
        ]}
      />
    </View>
  );
}

function BoilingSlice({ spec, source, frame, rect, box, tint, opacity }) {
  const { scaleX, scaleY, frameCount, window: win, sheet } = sliceGeometry(spec, rect, box, tint, opacity);
  const sheetStyle = useAnimatedStyle(() => {
    // Modulo, because the boil runs 0 → frameCount and the last step lands one
    // frame past the end of the strip, which is the first drawing again.
    const index = Math.floor(frame.value) % frameCount;
    return {
      transform: [
        { translateX: -(rect.x * scaleX) - index * spec.frameWidth * scaleX },
        { translateY: -(rect.y * scaleY) },
      ],
    };
  }, [frameCount, rect.x, rect.y, scaleX, scaleY, spec.frameWidth]);

  return (
    <View pointerEvents="none" style={[styles.window, win]}>
      <AnimatedImage
        source={source}
        resizeMode="stretch"
        fadeDuration={0}
        style={[styles.sheet, sheet, sheetStyle]}
      />
    </View>
  );
}

/**
 * `name`     a key from the frame registry ('panel', 'card', 'label', 'banner',
 *            'badge', 'bubble', …) or a raw frame id.
 * `width`    / `height` the box to draw. Both required — the frame is
 *            absolutely positioned over its parent and measures nothing.
 * `tint`     recolours the ink. The art is one flat blue, so a tint is how it
 *            picks up a clan colour or the theme's line colour.
 * `fill`     the colour of the paper layer. Required by 'paper'/'both'.
 * `layer`    which half to draw:
 *              'ink'   the outline. The default, and an overlay — it goes on
 *                      TOP of the content, because a border sits on the edge of
 *                      a box rather than behind it.
 *              'paper' the inside. Goes UNDER the content, for the obvious
 *                      reason, so a caller wanting both draws two of these
 *                      either side of its children rather than one of them.
 *              'both'  paper then ink, for decoration with nothing inside it.
 * `scale`    line weight. 1 draws the art at its own size; the frame reduces
 *            this on its own when the box is too small to hold the corners.
 *            Callers normally arrive here through `Framed`, which resolves a
 *            point-valued ink weight into this number — see `weightScale`.
 * `opacity`  applies to the INK only. See the paper note below.
 * `pose`     which of the three hand-redrawn poses a still frame uses.
 * `boil`     cycle the three drawings, while the screen is being looked at.
 */
export default function ArtFrame({
  name = 'panel',
  width,
  height,
  tint,
  fill,
  layer = 'ink',
  scale = 1,
  opacity = 1,
  pose = 0,
  boil = false,
  style,
}) {
  const reduced = useReduceMotion();
  const spec = getFrame(name);
  const frame = useSharedValue(0);
  const stillPose = spec ? Math.abs(Math.trunc(pose || 0)) % Math.max(1, spec.frameCount || 1) : 0;
  // Only a boiling frame has anything to park, so only a boiling frame listens
  // for focus — a screen draws fifty of these and almost none of them boil.
  const onScreen = useOnScreen(boil && !reduced && !!spec);
  const capsTrusted = useSyncExternalStore(subscribeCapTrust, readCapTrust, readCapTrust);

  useEffect(() => {
    cancelAnimation(frame);
    frame.value = stillPose;
    if (!boil || reduced || !spec || !onScreen) return undefined;
    // Each drawing held for its full beat and then swapped, rather than a
    // linear sweep read back through Math.floor. These are three separate
    // drawings, not keyframes of one, and a value that only moves when the
    // drawing does is a value the slices only restyle for when it does.
    const steps = [];
    for (let i = 1; i <= spec.frameCount; i += 1) {
      steps.push(withDelay(BOIL_MS, withTiming(stillPose + i, { duration: 0 })));
    }
    frame.value = withRepeat(withSequence(...steps), -1, false);
    return () => cancelAnimation(frame);
  }, [boil, frame, onScreen, reduced, spec, stillPose]);

  const layout = useMemo(
    () => sliceLayout(spec, width, height, scale),
    [spec, width, height, scale]
  );
  const wantsPaper = fill && (layer === 'paper' || layer === 'both');
  const middle = useMemo(
    () => (wantsPaper ? frameMiddle(spec, width, height, scale) : null),
    [wantsPaper, spec, width, height, scale]
  );

  if (!layout) return null;

  // Reduced motion keeps the box and drops the crawl, so it takes the still
  // path too — and gets the cheaper one for free. A boiling frame on a screen
  // nobody is looking at keeps its slices and just stops stepping, so coming
  // back to it does not rebuild sixteen views.
  const boiling = boil && !reduced;
  const SliceView = boiling ? BoilingSlice : StillSlice;

  // THE FAST PATH. One view per layer instead of sixteen — see the note on
  // NATIVE_NINE_SLICE above for what it is and what it costs.
  //
  // Every condition here is a reason the compositor cannot do the job:
  // a boiling frame needs the strip and a per-frame offset, Android has no
  // capInsets, a frame whose poses were never cut has nothing to hand it, and
  // a device that has contradicted the cut's arithmetic is not to be trusted
  // with it. Any of them falls through to the eight slices, which still work.
  const inkPose = spec.posesInk?.[stillPose];
  const paperPose = spec.posesPaper?.[stillPose];
  const canCap = NATIVE_NINE_SLICE && capsTrusted && !boiling && !!inkPose && (!wantsPaper || !!paperPose);

  if (canCap) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        {/* Paper under, ink over, exactly as below — and with no separate
            middle rectangle, because the paper drawing's own middle is solid
            and stretches to fill the box. Full alpha on the paper for the same
            reason it has full alpha below: `opacity` softens the LINE, and a
            surface that is paler at its edges than at its centre is two
            colours in one box. */}
        {wantsPaper ? (
          <CapLayer
            spec={spec}
            source={paperPose}
            width={width}
            height={height}
            scale={scale}
            tint={fill}
            opacity={1}
          />
        ) : null}
        {layer === 'paper' ? null : (
          <CapLayer
            spec={spec}
            source={inkPose}
            width={width}
            height={height}
            scale={scale}
            tint={tint}
            opacity={opacity}
          />
        )}
      </View>
    );
  }

  const slices = (source, slotTint, slotOpacity) => layout.map(({ key, rect, box }) => (
    <SliceView
      key={key}
      spec={spec}
      source={source}
      frame={frame}
      pose={stillPose}
      rect={rect}
      box={box}
      tint={slotTint}
      opacity={slotOpacity}
    />
  ));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {/* Paper first, then ink over it. The paper runs to the OUTER edge of the
          line — it is the outline's own silhouette — so the ink covering it is
          what leaves the fill sitting exactly inside the box. Drawn in the same
          eight slices as the ink, because it has to boil in step: hold the
          paper still under a crawling line and white creeps out from under it
          every third frame.

          The paper is drawn at FULL alpha, whatever `opacity` says. That prop
          softens the LINE, and it used to reach the paper's eight slices while
          the middle rectangle — a plain coloured View — kept its full strength.
          The result was a card whose centre was one colour and whose border
          band was a slightly paler version of it: two shades of the same fill
          inside one box, with a visible rectangle where they met. A surface is
          a surface; if a caller wants a translucent one it can put the alpha in
          `fill`, where it applies to both halves at once. */}
      {middle ? (
        <>
          <View style={[styles.middle, middle, { backgroundColor: fill }]} />
          {slices(spec.paper, fill, 1)}
        </>
      ) : null}
      {layer === 'paper' ? null : slices(spec.source, tint, opacity)}
    </View>
  );
}

const styles = StyleSheet.create({
  cap: { position: 'absolute' },
  middle: { position: 'absolute' },
  window: { position: 'absolute', overflow: 'hidden' },
  sheet: { position: 'absolute', left: 0, top: 0 },
});
