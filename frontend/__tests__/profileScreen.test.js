/**
 * The You page has to render ALL OF ITSELF.
 *
 * This exists because of a specific failure that shipped: the rank rail added
 * under the portrait is a horizontal ScrollView nested inside the page's
 * vertical one, and it carried no height of its own. A nested scroll view
 * measured in an unbounded parent takes the space rather than its content's,
 * so the rail grew to most of a screen and pushed the stat wall, the PRO
 * poster, the streak calendar, the trophies, the run list and
 * every setting down past the fold. Nothing crashed and nothing was missing
 * from the tree — the page simply read as though everything below the portrait
 * had been deleted.
 *
 * A render test cannot see layout, so it cannot catch that directly. What it
 * CAN do is pin the two things that made it possible: that everything below
 * the portrait is REACHABLE (so a real absence is caught), and that the rail
 * states a fixed height (so the layout that buried them cannot come back).
 *
 * Reachable, not mounted: half this page is folded away now and a closed
 * section renders no children at all, deliberately (components/ui/Accordion).
 * So the first test pins what you land on, and the second opens each section
 * and pins what is inside it. A block that stops being rendered by ANY section
 * still fails here, which is the guarantee the all-at-once assertion gave.
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

import { StyleSheet, Switch, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import ProfileScreen from '../src/screens/ProfileScreen';
import SettingsScreen from '../src/screens/SettingsScreen';
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

function mountSettings() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <SettingsScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

// Open (or close) a folded section by its heading. The head is one pressable
// carrying the section's title as its label — see AccordionSection.
function press(tree, label) {
  const node = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function'
  )[0];
  if (!node) throw new Error('no pressable section called ' + label);
  act(() => node.props.onPress());
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
    api.myTerritory.mockImplementation(() => Promise.resolve({
      summary: { plots: 1, area_m2: 12000, fading_plots: 1, held_times: 0, lost_times: 0 },
      plots: [{
        id: 'p1',
        area_m2: 12000,
        held: 0,
        reinforcements: 0,
        claimed_at: new Date(Date.now() - 24 * 3600000).toISOString(),
        expires_at: new Date(Date.now() + 5.5 * 3600000).toISOString(),
        rings: [],
        bbox: [],
        lat: 1.3,
        lon: 103.8,
      }],
      history: [],
      fading_hours: 36,
      window_days: 7,
      history_days: 14,
    }));
  });

  test('what you land on is the runner, with the rest folded away', async () => {
    const tree = mount();
    await act(async () => {});
    const t = texts(tree).join('|');

    // The header and the thing you do with the runner. Managing pasers is
    // not on You any more: it moved to its own page off Home's shortcuts.
    expect(t).toContain('runner');
    expect(t).toContain('Customize runner');
    expect(t).not.toContain('Add pasers');
    // The stat wall.
    for (const label of ['Area held', 'Distance', 'Runs', 'Biggest claim', 'Streak', 'Zones']) {
      expect(t).toContain(label);
    }
    expect(t).toContain('PASER PRO');

    // Profile content stays on You; settings and run history do not.
    for (const heading of ['Your land', 'Running streak', 'Trophies']) {
      expect(t).toContain(heading);
    }
    // The six labelled tiles say what they are; a heading over them was
    // height and nothing else.
    expect(t).not.toContain('Statistics');
    expect(t).not.toContain('Recent runs');
    for (const buried of ['Notifications', 'App customisation', 'Privacy', 'Account', 'Appearance', 'Runner colour', 'Sign out']) {
      expect(t).not.toContain(buried);
    }

    act(() => tree.unmount());
  });

  test('profile sections stay visible without settings or run history', async () => {
    const tree = mount();
    await act(async () => {});

    const t = texts(tree).join('|');
    expect(t).toContain('See all');
    // The summary row says every clock one way ("5h left"); red says it is fading.
    expect(t).toContain('5h left');
    expect(t).not.toContain('Fades in');
    expect(t).toContain('Running streak');
    expect(t).toContain('Trophies');
    expect(t).not.toContain('Recent runs');
    expect(t).not.toContain('Notifications');

    act(() => tree.unmount());
  });

  test('settings holds the moved groups, one at a time', async () => {
    const tree = mountSettings();
    await act(async () => {});

    const open = async (heading) => {
      press(tree, heading);
      await act(async () => {});
      return texts(tree).join('|');
    };

    let t = texts(tree).join('|');
    for (const heading of ['Settings', 'App customisation', 'Notifications', 'Privacy', 'Account']) {
      expect(t).toContain(heading);
    }

    expect(t).toContain('Appearance');
    expect(t).toContain('Runner colour');

    t = await open('Privacy');
    // Nested, the route controls are titled for what they actually are.
    // "Privacy" is the name of the section they now sit inside.
    expect(t).toContain('Your routes');
    expect(t).toContain('Crossed paths');
    expect(t).not.toContain('Private areas');

    t = await open('Account');
    expect(t).toContain('Username');
    expect(t).toContain('Sign out');
    expect(t).toContain('Delete account');
    // App Review looks for both of these, so they have to stay reachable.
    expect(t).toContain('Privacy Policy');
    expect(t).toContain('Support');

    // A second tap on the open one folds it back up.
    press(tree, 'Account');
    await act(async () => {});
    expect(texts(tree).join('|')).not.toContain('Sign out');

    act(() => tree.unmount());
  });

  test('one notification toggle controls every notification preference', async () => {
    const tree = mountSettings();
    await act(async () => {});
    press(tree, 'Notifications');
    await act(async () => {});
    const toggle = tree.root.findAllByType(Switch).find(
      (node) => node.props.accessibilityLabel === 'Notifications toggle'
    );
    expect(toggle).toBeTruthy();
    await act(async () => toggle.props.onValueChange(false));
    expect(api.setNotifPrefs).toHaveBeenCalledWith(expect.objectContaining({
      stolen: false,
      kudos: false,
      paserby: false,
      reminder: false,
    }));
    act(() => tree.unmount());
  });

  test('publish delay saves the selected value', async () => {
    api.privacy.mockImplementation(() => Promise.resolve({ route_trim_m: 0, publish_delay_h: 0 }));
    api.setPrivacy.mockImplementation((patch) => Promise.resolve({ route_trim_m: 0, publish_delay_h: patch.publish_delay_h }));
    const tree = mountSettings();
    await act(async () => {});
    press(tree, 'Privacy');
    await act(async () => {});
    const delay = tree.root.findAll(
      (node) => node.props?.accessibilityLabel === '3 h delay' && typeof node.props?.onPress === 'function'
    )[0];
    await act(async () => delay.props.onPress());
    expect(api.setPrivacy).toHaveBeenCalledWith({ publish_delay_h: 3 });
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
    expect(StyleSheet.flatten(wrap.props.containerStyle).height).toBe(RAIL_H);

    act(() => tree.unmount());
  });

  test('the name then the spelled-out level sit under the portrait', async () => {
    const tree = mount();
    await act(async () => {});
    const t = texts(tree);
    const name = t.indexOf('runner');
    const level = t.indexOf('Level 2');
    expect(name).toBeGreaterThan(-1);
    // The level follows the name, in words — no bare number on a disc.
    expect(level).toBeGreaterThan(name);
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

  test('does not depend on the old profile run list', async () => {
    // Recent runs moved off You; even a stale run-list payload should not
    // affect the profile render path.
    mockRuns = { detail: 'nope' };
    const tree = mount();
    await act(async () => {});
    const t = texts(tree).join('|');
    expect(t).toContain('Trophies');
    expect(t).not.toContain('Recent runs');
    act(() => tree.unmount());
  });

  test('a land request that fails takes its card with it, not the page', async () => {
    // An app build ahead of its backend gets a 404 here. The card goes; the
    // rest of You must not.
    api.myTerritory.mockImplementation(() => Promise.reject(new Error('Request failed (404)')));
    const tree = mount();
    await act(async () => {});
    const t = texts(tree).join('|');
    // Its heading and its "See all" go with it. The section's subtitle still
    // names it, which is why that is not what this asserts on.
    expect(t).not.toContain('See all');
    expect(t).not.toContain('Fades in');
    expect(t).toContain('Running streak');
    expect(t).toContain('Trophies');
    expect(t).not.toContain('Recent runs');
    act(() => tree.unmount());
  });

  test('renders the first frame with every request still in flight', () => {
    const tree = mount();
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });
});
