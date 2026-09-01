import {
  applyProEntitlement,
  clearCache,
  getCached,
  setCached,
  subscribeCached,
} from '../src/api/cache';

describe('applyProEntitlement', () => {
  beforeEach(() => clearCache());

  it('publishes the authoritative status to mounted PRO consumers immediately', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCached('pro', listener);
    setCached('pro', { active: false });
    listener.mockClear();

    const status = {
      active: true,
      lifetime: false,
      store: 'apple',
      product_id: 'paser_pro_monthly',
    };
    applyProEntitlement(status);

    expect(getCached('pro')).toEqual(status);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(status);
    unsubscribe();
  });

  it('invalidates entitlement-shaped payloads without dropping unrelated data', () => {
    setCached('insights:r1', { pro: null });
    setCached('standing:global', { pro_rank: null });
    setCached('feed', [{ id: 'post-1' }]);

    applyProEntitlement({ active: true });

    expect(getCached('insights:r1')).toBeUndefined();
    expect(getCached('standing:global')).toBeUndefined();
    expect(getCached('feed')).toEqual([{ id: 'post-1' }]);
  });
});
