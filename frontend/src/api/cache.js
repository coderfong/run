// Response cache — the reason screens stop showing skeletons.
//
// WHY THIS EXISTS. Every screen used to hold `useState(null)` and fetch on
// mount, so `null` (= "show a skeleton") was the state of the app for one whole
// round trip EVERY TIME you opened a screen — including the fiftieth time you
// opened it, with the same four feed rows waiting on the other end. The Render
// backend answers in ~0.5-1s warm and far worse on a cold instance or a phone
// on mobile data, and none of that latency was ever hidden. Navigating the app
// therefore looked like an app that loads, not an app that runs.
//
// The fix is stale-while-revalidate: the last response for an endpoint is kept
// in memory AND on disk, handed back SYNCHRONOUSLY the moment a screen mounts,
// and refreshed behind the rendered content. A screen you have opened before
// paints instantly with real data, then quietly corrects itself.
//
// Two properties matter and are easy to lose:
//
//   * Reads must be SYNCHRONOUS. An AsyncStorage read resolves a tick later,
//     which is another frame of skeleton — the whole point is that the first
//     render already has the data. Disk is therefore read exactly once, at
//     boot (`hydrateCache`), into a plain in-memory map; everything after that
//     is a map lookup.
//
//   * The cache is PER USER. Cached feed rows and stats belong to the account
//     that fetched them, so the blob records its owner and is dropped whole
//     when a different user signs in.
//
// Nothing here is a substitute for the server. Cached data is always refreshed;
// it only decides what is on screen while that refresh is in flight.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'paser:apicache:v1';

// Entries older than this are treated as absent — better a skeleton than a
// stat wall from last month. Anything fresher is shown immediately and
// corrected in place.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Persisting on every single write would mean an AsyncStorage round trip per
// response; batching them costs nothing and keeps writes off the render path.
const PERSIST_DEBOUNCE_MS = 1200;

// A cached payload that is enormous is a payload that costs more to serialise
// on every write than the skeleton it saves. Feed pages and leaderboards are
// well under this; map polygons are not, which is why they are not cached.
const MAX_ENTRY_BYTES = 256 * 1024;

// key -> { data, at }
let store = new Map();
// key -> when we last ASKED, which is not the same as when we last succeeded.
// Failures have to be recorded too or a dead endpoint is retried on every
// render. It lives here rather than in the hook so that invalidating a key
// also clears its retry throttle — otherwise dropping an entry after a claim
// would be silently ignored by a screen that had asked seconds earlier.
let attempts = new Map();
// key -> Promise, so two screens asking for the same endpoint in the same frame
// make one request (Home and You both read /me/energy on mount).
const inFlight = new Map();
// Mounted queries watching a key. Most writes come from that query's own
// fetch, but root-level foreground listeners (land capture, push events) also
// refresh cached data and the visible bell should react without a navigation
// focus cycle.
const subscribers = new Map();
let owner = null;
let hydrated = false;
let persistTimer = null;

// --- persistence -----------------------------------------------------------

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flush();
  }, PERSIST_DEBOUNCE_MS);
}

async function flush() {
  if (!hydrated) return;
  try {
    const entries = {};
    for (const [key, entry] of store) entries[key] = entry;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ owner, entries }));
  } catch {
    // A full or unavailable disk costs us the warm start, nothing more.
  }
}

// Read the saved blob into memory. Call once, before the first screen renders —
// after that every `getCached` is a synchronous map lookup.
export async function hydrateCache() {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const cutoff = Date.now() - MAX_AGE_MS;
      const savedOwner = parsed?.owner ?? null;
      // Boot races this read on a slow disk (App gives it 400ms before it
      // gives up and renders), so by the time it lands the app may already
      // have signed a user in and fetched. Never undo either: a live owner
      // wins, and a live entry is only replaced by a strictly newer one.
      const mismatched = owner !== null && savedOwner !== null && owner !== savedOwner;
      if (owner === null) owner = savedOwner;
      if (!mismatched) {
        for (const [key, entry] of Object.entries(parsed?.entries || {})) {
          if (!entry || typeof entry.at !== 'number' || entry.at < cutoff) continue;
          const live = store.get(key);
          if (!live || entry.at > live.at) store.set(key, entry);
        }
      }
    }
  } catch {
    // Corrupt blob — start empty rather than crash the launch path.
  } finally {
    hydrated = true;
  }
}

// --- ownership -------------------------------------------------------------

// Bind the cache to a user. A different id than the blob was written under
// means the contents belong to someone else and are dropped outright.
export function setCacheOwner(userKey) {
  const next = userKey || null;
  if (next === owner) return;
  if (owner !== null && next !== null) {
    store = new Map();
    attempts = new Map();
  }
  owner = next;
  schedulePersist();
}

// Sign-out. Everything goes, memory and disk, immediately — no debounce, so a
// second account signing in straight after can't race the write.
export function clearCache() {
  store = new Map();
  attempts = new Map();
  inFlight.clear();
  owner = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

// --- reads and writes ------------------------------------------------------

// The cached value for `key`, or undefined when there is none. SYNCHRONOUS by
// design — callers use it as their initial render state.
export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > MAX_AGE_MS) {
    store.delete(key);
    return undefined;
  }
  return entry.data;
}

// The last time `key` was written OR attempted, whichever is later — the basis
// for deciding whether a focus should refetch at all. Returns 0 for a key that
// has never been touched, or one that has been invalidated since.
export function touchedAt(key) {
  return Math.max(store.get(key)?.at || 0, attempts.get(key) || 0);
}

export function markAttempt(key) {
  attempts.set(key, Date.now());
}

export function setCached(key, data) {
  if (data === undefined) return;
  let size = 0;
  try {
    size = JSON.stringify(data)?.length || 0;
  } catch {
    return; // not serialisable — it would poison the whole blob
  }
  if (size > MAX_ENTRY_BYTES) return;
  store.set(key, { data, at: Date.now() });
  subscribers.get(key)?.forEach((listener) => listener(data));
  schedulePersist();
}

export function subscribeCached(key, listener) {
  if (!key || typeof listener !== 'function') return () => {};
  const listeners = subscribers.get(key) || new Set();
  listeners.add(listener);
  subscribers.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscribers.delete(key);
  };
}

// Drop cached entries. `prefix` matches from the start of the key, so
// `invalidate('clan:')` clears every clan-scoped entry at once. No argument
// clears everything but keeps the owner (a refresh, not a sign-out).
export function invalidate(prefix) {
  if (!prefix) {
    store = new Map();
    attempts = new Map();
  } else {
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) store.delete(key);
    }
    // Clearing the attempt stamps as well is what makes an invalidation
    // actually take: a screen that asked moments ago would otherwise decide
    // it was still fresh and skip the refetch this is asking for.
    for (const key of [...attempts.keys()]) {
      if (key.startsWith(prefix)) attempts.delete(key);
    }
  }
  schedulePersist();
}

// Update a cached entry in place from its current value. Lets an optimistic UI
// write (a kudos toggle, an accepted request) survive navigating away and back
// without waiting for a refetch.
export function updateCached(key, updater) {
  const current = getCached(key);
  if (current === undefined) return;
  setCached(key, updater(current));
}

// Everything a finished run or a claim makes wrong, in one place.
//
// This is the one thing stale-while-revalidate genuinely costs: the app's core
// loop is run → claim → back to Home, and Home would otherwise be entitled to
// show the pre-run feed and stats for as long as its staleness window lasts.
// So the write path names what it invalidated. Keep this list next to the keys
// it refers to — a key added to a screen and forgotten here is a screen that
// shows yesterday's numbers straight after a run.
const AFTER_RUN = [
  'feed', 'me:stats', 'me:runs', 'me:run-days', 'me:progression', 'leaderboard:',
  // Mission progress is derived from the runs and steals a run just wrote, so
  // finishing one is exactly when every bar on that screen becomes wrong. The
  // prefix covers the per day keys the week strip opens.
  'me:missions',
  // A finished run is exactly when crossed paths appear — Home's badge and the
  // Crossroads list are both wrong the moment /end-run returns.
  'me:paserby',
  // Every board's "you are 84th of 1,203" line. A run that moved somebody up
  // and then showed them their old position is worse than showing nothing.
  'standing:',
];
const AFTER_CLAIM = [
  ...AFTER_RUN,
  'me:energy',
  'me:rivals',
  'me:clan',
  'clan:',
  'season:',
  // A claim is the only thing that moves a rivalry, and the head-to-head
  // screen is keyed per opponent — hence the prefix rather than one key.
  'rival:',
];
const AFTER_LAND_LOSS = [
  'feed',
  'me:stats',
  'me:rivals',
  'rival:',
  'leaderboard:',
  'standing:',
  'me:clan',
  'clan:',
  'season:',
];

// PASER PRO started or ended. Nothing about the WORLD changed, but several
// responses carry an entitlement-shaped half that the server filled in (or
// left null) at fetch time — a subscriber who just paid must not have to
// restart the app to see the thing they paid for.
const AFTER_ENTITLEMENT = ['pro', 'insights:', 'rival:', 'season:', 'standing:'];

export function invalidateAfterEntitlementChange() {
  AFTER_ENTITLEMENT.forEach((prefix) => invalidate(prefix));
}

// A successful subscribe/sync response already IS the authoritative PRO
// status. Keep that answer instead of invalidating it and asking the same
// server for it again: the mounted ProProvider subscribes to this cache key,
// so writing the response here removes every padlock in the same tick. The
// related entitlement-shaped payloads are still dropped first and will
// revalidate normally when their screens are next opened.
export function applyProEntitlement(status) {
  if (!status || typeof status !== 'object') return;
  invalidateAfterEntitlementChange();
  setCached('pro', status);
}

export function invalidateAfterRun() {
  AFTER_RUN.forEach((prefix) => invalidate(prefix));
}

export function invalidateAfterClaim() {
  AFTER_CLAIM.forEach((prefix) => invalidate(prefix));
}

// Another runner just changed this account's territory from a different
// device. Keep the newly fetched notification cached, but drop every board and
// profile surface whose numbers changed behind the foreground alert.
export function invalidateAfterLandLoss() {
  AFTER_LAND_LOSS.forEach((prefix) => invalidate(prefix));
}

// Run `fetcher` for `key`, sharing a single request between concurrent callers.
export function dedupe(key, fetcher) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

// Fetch through the cache: shared in flight, written on success. The returned
// promise rejects like the raw call does, so callers keep their own error paths.
export async function fetchAndCache(key, fetcher) {
  const data = await dedupe(key, fetcher);
  setCached(key, data);
  return data;
}
