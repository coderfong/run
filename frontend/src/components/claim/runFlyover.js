// The run, replayed in 3D, before anything is claimed.
//
// The claim sequence used to open on a top-down camera snapping to the ground
// about to change hands. That skips the part the runner actually did: this
// flies the camera along their route at a pitch, so the run is re-lived as a
// place — buildings edge-on, the trail unrolling ahead — and the claim then
// lands on ground they have just been shown.
//
// It is a CAMERA animation, not a render. Mapbox is already drawing the world;
// all this does is move the eye along the route and let the trail catch up
// behind it. That keeps it cheap enough to run on the same screen as the rest
// of the sequence, and it works with whatever map style is loaded.
//
// Everything load-bearing here is about the JOINTS between hops. The flyover
// is a chain of short `setCamera` calls rather than one long one, because a
// single call cannot follow a bent route. So:
//
//   * every hop uses animationMode 'linearTo'. The default easeTo accelerates
//     and decelerates within each hop, which at ten hops a second reads as a
//     stutter at every joint rather than as flight.
//   * the heading for a hop is the bearing to the point AHEAD of the one being
//     flown to, not the one being flown to. Turning to face where you are
//     going already looks like flying; turning to face where you have arrived
//     means the camera swings after the fact, at the corner, every corner.
//   * the camera path is SMOOTHED (`smoothPath`) before it is flown. Sampled
//     waypoints sit on the route, and a route has corners; a camera that hits
//     each corner exactly has to change direction instantly there. Rounding
//     the path costs a couple of metres of fidelity — nobody is checking the
//     camera against the pavement — and buys a continuous curve.
//   * the headings are smoothed too, and UNWRAPPED first (`flightHeadings`).
//     Averaging 359 and 1 naively gives 180: a camera that whips round to face
//     backwards at the one corner that crosses north.
//   * each hop is given slightly MORE time than it is allowed to run before
//     the next one retargets it (`HOP_LEAD_MS`). Timers fire late, and a hop
//     that lands early sits still until its successor arrives — visible as a
//     tick at every joint. Overlapping them means the camera is always in
//     flight and simply trails its target by a fixed fraction of a hop.
//   * hop deadlines are measured from the start of the flight, not from "now
//     plus a hop", so late timers do not accumulate into a flyover that
//     overruns the beat it was budgeted.

const EARTH_R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversine(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude);
  const la2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Compass bearing from a to b, degrees clockwise from north. */
export function bearing(a, b) {
  const la1 = toRad(a.latitude);
  const la2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Resample a recorded path to `count` points spaced evenly by DISTANCE.
 *
 * Not by index: GPS fixes cluster where the runner slowed down and thin out
 * where they sped up, so flying the raw points would crawl up every hill and
 * sprint every descent. The camera should move at one speed.
 */
export function evenlySpaced(path, count) {
  const pts = (path || []).filter(
    (p) => p && isFinite(p.latitude) && isFinite(p.longitude)
  );
  if (pts.length < 2 || count < 2) return pts.slice(0, Math.max(1, count));

  const acc = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += haversine(pts[i - 1], pts[i]);
    acc.push(total);
  }
  if (total <= 0) return [pts[0], pts[pts.length - 1]];

  const out = [];
  let cursor = 1;
  for (let i = 0; i < count; i++) {
    const want = (total * i) / (count - 1);
    while (cursor < acc.length - 1 && acc[cursor] < want) cursor += 1;
    const a = pts[cursor - 1];
    const b = pts[cursor];
    const span = acc[cursor] - acc[cursor - 1];
    const f = span > 0 ? (want - acc[cursor - 1]) / span : 0;
    out.push({
      latitude: a.latitude + (b.latitude - a.latitude) * f,
      longitude: a.longitude + (b.longitude - a.longitude) * f,
    });
  }
  return out;
}

/**
 * Round the corners off a sampled camera path.
 *
 * A moving average of three, endpoints pinned so the flight still starts where
 * the run started and finishes where it finished. This is applied to the
 * CAMERA path only — the trail on the map is drawn from the real recording, so
 * nothing the runner sees moves off the pavement.
 *
 * Two passes takes a right-angled corner and spreads the turn over about a
 * third of the hops either side of it, which is the difference between a
 * camera that pivots and a camera that banks.
 */
export function smoothPath(points, passes = 2) {
  let out = (points || []).filter((p) => p && isFinite(p.latitude) && isFinite(p.longitude));
  if (out.length < 3) return out;
  for (let pass = 0; pass < passes; pass++) {
    const next = out.slice();
    for (let i = 1; i < out.length - 1; i++) {
      next[i] = {
        latitude: (out[i - 1].latitude + out[i].latitude * 2 + out[i + 1].latitude) / 4,
        longitude: (out[i - 1].longitude + out[i].longitude * 2 + out[i + 1].longitude) / 4,
      };
    }
    out = next;
  }
  return out;
}

/**
 * The heading to hold at each waypoint: continuous, and facing where the
 * camera is going rather than where it has arrived.
 *
 * Bearings are angles on a circle, so they are UNWRAPPED before anything is
 * averaged — a run that crosses north hands out 359 next to 1, and the mean of
 * those two is 180, i.e. the exact opposite of the truth. Unwrapped, the pair
 * is 359 and 361 and the mean is the 0 it should always have been. The result
 * is wrapped back into [0, 360) because that is what Mapbox's `heading` wants.
 */
export function flightHeadings(route, lookAhead = 2, passes = 2) {
  if (!route || route.length < 2) return route ? route.map(() => 0) : [];

  const raw = [];
  for (let i = 0; i < route.length; i++) {
    const from = route[Math.max(0, i - 1)];
    const to = route[Math.min(route.length - 1, i + lookAhead)];
    // Two identical points have no bearing between them — a runner who stood
    // still keeps whatever they were last facing rather than snapping north.
    const same = from.latitude === to.latitude && from.longitude === to.longitude;
    raw.push(same ? raw[i - 1] ?? 0 : bearing(from, to));
  }

  // Unwrap: each heading is carried to whichever revolution sits nearest its
  // predecessor, so the series is continuous and safe to average.
  const open = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    open.push(open[i - 1] + (((raw[i] - open[i - 1] + 540) % 360) - 180));
  }

  let smooth = open;
  for (let pass = 0; pass < passes; pass++) {
    const next = smooth.slice();
    for (let i = 1; i < smooth.length - 1; i++) {
      next[i] = (smooth[i - 1] + smooth[i] * 2 + smooth[i + 1]) / 4;
    }
    smooth = next;
  }
  return smooth.map((h) => ((h % 360) + 360) % 360);
}

// How far apart the sampled waypoints are. Fewer, longer hops used to be the
// smoother option because every joint was a visible stop; now that the joints
// overlap and both the path and the headings are smoothed, more waypoints just
// means a finer curve. ~22 traces a city loop as its own shape and still costs
// only about six `setCamera` calls a second.
export const FLYOVER_STEPS = 22;

// How much longer than its slice of the flight each hop is animated for. The
// next hop retargets the camera before this one lands, so the camera never
// comes to rest at a waypoint — it trails its target by a constant fraction of
// a hop, which is invisible, instead of ticking at every one, which is not.
const HOP_LEAD_MS = 60;

/**
 * Fly the camera along `path`, pitched over, drawing the trail behind it.
 *
 * @param mapRef      the GameMap ref (needs `setCameraTo`)
 * @param path        the recorded route, [{latitude, longitude}]
 * @param opts.totalMs      how long the whole pass takes
 * @param opts.pitch        camera tilt, degrees (0 is top-down)
 * @param opts.zoom         zoom to hold while flying
 * @param opts.onProgress   (0..1) each hop, so the caller can grow the trail
 * @param opts.alive        () => boolean; the flyover stops the moment this
 *                          goes false, which is how a skip or an unmount kills
 *                          it mid-flight instead of letting it keep driving a
 *                          camera the screen no longer owns
 * @param opts.wait         (ms) => Promise, supplied by the caller so its own
 *                          cancellation applies to these sleeps too
 * @returns true if it flew the whole way, false if it bailed or could not run
 */
export async function flyRun(mapRef, path, opts = {}) {
  const {
    totalMs = 4200,
    pitch = 55,
    zoom = 16,
    steps = FLYOVER_STEPS,
    onProgress,
    alive = () => true,
    wait,
  } = opts;

  const map = mapRef?.current;
  const sleep = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Sample by distance, then round the corners: one gives a camera that moves
  // at one speed, the other a camera that changes direction gradually.
  const route = smoothPath(evenlySpaced(path, steps));
  if (!map?.setCameraTo || route.length < 2) return false;

  const headings = flightHeadings(route);
  // The approach is part of the budget, not extra on top of it, so a flyover
  // asked for 4.2s takes 4.2s however many waypoints it ends up with.
  const approach = Math.min(900, Math.max(320, Math.round(totalMs * 0.16)));
  const hop = Math.max(90, Math.round((totalMs - approach) / (route.length - 1)));

  // Open at the start of the run, already pitched and already facing the way
  // the runner set off. Getting into position is not part of the replay, so it
  // happens in one move before the first hop rather than being eased into
  // over the first few.
  map.setCameraTo({
    center: route[0],
    zoom,
    pitch,
    heading: headings[0],
    durationMs: approach,
  });
  onProgress?.(0);
  await sleep(approach);
  if (!alive()) return false;

  // Deadlines are measured from here rather than each hop waiting a full `hop`
  // from whenever the last timer happened to fire. Timers run late, and late
  // that accumulates over twenty hops is a flyover that overruns its beat.
  const started = Date.now();
  for (let i = 1; i < route.length; i++) {
    map.setCameraTo({
      center: route[i],
      zoom,
      pitch,
      heading: headings[i],
      // Longer than the slice it gets: the next hop cuts this one short, so
      // the camera is retargeted mid-flight rather than after a pause.
      durationMs: hop + HOP_LEAD_MS,
      mode: 'linearTo',
    });
    onProgress?.(i / (route.length - 1));
    const due = started + i * hop;
    await sleep(Math.max(16, due - Date.now()));
    if (!alive()) return false;
  }
  // Let the last hop finish the extra it was given, so the flight ends on the
  // finish line instead of being levelled a few metres short of it.
  await sleep(HOP_LEAD_MS);
  return alive();
}

/**
 * Put the camera back on its back, ready for the claim beats.
 *
 * The reveal projects map coordinates into screen pixels and draws an SVG over
 * them. That projection is only true for a camera looking straight down: at a
 * pitch the ground plane is foreshortened, so a polygon drawn from projected
 * points would sit correctly at its near edge and drift further out the deeper
 * into the scene it goes. So the tilt has to be unwound BEFORE anything is
 * projected, and `useClaimReveal.focus` must not run until this has settled.
 */
export function levelCamera(mapRef, durationMs = 600) {
  mapRef?.current?.setCameraTo({ pitch: 0, heading: 0, durationMs });
}
