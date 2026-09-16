/**
 * The Club tab (src/screens/ClubScreen.js).
 *
 * Both cases here come from the same report, and both are about the top of the
 * page once you are in a club.
 *
 * THE SWITCHER WAS UNDER THE STATUS BAR. The member hub was a raw ScrollView
 * rather than a Screen, so it was the one page in the app that never applied
 * the top safe-area inset. On a phone with a Dynamic Island the Club view /
 * Club rank control sat behind it and roughly half of the control could not be
 * tapped at all. What is pinned is the inset, not the pixel: the hub and every
 * other view of the hub lay out on the same padding, so switching views cannot
 * move the control you switched with either.
 *
 * AND THERE WAS NO WAY BACK TO THE OTHER CLUBS. The directory was the whole
 * screen for anyone WITHOUT a club, so joining one took it away and left no
 * route to the club list from anywhere in the tab.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockClan;
let mockSearch;

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
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'runner' } }),
}));

const COLOR = { fill: '#123', stroke: '#2DD4BF', glow: '#7cf' };
jest.mock('../src/state/clan', () => ({
  useClan: () => ({ clan: { clan_id: 'c1' }, loading: false, refresh: jest.fn(), color: COLOR }),
  NEUTRAL: { fill: '#222', stroke: '#888', glow: '#aaa' },
}));

// Lottie wants a native view and a frame clock; the celebration itself is
// covered elsewhere and nothing here reaches a completed goal.
jest.mock('../src/components/GameLottie', () => 'GameLottie');

import { Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import ClubScreen from '../src/screens/ClubScreen';
import { Screen, Segmented } from '../src/components/ui';
import { api } from '../src/api/client';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  addListener: jest.fn(() => jest.fn()),
  isFocused: () => true,
  getParent: () => ({ navigate: jest.fn() }),
};

const club = (over = {}) => ({
  clan_id: 'c1',
  id: 'c1',
  name: 'PACE 6',
  tag: 'P6',
  description: 'Running out of Central Singapore.',
  color: COLOR,
  photo_url: null,
  badge_icon: 'sword',
  league: 'bronze',
  member_count: 15,
  my_role: 'member',
  elo_key: 'wood',
  elo_rating: 1046,
  elo_next_rating: 1050,
  elo_progress: 0.9,
  total_area_m2: 2e6,
  season_area_m2: 1e6,
  week_goal: {
    target_distance_m: 225000,
    progress_distance_m: 0,
    my_distance_m: 0,
    target_claims: 30,
    progress_claims: 0,
    my_claims: 0,
    reached: false,
  },
  members: [
    { user_id: 'u1', username: 'runner', role: 'member', week_distance_m: 0, week_claims: 0 },
  ],
  ...over,
});

const listing = (id, name, tag) => ({
  id,
  name,
  tag,
  color: COLOR,
  photo_url: null,
  badge_icon: 'sword',
  privacy: 'open',
  league: 'bronze',
  member_count: 4,
  season_area_m2: 1e6,
});

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <ClubScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

// A club row's label is `[{tag}] {name}`, which reaches Text as an ARRAY of
// children — flatten, or every interpolated line in the app reads as absent.
function texts(tree) {
  return tree.root
    .findAllByType(Text)
    .map((n) => [].concat(n.props.children).join(''))
    .filter(Boolean);
}

/** Switch the hub to one of its views the way a thumb would. */
function switchTo(tree, label) {
  const segment = tree.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  )[0];
  act(() => segment.props.onPress());
}

/**
 * The padding above the page's content. Screen flattens [safe-area inset,
 * contentStyle] in that order, so this is the number that actually lands —
 * which is the whole point: a contentStyle paddingTop silently wins over the
 * inset.
 */
function topPad(tree) {
  const page = tree.root.findAllByType(Screen)[0];
  const scroll = page.findByProps({ showsVerticalScrollIndicator: false });
  return Object.assign({}, ...[].concat(scroll.props.contentContainerStyle)).paddingTop;
}

describe('the Club tab, once you are in a club', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClan = club();
    mockSearch = [listing('c1', 'PACE 6', 'P6'), listing('c2', 'Night Owls', 'OWL')];
    api.getClan = jest.fn(() => Promise.resolve(mockClan));
    api.searchClans = jest.fn(() => Promise.resolve(mockSearch));
    api.listJoinRequests = jest.fn(() => Promise.resolve([]));
    api.clanEloLeaderboard = jest.fn(() => Promise.resolve([]));
  });

  // The bug, stated as the thing that was missing. jest.setup fixes the mock
  // inset at 44, so a hub that skips it lays out at 0 and fails here.
  it('starts its content below the status bar, not under it', async () => {
    const tree = mount();
    await act(async () => {});
    expect(topPad(tree)).toBe(44);
  });

  it('keeps the switcher in the same place in every view', async () => {
    const tree = mount();
    await act(async () => {});
    const hub = topPad(tree);
    switchTo(tree, 'Club rank');
    expect(topPad(tree)).toBe(hub);
    switchTo(tree, 'All clubs');
    expect(topPad(tree)).toBe(hub);
  });

  it('offers a way back to the other clubs', async () => {
    const tree = mount();
    await act(async () => {});
    const keys = tree.root.findByType(Segmented).props.options.map((o) => o.key);
    expect(keys).toEqual(['view', 'rankings', 'browse']);
  });

  it('browses and searches the full club list from inside a club', async () => {
    const tree = mount();
    await act(async () => {});
    switchTo(tree, 'All clubs');
    await act(async () => {});
    expect(api.searchClans).toHaveBeenCalled();
    const t = texts(tree).join('|');
    expect(t).toContain('[OWL] Night Owls');
    expect(t).toContain('[P6] PACE 6');
  });

  // The way back out of a browsed club is the stack's own header, which only
  // exists because the row PUSHES ClubDetail rather than swapping the tab's
  // contents for it.
  it('pushes a browsed club rather than swallowing the tab', async () => {
    const tree = mount();
    await act(async () => {});
    switchTo(tree, 'All clubs');
    await act(async () => {});
    const row = tree.root.findAll(
      (n) => typeof n.props.onPress === 'function'
        && n.findAllByType(Text).some((t) => [].concat(t.props.children).join('') === '[OWL] Night Owls')
    )[0];
    act(() => row.props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('ClubDetail', { clanId: 'c2' });
  });
});
