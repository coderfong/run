// LandCaptureAlertHost, mounted.
//
// This is the screen a push delivers straight into whatever the runner is
// doing — Home, the map, mid-run recap, anywhere. It now drives the real
// CaptureCast + CaptureStylePlayer choreography engine instead of the small
// standalone flourish it used to, so a prop mismatch here throws exactly the
// way it would on ResultScreen, just with no run behind it to blame it on.
// These are mount tests: they assert the alert comes up, plays a style, and
// tears down cleanly — not what it looks like.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

// `check()` calls api.notifications on mount and every 10s after. Left
// unmocked it hits a real fetch that hangs the whole run instead of settling
// — the alert's own try/catch would happily absorb the eventual rejection,
// but jest never gets to see it.
jest.mock('../src/api/client', () => ({
  api: new Proxy({}, { get: () => jest.fn(() => new Promise(() => {})) }),
  ApiError: class ApiError extends Error {},
  API_BASE: 'http://test',
}));
jest.mock('../src/api/cache', () => ({
  invalidateAfterLandLoss: jest.fn(),
  getCached: jest.fn(() => null),
  fetchAndCache: jest.fn(() => new Promise(() => {})),
}));

import { LandCaptureAlertHost, landCaptureAlert } from '../src/components/LandCaptureAlert';

const mount = (element) => {
  let tree;
  act(() => { tree = renderer.create(element); });
  return {
    tree,
    unmount: () => act(() => tree.unmount()),
  };
};

const STOLEN_PAYLOAD = {
  category: 'stolen',
  title: 'Your land was captured',
  body: 'RivalKai took 1,240 m² of your territory.',
  data: {
    capture_id: 'run-1:me',
    taken_m2: 1240.4,
    lat: 1.3521,
    lon: 103.8198,
    attacker_id: 'kai',
    attacker_username: 'RivalKai',
    attacker_avatar: { hair: 'curtains' },
    territory_id: 'territory-42',
  },
};

describe('the land capture alert', () => {
  test('mounts idle with nothing queued', () => {
    const { unmount } = mount(
      <LandCaptureAlertHost onViewLand={() => {}} onOpenNotifications={() => {}} />
    );
    unmount();
  });

  test('plays the real capture-style choreography for a stolen event without throwing', () => {
    let ctx;
    act(() => {
      ctx = renderer.create(
        <LandCaptureAlertHost onViewLand={() => {}} onOpenNotifications={() => {}} />
      );
    });

    expect(() => {
      act(() => { landCaptureAlert.show(STOLEN_PAYLOAD); });
    }).not.toThrow();

    const text = ctx.toJSON();
    expect(text).not.toBeNull();
    expect(JSON.stringify(text)).toContain('LAND CAPTURED');

    act(() => { ctx.unmount(); });
  });

  test('boxes the real ring: mounts, plays and forwards the ring to onViewLand', () => {
    const seen = [];
    let ctx;
    act(() => {
      ctx = renderer.create(
        <LandCaptureAlertHost onViewLand={(c) => seen.push(c)} onOpenNotifications={() => {}} />
      );
    });

    const ring = [
      [103.8198, 1.3521],
      [103.8210, 1.3521],
      [103.8210, 1.3533],
      [103.8198, 1.3533],
    ];

    // The real capture path: projecting the ring into the stage and handing it
    // to CaptureStylePlayer must not throw the way a prop mismatch would.
    expect(() => {
      act(() => {
        landCaptureAlert.show({ ...STOLEN_PAYLOAD, data: { ...STOLEN_PAYLOAD.data, territory_ring: ring } });
      });
    }).not.toThrow();

    const press = (title) => {
      const btn = ctx.root.findAll(
        (n) => n.props && n.props.title === title && typeof n.props.onPress === 'function'
      )[0];
      act(() => { btn.props.onPress(); });
    };

    // The route through the sequence, in order: alert → the full-screen
    // cutscene → its payoff → the live map. SKIP is the always-available way
    // to the payoff, so this does not have to wait out a real style's
    // choreography; ZOOM TO THE LAND does not exist until the payoff has
    // landed, which is why it is walked rather than reached for.
    expect(() => press('VIEW AFFECTED LAND')).not.toThrow();
    expect(() => press('SKIP')).not.toThrow();
    expect(() => press('ZOOM TO THE LAND')).not.toThrow();

    // The exact ring reaches the map so it can fit to the real ground.
    expect(seen).toHaveLength(1);
    expect(seen[0].territoryRing).toEqual(ring);

    act(() => { ctx.unmount(); });
  });

  test('still mounts a stolen event with no lat/lon and no territory id', () => {
    let ctx;
    act(() => {
      ctx = renderer.create(
        <LandCaptureAlertHost onViewLand={() => {}} onOpenNotifications={() => {}} />
      );
    });

    expect(() => {
      act(() => {
        landCaptureAlert.show({
          category: 'stolen',
          body: 'DevRival took 9,876 m² of your territory.',
          actor_username: 'DevRival',
        });
      });
    }).not.toThrow();

    act(() => { ctx.unmount(); });
  });
});
