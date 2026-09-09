/**
 * The You page has to render ALL OF ITSELF.
 *
 * This exists because of a specific failure that shipped: the rank rail added
 * under the portrait is a horizontal ScrollView nested inside the page's
 * vertical one, and it carried no height of its own. A nested scroll view
 * measured in an unbounded parent takes the space rather than its content's,
 * so the rail grew to most of a screen and pushed the stat wall, the PRO
 * poster, the rivals, the streak calendar, the trophies, the run list and
 * every setting down past the fold. Nothing crashed and nothing was missing
 * from the tree — the page simply read as though everything below the portrait
 * had been deleted.
 *
 * A render test cannot see layout, so it cannot catch that directly. What it
 * CAN do is pin the two things that made it possible: that every section is
 * actually mounted (so a real absence is caught), and that the rail states a
 * fixed height (so the layout that buried them cannot come back).
 *
 * It also mounts the screen against payloads that are the wrong shape, which
 * is the other way this page vanishes: an exception in render is caught by the
 * tab's ErrorBoundary and the whole of You becomes "Something went wrong".
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockStats;
let mockRuns;

jest.mock('../src/api/client', () => {
  const named = {};
  return {
    api: new Proxy(named, {
      get: (target, prop) => target[prop] || (target[prop] = jest.fn(() => Promise.resolve({}))),
    }),
    ApiError: class ApiError extends Error {},
    API_BASE: 'http://test',
    apiImageUri: jest.fn((path) => (path ? `http://test${path}` : null)),
    apiPhotoSource: jest.fn((path) => (path ? { uri: `http://test${path}` } : null)),
  };
});

jest.mock('../src/api/cache', () => ({
  fetchAndCache: jest.fn((_key, fetcher) => fetcher()),
  getCached: jest.fn(() => undefined),
  setCached: jest.fn(),
  markAttempt: jest.fn(),
  touchedAt: jest.fn(() => 0),
  subscribeCached: jest.fn(() => jest.fn()),
  invalidate: jest.fn(),
  invalidateAfterClaim: jest.fn(),
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'runner' },
    signOut: jest.fn(),
    updateUsername: jest.fn(),
    deleteAccount: jest.fn(),
  }),
}));
jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({ equipped: {}, rankKey: 'wood', refreshRank: jest.fn() }),
}));
jest.mock('../src/state/clan', () => ({
  useClan: () => ({ color: { fill: '#222', stroke: '#4af', glow: '#7cf' }, clan: null }),
  NEUTRAL: { fill: '#222', stroke: '#888', glow: '#aaa' },
}));
jest.mock('../src/utils/runnerAssetPreload', () => ({ preloadRunnerAssets: jest.fn() }));
jest.mock('../src/pro/ProProvider', () => ({
  useProEntitlement: () => ({
    isPro: false, canSell: false, canShowPro: true, isLoading: false,
    runCount: 5, openPaywall: jest.fn(() => false),
  }),
  ProProvider: ({ children }) => children,
}));

import { StyleSheet, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import ProfileScreen from '../src/screens/ProfileScreen';
import RankRail, { RAIL_H } from '../src/components/rank/RankRail';
import { api } from '../src/api/client';

const navigation = {
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  isFocused: () => true,
  getParent: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
};

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <ProfileScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

function texts(tree) {
  return tree.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String);
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStats = {
      level: 2,
      xp: 40,
      next_level_xp: 100,
      rank_key: 'wood',
      rank_points: 1000,
      rank_progress: 0.8,
      total_distance_m: 35900,
      total_area_m2: 1850000,
      biggest_claim_m2: 1570000,
      territory_count: 2,
      run_count: 5,
      current_streak_days: 1,
    };
    mockRuns = [];

    api.meStats.mockImplementation(() => Promise.resolve(mockStats));
    api.meRuns.mockImplementation(() => Promise.resolve(mockRuns));
    api.rankLadder.mockImplementation(() => Promise.resolve({
      tiers: [800, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2150, 2400].map((floor) => ({ floor })),
    }));
    api.runDays.mockImplementation(() => Promise.resolve({ days: [] }));
    api.rivals.mockImplementation(() => Promise.resolve({ rivals: [] }));
    api.energyStatus.mockImplementation(() => Promise.resolve({ energy: 40, energy_max: 100, claim_cost: 16 }));
    api.pasers.mockImplementation(() => Promise.resolve({ incoming: [], pasers: [] }));
    api.paserby.mockImplementation(() => Promise.resolve({ enabled: true, unseen: 0, total: 0 }));
    api.getNotifPrefs.mockImplementation(() => Promise.resolve({}));
  });

  test('every section of the page is on it', async () => {
    const tree = mount();
    await act(async () => {});
    const t = texts(tree).join('|');

    // The header and the two things you do with the runner.
    expect(t).toContain('runner');
    expect(t).toContain('Customize runner');
    expect(t).toContain('Add pasers');
    // The stat wall.
    for (const label of ['Area held', 'Distance', 'Runs', 'Biggest claim', 'Streak', 'Zones']) {
      expect(t).toContain(label);
    }
    // Everything under it, in page order.
    expect(t).toContain('PASER PRO');
    expect(t).toContain('Rivals');
    expect(t).toContain('Running streak');
    expect(t).toContain('Trophies');
    expect(t).toContain('Recent runs');
    expect(t).toContain('Settings');
    expect(t).toContain('Runner colour');
    expect(t).toContain('Privacy');
    expect(t).toContain('Appearance');
    expect(t).toContain('Sign out');

    act(() => tree.unmount());
  });

  test('the rank rail states a height, so it cannot bury the page under it', async () => {
    const tree = mount();
    await act(async () => {});

    // The height lives on the rail's own wrapper, not on the style the page
    // hands it — which is exactly why the page could not have caught this.
    expect(tree.root.findAllByType(RankRail)).toHaveLength(1);
    const wrap = tree.root.findAll(
      (n) => String(n.props?.accessibilityLabel || '').includes('Open the rank ladder')
    )[0];
    expect(StyleSheet.flatten(wrap.props.style).height).toBe(RAIL_H);

    act(() => tree.unmount());
  });

  test('the rail reflects the standing the page was actually given', async () => {
    const tree = mount();
    await act(async () => {});
    const t = texts(tree).join('|');

    // 1,000 points, Wood floor 800, Bronze at 1,050: the last third of the
    // band, which is Wood III with fifty to go.
    expect(t).toContain('WOOD III');
    expect(t).toContain('1,000 / 1,050');
    expect(t).toContain('50 to Bronze');

    act(() => tree.unmount());
  });

  test('survives a run list that is not a list', async () => {
    // The list is rendered with `.slice`. An error body or a stale cache entry
    // of another shape used to take the whole page down with it.
    mockRuns = { detail: 'nope' };
    const tree = mount();
    await act(async () => {});
    expect(texts(tree).join('|')).toContain('Settings');
    act(() => tree.unmount());
  });

  test('renders the first frame with every request still in flight', () => {
    const tree = mount();
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });
});
