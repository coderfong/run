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
// Two things here are load-bearing and both are about the JOINTS between hops.
// The flyover is a chain of short `setCamera` calls rather than one long one,
// because a single call cannot follow a bent route. So:
//
//   * every hop uses animationMode 'linearTo'. The default easeTo accelerates
//     and decelerates within each hop, which at ten hops a second reads as a
//     stutter at every joint rather than as flight.
//   * the heading for a hop is the bearing to the point AHEAD of the one being
//     flown to, not the one being flown to. Turning to face where you are
//     going already looks like flying; turning to face where you have arrived
//     means the camera swings after the fact, at the corner, every corner.

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

// How far apart the sampled waypoints are. Fewer, longer hops are smoother
// (less to stutter between) but cut corners; more, shorter hops trace the
// route faithfully and cost a `setCamera` each. ~14 is where a city loop still
// reads as its own shape.
export const FLYOVER_STEPS = 14;

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
  const route = evenlySpaced(path, steps);
  if (!map?.setCameraTo || route.length < 2) return false;

  const hop = Math.max(120, Math.round(totalMs / route.length));

  // Open at the start of the run, already pitched and already facing the way
  // the runner set off. Getting into position is not part of the replay, so it
  // happens in one move before the first hop rather than being eased into
  // over the first few.
  map.setCameraTo({
    center: route[0],
    zoom,
    pitch,
    heading: bearing(route[0], route[1]),
    durationMs: Math.min(900, hop * 3),
  });
  onProgress?.(0);
  await sleep(Math.min(900, hop * 3));
  if (!alive()) return false;

  for (let i = 1; i < route.length; i++) {
    // Face where the camera is GOING, not where it has just arrived.
    const ahead = route[Math.min(i + 1, route.length - 1)];
    map.setCameraTo({
      center: route[i],
      zoom,
      pitch,
      heading: bearing(route[i - 1], ahead),
      durationMs: hop,
      mode: 'linearTo',
    });
    onProgress?.(i / (route.length - 1));
    await sleep(hop);
    if (!alive()) return false;
  }
  return true;
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
