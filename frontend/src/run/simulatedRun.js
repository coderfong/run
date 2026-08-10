// A run that never happened.
//
// The post-run flow is the most expensive thing in this app to look at. Seeing
// it once costs a real half hour outdoors, the day's claim on that run, and the
// energy to take the ground — and the best parts of it (a level-up, a steal off
// somebody, crossing paths) only appear when the world happens to line up. That
// makes it nearly impossible to tune, and it is the sequence players see after
// every single run.
//
// This builds a GPS trace and hands it to the ordinary /start-run -> /end-run
// path. Nothing downstream is mocked: the claim options, the territory, the
// victims, the XP and the standings all come back from the server exactly as
// they would for a run on legs. That is the point, and it is also the
// constraint — the trace has to clear every bar a real run clears:
//
//   * over the claim thresholds with room to spare (1 km, 7 min) and covering
//     enough DISTINCT ground (700 m), so the loop is one lap and never laps
//   * pace nowhere near the 2:50/km floor, no gap near the 12 m/s ceiling
//   * a step count inside a plausible stride, since a working pedometer
//     reporting nothing across kilometres is the vehicle signature
//   * noise. Real GPS wanders, and a trace with too-even spacing or a fixed
//     accuracy reading is flagged as coming from a simulator, which it is. The
//     wobble below is what keeps the run's flag list empty so the result that
//     comes back is an ordinary one rather than a withheld one.
//
// It is a development harness and nothing outside one may import it: a button
// that mints territory from a desk is a cheat, and the server cannot tell this
// apart from a run. See DevRunSimulator, the only caller, and
// backend/app/devtools.py for the allowlist that decides who reaches it — the
// gate is server-side precisely because this file's output is indistinguishable
// from the real thing.

// Metres per degree of latitude is near enough constant; longitude shrinks with
// the cosine of the latitude, which matters at any distance worth simulating.
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

// Somewhere to stand when the phone has no fix yet (simulator, permission not
// granted, indoors on a cold start). Anywhere real will do — the ground it
// claims is only ever the ground the trace covers.
export const FALLBACK_ORIGIN = { latitude: 1.3521, longitude: 103.8198 };

// What the harness offers. Every one clears the claim bars; the shortest is
// deliberately just over them, because "barely qualified" is the case most
// worth being able to look at.
export const SIM_PRESETS = [
  { key: 'min', label: '1.2 km', distanceM: 1200, paceSPerKm: 400 },
  { key: 'short', label: '3 km', distanceM: 3000, paceSPerKm: 385 },
  { key: 'mid', label: '5 km', distanceM: 5000, paceSPerKm: 370 },
  { key: 'long', label: '10 km', distanceM: 10000, paceSPerKm: 355 },
];

// Seeded, so tuning a shape can be repeated and the test below is not a
// coin flip. mulberry32 — small, fast, good enough for jitter.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The circuit, in metres, before it is scaled or placed anywhere.
//
// A superellipse rather than a circle: four longish straights joined by rounded
// corners is what a lap of a few blocks actually looks like, and a perfect
// circle both reads as fake on the map and grows a dull territory. The two
// harmonics on the radius bend the straights so no two sides match.
function circuit(samples) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const a = ((i % samples) / samples) * Math.PI * 2;
    const wobble = 1 + 0.09 * Math.sin(3 * a + 0.7) + 0.05 * Math.cos(5 * a + 2.1);
    // |cos|^0.5 with the sign kept is the n=4 superellipse: a squared-off oval.
    const round = (v) => Math.sign(v) * Math.sqrt(Math.abs(v));
    pts.push([round(Math.cos(a)) * 1.35 * wobble, round(Math.sin(a)) * wobble]);
  }
  return pts;
}

function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

/**
 * Build a submittable run.
 *
 * @param origin      {latitude, longitude} the loop is centred on
 * @param distanceM   how far the run should be
 * @param paceSPerKm  seconds per km, which decides how long it took
 * @param endedAtMs   when it finished (the start is derived backwards)
 * @param seed        fixed for a repeatable trace
 * @returns {points, stepCount, startedAtMs, distanceM, durationS}
 *          `points` are in the shape RunningScreen keeps its own path in, so
 *          they go through `toApiPoints` and the normal commit like any other.
 */
export function buildSimulatedRun({
  origin = FALLBACK_ORIGIN,
  distanceM = 3000,
  paceSPerKm = 385,
  endedAtMs = Date.now(),
  seed = 1,
} = {}) {
  const rand = mulberry32(seed);
  const durationS = (distanceM / 1000) * paceSPerKm;
  const startedAtMs = endedAtMs - durationS * 1000;
  const speed = 1000 / paceSPerKm; // m/s

  // 1. the shape, scaled so once round it is the distance asked for
  const shape = circuit(1440);
  const k = distanceM / polylineLength(shape);
  const scaled = shape.map(([x, y]) => [x * k, y * k]);

  // 2. arc-length table, so samples can be dropped at chosen distances rather
  //    than at whatever spacing the parametrisation happened to give
  const cum = [0];
  for (let i = 1; i < scaled.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(scaled[i][0] - scaled[i - 1][0], scaled[i][1] - scaled[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  let cursor = 0;
  const pointAt = (d) => {
    while (cursor < cum.length - 2 && cum[cursor + 1] < d) cursor += 1;
    const span = cum[cursor + 1] - cum[cursor] || 1;
    const f = Math.max(0, Math.min(1, (d - cum[cursor]) / span));
    const [x0, y0] = scaled[cursor];
    const [x1, y1] = scaled[cursor + 1];
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  };

  // 3. walk it, dropping a fix every few seconds the way a phone does. The
  //    interval is deliberately uneven: a fixed cadence is the single clearest
  //    tell that nobody was holding the phone.
  const marks = [];
  for (let d = 0; d < total; ) {
    marks.push(d);
    d += speed * (2 + rand() * 3) * (0.88 + rand() * 0.24);
  }
  marks.push(total);

  // 4. time. Each gap gets its own pace, then the whole set is scaled so the
  //    run lasts exactly as long as it claims to — otherwise the jitter
  //    compounds and a 5 km "30 minute" run finishes in 27.
  const gaps = [];
  for (let i = 1; i < marks.length; i++) {
    gaps.push((marks[i] - marks[i - 1]) / (speed * (0.9 + rand() * 0.2)));
  }
  const timeScale = durationS / (gaps.reduce((a, b) => a + b, 0) || 1);

  // 5. place it on the map, with the wander a real fix has
  const mLon = M_PER_DEG_LON * Math.cos((origin.latitude * Math.PI) / 180);
  const points = [];
  let t = startedAtMs;
  for (let i = 0; i < marks.length; i++) {
    if (i > 0) t += gaps[i - 1] * timeScale * 1000;
    const [x, y] = pointAt(marks[i]);
    const jx = (rand() - 0.5) * 6; // about +-3 m, a phone between buildings
    const jy = (rand() - 0.5) * 6;
    const frac = marks[i] / total;
    points.push({
      latitude: origin.latitude + (y + jy) / M_PER_DEG_LAT,
      longitude: origin.longitude + (x + jx) / mLon,
      timestamp: Math.round(t),
      // One rise and one fall over the loop, plus noise: enough for the result
      // screen's elevation figure to have something honest to add up.
      altitude: 24 + 16 * Math.sin(frac * Math.PI * 2) + (rand() - 0.5) * 2.4,
      accuracyM: 4 + rand() * 9,
      speedMps: i === 0 ? 0 : (marks[i] - marks[i - 1]) / (gaps[i - 1] * timeScale),
      mocked: false,
    });
  }

  // 6. steps. A stride in the middle of the plausible band, jittered, so the
  //    server's distance-over-steps check reads as a person running.
  const stride = 0.78 + rand() * 0.14;

  return {
    points,
    stepCount: Math.round(distanceM / stride),
    startedAtMs: Math.round(startedAtMs),
    distanceM,
    durationS,
  };
}
