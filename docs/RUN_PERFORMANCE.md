# Run screen: heat and lag

Testers reported the phone getting hot and the app lagging during a run. This
is the standing audit of what the run screen actually does per second, split
into what has been **proven from the source** and what still needs a **profiler
on hardware**. It is written to be worked through in order: the top item is
believed to dominate everything below it.

The companion fix already landed: vehicle detection no longer blocks the screen
(`src/run/vehicleGate.js`, and the notice in `RunningScreen`). Its one thermal
component is fixed too and listed under *Done* below.

## What runs, and how often

During an active run, with GPS on `high` (`theme/tokens.js` `gpsHigh`):

| Work | Cadence | Where |
|---|---|---|
| GPS fix accepted | up to **1/s** (3s relaxed) | `RunningScreen.onLocation` |
| `setPath` on a fresh array | per accepted fix | `RunningScreen` |
| Trail GeoJSON rebuild | per accepted fix | `components/GameMap.js:266` |
| Run clock redraw | **4/s** | `RunningScreen.js:147` |
| Elapsed tick | 1/s | `RunningScreen.js:996` |
| Vehicle window check | 1 per 45s | `RunningScreen.startVehicleWatch` |
| Live marker | static | `CharacterBust` in the render |
| Route head effect | removed | — |
| Nearby-land portraits | up to **12 rigs** | `boardPortraits` |

## Proven from the source, in priority order

### 1. The trail is rebuilt from scratch on every GPS fix — O(N²) per run

`Trail` is a plain function component, not memoized, and it calls
`lineFeature(points)` in its body (`components/GameMap.js:266`, `:54`), which
does `points.map(toLngLat)` over the **entire path so far**. Every accepted fix
calls `setPath([...pathRef.current, nextPoint])`, a new array, so every fix
re-renders `Trail` and rebuilds the whole coordinate list, then hands a brand
new shape object to native Mapbox.

At 1 fix/s, an hour's run ends with ~3600 points and has rebuilt that list 3600
times: on the order of 6.5 million coordinate objects allocated and thrown
away, plus 3600 bridge crossings whose payload grows all run. The cost per fix
rises linearly as the run goes on, which matches the reported shape of the
problem — fine at first, hot and laggy later.

This is the first thing to fix and the first thing to measure.

### 2. `React.memo(GameMap)` cannot bite during a run

`GameMap` is wrapped in `React.memo` (`components/GameMap.js:260`), but the run
screen passes its layers as `children`. A parent re-render always produces a
new child element tree, so `props.children` always differs by identity and the
memo never short-circuits. Every `setPath` therefore re-renders the whole map
subtree, not just the trail. Same class of problem as the 2026-08-15 pass where
unstable callbacks defeated Mapbox's own `PureComponent` gate.

### 3. Up to 12 character rigs are mounted on the map

`boardPortraits` keeps `.slice(0, 12)` owner busts, each a `CharacterBust`, and
they sit inside the same subtree that re-renders on every fix per item 2. Rigs
were already a measured cost in the 2026-08-14 pass.

### 4. Continuous run-marker animations — fixed

The live marker's `Pulse` and `routeHead` Lottie used to loop for the entire
run. The marker is now static, removing two permanent render loops from a
surface that can remain open for hours.

## Needs a profiler on hardware

None of these can be settled by reading the source.

- **Where the heat actually comes from.** Sustained GPS at 1Hz with the screen
  on is a known thermal load on its own, independent of anything above. Until
  a run is profiled with the map torn out, the split between radio, display and
  JS is a guess.
- **Whether the JS thread or the render thread is saturated.** Item 1 is JS
  thread; items 2 to 4 are mostly commit and native map work.
- **Whether the older supported iPhones behave differently in kind**, not just
  degree. Target the oldest device in the support matrix, not a dev phone.
- **Whether `gpsRelaxed` is being entered at all** in real running conditions,
  and what the adaptive sampling actually settles on.

Suggested method: Instruments (Time Profiler + Energy Log) over a 20 minute
simulated run, once as shipped, once with `Trail` memoized and fed a stable
shape, and once with `TerritoryLayer` and the portraits removed. Three runs
answer items 1 to 3 between them.

## Done

- **The vehicle watchdog no longer re-walks the trail.** It used to call
  `totalDistanceMeters(pathRef.current)` every 45 seconds, a haversine per
  recorded point, on the JS thread, for the whole run. It now reads a mirrored
  running total kept by the GPS filter, which is O(1). Small next to item 1,
  but it was the same bug in miniature and it was on the detection path item 12
  said must stay off the UI thread.
