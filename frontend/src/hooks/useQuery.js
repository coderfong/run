// useQuery — the read path for every screen that shows server data.
//
// Replaces the pattern that made the app feel like it was always loading:
//
//   const [items, setItems] = useState(null);            // = show a skeleton
//   useEffect(() => { api.feed().then(setItems); }, []);  // ...for a round trip
//   if (items === null) return <Skeleton />;              // ...every single visit
//
// with:
//
//   const { data: items, loading } = useQuery('feed', api.feed);
//
// The difference is the FIRST RENDER. `useQuery` seeds its state synchronously
// from the response cache (see api/cache.js), so a screen you have opened
// before — which is every screen, after the first minute of using the app —
// mounts with real content already in it. The refresh still happens; it just
// happens behind what you are looking at instead of in front of it. `loading`
// is true only when there is genuinely nothing to show, so skeletons survive
// for the first-ever visit and for a fresh install, which is where they belong.
//
// Revalidation is tied to FOCUS, not mount. The tab navigator keeps all four
// tabs mounted (lazyPreloadDistance: 3), so a mount-only fetch would leave a
// tab showing minutes-old data; a focus fetch refreshes exactly when you look
// at it. `staleMs` stops a quick swipe through the tabs from firing the same
// request three times, and concurrent callers of one endpoint are coalesced
// into a single request by the cache. The FIRST load is focus-gated too, for
// the same reason: a screen the tab navigator merely preloaded is mounted
// without being looked at, and firing its fetch anyway meant opening the app
// fired four screens' worth of requests in one burst. See the first-load
// effect below.
//
// A REFRESH THAT CHANGES NOTHING RENDERS NOTHING. Every focus used to cost
// each query two renders of its screen whatever came back: `refreshing`
// flipped on and off (and no screen reads it; the pull-to-refresh spinners
// all keep their own state), and the response arrived as a new object with
// the same contents. ProfileScreen runs seven queries, so opening You was
// fourteen full renders of the page to redraw it as it was. Now the cache
// hands back the object it already holds when the JSON matches, which React
// skips, and `refreshing` only re-renders a component that reads it.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

import {
  fetchAndCache,
  getCached,
  markAttempt,
  setCached,
  subscribeCached,
  touchedAt,
} from '../api/cache';

// A refetch this soon after the last one buys nothing and costs a request.
const DEFAULT_STALE_MS = 15 * 1000;

/**
 * @param {string|null} key      cache key; null disables the query (e.g. an id
 *                               that hasn't arrived yet)
 * @param {() => Promise<any>} fetcher
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {boolean} [options.refetchOnFocus=true]
 * @param {number}  [options.staleMs]
 * @param {any}     [options.fallback]  value to settle on when the first fetch
 *                                      fails and nothing is cached (usually []
 *                                      so the screen shows its empty state
 *                                      instead of a skeleton forever)
 * @param {(raw:any) => any} [options.select]  shape the response for the screen
 */
export function useQuery(key, fetcher, options = {}) {
  const {
    enabled = true,
    refetchOnFocus = true,
    staleMs = DEFAULT_STALE_MS,
    fallback,
    select,
  } = options;

  const active = enabled && !!key;

  // Synchronous seed — this is what removes the skeleton on a repeat visit.
  const [raw, setRaw] = useState(() => (active ? getCached(key) : undefined));
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Has anything READ `refreshing`? Set by the getter on the returned object.
  // Until something does, the flag is not tracked at all: flipping it costs a
  // render on the way into every fetch and another on the way out, for a value
  // nobody draws.
  const refreshingRead = useRef(false);

  // Screens pass inline arrows, so the fetcher's identity changes every render.
  // Holding it in a ref keeps `key` the only thing that can retrigger a fetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Re-seed when the key changes (navigating between two runners' profiles
  // reuses this component; the previous runner's data must not linger).
  const seededFor = useRef(active ? key : null);
  if (active && seededFor.current !== key) {
    seededFor.current = key;
    const seed = getCached(key);
    setRaw(seed);
    setError(null);
  }

  // `fallback` is nearly always an inline literal, so it must NOT be a
  // dependency of `run` — a fresh identity each render would rebuild `run`,
  // re-fire the load effect, and (for an endpoint that keeps failing, where
  // nothing ever lands in the cache to satisfy the staleness check) spin into
  // a request loop.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const run = useCallback(
    async ({ force = false } = {}) => {
      if (!active) return undefined;
      // `touchedAt` counts failed attempts as well as successes, so a dead
      // endpoint is throttled rather than retried on every render — and it
      // resets when the key is invalidated, so a post-run drop really does
      // force the next look to refetch.
      if (!force && staleMs > 0 && Date.now() - touchedAt(key) < staleMs) return undefined;
      markAttempt(key);
      if (refreshingRead.current) setRefreshing(true);
      try {
        // The CACHED value: an unchanged response comes back as the object
        // already in `raw`, and setting it is a no-op React skips.
        const next = await fetchAndCache(key, () => fetcherRef.current());
        if (mounted.current) {
          setRaw(next);
          setError(null);
        }
        return next;
      } catch (e) {
        if (mounted.current) {
          setError(e);
          // Only fall back when there is nothing on screen. A failed refresh
          // must never blank out content the user is already reading.
          if (getCached(key) === undefined && fallbackRef.current !== undefined) {
            setRaw((prev) => (prev === undefined ? fallbackRef.current : prev));
          }
        }
        return undefined;
      } finally {
        if (mounted.current && refreshingRead.current) setRefreshing(false);
      }
    },
    [active, key, staleMs]
  );

  // Refresh when the screen is actually looked at. NavigationContext is absent
  // outside a navigator (contexts and providers use this hook too), in which
  // case there is nothing to subscribe to and mount-time load is all there is.
  const navigation = useContext(NavigationContext);

  // First load. Forced when there is nothing cached, so a screen that has just
  // mounted with an empty cache asks straight away — the cache's in-flight
  // coalescing makes that free when two screens really do ask at once.
  //
  // Gated on focus for a screen that HAS a navigation context and is not
  // focused: the tab navigator keeps all four tabs mounted at once
  // (lazyPreloadDistance: 3), so without this every one of them fired its
  // first fetch in the same burst the instant the app opened, whether or not
  // the tab was ever looked at. A preloaded-but-unfocused screen now gets its
  // first fetch from the `focus` listener below instead, when the tab is
  // actually opened — that `run()` call still fetches (unforced doesn't mean
  // skipped, only throttled) because nothing has been attempted yet, so nothing
  // about what a freshly-opened tab shows changes, only when the request fires.
  useEffect(() => {
    if (!active) return;
    // Deferring only holds together because the focus listener below is what
    // eventually fires the fetch — a caller that opts OUT of it
    // (`refetchOnFocus: false`) would otherwise mount unfocused and never
    // fetch at all.
    if (refetchOnFocus && navigation?.isFocused && !navigation.isFocused()) return;
    run({ force: touchedAt(key) === 0 });
  }, [active, key, run, navigation, refetchOnFocus]);

  useEffect(() => {
    if (!active || !refetchOnFocus || !navigation?.addListener) return undefined;
    const unsub = navigation.addListener('focus', () => run());
    return unsub;
  }, [active, refetchOnFocus, navigation, run]);

  // A root listener can refresh a key while this screen remains mounted (for
  // example a foreground land capture updates the notification inbox while
  // Home is visible). Mirror those cache writes into hook state immediately so
  // the bell badge and any open list do not wait for another focus event.
  // An unchanged publication carries the object already held, so it costs
  // nothing unless it clears an error.
  useEffect(() => {
    if (!active) return undefined;
    return subscribeCached(key, (next) => {
      if (mounted.current) {
        setRaw(next);
        // A cache publication is a successful answer, even when it came from
        // a sibling mutation rather than this hook's own fetch. Leaving the
        // old error attached made entitlement self-heal keep retrying after a
        // subscribe/sync response had already proved PRO active.
        setError(null);
      }
    });
  }, [active, key]);

  // Pull-to-refresh and post-mutation refreshes bypass the staleness floor.
  const refresh = useCallback(() => run({ force: true }), [run]);

  // Local writes (optimistic toggles) land in the cache too, so navigating away
  // and back shows the new state rather than reverting to the last response.
  // Kept out of the state updater on purpose: React may run an updater twice,
  // and writing to the cache from inside one would make that a double write.
  // What is set is what the cache KEPT, so a write that changes nothing keeps
  // the identity already on screen.
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const setData = useCallback(
    (next) => {
      const value = typeof next === 'function' ? next(rawRef.current) : next;
      const kept = active ? setCached(key, value) : value;
      setRaw(kept === undefined ? value : kept);
    },
    [active, key]
  );

  // `select` is nearly always an inline arrow, so it cannot be a dependency:
  // re-running it every render would hand a NEW array to the list on each pass
  // and defeat every memo below it. Keyed on the response alone.
  const selectRef = useRef(select);
  selectRef.current = select;
  const data = useMemo(
    () => (selectRef.current && raw !== undefined ? selectRef.current(raw) : raw),
    [raw]
  );

  const result = {
    data,
    // Nothing to paint yet — the only state that should produce a skeleton.
    loading: raw === undefined,
    error,
    refresh,
    setData,
  };
  // A refresh is running over content that is already on screen. A getter,
  // because READING it is what turns the tracking on (see `refreshingRead`).
  Object.defineProperty(result, 'refreshing', {
    enumerable: true,
    get() {
      refreshingRead.current = true;
      return refreshing;
    },
  });
  return result;
}

export default useQuery;
