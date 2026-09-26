import {
  isNewerLiveState,
  parseLiveState,
  pointsFromWatchPayload,
  validatePendingRun,
  WATCH_RUN_STATE,
} from '../src/watch/watchRunState';

describe('parseLiveState', () => {
  const base = {
    kind: 'watchRunState',
    runId: 'r1',
    state: 'running',
    seq: 3,
    sentAt: 1000,
    startedAt: 500,
    elapsedS: 12,
    distanceM: 40,
    paceSPerKm: 300,
    lat: 1.3,
    lon: 103.8,
  };

  test('parses a well-formed live message', () => {
    const out = parseLiveState(base);
    expect(out).toEqual({
      kind: 'live',
      runId: 'r1',
      state: 'running',
      seq: 3,
      sentAtMs: 1000,
      startedAtMs: 500,
      elapsedS: 12,
      distanceM: 40,
      paceSPerKm: 300,
      lat: 1.3,
      lon: 103.8,
    });
  });

  test('parses a route_ready signal into its own shape', () => {
    expect(parseLiveState({ kind: 'watchRunState', runId: 'r1', state: 'route_ready' })).toEqual({
      kind: 'routeReady',
      runId: 'r1',
    });
  });

  test.each([
    [null],
    [undefined],
    ['not an object'],
    [{}],
    [{ kind: 'somethingElse', runId: 'r1', state: 'running' }],
    [{ kind: 'watchRunState', runId: '', state: 'running' }],
    [{ kind: 'watchRunState', runId: 'r1', state: 'unknownState' }],
    [{ kind: 'watchRunState', runId: 'r1', state: 'running' }], // no startedAt
  ])('rejects malformed input %#', (raw) => {
    expect(parseLiveState(raw)).toBeNull();
  });

  test('missing numeric fields fall back to safe defaults, never NaN or negative', () => {
    const out = parseLiveState({ kind: 'watchRunState', runId: 'r1', state: 'paused', startedAt: 0 });
    expect(out.elapsedS).toBe(0);
    expect(out.distanceM).toBe(0);
    expect(out.paceSPerKm).toBeNull();
    expect(out.lat).toBeNull();
    expect(out.lon).toBeNull();
  });

  test('negative distance/elapsed are clamped to zero, not passed through', () => {
    const out = parseLiveState({ ...base, distanceM: -5, elapsedS: -1 });
    expect(out.distanceM).toBe(0);
    expect(out.elapsedS).toBe(0);
  });
});

describe('isNewerLiveState', () => {
  const runA1 = { runId: 'a', seq: 1 };
  const runA2 = { runId: 'a', seq: 2 };
  const runB1 = { runId: 'b', seq: 1 };

  test('anything is newer than nothing', () => {
    expect(isNewerLiveState(runA1, null)).toBe(true);
  });

  test('nothing is never newer', () => {
    expect(isNewerLiveState(null, runA1)).toBe(false);
  });

  test('a higher sequence on the same run wins', () => {
    expect(isNewerLiveState(runA2, runA1)).toBe(true);
  });

  test('a stale, delayed message on the same run is rejected', () => {
    expect(isNewerLiveState(runA1, runA2)).toBe(false);
  });

  test('a different runId is always newer — a fresh workout started', () => {
    expect(isNewerLiveState(runB1, runA2)).toBe(true);
  });

  test('the same seq counts as newer (a re-send of the current state)', () => {
    expect(isNewerLiveState({ runId: 'a', seq: 2 }, runA2)).toBe(true);
  });
});

describe('pointsFromWatchPayload', () => {
  test('converts, defaults optional fields, and sorts by time', () => {
    const out = pointsFromWatchPayload([
      { latitude: 1, longitude: 103, timestamp: 2000 },
      { latitude: 2, longitude: 104, timestamp: 1000, accuracyM: 5, speedMps: 3, altitude: 12, mocked: true },
    ]);
    expect(out).toEqual([
      { latitude: 2, longitude: 104, timestamp: 1000, altitude: 12, accuracyM: 5, speedMps: 3, mocked: true },
      { latitude: 1, longitude: 103, timestamp: 2000, altitude: null, accuracyM: null, speedMps: null, mocked: false },
    ]);
  });

  test('drops entries missing a required field rather than crashing', () => {
    const out = pointsFromWatchPayload([
      { latitude: 1, longitude: 103, timestamp: 1000 },
      { latitude: null, longitude: 103, timestamp: 2000 },
      { longitude: 103, timestamp: 3000 },
      'not a point',
    ]);
    expect(out).toHaveLength(1);
  });

  test('non-array input is an empty route, not a crash', () => {
    expect(pointsFromWatchPayload(null)).toEqual([]);
    expect(pointsFromWatchPayload(undefined)).toEqual([]);
    expect(pointsFromWatchPayload('nope')).toEqual([]);
  });
});

describe('validatePendingRun', () => {
  const goodPoints = [
    { latitude: 1, longitude: 103, timestamp: 1000 },
    { latitude: 1.001, longitude: 103.001, timestamp: 2000 },
  ];

  test('accepts a well-formed pending run and sorts its points', () => {
    const out = validatePendingRun({
      runId: 'r1',
      startedAt: 1000,
      endedAt: 2000,
      points: [goodPoints[1], goodPoints[0]],
    });
    expect(out.ok).toBe(true);
    expect(out.run.runId).toBe('r1');
    expect(out.run.source).toBe('watch');
    expect(out.run.points.map((p) => p.timestamp)).toEqual([1000, 2000]);
  });

  test('rejects a run with no id', () => {
    expect(validatePendingRun({ startedAt: 1, endedAt: 2, points: goodPoints }).ok).toBe(false);
  });

  test('rejects an end before the start', () => {
    const out = validatePendingRun({ runId: 'r1', startedAt: 2000, endedAt: 1000, points: goodPoints });
    expect(out).toEqual({ ok: false, reason: 'bad_time_range' });
  });

  test('rejects a route with fewer than two usable points', () => {
    const out = validatePendingRun({ runId: 'r1', startedAt: 1000, endedAt: 2000, points: [goodPoints[0]] });
    expect(out).toEqual({ ok: false, reason: 'too_few_points' });
  });

  test('rejects nullish input', () => {
    expect(validatePendingRun(null)).toEqual({ ok: false, reason: 'empty' });
  });
});

test('WATCH_RUN_STATE names the states the native side actually sends', () => {
  expect(WATCH_RUN_STATE).toEqual({
    RUNNING: 'running',
    PAUSED: 'paused',
    FINISHED: 'finished',
    ROUTE_READY: 'route_ready',
  });
});
