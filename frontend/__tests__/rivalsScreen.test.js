/**
 * The Rivals page, after it was given the painted park to stand in.
 *
 * Three things here are load-bearing and none of them are visible to a render
 * test by looking at the picture, so they are pinned by their numbers:
 *
 *   1. The park is the page's GROUND. It is drawn in the loading state too —
 *      a backdrop that only appears once the request lands is a flat grey
 *      rectangle on every visit, which is the whole thing it exists to stop.
 *   2. The two bands are pinned to the window's edges and sized off the
 *      picture's own proportions (RIVALS_PARK). Anything that turns that into
 *      a `cover` crop takes the dogs off the sides of a tall phone.
 *   3. The list's run-out is the bottom band MINUS the chrome already covering
 *      it. That subtraction is why the last card lands on the treeline instead
 *      of a hundred points above it, and it is measured from a layout event,
 *      so it is the one part that can silently go back to being a guess.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockRivals;

jest.mock('../src/api/client', () => {
  const named = {};
  return {
    api: new Proxy(named, {
      get: (target, prop) => target[prop] || (target[prop] = jest.fn(() => Promise.resolve({}))),
    }),
    ApiError: class ApiError extends Error {},
    API_BASE: 'http://test',
    apiImageUri: jest.fn((path) => (path ? `http://test${path}` : null)),
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

jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({ equipped: {}, rankKey: 'wood', refreshRank: jest.fn() }),
}));
jest.mock('../src/utils/runnerAssetPreload', () => ({ preloadRunnerAssets: jest.fn() }));

// The card has its own tests; this is about the page around it.
jest.mock('../src/components/RivalCard', () => {
  const { Text } = require('react-native');
  const Card = ({ rival }) => <Text>{`card:${rival.username}`}</Text>;
  Card.fmtArea = () => '';
  return { __esModule: true, default: Card, fmtArea: (m2) => `${m2}m2` };
});

import { Dimensions, ScrollView, StyleSheet, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import RivalsScreen from '../src/screens/RivalsScreen';
import RivalsBackdrop from '../src/components/rivals/RivalsBackdrop';
import { ToonHeader } from '../src/components/ui';
import { RIVALS_PARK } from '../src/config/onboardingArt';
import { api } from '../src/api/client';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  addListener: jest.fn(() => jest.fn()),
  isFocused: () => true,
  getParent: () => ({ navigate: jest.fn() }),
};

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <RivalsScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

/** Every box in the tree that states a height, as flattened styles. */
function boxes(tree) {
  return tree.root
    .findAll((n) => typeof n.type === 'string' && n.props?.style)
    .map((n) => StyleSheet.flatten(n.props.style))
    .filter(Boolean);
}

const DAY = 24 * 60 * 60 * 1000;
const rival = (username, daysAgo = 0) => ({
  user_id: `u-${username}`,
  username,
  net_m2: 1000,
  you_took_m2: 2000,
  they_took_m2: 1000,
  last_event: {
    kind: 'you_took',
    area_m2: 2000,
    at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    lat: 1,
    lon: 2,
  },
});

/** The usernames of the cards currently drawn, in order. */
function cards(tree) {
  return tree.root
    .findAllByType(Text)
    .map((t) => t.props.children)
    .filter((c) => typeof c === 'string' && c.startsWith('card:'))
    .map((c) => c.slice(5));
}

/** Press the header tab with this label. */
function pressTab(tree, label) {
  const tab = tree.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  )[0];
  act(() => tab.props.onPress());
}

describe('RivalsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRivals = [rival('denise'), rival('felicia')];
    api.rivals = jest.fn(() => Promise.resolve({ rivals: mockRivals }));
  });

  it('stands the page in the park before the rivalries have loaded', async () => {
    // Nothing resolved yet: this is the skeleton state, and it must already
    // have its ground under it.
    let tree;
    act(() => {
      tree = renderer.create(
        <NavigationContext.Provider value={navigation}>
          <RivalsScreen navigation={navigation} />
        </NavigationContext.Provider>
      );
    });
    expect(tree.root.findAllByType(RivalsBackdrop)).toHaveLength(1);
    // Let the request settle inside act, so the loaded state doesn't land
    // after the test has finished.
    await act(async () => {});
  });

  it('keeps the park under the list once the rivalries arrive', async () => {
    const tree = mount();
    await act(async () => {});
    expect(tree.root.findAllByType(RivalsBackdrop)).toHaveLength(1);
    expect(tree.root.findAllByType(ScrollView)).not.toHaveLength(0);
  });

  it('stands its header IN the picture — no fill, no rule under it', async () => {
    const tree = mount();
    await act(async () => {});
    const header = tree.root.findByType(ToonHeader);
    expect(header.props.onArt).toBe(true);
    // The panel colour and the cut-out both belong to the old flat header. If
    // either comes back the treeline is painted over.
    expect(header.props.solid).toBeUndefined();
    expect(header.props.art).toBeUndefined();
  });

  it('keeps the copy on the sky to one short line', async () => {
    const tree = mount();
    await act(async () => {});
    const header = tree.root.findByType(ToonHeader);
    // The running score and the eyebrow were what ran across the left tree.
    expect(header.props.eyebrow).toBeUndefined();
    expect(header.props.subtitle).toBe('Head to head. Take more ground.');
  });

  it('opens on Active, and History holds the rivalries that went quiet', async () => {
    mockRivals = [rival('denise', 1), rival('felicia', 20)];
    const tree = mount();
    await act(async () => {});

    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'Active (1)').length).toBeGreaterThan(0);
    expect(cards(tree)).toEqual(['denise']);

    pressTab(tree, 'History');
    expect(cards(tree)).toEqual(['felicia']);

    pressTab(tree, 'Active (1)');
    expect(cards(tree)).toEqual(['denise']);
  });

  it('draws the cut at two weeks', async () => {
    mockRivals = [rival('inside', 13.9), rival('outside', 14.1)];
    const tree = mount();
    await act(async () => {});
    expect(cards(tree)).toEqual(['inside']);
  });

  it('says so when every rivalry has gone quiet, rather than drawing nothing', async () => {
    mockRivals = [rival('felicia', 30)];
    const tree = mount();
    await act(async () => {});

    expect(cards(tree)).toEqual([]);
    const copy = tree.root.findAllByType(Text).map((t) => t.props.children);
    expect(copy).toContain('All quiet');

    pressTab(tree, 'History');
    expect(cards(tree)).toEqual(['felicia']);
  });

  it('runs the list out to the treeline, less the chrome already covering it', async () => {
    const tree = mount();
    await act(async () => {});

    const { width, height } = Dimensions.get('window');
    const band = Math.round(width * RIVALS_PARK.bottom);
    const scroll = tree.root.findAllByType(ScrollView)[0];

    // Before anything has been measured the run-out is the whole band: better
    // a card floating high for one frame than one sitting in the grass.
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(band);

    // A tab bar 90pt tall already covers 90pt of that band.
    const TAB_BAR = 90;
    act(() => {
      scroll.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 200, width, height: height - 200 - TAB_BAR } },
      });
    });
    const after = tree.root.findAllByType(ScrollView)[0];
    expect(StyleSheet.flatten(after.props.contentContainerStyle).paddingBottom).toBe(
      band - TAB_BAR
    );
  });
});

describe('RivalsBackdrop', () => {
  it('pins a band to each edge at the picture’s own proportions', () => {
    let tree;
    act(() => {
      tree = renderer.create(<RivalsBackdrop />);
    });

    const { width } = Dimensions.get('window');
    const top = Math.round(width * RIVALS_PARK.top);
    const bottom = Math.round(width * RIVALS_PARK.bottom);

    const styles = boxes(tree);
    // The canopy, in the flow at the top of the page.
    expect(styles.some((s) => s.height === top && s.overflow === 'hidden')).toBe(true);
    // The park, pinned to the bottom edge.
    expect(
      styles.some((s) => s.height === bottom && s.position === 'absolute' && s.bottom === 0)
    ).toBe(true);
    // Both windows look at ONE plate, and the lower one reaches its band by
    // sliding the whole thing up past the canopy. A plate drawn at anything
    // other than top+bottom means the field crept back into the asset.
    const plate = styles.filter((s) => s.height === top + bottom);
    expect(plate.length).toBe(2);
    expect(plate.some((s) => s.marginTop === -top)).toBe(true);
  });

  it('hangs the treeline off a header taller than the canopy, in sky not cream', () => {
    const { width } = Dimensions.get('window');
    const top = Math.round(width * RIVALS_PARK.top);
    const TALL = top + 40;

    let tree;
    act(() => {
      tree = renderer.create(<RivalsBackdrop headerHeight={TALL} />);
    });
    const styles = boxes(tree);
    // The spacer is exactly what the canopy was short by, and it is sky: fill
    // it with the field colour instead and the page wears a cream stripe above
    // its own treeline.
    expect(
      styles.some((s) => s.height === 40 && s.backgroundColor === RIVALS_PARK.sky)
    ).toBe(true);
    // The canopy itself is unchanged — pushed, never stretched.
    expect(styles.some((s) => s.height === top && s.overflow === 'hidden')).toBe(true);
  });

  it('leaves a canopy taller than its header exactly where it is', () => {
    let tree;
    act(() => {
      tree = renderer.create(<RivalsBackdrop headerHeight={10} />);
    });
    expect(
      boxes(tree).some((s) => s.backgroundColor === RIVALS_PARK.sky)
    ).toBe(false);
  });

  it('paints the field the picture ends in, so the stretch between the bands is seamless', () => {
    let tree;
    act(() => {
      tree = renderer.create(<RivalsBackdrop />);
    });
    expect(
      boxes(tree).some((s) => s.backgroundColor === RIVALS_PARK.ground)
    ).toBe(true);
  });
});
