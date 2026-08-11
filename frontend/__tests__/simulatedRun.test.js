/**
 * The simulated trace has to survive the server, or the dev harness is worse
 * than useless: a flagged run comes back looking withheld, and a short one
 * comes back with nothing to claim, so the post-run flow it exists to show is
 * exactly the flow you don't get.
 *
 * These are the backend's own rules restated (backend/app/anticheat.py and the
 * thresholds in backend/app/config.py). They were checked against the real
 * implementations once, by feeding a generated trace through `validate_run`,
 * `clean_path` and `run_tier` directly; every preset came back with no flags,
 * verified, and `qualified_for_claim`. This keeps it that way, because the
 * failure mode is silent — a trace that drifts over a threshold still submits
 * fine and just quietly stops demonstrating anything.
 *
 * Keep the numbers below in step with config.Settings if those ever move.
 */

import { buildSimulatedRun, SIM_PRESETS, FALLBACK_ORIGIN } from '../src/run/simulatedRun';
import { api } from '../src/api/client';

// backend/app/config.py
const MIN_CLAIM_DISTANCE_M = 1000;
const MIN_CLAIM_DURATION_S = 420;
const MIN_UNIQUE_ROUTE_M = 700;
const TELEPORT_MPS = 12;
const PACE_FLOOR_S_PER_KM = 170;
const PACE_WINDOW_M = 500;
const STRIDE_MIN_M = 0.5;
const STRIDE_MAX_M = 2.0;
const CLEAN_MIN_POINTS = 120;
const CLEAN_SPACING_CV = 0.05;
const CLEAN_ACCURACY_VAR = 0.01;

function haversine(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function segments(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].timestamp - points[i - 1].timestamp) / 1000;
    if (dt > 0) out.push({ d: haversine(points[i - 1], points[i]), dt });
  }
  return out;
}

// The server's rolling-window pace floor, two-pointer, same as _check_pace_floor.
function fastestWindowSPerKm(segs) {
  let best = Infinity;
  let i = 0;
  let dist = 0;
  let time = 0;
  for (let j = 0; j < segs.length; j++) {
    dist += segs[j].d;
    time += segs[j].dt;
    while (dist - segs[i].d >= PACE_WINDOW_M && i < j) {
      dist -= segs[i].d;
      time -= segs[i].dt;
      i += 1;
    }
    if (dist >= PACE_WINDOW_M) best = Math.min(best, time / (dist / 1000));
  }
  return best;
}

function variance(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
}

describe.each(SIM_PRESETS)('simulated run: $label', (preset) => {
  // A fixed seed keeps this deterministic; the shape is the same either way.
  const sim = buildSimulatedRun({ ...preset, seed: 7, endedAtMs: Date.UTC(2026, 7, 10, 12) });
  const segs = segments(sim.points);
  const measured = segs.reduce((a, s) => a + s.d, 0);

  it('clears the claim bars', () => {
    expect(measured).toBeGreaterThan(MIN_CLAIM_DISTANCE_M);
    expect(sim.durationS).toBeGreaterThan(MIN_CLAIM_DURATION_S);
    // One lap, never laps: a circuit's distinct ground is its whole length, so
    // this is really asserting the shape never doubles back over itself.
    expect(measured).toBeGreaterThan(MIN_UNIQUE_ROUTE_M);
  });

  it('starts where it says it does', () => {
    expect(sim.points[0].timestamp).toBe(sim.startedAtMs);
    const spanS = (sim.points[sim.points.length - 1].timestamp - sim.startedAtMs) / 1000;
    expect(spanS).toBeCloseTo(sim.durationS, 0);
  });

  it('never teleports', () => {
    expect(Math.max(...segs.map((s) => s.d / s.dt))).toBeLessThan(TELEPORT_MPS);
  });

  it('is not inhumanly fast over any 500 m', () => {
    expect(fastestWindowSPerKm(segs)).toBeGreaterThan(PACE_FLOOR_S_PER_KM);
  });

  it('reports a plausible stride', () => {
    const stride = measured / sim.stepCount;
    expect(stride).toBeGreaterThan(STRIDE_MIN_M);
    expect(stride).toBeLessThan(STRIDE_MAX_M);
  });

  it('carries no mock-provider points', () => {
    expect(sim.points.every((p) => p.mocked === false)).toBe(true);
  });

  it('is noisy enough not to read as a simulator', () => {
    // Only long traces are checked for this server-side, but every preset
    // clears it, and a preset that stopped clearing it would be the one to
    // notice.
    expect(sim.points.length).toBeGreaterThan(CLEAN_MIN_POINTS);
    const dists = segs.map((s) => s.d);
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
    expect(Math.sqrt(variance(dists)) / mean).toBeGreaterThan(CLEAN_SPACING_CV);
    expect(variance(sim.points.map((p) => p.accuracyM))).toBeGreaterThan(CLEAN_ACCURACY_VAR);
  });
});

describe('buildSimulatedRun', () => {
  it('lands on the origin it is given', () => {
    const origin = { latitude: 51.5072, longitude: -0.1276 };
    const sim = buildSimulatedRun({ origin, distanceM: 3000, paceSPerKm: 385, seed: 3 });
    const lats = sim.points.map((p) => p.latitude);
    const lons = sim.points.map((p) => p.longitude);
    const mid = {
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
    };
    // The loop is centred on the origin, so its bounding box is too — within
    // the wobble the shape is deliberately not symmetric by.
    expect(haversine(mid, origin)).toBeLessThan(120);
  });

  it('is repeatable for a seed and different across seeds', () => {
    const a = buildSimulatedRun({ seed: 1, endedAtMs: 0 });
    const b = buildSimulatedRun({ seed: 1, endedAtMs: 0 });
    const c = buildSimulatedRun({ seed: 2, endedAtMs: 0 });
    expect(a.points).toEqual(b.points);
    expect(c.points).not.toEqual(a.points);
  });

  it('defaults to a real place when the phone has no fix', () => {
    const sim = buildSimulatedRun({ seed: 5 });
    expect(Math.abs(sim.points[0].latitude - FALLBACK_ORIGIN.latitude)).toBeLessThan(0.02);
  });
});

describe('simulated run submission', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('marks only the simulator end-run request for server-side dev handling', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));

    await api.endRun('run-1', [], 1234, true);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/end-run$/);
    expect(JSON.parse(init.body)).toEqual({
      run_id: 'run-1',
      points: [],
      step_count: 1234,
      simulated: true,
    });
  });
});
