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

// Entitlement, so the PRO surfaces on this screen can be put in a state.
// Without the provider they would fall back to "cannot sell, not a subscriber,
// run count unknown" — which is the correct default and the reason every case
// above renders no PRO at all.
let mockPro = {
  isPro: false,
  canSell: false,
  // Marketing surfaces (hero slide, feed card) gate on `canShowPro`; only the
  // subscribe button reads `canSell`. Mirror both so the mock matches the real
  // useProEntitlement shape.
  canShowPro: false,
  runCount: null,
  openPaywall: jest.fn(() => false),
};
jest.mock('../src/pro/ProProvider', () => ({
  useProEntitlement: () => mockPro,
  ProProvider: ({ children }) => children,
}));
// The test is about where/when the one-shot is mounted. Sprite timing itself
// is covered by effect tests and needs a native UI-frame callback unavailable
// in react-test-renderer.
jest.mock('../src/effects/ReactionEffect', () => 'ReactionEffect');

import { StyleSheet, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import HomeScreen from '../src/screens/HomeScreen';
import { HOME_AUTO_PROMPT_DELAY_MS } from '../src/config/proExposure';
import FeedCard from '../src/components/FeedCard';
import EnergyMeter from '../src/components/EnergyMeter';
import ReactionEffect from '../src/effects/ReactionEffect';
import { Bar } from '../src/ui/motion';

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

  it('keeps the compact energy amount inside its correctly measured bar', async () => {
    const tree = mount();
    await act(async () => {});

    const meter = tree.root.findByType(EnergyMeter);
    const labels = meter
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .map(String);
    const bar = meter.findByType(Bar);

    expect(meter.props.compact).toBe(true);
    expect(labels).toContain('40');
    expect(labels).not.toContain('40/100');
    expect(bar.props.trackStyle).toBe(StyleSheet.absoluteFill);
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

/**
 * The one thing Home does that nobody asked for.
 *
 * Home may raise PASER PRO by itself, which makes it the only surface in the
 * app that can interrupt somebody. Whether it is ALLOWED to is the exposure
 * rules' job (proMonetisation.test.js covers those); what is tested here is
 * that Home asks at the right MOMENT, because the two ways this goes wrong are
 * both invisible in a running app:
 *
 *   * Asking before /me/stats has landed. The rules refuse an unknown run
 *     count, Home has spent its one prompt for the launch, and the popup then
 *     only ever appears on a warm start — for no reason anybody would find.
 *   * Asking while the screen is still drawing itself, which is a launch
 *     interstitial whatever the copy says.
 */
describe('the Home PRO prompt', () => {
  const withPro = (over) => { mockPro = { ...mockPro, ...over }; };

  beforeEach(() => {
    jest.useFakeTimers();
    mockFeed = { items: [], next_cursor: null };
    mockPro = { isPro: false, canSell: true, canShowPro: true, runCount: null, openPaywall: jest.fn(() => true) };
  });
  afterEach(() => jest.useRealTimers());

  it('does not ask while the run count is still unknown', async () => {
    const tree = mount();
    await act(async () => {});
    act(() => { jest.advanceTimersByTime(60_000); });
    // Not "asked and was refused" — never asked at all, so the one prompt this
    // launch is allowed is still available once the number arrives.
    expect(mockPro.openPaywall).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('asks once the count is known, and says it was automatic', async () => {
    withPro({ runCount: 10 });
    const tree = mount();
    await act(async () => {});
    // Nothing yet: the screen has only just appeared.
    expect(mockPro.openPaywall).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(HOME_AUTO_PROMPT_DELAY_MS); });
    // `automatic: true` is what sends this through the exposure rules. Without
    // it this would be treated as a tap the runner made and shown every time.
    expect(mockPro.openPaywall).toHaveBeenCalledWith('home', { automatic: true });
    expect(mockPro.openPaywall).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  // The other half of the ask: a way IN that does not depend on being
  // prompted. The mid-feed card needs three finished runs behind it, so
  // without this a new account had no route to the paywall from Home at all.
  it('carries a PRO card in the hero, one tap from the paywall', async () => {
    const tree = mount();
    await act(async () => {});
    const hero = tree.root.findByProps({ accessibilityLabel: 'GO PRO' });
    act(() => hero.props.onPress());
    expect(mockPro.openPaywall).toHaveBeenCalledWith('home');
    act(() => tree.unmount());
  });

  it('never sells a subscriber their own subscription', async () => {
    withPro({ isPro: true, runCount: 10 });
    const tree = mount();
    await act(async () => {});
    expect(tree.root.findAllByProps({ accessibilityLabel: 'GO PRO' })).toHaveLength(0);
    act(() => { jest.advanceTimersByTime(60_000); });
    // The prompt is still ASKED for — refusing a subscriber is the provider's
    // job and it does it in one place, rather than every caller remembering.
    // What must never happen is a sheet, and openPaywall returning false is
    // how that is guaranteed.
    expect(mockPro.openPaywall).toHaveBeenCalledWith('home', { automatic: true });
    act(() => tree.unmount());
  });

  it('cancels rather than spends the prompt when Home is left first', async () => {
    withPro({ runCount: 10 });
    const tree = mount();
    await act(async () => {});
    act(() => tree.unmount());
    act(() => { jest.advanceTimersByTime(60_000); });
    // Somebody who opens the app and taps straight into a run is not sold to
    // on the way past.
    expect(mockPro.openPaywall).not.toHaveBeenCalled();
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
  // Same shape as the reaction picker's opener, and for the same reason: the
  // menu is placed from `measureInWindow`, which RN's test mock never calls
  // back, so without a stub it never opens.
  function openOverflowMenu(tree) {
    const anchor = tree.root.findByProps({ testID: 'overflow-menu-anchor' });
    anchor.instance.measureInWindow.mockImplementation((cb) => cb(240, 200, 40, 40));
    act(() => {
      tree.root
        .findByProps({ accessibilityLabel: 'More actions for this run' })
        .props.onPress();
    });
  }

  function openReactionPicker(tree) {
    const anchor = tree.root.findByProps({ testID: 'feed-card-reaction-anchor' });
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

  it('offers the caption entry only until a caption or photo has actually been saved', () => {
    const blank = runner({ is_you: true, caption: '', media: [] });
    let tree;
    act(() => { tree = renderer.create(<FeedCard item={blank} navigation={navigation} />); });
    openOverflowMenu(tree);
    expect(tree.root.findByProps({ accessibilityLabel: 'Add caption or photo' })).toBeTruthy();
    act(() => tree.unmount());

    const captioned = runner({ is_you: true, caption: 'hi', media: [] });
    act(() => { tree = renderer.create(<FeedCard item={captioned} navigation={navigation} />); });
    openOverflowMenu(tree);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Add caption or photo' })).toHaveLength(0);
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
    openOverflowMenu(tree);
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
    openOverflowMenu(tree);
    expect(tree.root.findAll((n) => n.props?.accessibilityLabel === 'Share this run')).toHaveLength(0);
    // The menu is still offered — it still holds Comments.
    expect(tree.root.findByProps({ accessibilityLabel: 'Comments' })).toBeTruthy();
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

// The card header carries the identity on the left and up to five buttons on
// the right (share, edit, react, comment, kudos). Five of them are more than
// half the width a card has inside its padding, and while the identity was the
// only side allowed to shrink, they took it: the username clipped to an
// ellipsis and "took ground · 8h ago" disappeared altogether — on your OWN
// runs, the only rows that carry all five.
//
// Layout is not computed by the test renderer, so these assert the rules that
// produce it. Every one of them is a way the bug came back.
describe('feed card header', () => {
  const navigation = { navigate: jest.fn() };
  const flat = (tree, id) =>
    StyleSheet.flatten(tree.root.findByProps({ testID: id }).props.style);

  it('gives the name and the timestamp room, and wraps the buttons instead of squeezing them', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <FeedCard item={runner({ is_you: true, caption: '', media: [] })} navigation={navigation} />
      );
    });

    // Your own run is the case that broke, because it carries the most to do.
    // The row itself is now three slots — the two immediate actions and the
    // menu — and the rest are inside the menu rather than on the line.
    ['Add a reaction', 'Give kudos', 'More actions for this run']
      .forEach((label) => expect(tree.root.findByProps({ accessibilityLabel: label })).toBeTruthy());

    // ...and they are genuinely NOT on the row until it is opened, which is
    // the whole of the fix: an assertion that only checked they exist
    // somewhere would pass just as well with all five back on the line.
    ['Share this run', 'Add caption or photo', 'Comments']
      .forEach((label) => expect(tree.root.findAllByProps({ accessibilityLabel: label })).toHaveLength(0));

    const header = flat(tree, 'feed-card-header');
    const identity = flat(tree, 'feed-card-identity');
    const actions = flat(tree, 'feed-card-actions');

    // The escape hatch: when both sides cannot fit, the header breaks.
    expect(header.flexWrap).toBe('wrap');

    // Enough for the portrait and the longer of the two lines.
    expect(identity.minWidth).toBeGreaterThanOrEqual(150);
    expect(identity.flexGrow).toBe(1);
    // `flex: 1` here would zero the basis, and the wrap is decided on basis —
    // a zero-basis identity always "fits", so the header would never break.
    expect(identity.flexBasis).toBeUndefined();

    // 40pt is the smallest a thumb can hit, so the buttons hold their size and
    // sit against the right edge on whichever line they end up on.
    expect(actions.flexShrink).toBe(0);
    expect(actions.marginLeft).toBe('auto');

    act(() => tree.unmount());
  });

  it('keeps what happened and how long ago on a single line', () => {
    let tree;
    act(() => {
      tree = renderer.create(<FeedCard item={runner({ closed_loop: true })} navigation={navigation} />);
    });
    const stamp = tree.root.findAllByType(Text).filter((node) =>
      [].concat(node.props.children || []).join('').includes('took ground')
    );
    expect(stamp).toHaveLength(1);
    expect(stamp[0].props.numberOfLines).toBe(1);
    act(() => tree.unmount());
  });
});
