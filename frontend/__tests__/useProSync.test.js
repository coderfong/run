import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';

const mockActiveSubscriptions = jest.fn();
const mockSyncPro = jest.fn();
const mockApplyProEntitlement = jest.fn();

jest.mock('../src/iap', () => ({
  activeSubscriptions: (...args) => mockActiveSubscriptions(...args),
}));
jest.mock('../src/api/client', () => ({ api: { syncPro: (...args) => mockSyncPro(...args) } }));
jest.mock('../src/api/cache', () => ({
  applyProEntitlement: (...args) => mockApplyProEntitlement(...args),
}));

import { useProSync } from '../src/hooks/usePro';

function Probe({ signedIn = true }) {
  useProSync(signedIn);
  return null;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useProSync', () => {
  let tree;

  beforeEach(() => {
    jest.useFakeTimers();
    mockActiveSubscriptions.mockReset();
    mockSyncPro.mockReset();
    mockApplyProEntitlement.mockReset();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  });

  afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('publishes the status returned by a successful launch reconciliation', async () => {
    const purchases = [{ product_id: 'paser_pro_monthly', receipt: 'r1', platform: 'ios' }];
    const status = { active: true, store: 'apple' };
    mockActiveSubscriptions.mockResolvedValue(purchases);
    mockSyncPro.mockResolvedValue(status);

    await act(async () => {
      tree = renderer.create(<Probe />);
      await flush();
    });

    expect(mockSyncPro).toHaveBeenCalledWith(purchases);
    expect(mockApplyProEntitlement).toHaveBeenCalledWith(status);
  });

  it('retries a failed backend handoff instead of settling the session as locked', async () => {
    const purchases = [{ product_id: 'paser_pro_monthly', receipt: 'r1', platform: 'ios' }];
    const status = { active: true, store: 'apple' };
    mockActiveSubscriptions.mockResolvedValue(purchases);
    mockSyncPro.mockRejectedValueOnce(new Error('backend cold')).mockResolvedValueOnce(status);

    await act(async () => {
      tree = renderer.create(<Probe />);
      await flush();
    });
    expect(mockSyncPro).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await flush();
    });

    expect(mockSyncPro).toHaveBeenCalledTimes(2);
    expect(mockApplyProEntitlement).toHaveBeenCalledWith(status);
  });
});
