import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchAndCache,
  getCached,
  hydrateCache,
  invalidate,
  setCached,
  subscribeCached,
} from '../src/api/cache';

// First in the file on purpose: the persist timer is module state, and a timer
// left pending by an earlier case would swallow the one this counts.
describe('writing the cache to disk', () => {
  afterEach(() => jest.useRealTimers());

  it('writes nothing new for an answer that has not changed', async () => {
    await hydrateCache();
    jest.useFakeTimers();

    setCached('disk:stats', { runs: 3 });
    jest.advanceTimersByTime(1300);
    const writes = AsyncStorage.setItem.mock.calls.length;
    expect(writes).toBeGreaterThan(0);

    // The inbox poll does this every 12 seconds for as long as the app is open.
    setCached('disk:stats', { runs: 3 });
    jest.advanceTimersByTime(1300);
    expect(AsyncStorage.setItem.mock.calls.length).toBe(writes);

    setCached('disk:stats', { runs: 4 });
    jest.advanceTimersByTime(1300);
    expect(AsyncStorage.setItem.mock.calls.length).toBe(writes + 1);
  });
});

describe('response cache subscriptions', () => {
  it('publishes root-level cache refreshes to mounted queries', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCached('notifications', listener);
    const payload = { unread: 1, items: [{ id: 'capture-1' }] };

    setCached('notifications', payload);
    expect(listener).toHaveBeenCalledWith(payload);

    unsubscribe();
    setCached('notifications', { unread: 0, items: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

/**
 * A refresh that brings back what is already cached keeps the object that is
 * already cached. Every screen holding it is then handed the identity it has,
 * and React has nothing to render. Before, each focus revalidation and each
 * 12 second inbox poll delivered a new object with the same contents, and
 * every screen reading it re-rendered in full to draw what it already showed.
 */
describe('a refresh that changes nothing', () => {
  it('keeps the object already stored', async () => {
    const first = await fetchAndCache('same:stats', async () => ({ runs: 3, area: [1, 2] }));
    const again = await fetchAndCache('same:stats', async () => ({ runs: 3, area: [1, 2] }));
    expect(again).toBe(first);
    expect(getCached('same:stats')).toBe(first);
  });

  it('is still published, with the object subscribers already hold', () => {
    // A publication is what clears a query's stale error, so it still goes
    // out. It just carries nothing new.
    const payload = { unread: 2, items: [] };
    setCached('same:inbox', payload);
    const listener = jest.fn();
    const off = subscribeCached('same:inbox', listener);
    setCached('same:inbox', { unread: 2, items: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBe(payload);
    off();
  });

  it('hands over the new object the moment anything differs', async () => {
    const first = await fetchAndCache('same:feed', async () => ({ items: [{ id: 'a' }] }));
    const next = await fetchAndCache('same:feed', async () => ({ items: [{ id: 'a' }, { id: 'b' }] }));
    expect(next).not.toBe(first);
    expect(next.items).toHaveLength(2);
    expect(getCached('same:feed')).toBe(next);
  });

  it('forgets what it held once a key is invalidated', async () => {
    const first = await fetchAndCache('clan:same', async () => ({ name: 'Harriers' }));
    invalidate('clan:');
    const again = await fetchAndCache('clan:same', async () => ({ name: 'Harriers' }));
    expect(again).not.toBe(first);
    expect(getCached('clan:same')).toBe(again);
  });

  it('passes through a payload too big to cache untouched', async () => {
    const huge = { blob: 'x'.repeat(300 * 1024) };
    const back = await fetchAndCache('same:huge', async () => huge);
    expect(back).toBe(huge);
    expect(getCached('same:huge')).toBeUndefined();
  });
});
