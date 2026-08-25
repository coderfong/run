// What these lock down is the difference between a fix and a step. The old
// trail took every fix more than 2 m from the last one, so GPS error became
// distance: standing still grew the total and one coarse fix added a sprint.
// Each case here compares the filter against that naive rule on the same
// synthetic stream, so a regression shows up as the gap closing.

import { createGpsFilter, filterPoints, haversineM, pathDistanceM } from '../src/run/gpsFilter';

const LAT = 0; // on the equator a degree of longitude is a clean 111320 m
const M_PER_DEG = 111320;

const at = (eastM, northM) => ({
  latitude: LAT + northM / M_PER_DEG,
  longitude: eastM / M_PER_DEG,
});

// Deterministic noise, so a bad seed can never make CI flaky.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The rule the trail used before the filter existed: append anything more
// than 2 m from the previous fix, and sum the whole lot.
function naiveDistance(fixes) {
  const kept = [];
  for (const f of fixes) {
    const prev = kept[kept.length - 1];
    if (prev && haversineM(prev, f) < 2) continue;
    kept.push(f);
  }
  return pathDistanceM(kept);
}

function run(fixes, options) {
  const filter = createGpsFilter(options);
  const path = [];
  for (const f of fixes) {
    const res = filter.accept(f);
    if (res.advanced) path.push(res.point);
  }
  return { filter, path, distanceM: filter.distanceM };
}

describe('standing still', () => {
  const fixes = [];
  const rand = lcg(7);
  for (let i = 0; i < 300; i++) {
    const angle = rand() * Math.PI * 2;
    const r = rand() * 5;
    fixes.push({
      ...at(Math.cos(angle) * r, Math.sin(angle) * r),
      timestamp: 1000 + i * 1000,
      accuracyM: 8,
    });
  }

  test('five minutes of jitter is not five minutes of running', () => {
    const { distanceM } = run(fixes);
    expect(distanceM).toBeLessThan(40);
  });

  test('and the naive rule it replaces was an order of magnitude worse', () => {
    expect(naiveDistance(fixes)).toBeGreaterThan(run(fixes).distanceM * 10);
  });
});

describe('steady running', () => {
  // 3 m/s due east for five minutes: 900 m of real ground.
  const fixes = [];
  const rand = lcg(21);
  for (let i = 0; i <= 300; i++) {
    fixes.push({
      ...at(i * 3 + (rand() - 0.5) * 6, (rand() - 0.5) * 6),
      timestamp: 1000 + i * 1000,
      accuracyM: 6,
    });
  }

  test('measures the ground that was covered', () => {
    const { distanceM } = run(fixes);
    expect(distanceM).toBeGreaterThan(855); // within 5% of 900 m
    expect(distanceM).toBeLessThan(945);
  });

  test('the step gate defers distance rather than dropping it', () => {
    // Half the fixes fall short of the noise floor and never extend the
    // trail, but the metres they covered still arrive in the next step, so
    // the total does not sag with a tighter sampling interval.
    const { path } = run(fixes);
    expect(path.length).toBeLessThan(fixes.length);
    expect(path.length).toBeGreaterThan(20);
  });

  test('reads a pace close to the one being run', () => {
    // Polled once a second, the way the run clock does it.
    const filter = createGpsFilter();
    let pace = null;
    for (const f of fixes) {
      filter.accept(f);
      pace = filter.paceSPerKm(f.timestamp);
    }
    expect(pace).toBeGreaterThan(310); // 3 m/s is 333 s/km
    expect(pace).toBeLessThan(360);
  });
});

describe('a bad fix', () => {
  const clean = [];
  for (let i = 0; i <= 60; i++) {
    clean.push({ ...at(i * 3, 0), timestamp: 1000 + i * 1000, accuracyM: 5 });
  }

  test('too coarse to trust never enters the trail', () => {
    const withOutlier = clean.slice();
    withOutlier.splice(30, 0, {
      ...at(30 * 3, 120), // 120 m off the route
      timestamp: 1000 + 30 * 1000 + 500,
      accuracyM: 60,
    });
    const straight = run(clean).distanceM;
    const spiked = run(withOutlier).distanceM;
    expect(Math.abs(spiked - straight)).toBeLessThan(5);
    // The rule it replaces paid for the excursion twice, out and back.
    expect(naiveDistance(withOutlier)).toBeGreaterThan(naiveDistance(clean) + 200);
  });

  test('claiming a runner sprinted is dropped outright', () => {
    const teleport = clean.slice();
    teleport.splice(30, 0, {
      ...at(30 * 3 + 400, 0),
      timestamp: 1000 + 30 * 1000 + 500,
      accuracyM: 5, // sharp, but 400 m in half a second
    });
    expect(Math.abs(run(teleport).distanceM - run(clean).distanceM)).toBeLessThan(5);
  });

  test('with no reported accuracy is still measured, not trusted blindly', () => {
    // Assumed accuracy is deliberately pessimistic, so the gate is coarser
    // and the estimate trails a little further behind. The run still has to
    // be recognisably its own length.
    const unknown = clean.map(({ accuracyM, ...rest }) => rest);
    const { distanceM } = run(unknown);
    expect(distanceM).toBeGreaterThan(150); // of 180 m travelled
  });

  test('that persists is a real move, not a glitch, and the trail resyncs', () => {
    // Losing the constellation in a tunnel and refinding it 400 m along is
    // not a run of 400 m, but it is not a reason to stop recording either.
    const tunnel = clean.slice(0, 30);
    for (let i = 0; i <= 30; i++) {
      tunnel.push({
        ...at(30 * 3 + 400 + i * 3, 0),
        timestamp: 1000 + (30 + i) * 1000,
        accuracyM: 5,
      });
    }
    const { distanceM, path } = run(tunnel);
    expect(distanceM).toBeLessThan(300); // the 400 m gap is never credited
    expect(path[path.length - 1].longitude).toBeCloseTo(tunnel[tunnel.length - 1].longitude, 4);
  });

  test('is refused long enough for a caller to call it a vehicle first', () => {
    // RunningScreen counts consecutive refusals towards its auto-pause. The
    // filter must not forgive the streak before that count is reached, or a
    // bus ride on a platform that reports no speed would record as a run.
    const filter = createGpsFilter();
    filter.accept({ ...at(0, 0), timestamp: 1000, accuracyM: 5 });
    let refused = 0;
    for (let i = 1; i <= 5; i++) {
      const res = filter.accept({ ...at(i * 60, 0), timestamp: 1000 + i * 1000, accuracyM: 5 });
      if (res.reason === 'teleport') refused += 1;
    }
    expect(refused).toBeGreaterThanOrEqual(5);
  });
});

describe('rebuilding a path', () => {
  // Merging the background buffer re-runs the whole path through the gates.
  // Points that were already conditioned have to survive that untouched, or
  // every return to the foreground would shave metres off the run.
  const raw = [];
  for (let i = 0; i <= 120; i++) {
    raw.push({ ...at(i * 3, 0), timestamp: 1000 + i * 1000, accuracyM: 6 });
  }

  test('is idempotent once the points are conditioned', () => {
    const first = filterPoints(raw);
    const second = filterPoints(first.points);
    expect(second.points).toHaveLength(first.points.length);
    expect(second.distanceM).toBeCloseTo(first.distanceM, 6);
  });

  test('mixes buffered raw fixes in without re-smoothing the rest', () => {
    const conditioned = filterPoints(raw.slice(0, 60)).points;
    const buffered = raw.slice(60);
    const merged = filterPoints([...conditioned, ...buffered]);
    expect(merged.distanceM).toBeGreaterThan(filterPoints(raw).distanceM * 0.9);
  });

  test('seeding keeps the pace window alive across a merge', () => {
    const { points, distanceM } = filterPoints(raw);
    const filter = createGpsFilter();
    filter.seed(points, distanceM);
    expect(filter.distanceM).toBe(distanceM);
    expect(filter.paceSPerKm(points[points.length - 1].timestamp)).not.toBeNull();
  });
});

describe('pace', () => {
  test('says nothing at all rather than guessing early', () => {
    const filter = createGpsFilter();
    filter.accept({ ...at(0, 0), timestamp: 1000, accuracyM: 5 });
    filter.accept({ ...at(10, 0), timestamp: 4000, accuracyM: 5 });
    expect(filter.paceSPerKm(4000)).toBeNull();
  });

  test('goes quiet when the runner has stopped', () => {
    const filter = createGpsFilter();
    for (let i = 0; i <= 120; i++) {
      filter.accept({ ...at(i * 3, 0), timestamp: 1000 + i * 1000, accuracyM: 5 });
    }
    const last = 1000 + 120 * 1000;
    expect(filter.paceSPerKm(last)).not.toBeNull();
    expect(filter.paceSPerKm(last + 90000)).toBeNull();
  });

  test('follows a change of effort instead of averaging it away', () => {
    // Six minutes easy, then three minutes hard. A cumulative average would
    // still be reading the easy half; the window has moved on.
    const filter = createGpsFilter();
    let t = 1000;
    let x = 0;
    let easy = null;
    let hard = null;
    for (let i = 0; i < 360; i++, t += 1000) {
      x += 2.5;
      filter.accept({ ...at(x, 0), timestamp: t, accuracyM: 5 });
      easy = filter.paceSPerKm(t);
    }
    for (let i = 0; i < 180; i++, t += 1000) {
      x += 4.5;
      filter.accept({ ...at(x, 0), timestamp: t, accuracyM: 5 });
      hard = filter.paceSPerKm(t);
    }
    expect(easy).toBeGreaterThan(370); // 2.5 m/s is 400 s/km
    expect(hard).toBeLessThan(260); // 4.5 m/s is 222 s/km
  });
});
