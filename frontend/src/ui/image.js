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
// expo-image (SDWebImage / Glide) has a memory cache with a sane budget, and
// `allowDownscaling` decodes to the size the view actually draws at instead of
// the source's full resolution. Warmed art comes back instantly on the second
// visit, which is the entire point.
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
 * `crisp` turns OFF expo-image's `allowDownscaling`.
 *
 * That option decodes to the size the view draws at RIGHT NOW, which is a big
 * win for a static grid of art and a bug for anything that then animates its
 * own scale: the bitmap was decoded for the resting size, so a spring up to
 * 1.12 (the rig's tap and swap reactions) or a blow-up to full screen (the
 * reveal's backdrop) magnifies pixels that were never decoded at that size.
 * That is the "character goes blurry when I tap them" symptom, and it is not
 * fixable by shipping bigger art — the decode, not the source, is the limit.
 *
 * So: `crisp` on anything whose scale moves, default everywhere else. It costs
 * a full-resolution decode, which is exactly what it is buying.
 */
export const Image = React.forwardRef(function Image(
  { resizeMode, fadeDuration, contentFit, transition, cachePolicy, crisp, allowDownscaling, ...rest },
  ref
) {
  return (
    <ExpoImage
      ref={ref}
      allowDownscaling={allowDownscaling ?? (crisp ? false : undefined)}
      // Art is local and already decoded once — cross-fading it in reads as a
      // slow load rather than a transition, so default to an instant swap.
      transition={transition ?? (fadeDuration ? { duration: fadeDuration } : 0)}
      contentFit={contentFit ?? CONTENT_FIT[resizeMode] ?? 'cover'}
      cachePolicy={cachePolicy ?? 'memory-disk'}
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
