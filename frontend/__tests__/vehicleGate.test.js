/**
 * The vehicle gate raises a NOTICE, at most once per run, and never more.
 *
 * This is the regression guard for the run-screen lock-up: the gate used to
 * auto-pause behind a modal Alert with no working one-shot guard, so every
 * fast fix after the threshold stacked another modal over the Pause and End
 * controls and pushed another entry into the pause windows. The invariant that
 * stops that coming back is "at most one raise per run", and it is tested here
 * rather than in the screen because the screen cannot express it in one place.
 */

import fs from 'fs';
import path from 'path';

import { createVehicleGate } from '../src/run/vehicleGate';

const gate = (over = {}) =>
  createVehicleGate({
    fastPointsNeeded: 4,
    windowDistanceM: 250,
    minStepsPerWindow: 15,
    ...over,
  });

describe('fast fixes', () => {
  it('stays quiet until the run of fast fixes is long enough', () => {
    const g = gate();
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(true);
    expect(g.flagged).toBe(true);
  });

  it('raises exactly once, however many fast fixes follow', () => {
    const g = gate();
    const raises = Array.from({ length: 200 }, () => g.onFastFix()).filter(Boolean);
    expect(raises).toHaveLength(1);
  });

  it('forgets a part-built run of fast fixes after a good one', () => {
    const g = gate();
    g.onFastFix();
    g.onFastFix();
    g.onFastFix();
    g.onGoodFix();
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(true);
  });
});

describe('the distance-vs-steps window', () => {
  it('raises on ground covered with no steps under it', () => {
    const g = gate();
    g.armWindow({ distanceM: 1000, steps: 900 });
    expect(g.onWindow({ distanceM: 1400, steps: 902, pedometerOk: true })).toBe(true);
  });

  it('stays quiet when the steps are there', () => {
    const g = gate();
    g.armWindow({ distanceM: 1000, steps: 900 });
    expect(g.onWindow({ distanceM: 1400, steps: 1300, pedometerOk: true })).toBe(false);
    expect(g.flagged).toBe(false);
  });

  it('stays quiet when the distance is short, however few the steps', () => {
    const g = gate();
    g.armWindow({ distanceM: 1000, steps: 900 });
    expect(g.onWindow({ distanceM: 1100, steps: 900, pedometerOk: true })).toBe(false);
  });

  it('says nothing at all with no pedometer to judge by', () => {
    const g = gate();
    g.armWindow({ distanceM: 1000, steps: 0 });
    expect(g.onWindow({ distanceM: 9999, steps: 0, pedometerOk: false })).toBe(false);
    expect(g.flagged).toBe(false);
  });

  it('rolls the window forward even when it does not raise', () => {
    const g = gate();
    g.armWindow({ distanceM: 0, steps: 0 });
    // A quiet window with plenty of steps. If the window did not move, the
    // next one would measure against 0 and see the whole run's distance.
    expect(g.onWindow({ distanceM: 400, steps: 500, pedometerOk: true })).toBe(false);
    expect(g.onWindow({ distanceM: 500, steps: 500, pedometerOk: true })).toBe(false);
  });

  it('rolls the window forward across a pedometer-less stretch too', () => {
    const g = gate();
    g.armWindow({ distanceM: 0, steps: 0 });
    g.onWindow({ distanceM: 400, steps: 0, pedometerOk: false });
    // Permission arrives mid-run: the window must have moved on, so this is
    // judged on its own 100m and not the 500m since the run began.
    expect(g.onWindow({ distanceM: 500, steps: 0, pedometerOk: true })).toBe(false);
  });
});

describe('one voice per run', () => {
  it('will not raise on the window once the fast fixes already did', () => {
    const g = gate();
    for (let i = 0; i < 4; i += 1) g.onFastFix();
    expect(g.flagged).toBe(true);
    g.armWindow({ distanceM: 0, steps: 0 });
    expect(g.onWindow({ distanceM: 5000, steps: 0, pedometerOk: true })).toBe(false);
  });

  it('will not raise on fast fixes once the window already did', () => {
    const g = gate();
    g.armWindow({ distanceM: 0, steps: 0 });
    expect(g.onWindow({ distanceM: 5000, steps: 0, pedometerOk: true })).toBe(true);
    for (let i = 0; i < 20; i += 1) expect(g.onFastFix()).toBe(false);
  });

  it('speaks again for a new run, and not before', () => {
    const g = gate();
    for (let i = 0; i < 4; i += 1) g.onFastFix();
    expect(g.onFastFix()).toBe(false);
    g.reset();
    expect(g.flagged).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(false);
    expect(g.onFastFix()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The structural half: the gate can only stay non-blocking if the run screen
// keeps wiring it up that way. These read the source, in the style of
// lucideIcons.test.js, because what is being asserted is the absence of a
// call — and you cannot render your way to that.
// ---------------------------------------------------------------------------

describe('the run screen keeps the gate out of the way', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'RunningScreen.js'),
    'utf8'
  );

  it('never puts the vehicle notice behind a modal', () => {
    // `Alert` is still used elsewhere on this screen for things the runner
    // asked for. What must not come back is an alert on the detection path.
    const announce = src.slice(src.indexOf('function announceVehicle'));
    const body = announce.slice(0, announce.indexOf('\n  }'));
    expect(body).not.toMatch(/Alert\./);
  });

  it('never pauses the run on detection', () => {
    const announce = src.slice(src.indexOf('function announceVehicle'));
    const body = announce.slice(0, announce.indexOf('\n  }'));
    expect(body).not.toMatch(/pauseRun|setPaused/);
  });

  it('guards pause and resume on a ref, not on React state', () => {
    // `if (paused)` inside pauseRun is stale for the rest of the tick it is
    // read in, which is what let two calls each open a pause window.
    expect(src).toMatch(/function pauseRun\(\)\s*\{[\s\S]{0,400}?if \(pausedRef\.current\) return;/);
    expect(src).toMatch(/async function resumeFromPause\(\)\s*\{\s*\n\s*if \(!pausedRef\.current\) return;/);
  });
});
