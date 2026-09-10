import { createViewportCache, selectPortraits } from '../src/map/viewportCache';

const box = (x = 0) => ({ minLon: x, maxLon: x + 1, minLat: 0, maxLat: 1 });
const scope = { rank: 0, board: 'solo' };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness() {
  const jobs = [];
  const request = jest.fn(() => new Promise((resolve, reject) => jobs.push({ resolve, reject })));
  const onData = jest.fn();
  const onError = jest.fn();
  let clock = 0;
  const cache = createViewportCache({ request, onData, onError, now: () => clock });
  return { cache, jobs, request, onData, onError, age: () => { clock += 31000; } };
}

test('nearby pans and same-band zooms use warm data without a request', async () => {
  const h = harness();
  h.cache.load(box(), 14, scope);
  await flush();
  h.jobs[0].resolve({ territories: ['a'] });
  await flush();
  h.cache.load(box(.1), 16, scope);
  await flush();
  expect(h.request).toHaveBeenCalledTimes(1);
  expect(h.onData).toHaveBeenLastCalledWith(['a']);
});

test('rapid panning bounds concurrency and skips intermediate destinations', async () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.cache.load(box(i * 10), 14, scope);
  await flush();
  expect(h.request).toHaveBeenCalledTimes(2);
  h.jobs[0].resolve({ territories: ['old'] });
  await flush();
  expect(h.request).toHaveBeenCalledTimes(3);
  expect(h.request.mock.calls[2][0].minLon).toBeCloseTo(189.4 > 180 ? 189.4 : 189.4);
  expect(h.onData).not.toHaveBeenCalled();
});

test('superseded responses warm the cache without replacing the current map', async () => {
  const h = harness();
  h.cache.load(box(), 14, scope);
  h.cache.load(box(10), 14, scope);
  await flush();
  h.jobs[1].resolve({ territories: ['b'] });
  await flush();
  h.jobs[0].resolve({ territories: ['a'] });
  await flush();
  expect(h.onData).toHaveBeenLastCalledWith(['b']);
  h.cache.load(box(), 14, scope);
  expect(h.onData).toHaveBeenLastCalledWith(['a']);
  await flush();
  expect(h.request).toHaveBeenCalledTimes(2);
});

test('approaching the loaded edge prefetches while keeping current land', async () => {
  const h = harness();
  h.cache.load(box(), 14, scope);
  await flush();
  h.jobs[0].resolve({ territories: ['a'] });
  await flush();
  h.cache.load(box(.5), 14, scope);
  await flush();
  expect(h.request).toHaveBeenCalledTimes(2);
  expect(h.onData).toHaveBeenLastCalledWith(['a']);
});

test('expired data displays immediately while refreshing; failures do not spin', async () => {
  const h = harness();
  h.cache.load(box(), 14, scope);
  await flush();
  h.jobs[0].resolve({ territories: ['a'] });
  await flush();
  h.age();
  h.cache.load(box(), 14, scope);
  await flush();
  h.jobs[1].reject(new Error('offline'));
  await flush();
  expect(h.onData).toHaveBeenLastCalledWith(['a']);
  expect(h.onError).toHaveBeenCalledTimes(1);
  expect(h.request).toHaveBeenCalledTimes(2);
});

test('rank, board, zoom cap and forced refresh cannot reuse fresh coverage', async () => {
  for (const change of [{ rank: 1 }, { board: 'club' }, { zoom: 10 }, { force: true }]) {
    const h = harness();
    h.cache.load(box(), 14, scope);
    await flush();
    h.jobs[0].resolve({ territories: ['a'] });
    await flush();
    h.cache.load(box(), change.zoom ?? 14, { ...scope, ...change });
    await flush();
    expect(h.request).toHaveBeenCalledTimes(2);
  }
});

test('disposed screens do not receive late results', async () => {
  const h = harness();
  h.cache.load(box(), 14, scope);
  await flush();
  h.cache.dispose();
  h.jobs[0].resolve({ territories: ['a'] });
  await flush();
  expect(h.onData).not.toHaveBeenCalled();
});

test('visible owners take marker slots before larger off-screen territories', () => {
  const visible = { id: 'small', area: 1, at: { latitude: .5, longitude: .5 } };
  const outside = { id: 'large', area: 100, at: { latitude: 5, longitude: 5 } };
  expect(selectPortraits([outside, visible], box(), 1)).toEqual([visible]);
});
