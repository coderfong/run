import { setCached, subscribeCached } from '../src/api/cache';

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
