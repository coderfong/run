// Exercises the ONE place a watch run is actually submitted — idempotency in
// particular, since a watch run can be resubmitted after a crash or a lost
// network response and must never mint a second server run for it. Uses the
// real (jest-mocked) AsyncStorage rather than mocking it away, the same
// reasoning as the profile-persistence work this mirrors: the thing worth
// proving is that the mapping survives a real write/read round trip, not
// just that a mock was called correctly.

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../src/api/client', () => ({
  api: {
    startRun: jest.fn(),
    endRun: jest.fn(),
  },
}));
jest.mock('../src/api/cache', () => ({
  invalidateAfterRun: jest.fn(),
}));

import { api } from '../src/api/client';
import { invalidateAfterRun } from '../src/api/cache';
import { clearWatchRunMapping, submitWatchRun } from '../src/run/watchRunImport';

const POINTS = [
  { latitude: 1.35, longitude: 103.8, timestamp: 1_000_000, accuracyM: 5, speedMps: 2, mocked: false },
  { latitude: 1.351, longitude: 103.801, timestamp: 1_010_000, accuracyM: 5, speedMps: 2, mocked: false },
];

function makeRun(overrides = {}) {
  return {
    runId: 'watch-run-1',
    startedAtMs: 1_000_000,
    endedAtMs: 1_010_000,
    points: POINTS,
    ...overrides,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('a first submission starts a new server run and calls /end-run with it', async () => {
  api.startRun.mockResolvedValue({ run_id: 'server-1' });
  api.endRun.mockResolvedValue({ run_id: 'server-1', distance_m: 12 });

  const { result } = await submitWatchRun(makeRun());

  expect(api.startRun).toHaveBeenCalledWith(1_000_000, { source: 'watch' });
  expect(api.endRun).toHaveBeenCalledWith('server-1', expect.any(Array), null, false);
  expect(result).toEqual({ run_id: 'server-1', distance_m: 12 });
  expect(invalidateAfterRun).toHaveBeenCalledTimes(1);
});

test('the submitted points are converted to the API wire shape', async () => {
  api.startRun.mockResolvedValue({ run_id: 'server-1' });
  api.endRun.mockResolvedValue({ run_id: 'server-1' });

  await submitWatchRun(makeRun());

  const sentPoints = api.endRun.mock.calls[0][1];
  expect(sentPoints[0]).toEqual({
    lat: 1.35,
    lon: 103.8,
    t: new Date(1_000_000).toISOString(),
    mocked: false,
    accuracy_m: 5,
    speed_mps: 2,
  });
});

test('a retry after /end-run already succeeded still starts no second server run', async () => {
  // submitWatchRun deliberately does NOT clear the mapping itself — only the
  // caller does, after it has ALSO removed the native pending-run file (see
  // the function's own doc comment for why). So a submission that "succeeded
  // but was not yet fully cleaned up" — the exact state a crash between
  // /end-run answering and consumePendingWatchRun running would leave — must
  // still resubmit against the SAME server run_id, not a fresh one.
  api.startRun.mockResolvedValue({ run_id: 'server-1' });
  api.endRun.mockResolvedValue({ run_id: 'server-1' });
  await submitWatchRun(makeRun());
  expect(api.startRun).toHaveBeenCalledTimes(1);

  api.startRun.mockClear();
  api.endRun.mockClear();
  await submitWatchRun(makeRun());
  expect(api.startRun).not.toHaveBeenCalled();
  expect(api.endRun).toHaveBeenCalledWith('server-1', expect.any(Array), null, false);
});

test('clearWatchRunMapping is what actually lets a later run of the same watch runId start fresh', async () => {
  api.startRun.mockResolvedValueOnce({ run_id: 'server-1' });
  api.endRun.mockResolvedValue({ run_id: 'server-1' });
  await submitWatchRun(makeRun());

  await clearWatchRunMapping('watch-run-1');

  api.startRun.mockClear();
  api.startRun.mockResolvedValueOnce({ run_id: 'server-2' });
  await submitWatchRun(makeRun());
  expect(api.startRun).toHaveBeenCalledTimes(1);
});

test('a retry BEFORE /end-run ever succeeded reuses the same server run_id', async () => {
  api.startRun.mockResolvedValue({ run_id: 'server-1' });
  api.endRun.mockRejectedValueOnce(new Error('network down'));

  await expect(submitWatchRun(makeRun())).rejects.toThrow('network down');
  expect(api.startRun).toHaveBeenCalledTimes(1);
  // The failure must not have cleared the mapping the first call wrote.
  expect(invalidateAfterRun).not.toHaveBeenCalled();

  api.startRun.mockClear();
  api.endRun.mockResolvedValueOnce({ run_id: 'server-1' });
  await submitWatchRun(makeRun());

  // The SAME server run_id, and /start-run was never called a second time —
  // this is the one PASER run per watch workout guarantee.
  expect(api.startRun).not.toHaveBeenCalled();
  expect(api.endRun).toHaveBeenLastCalledWith('server-1', expect.any(Array), null, false);
});

test('two different watch runIds never share a server run mapping', async () => {
  api.startRun.mockResolvedValueOnce({ run_id: 'server-a' }).mockResolvedValueOnce({ run_id: 'server-b' });
  api.endRun.mockResolvedValue({});

  await submitWatchRun(makeRun({ runId: 'watch-a' }));
  await submitWatchRun(makeRun({ runId: 'watch-b' }));

  expect(api.startRun).toHaveBeenCalledTimes(2);
  expect(api.endRun).toHaveBeenNthCalledWith(1, 'server-a', expect.any(Array), null, false);
  expect(api.endRun).toHaveBeenNthCalledWith(2, 'server-b', expect.any(Array), null, false);
});

test('clearWatchRunMapping also serves an explicit discard, with nothing submitted', async () => {
  api.startRun.mockResolvedValue({ run_id: 'server-1' });
  api.endRun.mockRejectedValueOnce(new Error('network down'));
  await expect(submitWatchRun(makeRun())).rejects.toThrow();

  await clearWatchRunMapping('watch-run-1');

  api.startRun.mockClear();
  api.endRun.mockResolvedValueOnce({ run_id: 'server-2' });
  await submitWatchRun(makeRun());
  // The discarded mapping means this is treated as a brand new submission.
  expect(api.startRun).toHaveBeenCalledTimes(1);
});
