// Image — a drop-in replacement for React Native's <Image> that renders through
// expo-image.
//
// WHY THIS EXISTS. React Native's iOS image pipeline keeps decoded bitmaps in
// RCTImageCache, which has two hard limits baked into the native module:
//
//   * a single image larger than 2 MB *decoded* is never cached at all, and
//   * the whole cache is capped at 20 MB.
//
// PASER's art blows through both. A 1024x1024 border ring decodes to 4 MB, so
// it was refused outright and re-decoded from disk on every single mount; the
// 40 sticker icons at 512x512 decode to 1 MB each, so any four screens' worth
// evicted everything else. The result was that navigating anywhere re-decoded
// the entire screen's art from scratch — the "assets take forever on every
// screen" symptom — no matter how much had been prefetched beforehand.
//
// expo-image (SDWebImage / Glide) has a memory cache with no size cap of its
// own (it empties on a memory warning), so warmed art comes back instantly on
// the second visit, which is the entire point.
//
// HOW BUNDLED ART ACTUALLY LOADS, and why the defaults below are what they are.
// Read out of expo-image 3.0's ImageView.swift and SDWebImage 5.21 on
// 2026-09-15. None of it can be seen from a dev build or a test, which is how
// the old defaults survived six "still laggy" passes:
//
//   * A MEMORY hit is synchronous: the art is on screen in the same frame as
//     its view. Everything else here is about getting art into memory before
//     it is asked for, and doing no work on the way out of it.
//   * The DISK cache is read AND DECODED on one serial queue (SDImageCache's
//     ioQueue). `memory-disk`, the old default, therefore meant that after
//     every cold start each screen's art decoded one image at a time — a feed
//     of runners is dozens of layers, single file — and it wrote a second copy
//     of every bundled PNG into Caches on the way. Bundled art is already a
//     file on the device, so the disk cache bought nothing but that queue.
//     `memory` skips it: a miss goes straight to the loader, which reads and
//     decodes up to six files at once.
//   * `allowDownscaling`, expo-image's default, does NOT decode smaller. The
//     whole image is decoded and cached either way; downscaling then REDRAWS
//     it at view size with CoreGraphics, on the MAIN thread, every time a view
//     shows it — memory hits included. A screen of runner busts was dozens of
//     main-thread redraws landing inside the transition that opened it. Bundled
//     art is now drawn from the decode itself and the GPU scales it (expo-image
//     sets a trilinear filter), which costs the main thread nothing and keeps
//     no per-view copy.
//   * `priority: 'high'` puts a view's own load ahead of background warming
//     (utils/imagePreload.js) in the loader's queue.
//
// A remote image (club photos, run media) keeps the old defaults. It does want
// the disk cache — the alternative is the network — and a 12 megapixel photo in
// a 60pt circle is exactly what downscaling is for.
//
// The wrapper exists so call sites keep RN's prop names — swapping the import
// line is the whole migration:
//
//   -import { Image, View } from 'react-native';
//   +import { View } from 'react-native';
//   +import { Image } from '../ui/image';
//
// `resizeMode` is translated to expo-image's `contentFit`, and `fadeDuration`
// to `transition`. Everything else passes through, so expo-image's own props
// (placeholder, recyclingKey, priority) are available where they're wanted.

import React from 'react';
import { Image as RNImage } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

const CONTENT_FIT = {
  contain: 'contain',
  cover: 'cover',
  stretch: 'fill',
  center: 'none',
  // expo-image has no repeat; 'cover' is the least-wrong stand-in and no PASER
  // art uses it today.
  repeat: 'cover',
};

/**
 * Art that ships inside the app. Metro hands a `require()`d asset around as a
 * number; anything else — a `{ uri }`, an http string — came from somewhere the
 * notes above do not describe, and keeps expo-image's own behaviour.
 */
export function isBundledSource(source) {
  return typeof source === 'number';
}

/**
 * `crisp` turns OFF expo-image's `allowDownscaling` for a REMOTE image whose
 * own scale animates: a bitmap redrawn for the resting size magnifies into mush
 * on a spring up to 1.12. Bundled art is never downscaled at all (see above),
 * so on a `require()`d source it changes nothing.
 */
export const Image = React.forwardRef(function Image(
  { source, resizeMode, fadeDuration, contentFit, transition, cachePolicy, crisp, allowDownscaling, priority, ...rest },
  ref
) {
  const bundled = isBundledSource(source);
  return (
    <ExpoImage
      ref={ref}
      source={source}
      allowDownscaling={allowDownscaling ?? (bundled || crisp ? false : undefined)}
      // Art is local and already decoded once — cross-fading it in reads as a
      // slow load rather than a transition, so default to an instant swap.
      transition={transition ?? (fadeDuration ? { duration: fadeDuration } : 0)}
      contentFit={contentFit ?? CONTENT_FIT[resizeMode] ?? 'cover'}
      cachePolicy={cachePolicy ?? (bundled ? 'memory' : 'memory-disk')}
      priority={priority ?? (bundled ? 'high' : undefined)}
      {...rest}
    />
  );
});

// expo-image has no equivalent, and the rig / backdrop / cloud band all read an
// asset's intrinsic size to derive an aspect ratio. Keep RN's resolver.
Image.resolveAssetSource = RNImage.resolveAssetSource;
Image.prefetch = ExpoImage.prefetch;
Image.clearMemoryCache = ExpoImage.clearMemoryCache;
Image.clearDiskCache = ExpoImage.clearDiskCache;

export default Image;
