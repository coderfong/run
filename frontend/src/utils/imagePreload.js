// Small image-cache coordinator.
//
// `require(...)` makes an image part of the app bundle, but the device still
// has to read and decode it the first time an <Image> is mounted. Prefetching
// goes through the same loader as <Image>, so warming a screen's art before it
// is navigated to prevents blank frames on arrival.
//
// TWO RULES, both learned from the "every screen takes forever" regression:
//
//  1. Warming is an OPTIMISATION, never a gate. Nothing may `await` these
//     helpers before rendering content — a cold cache, a slow device or a
//     missing asset would then hold the whole screen behind a skeleton. Screens
//     render their data immediately and let art land when it lands.
//  2. Prefetching only pays off if the decode SURVIVES. It stopped paying off
//     under React Native's <Image>, whose iOS cache refuses anything over 2 MB
//     decoded and evicts the rest inside 20 MB. That is why rendering now goes
//     through `ui/image` (expo-image) — see the comment there.

import { Image } from '../ui/image';

const inFlight = new Map();
// Warmed once, warmed for good. `inFlight` alone only de-duplicates CONCURRENT
// calls, so every screen focus re-issued a prefetch for art that was already
// decoded — SharedIcons is 40 of them. Bundled art cannot change under us, so
// a completed warm is permanent for the life of the process.
const warmed = new Set();

function sourceUri(source) {
  if (!source) return null;
  if (typeof source === 'string') return source;
  if (typeof source === 'object' && source.uri) return source.uri;
  return Image.resolveAssetSource(source)?.uri || null;
}

export function preloadImage(source) {
  const uri = sourceUri(source);
  if (!uri) return Promise.resolve(true);
  if (warmed.has(uri)) return Promise.resolve(true);
  if (inFlight.has(uri)) return inFlight.get(uri);

  const request = Promise.resolve(Image.prefetch(uri))
    .then((ok) => {
      if (ok !== false) warmed.add(uri);
      return ok !== false;
    })
    // A missing optional asset should never hold the app or navigation open.
    .catch(() => false)
    .finally(() => inFlight.delete(uri));

  inFlight.set(uri, request);
  return request;
}

export function preloadImages(sources = []) {
  const unique = [];
  const seen = new Set();

  for (const source of sources.flat(Infinity)) {
    const uri = sourceUri(source);
    if (!uri || seen.has(uri) || warmed.has(uri)) continue;
    seen.add(uri);
    unique.push(source);
  }

  return Promise.all(unique.map(preloadImage));
}
