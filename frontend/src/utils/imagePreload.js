// Small image-cache coordinator.
//
// `require(...)` makes an image part of the app bundle, but the device still
// has to read and decode it the first time an <Image> is mounted. Prefetching
// goes through the same loader as <Image>, so warming a screen's art before it
// is navigated to prevents blank frames on arrival.
//
// THREE RULES, the first two learned from the "every screen takes forever"
// regression:
//
//  1. Warming is an OPTIMISATION, never a gate. Nothing may `await` these
//     helpers before rendering content — a cold cache, a slow device or a
//     missing asset would then hold the whole screen behind a skeleton. Screens
//     render their data immediately and let art land when it lands. (Launch is
//     the one caller that waits, and what it holds is the SPLASH, not a
//     screen, under a guard — see App.js.)
//  2. Prefetching only pays off if the decode SURVIVES. It stopped paying off
//     under React Native's <Image>, whose iOS cache refuses anything over 2 MB
//     decoded and evicts the rest inside 20 MB. That is why rendering now goes
//     through `ui/image` (expo-image) — see the comment there.
//  3. Bundled art is warmed into MEMORY only, the cache its views read from
//     (ui/image.js). The disk cache is decoded on a single serial queue, so
//     warming "into disk" lined a screen's decodes up single file and then
//     made the screen wait on the same queue to read them back.

import { AppState } from 'react-native';
import { Image } from '../ui/image';

const inFlight = new Map();
// Warmed once, warmed for good. `inFlight` alone only de-duplicates CONCURRENT
// calls, so every screen focus re-issued a prefetch for art that was already
// decoded — SharedIcons is 40 of them. Bundled art cannot change under us, so
// a completed warm is permanent for the life of the process…
const warmed = new Set();
// …until a memory warning, which empties the native memory cache outright
// (SDWebImage drops every image it holds). After one, "warmed" is a lie, and
// the next screen to ask should really warm again.
AppState.addEventListener?.('memoryWarning', () => warmed.clear());

// Shared across callers: separate screen groups must not each saturate the
// native image loader while navigation is mounting visible images. Three is
// the native prefetcher's own ceiling (SDWebImagePrefetcher runs three at once
// and queues the rest), and a view's own load outranks every one of them in
// the loader (`priority` in ui/image.js), so warming never delays visible art.
const MAX_CONCURRENT_PREFETCHES = 3;
const pending = [];
let active = 0;

function drain() {
  while (active < MAX_CONCURRENT_PREFETCHES && pending.length) {
    const { uri, policy, resolve } = pending.shift();
    active += 1;
    Promise.resolve()
      .then(() => Image.prefetch(uri, policy))
      .then((ok) => {
        if (ok !== false) warmed.add(uri);
        return ok !== false;
      })
      .catch(() => false)
      .then((ok) => {
        active -= 1;
        inFlight.delete(uri);
        resolve(ok);
        drain();
      });
  }
}

function sourceUri(source) {
  if (!source) return null;
  if (typeof source === 'string') return source;
  if (typeof source === 'object' && source.uri) return source.uri;
  return Image.resolveAssetSource(source)?.uri || null;
}

// Where a warmed image is kept — rule 3. A `require()`d number, or a local file,
// goes to memory, which is where its views look for it. Anything fetched over
// http keeps the disk cache as well: there, disk is the difference between a
// second visit and a second download.
function cachePolicyFor(source, uri) {
  if (typeof source === 'number') return 'memory';
  return /^https?:/i.test(uri) ? 'memory-disk' : 'memory';
}

export function preloadImage(source) {
  const uri = sourceUri(source);
  if (!uri) return Promise.resolve(true);
  if (warmed.has(uri)) return Promise.resolve(true);
  if (inFlight.has(uri)) return inFlight.get(uri);

  let resolve;
  const request = new Promise((done) => { resolve = done; });
  inFlight.set(uri, request);
  pending.push({ uri, policy: cachePolicyFor(source, uri), resolve });
  drain();
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
