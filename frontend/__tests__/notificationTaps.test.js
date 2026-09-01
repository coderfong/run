// The device-level tap wiring: a foreground handler, Android channels the
// backend addresses by id, and — the part with the sharp edge — the tap that
// launched the app from a COLD start, which is not delivered to the listener
// and has to be pulled once the tree is up.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';

import { useNotificationTaps } from '../src/notifications/setup';

function Probe({ navigationRef, ready }) {
  useNotificationTaps(navigationRef, ready);
  return null;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useNotificationTaps', () => {
  let responseCb;

  beforeEach(() => {
    jest.clearAllMocks();
    Notifications.addNotificationResponseReceivedListener.mockImplementation((cb) => {
      responseCb = cb;
      return { remove: jest.fn() };
    });
    Notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  });

  test('sets a foreground handler and (attempts) the Android channels', async () => {
    const nav = { isReady: () => true, navigate: jest.fn() };
    let tree;
    await act(async () => {
      tree = renderer.create(<Probe navigationRef={nav} ready />);
      await flush();
    });
    expect(Notifications.setNotificationHandler).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('a warm tap routes straight away', async () => {
    const nav = { isReady: () => true, navigate: jest.fn() };
    let tree;
    await act(async () => {
      tree = renderer.create(<Probe navigationRef={nav} ready />);
      await flush();
    });
    act(() => {
      responseCb({
        notification: { request: { content: { data: { category: 'kudos', screen: 'run', run_id: 'r1' } } } },
      });
    });
    expect(nav.navigate).toHaveBeenCalledWith(
      'Tabs',
      expect.objectContaining({ screen: 'Home', params: expect.objectContaining({ screen: 'RunDetail' }) })
    );
    await act(async () => tree.unmount());
  });

  test('a cold-start tap is replayed once the navigator is ready', async () => {
    Notifications.getLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { category: 'stolen', screen: 'map', lat: 1, lon: 2 } } } },
    });
    const nav = { isReady: () => false, navigate: jest.fn() };
    let tree;
    await act(async () => {
      tree = renderer.create(<Probe navigationRef={nav} ready={false} />);
      await flush();
    });
    // Tree not ready yet — nothing routed.
    expect(nav.navigate).not.toHaveBeenCalled();

    nav.isReady = () => true;
    await act(async () => {
      tree.update(<Probe navigationRef={nav} ready />);
      await flush();
    });
    expect(nav.navigate).toHaveBeenCalledWith(
      'Tabs',
      expect.objectContaining({ screen: 'Map' })
    );
    await act(async () => tree.unmount());
  });
});
