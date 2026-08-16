/**
 * Home must render. It is the first screen after sign-in and the one every tab
 * falls back to, so a render crash there is caught by the per-tab
 * ErrorBoundary and shown as "Something went wrong" — which tells the user
 * nothing and tells a developer less, because the boundary swallows the stack.
 *
 * This mounts the real screen against the states its data can actually be in:
 * everything still in flight (first launch), a populated feed, and a feed whose
 * rows are missing the fields the header and cards read. The assertion is that
 * it renders at all — a crash here surfaces the stack the boundary would eat.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import Svg from 'react-native-svg';

// --- data the screen pulls in ----------------------------------------------
let mockFeed = { items: [], next_cursor: null };
let mockEnergy = { energy: 40, energy_max: 100, claim_cost: 16 };
let mockNotifs = { unread: 0, items: [] };

// A Proxy rather than a fixed list of methods, so this keeps testing Home as
// the screen grows new calls instead of failing on an undefined mock. Home
// itself only fetches three things, but the header rail and the cards under it
// fetch their own (progression, rank, …), and every one of those has to answer
// something for the render to complete.
jest.mock('../src/api/client', () => {
  const named = {
    feed: jest.fn(() => Promise.resolve(mockFeed)),
    energyStatus: jest.fn(() => Promise.resolve(mockEnergy)),
    notifications: jest.fn(() => Promise.resolve(mockNotifs)),
  };
  return {
    api: new Proxy(named, {
      get: (target, prop) =>
        target[prop] || (target[prop] = jest.fn(() => Promise.resolve({}))),
    }),
    ApiError: class ApiError extends Error {},
    API_BASE: 'http://test',
    apiImageUri: jest.fn((path) => (path ? `http://test${path}` : null)),
    apiPhotoSource: jest.fn((path) => (path ? { uri: `http://test${path}` } : null)),
  };
});

// The real cache would persist between cases through AsyncStorage; a plain
// pass-through keeps each case starting from nothing.
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
  useAuth: () => ({ user: { id: 'u1', username: 'runner' } }),
}));
jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({ equipped: {}, rankKey: 'wood', refreshRank: jest.fn() }),
}));
jest.mock('../src/state/clan', () => ({
  useClan: () => ({ color: { fill: '#222', stroke: '#4af', glow: '#7cf' }, clan: null }),
  NEUTRAL: { fill: '#222', stroke: '#888', glow: '#aaa' },
}));
jest.mock('../src/utils/runnerAssetPreload', () => ({ preloadRunnerAssets: jest.fn() }));
// The test is about where/when the one-shot is mounted. Sprite timing itself
// is covered by effect tests and needs a native UI-frame callback unavailable
// in react-test-renderer.
jest.mock('../src/effects/ReactionEffect', () => 'ReactionEffect');

import { NavigationContext } from '@react-navigation/native';

import HomeScreen from '../src/screens/HomeScreen';
import FeedCard from '../src/components/FeedCard';
import ReactionEffect from '../src/effects/ReactionEffect';

// `useFocusEffect` and `useQuery` both reach for the navigation object through
// context rather than through props, so passing one as a prop is not enough —
// the screen has to be mounted inside a provider the way the tab navigator
// mounts it.
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
        <HomeScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

const runner = (over = {}) => ({
  id: 'f1',
  user_id: 'u2',
  username: 'someone',
  distance_m: 5000,
  duration_s: 1800,
  area_m2: 120000,
  created_at: new Date().toISOString(),
  avatar: {},
  ...over,
});

describe('HomeScreen', () => {
  beforeEach(() => {
    mockFeed = { items: [], next_cursor: null };
    mockEnergy = { energy: 40, energy_max: 100, claim_cost: 16 };
    mockNotifs = { unread: 0, items: [] };
    jest.clearAllMocks();
  });

  it('renders the first frame with every request still in flight', () => {
    const tree = mount();
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('renders a populated feed', async () => {
    mockFeed = { items: [runner(), runner({ id: 'f2', username: 'other' })], next_cursor: null };
    mockNotifs = { unread: 3, items: [] };
    const tree = mount();
    await act(async () => {});
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('renders a feed row that took land off somebody', async () => {
    // The one card that auto-plays its steal. Reads `victims`, which most
    // rows do not have at all.
    mockFeed = {
      items: [
        runner({
          id: 'f3',
          victims: [{ user_id: 'u9', username: 'victim', area_m2: 4000, avatar: {} }],
        }),
      ],
      next_cursor: null,
    };
    const tree = mount();
    await act(async () => {});
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('survives a feed whose rows are missing fields', async () => {
    // Nothing here is hypothetical: a row can predate a column, and a server
    // that answers with nulls must not take the whole tab down.
    mockFeed = {
      items: [
        { id: 'bare' },
        runner({ id: 'nulls', avatar: null, username: null, area_m2: null, distance_m: null }),
      ],
      next_cursor: null,
    };
    const tree = mount();
    await act(async () => {});
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('survives every request failing', async () => {
    const { api } = require('../src/api/client');
    api.feed.mockRejectedValue(new Error('offline'));
    api.energyStatus.mockRejectedValue(new Error('offline'));
    api.notifications.mockRejectedValue(new Error('offline'));
    const tree = mount();
    await act(async () => {});
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });
});

describe('feed reactions', () => {
  const route = {
    path: [[103.80, 1.30], [103.81, 1.31], [103.82, 1.30]],
    rings: [[
      [103.80, 1.30], [103.81, 1.31], [103.82, 1.30], [103.80, 1.30],
    ]],
  };

  // The picker is hosted in a Modal, placed off a real measurement of the
  // trigger's on-screen position (see FeedCard's `openPicker`) so it can open
  // upward and still be tappable on Android. RN's test mock leaves
  // `measureInWindow` an empty `jest.fn()` that never calls back, so without
  // this the picker simply never opens in the test renderer.
  function openReactionPicker(tree) {
    const anchor = tree.root.findByProps({ collapsable: false });
    anchor.instance.measureInWindow.mockImplementation((cb) => cb(20, 200, 40, 40));
    act(() => {
      tree.root.findByProps({ accessibilityLabel: 'Add a reaction' }).props.onPress();
    });
  }

  it('closes the inline picker when Home loses navigation focus', () => {
    const item = runner({ reactions: [], my_reaction: null });
    let tree;
    act(() => {
      tree = renderer.create(
        <FeedCard item={item} navigation={navigation} screenFocused />
      );
    });

    openReactionPicker(tree);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Love it' }).length).toBeGreaterThan(0);

    act(() => {
      tree.update(<FeedCard item={item} navigation={navigation} screenFocused={false} />);
    });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Love it' })).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('offers the pencil only until a caption or photo has actually been saved', () => {
    const blank = runner({ is_you: true, caption: '', media: [] });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={blank} navigation={navigation} />); });
    expect(tree.root.findByProps({ accessibilityLabel: 'Add a caption or photo' })).toBeTruthy();
    act(() => tree.unmount());

    const captioned = runner({ is_you: true, caption: 'hi', media: [] });
    act(() => { tree = renderer.create(<FeedCard item={captioned} navigation={navigation} />); });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Add a caption or photo' })).toHaveLength(0);
    act(() => tree.unmount());
  });

  // The share button on a run card: your own runs only, and it opens the same
  // sheet the result screen mounts — at the ROOT, so the card is not posted
  // from under the tab bar.
  it('offers Share on your own run and hands the sheet what the card drew', () => {
    const mine = runner({
      id: 'r9',
      is_you: true,
      closed_loop: true,
      clan_color: { fill: '#222', stroke: '#4af', glow: '#7cf' },
      ...route,
    });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={mine} navigation={navigation} />); });
    const [button] = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Share this run');
    expect(button).toBeTruthy();
    act(() => button.props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('RunShare', expect.objectContaining({
      path: route.path,
      rings: route.rings,
      team: mine.clan_color,
      run: expect.objectContaining({ runId: 'r9', areaM2: mine.area_m2, claimed: true }),
    }));
    act(() => tree.unmount());
  });

  it("keeps Share off somebody else's run", () => {
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={runner()} navigation={navigation} />); });
    expect(tree.root.findAll((n) => n.props?.accessibilityLabel === 'Share this run')).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('shows a run caption and every attached photo on the Home card', () => {
    const item = runner({
      is_you: true,
      caption: 'Sunrise around the bay',
      media: [
        'data:image/jpeg;base64,aGVsbG8=',
        'data:image/jpeg;base64,d29ybGQ=',
      ],
    });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={item} navigation={navigation} />); });
    expect(tree.root.findByProps({ children: 'Sunrise around the bay' })).toBeTruthy();
    const photoLabels = new Set(tree.root.findAll((node) =>
      String(node.props.accessibilityLabel || '').startsWith('Run post photo ')
    ).map((node) => node.props.accessibilityLabel));
    expect([...photoLabels]).toEqual(['Run post photo 1 of 2', 'Run post photo 2 of 2']);
    // Caption and photos are already set on this run — a one-time edit, so
    // the pencil that adds them is gone once they exist.
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Add a caption or photo' })).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('puts the route map and the post photos side by side when a run has both, and pages between photos', () => {
    const item = runner({
      ...route,
      is_you: true,
      caption: 'Loop with a view',
      media: ['data:image/jpeg;base64,aGVsbG8=', 'data:image/jpeg;base64,d29ybGQ='],
    });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={item} navigation={navigation} />); });

    // The photo half measures itself before it renders any image — simulate
    // the layout pass a real device does automatically.
    const photoCard = tree.root.findByProps({ testID: 'paired-photo-card' });
    act(() => {
      photoCard.props.onLayout({ nativeEvent: { layout: { width: 160, height: 160 } } });
    });

    const photoLabels = new Set(tree.root.findAll((node) =>
      String(node.props.accessibilityLabel || '').startsWith('Run post photo ')
    ).map((node) => node.props.accessibilityLabel));
    expect([...photoLabels]).toEqual(['Run post photo 1 of 2', 'Run post photo 2 of 2']);
    // The route drawing is still there, beside the photos rather than instead
    // of them.
    expect(tree.root.findAllByType(Svg).length).toBeGreaterThan(0);

    // Paging math uses the SAME measured width the photos were rendered at —
    // landing a swipe on photo index 1 (not somewhere between 0 and 1) is
    // exactly the bug report this guards against.
    const scrollView = tree.root.findByProps({ testID: 'paired-photo-card' })
      .findByProps({ pagingEnabled: true });
    act(() => {
      scrollView.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 160 } } });
    });
    expect(tree.root.findAll((node) =>
      Array.isArray(node.props.children) && node.props.children.join('') === '2/2'
    ).length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it('renders a route thumbnail without crashing the Home tab', async () => {
    // RouteThumb used the palette without creating it. Text-only feed fixtures
    // all passed while the first real run with a path threw into Home's error
    // boundary and showed the generic "Something went wrong" screen.
    mockFeed = {
      items: [runner({
        id: 'with-route',
        path: [
          { latitude: 1.30, longitude: 103.80 },
          { latitude: 1.31, longitude: 103.81 },
          { latitude: 1.30, longitude: 103.82 },
        ],
        rings: [[
          [103.80, 1.30], [103.81, 1.31], [103.82, 1.30], [103.80, 1.30],
        ]],
      })],
      next_cursor: null,
    };
    const tree = mount();
    await act(async () => {});
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('shows aggregate reaction counts as chips in their own row, not on the map', () => {
    const item = runner({
      ...route,
      reactions: [
        { emote: 'love', count: 3 },
        { emote: 'wow', count: 2 },
      ],
      my_reaction: null,
    });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={item} navigation={navigation} />); });
    // One chip per emote, carrying its count — not one sticker per person.
    expect(tree.root.findByProps({ accessibilityLabel: 'Love it, 3' })).toBeTruthy();
    expect(tree.root.findByProps({ accessibilityLabel: 'No way, 2' })).toBeTruthy();
    act(() => tree.unmount());
  });

  it('plays the selected emoji animation over the reaction row', () => {
    const { api } = require('../src/api/client');
    // Hold the request so this assertion sees the optimistic placement rather
    // than an intentionally empty generic mock response replacing it.
    api.setRunReaction.mockImplementation(() => new Promise(() => {}));
    const item = runner({ ...route, reactions: [], my_reaction: null });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={item} navigation={navigation} />); });
    openReactionPicker(tree);
    act(() => tree.root.findByProps({ accessibilityLabel: 'Love it' }).props.onPress());
    expect(tree.root.findAllByType(ReactionEffect)).toHaveLength(1);
    expect(tree.root.findByProps({ accessibilityLabel: 'Love it, 1' })).toBeTruthy();
    act(() => tree.unmount());
  });
});
