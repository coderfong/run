// The run-session validity system, driven through the scenarios it exists
// for. Each one synthesises the evidence a phone would record — GPS with
// realistic drift, a pedometer heartbeat, Core Motion readings — and checks
// what the engine decides the run was.

import { createSessionEngine } from '../src/run/session/sessionEngine';
import { finalizeSession } from '../src/run/session/finalizeSession';
import { RUN_SESSION, SEGMENT, SESSION_STATE } from '../src/run/session/config';
import { decideRecovery, resumeGapPause } from '../src/run/session/recovery';
import { canStartPhoneRun } from '../src/run/session/runOwnership';

const T0 = Date.UTC(2026, 8, 24, 6, 0, 0);
const MIN = 60000;
const H = 60 * MIN;

// Deterministic noise, so a failing scenario fails the same way every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Builds evidence phase by phase. Movement heads east (and turns north every
 * so often so a long route is not one straight line).
 */
function simulator({ seed = 7 } = {}) {
  const rand = rng(seed);
  const ev = { fixes: [], steps: [], motion: [] };
  let t = T0;
  let lat = 1.3;
  let lon = 103.8;
  let total = 0;
  let heading = 0;
  let truthM = 0;
  const mPerDegLat = 111320;

  function phase(seconds, {
    speed = 0, cadence = 0, motion = null, accuracy = 8, fixEveryS = 1,
    drift = 6, steps = true, gps = true, count = true,
  } = {}) {
    if (motion) ev.motion.push({ t, kind: motion, conf: 2 });
    const end = t + seconds * 1000;
    let nextFix = t;
    let nextStep = t;
    while (t < end) {
      t += 1000;
      const d = speed; // metres this second
      if (d > 0) {
        lat += (Math.sin(heading) * d) / mPerDegLat;
        lon += (Math.cos(heading) * d) / (mPerDegLat * Math.cos((lat * Math.PI) / 180));
        if (count) truthM += d;
        if (Math.floor((truthM || 0) / 800) % 2 === 1) heading = Math.PI / 2; else heading = 0;
      }
      total += cadence / 60;
      if (gps && t >= nextFix) {
        nextFix = t + fixEveryS * 1000;
        const jitter = speed > 0 ? 2 : drift;
        const jLat = ((rand() - 0.5) * 2 * jitter) / mPerDegLat;
        const jLon = ((rand() - 0.5) * 2 * jitter) / mPerDegLat;
        ev.fixes.push({ t, lat: lat + jLat, lon: lon + jLon, acc: accuracy, spd: speed > 0 ? speed : rand() * 0.3 });
      }
      if (steps && t >= nextStep) {
        nextStep = t + 5000;
        ev.steps.push({ t, total: Math.round(total) });
      }
    }
  }
  return {
    phase,
    teleport(meters) {
      ev.fixes.push({ t: t + 500, lat: lat + meters / mPerDegLat, lon, acc: 8, spd: null });
    },
    get t() { return t; },
    get truthM() { return truthM; },
    ev,
  };
}

const RUN = { speed: 3, cadence: 165, motion: 'running' };
const STILL = { speed: 0, cadence: 0, motion: 'stationary' };

function run(sim, endAt = sim.t) {
  const engine = createSessionEngine({ startedAt: T0 });
  engine.addFixes(sim.ev.fixes);
  engine.addSteps(sim.ev.steps);
  engine.addMotion(sim.ev.motion);
  return { engine, result: finalizeSession(engine, endAt) };
}

const kinds = (result) => result.segments.map((s) => s.kind);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

describe('run session scenarios', () => {
  test('1. a normal 5 km is accepted whole', () => {
    const sim = simulator();
    sim.phase(5000 / 3, RUN);
    const { result } = run(sim);
    expect(near(result.distanceM, 5000, 5000 * 0.04)).toBe(true);
    expect(kinds(result)).toEqual([SEGMENT.RUNNING]);
    expect(near(result.movingMs, 5000 / 3 * 1000, 10000)).toBe(true);
    expect(result.notice).toBeNull();
  });

  test('2. a 30 s traffic light does not pause or end the run', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    sim.phase(30, STILL);
    sim.phase(600, RUN);
    const { engine, result } = run(sim);
    expect(kinds(result)).toEqual([SEGMENT.RUNNING]);
    expect(engine.transitions.some((x) => x.to === SESSION_STATE.AUTO_PAUSED)).toBe(false);
    expect(near(result.distanceM, 3600, 3600 * 0.05)).toBe(true);
  });

  test('3. a 20 min cafe stop auto-pauses, drifts no distance, and auto-resumes', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    sim.phase(20 * 60, { ...STILL, drift: 12, accuracy: 12 });
    sim.phase(600, RUN);
    const { engine, result } = run(sim);
    expect(kinds(result)).toEqual([SEGMENT.RUNNING, SEGMENT.STATIONARY, SEGMENT.RUNNING]);
    expect(engine.transitions.some((x) => x.reason === 'auto_resume')).toBe(true);
    // Moving time is the two 10 min runs, give or take the detection edges.
    expect(near(result.movingMs, 20 * MIN, 1.5 * MIN)).toBe(true);
    expect(near(result.distanceM, 3600, 3600 * 0.05)).toBe(true);
  });

  test('4. forgotten overnight: a 30 min run, not an 8 h one', () => {
    const sim = simulator();
    sim.phase(30 * 60, RUN);
    sim.phase(8 * 3600, { ...STILL, fixEveryS: 10, drift: 15, accuracy: 15 });
    const engine = createSessionEngine({ startedAt: T0 });
    engine.addFixes(sim.ev.fixes);
    engine.addSteps(sim.ev.steps);
    engine.addMotion(sim.ev.motion);
    const status = engine.advance(sim.t);
    expect(status.state).toBe(SESSION_STATE.RECOVERY_REQUIRED);
    expect(near(status.lastActiveAt, T0 + 30 * MIN, 2 * MIN)).toBe(true);
    const result = finalizeSession(engine, sim.t);
    expect(near(result.movingMs, 30 * MIN, 2 * MIN)).toBe(true);
    expect(near(result.endedAt, T0 + 30 * MIN, 2 * MIN)).toBe(true);
    expect(near(result.distanceM, 5400, 5400 * 0.05)).toBe(true);
    expect(result.summary.stationary_s).toBeGreaterThan(7.5 * 3600);
  });

  test('5. run then drive: the run is kept, the drive is excluded and reported', () => {
    const sim = simulator();
    sim.phase(5000 / 3, RUN);
    sim.phase(20 * 60, { speed: 11, cadence: 0, motion: 'automotive', count: false });
    const { result } = run(sim);
    expect(near(result.distanceM, 5000, 5000 * 0.05)).toBe(true);
    expect(kinds(result)).toContain(SEGMENT.VEHICLE);
    expect(result.summary.excluded_vehicle_m).toBeGreaterThan(10000);
    expect(result.notice?.kind).toBe('vehicle');
  });

  test('5b. the drive is caught from steps and speed alone, with no motion data', () => {
    const sim = simulator();
    sim.phase(5000 / 3, { speed: 3, cadence: 165 });
    sim.phase(15 * 60, { speed: 11, cadence: 0, count: false });
    const { result } = run(sim);
    expect(near(result.distanceM, 5000, 5000 * 0.06)).toBe(true);
    expect(kinds(result)).toContain(SEGMENT.VEHICLE);
  });

  test('6. cycling at running speed is not running', () => {
    const sim = simulator();
    sim.phase(30 * 60, { speed: 4.17, cadence: 4, motion: 'cycling', count: false });
    const { result } = run(sim);
    expect(result.distanceM).toBeLessThan(7500 * 0.1);
    expect(kinds(result)).toContain(SEGMENT.CYCLING);
  });

  test('6b. cycling after a run keeps the run', () => {
    const sim = simulator();
    // No motion permission: steps and GPS are all PASER has.
    sim.phase(4000 / 3, { speed: 3, cadence: 165 });
    sim.phase(30 * 60, { speed: 4.5, cadence: 3, count: false });
    const { result } = run(sim);
    expect(near(result.distanceM, 4000, 4000 * 0.07)).toBe(true);
    expect(kinds(result)).toContain(SEGMENT.CYCLING);
  });

  test('7. a 2:27/km interval is not a bike and keeps its distance', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    sim.phase(90, { speed: 6.8, cadence: 192, motion: 'running' });
    sim.phase(600, RUN);
    const { result } = run(sim);
    expect(kinds(result)).toEqual([SEGMENT.RUNNING]);
    expect(result.distanceM).toBeGreaterThan(sim.truthM * 0.95);
  });

  test('7b. a fast burst with no pedometer or motion data is still not rejected', () => {
    const sim = simulator();
    sim.phase(600, { speed: 3, steps: false });
    sim.phase(60, { speed: 7, steps: false });
    sim.phase(600, { speed: 3, steps: false });
    const { result } = run(sim);
    expect(kinds(result)).toEqual([SEGMENT.RUNNING]);
    expect(result.distanceM).toBeGreaterThan(sim.truthM * 0.93);
  });

  test('8. a 12 h ultra with aid stations stays valid', () => {
    const sim = simulator();
    for (let i = 0; i < 12; i += 1) {
      sim.phase(45 * 60, { ...RUN, fixEveryS: 3 });
      sim.phase(10 * 60, { speed: 1.3, cadence: 110, motion: 'walking', fixEveryS: 3 });
      sim.phase(5 * 60, { ...STILL, fixEveryS: 10 });
    }
    const { engine, result } = run(sim);
    expect(engine.status(sim.t).state).not.toBe(SESSION_STATE.RECOVERY_REQUIRED);
    expect(result.distanceM).toBeGreaterThan(sim.truthM * 0.93);
    expect(result.movingMs).toBeGreaterThan(10.5 * H);
  });

  test('9. a 24 h ultra is supported: duration is never the verdict', () => {
    const sim = simulator({ seed: 3 });
    for (let i = 0; i < 24; i += 1) {
      sim.phase(40 * 60, { ...RUN, speed: 2.6, fixEveryS: 5 });
      sim.phase(15 * 60, { speed: 1.2, cadence: 100, motion: 'walking', fixEveryS: 5 });
      sim.phase(5 * 60, { ...STILL, fixEveryS: 15 });
    }
    const { result } = run(sim);
    expect(result.distanceM).toBeGreaterThan(sim.truthM * 0.9);
    expect(result.movingMs).toBeGreaterThan(20 * H);
    expect(kinds(result).filter((k) => k === SEGMENT.CYCLING || k === SEGMENT.VEHICLE)).toEqual([]);
  });

  test('10. a 500 m GPS teleport adds nothing', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    sim.teleport(500);
    sim.phase(600, RUN);
    const { result } = run(sim);
    expect(near(result.distanceM, 3600, 3600 * 0.05)).toBe(true);
  });

  test('11. app crash: nothing is invented for the missing 10 minutes', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    const diedAt = sim.t;
    // The process is dead: no evidence at all for 10 minutes.
    const reopen = diedAt + 10 * MIN;
    const engine = createSessionEngine({ startedAt: T0 });
    engine.addFixes(sim.ev.fixes);
    engine.addSteps(sim.ev.steps);
    engine.addMotion(sim.ev.motion);
    const status = engine.advance(reopen);
    const decision = decideRecovery({ meta: { savedAt: diedAt, startedAt: T0 }, status, now: reopen });
    expect(decision.required).toBe(true);
    expect(near(decision.lastActiveAt, diedAt, 15000)).toBe(true);
    const result = finalizeSession(engine, reopen);
    expect(near(result.distanceM, 1800, 1800 * 0.05)).toBe(true);
    expect(near(result.movingMs, 10 * MIN, 30000)).toBe(true);
    expect(near(result.endedAt, diedAt, 15000)).toBe(true);
  });

  test('11b. resuming after a crash treats the gap as a pause', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    const diedAt = sim.t;
    const engine = createSessionEngine({ startedAt: T0 });
    engine.addFixes(sim.ev.fixes);
    engine.addSteps(sim.ev.steps);
    const reopen = diedAt + 10 * MIN;
    const gap = resumeGapPause({ lastActiveAt: diedAt, now: reopen });
    engine.userPause(gap.from);
    engine.userResume(gap.to);
    engine.acknowledge(reopen);
    const status = engine.advance(reopen + RUN_SESSION.EVAL_LAG_MS + 5000);
    expect(status.state).not.toBe(SESSION_STATE.RECOVERY_REQUIRED);
    expect(near(engine.movingMs(reopen), 10 * MIN, 30000)).toBe(true);
  });

  test('12. a watch workout in progress blocks a second run on the phone', () => {
    const now = T0;
    expect(canStartPhoneRun({ watchWorkout: { phase: 'running', at: now - 20000 }, now }).allowed).toBe(false);
    expect(canStartPhoneRun({ watchWorkout: { phase: 'running', at: now - 10 * MIN }, now }).allowed).toBe(true);
    expect(canStartPhoneRun({ watchWorkout: { phase: 'ended', at: now }, now }).allowed).toBe(true);
    expect(canStartPhoneRun({ watchWorkout: null, now }).allowed).toBe(true);
  });
});

describe('pause semantics', () => {
  test('a user pause never auto-resumes, however much running follows', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    const pausedAt = sim.t;
    sim.phase(600, { ...RUN, count: false });
    const engine = createSessionEngine({ startedAt: T0 });
    engine.addFixes(sim.ev.fixes);
    engine.addSteps(sim.ev.steps);
    engine.addMotion(sim.ev.motion);
    engine.userPause(pausedAt);
    const status = engine.advance(sim.t);
    expect(status.stepState).toBe(SESSION_STATE.USER_PAUSED);
    const result = finalizeSession(engine, sim.t);
    expect(near(result.distanceM, 1800, 1800 * 0.05)).toBe(true);
    expect(kinds(result)).toEqual([SEGMENT.RUNNING, SEGMENT.USER_PAUSED]);
  });

  test('a GPS-only runner (no pedometer, no motion) is never marked stale', () => {
    const sim = simulator();
    sim.phase(60 * 60, { speed: 2.8, steps: false });
    const engine = createSessionEngine({ startedAt: T0 });
    engine.addFixes(sim.ev.fixes);
    const status = engine.advance(sim.t);
    expect(status.state).not.toBe(SESSION_STATE.RECOVERY_REQUIRED);
    expect(near(status.lastActiveAt, sim.t, 30000)).toBe(true);
  });

  test('stationary GPS drift adds no distance', () => {
    const sim = simulator();
    sim.phase(2 * 3600, { ...STILL, drift: 25, accuracy: 20, motion: null });
    const { result } = run(sim);
    expect(result.distanceM).toBeLessThan(50);
  });

  test('late background evidence is replayed into the same decision', () => {
    const sim = simulator();
    sim.phase(600, RUN);
    sim.phase(20 * 60, STILL);
    sim.phase(600, RUN);
    const engine = createSessionEngine({ startedAt: T0 });
    const half = Math.floor(sim.ev.fixes.length / 2);
    engine.addFixes(sim.ev.fixes.slice(half));
    engine.addSteps(sim.ev.steps);
    engine.addMotion(sim.ev.motion);
    engine.advance(sim.t);
    engine.addFixes(sim.ev.fixes.slice(0, half));
    const late = finalizeSession(engine, sim.t);
    const { result: whole } = run(sim);
    expect(late.distanceM).toBeCloseTo(whole.distanceM, 3);
    expect(kinds(late)).toEqual(kinds(whole));
  });
});
