/**
 * The Your land page (src/screens/TerritoryScreen.js).
 *
 * Holding and History are two views of ONE response, the same one the card on
 * You reads. What is pinned here is what the runner does with the page: read
 * the plots soonest to fade first, tap one and land on the map framed on it,
 * read what happened to their ground, and get a sentence rather than a blank
 * when there is nothing to show or the request failed.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockLand;

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

jest.mock('../src/hooks/useAccent', () => ({ useAccent: () => '#3b82f6' }));

import { Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import TerritoryScreen from '../src/screens/TerritoryScreen';
import PlotRow from '../src/components/territory/PlotRow';
import BeatRow from '../src/components/territory/BeatRow';
import { EmptyState, ToonHeader } from '../src/components/ui';
import { api } from '../src/api/client';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  addListener: jest.fn(() => jest.fn()),
  isFocused: () => true,
  getParent: () => ({ navigate: jest.fn() }),
};

const H = 60 * 60 * 1000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();
const BBOX = [103.8, 1.3, 103.801, 1.301];

const plot = (id, leftH, extra = {}) => ({
  id,
  area_m2: 12000,
  claimed_at: iso(-24 * H),
  expires_at: iso(leftH * H),
  fading: leftH <= 36,
  life_left: 0.5,
  strength: 1,
  reinforcements: 0,
  club: false,
  held: 0,
  last_held_at: null,
  run_id: null,
  run_distance_m: null,
  lat: 1.3005,
  lon: 103.8005,
  bbox: BBOX,
  rings: [[[103.8, 1.3], [103.801, 1.3], [103.801, 1.301], [103.8, 1.301], [103.8, 1.3]]],
  ...extra,
});

const land = (over = {}) => ({
  summary: {
    plots: 2,
    area_m2: 24000,
    fading_plots: 1,
    fading_m2: 12000,
    next_expiry_at: iso(10.5 * H),
    lost_times: 1,
    lost_m2: 900,
    held_times: 2,
    faded_times: 1,
    faded_m2: 1600,
  },
  plots: [plot('p1', 10.5), plot('p2', 120.5, { held: 2, reinforcements: 1 })],
  history: [
    { kind: 'held', area_m2: 400, at: iso(-5 * H), lat: 1.3, lon: 103.8,
      rival_id: 'r1', rival_username: 'denise', rival_avatar: null, rival_rank_key: 'wood' },
    { kind: 'faded', area_m2: 1600, at: iso(-24 * H), lat: 1.31, lon: 103.81,
      rival_id: null, rival_username: null, rival_avatar: null, rival_rank_key: null },
    { kind: 'lost', area_m2: 900, at: iso(-48 * H), lat: null, lon: null,
      rival_id: 'r1', rival_username: 'denise', rival_avatar: null, rival_rank_key: 'wood' },
  ],
  fading_hours: 36,
  window_days: 7,
  history_days: 14,
  ...over,
});

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <TerritoryScreen navigation={navigation} />
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

/** Press the control with this accessibility label. */
function press(tree, label) {
  const node = tree.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  )[0];
  act(() => node.props.onPress());
}

describe('TerritoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLand = land();
    api.myTerritory = jest.fn(() => Promise.resolve(mockLand));
  });

  it('stands under the panel header with one short fixed line', async () => {
    const tree = mount();
    await act(async () => {});
    const header = tree.root.findByType(ToonHeader);
    expect(header.props.panel).toBe(true);
    expect(header.props.title).toBe('Your land');
    expect(header.props.subtitle).toBe('Run it again before it fades.');
  });

  it('opens on what you hold, soonest to fade first', async () => {
    const tree = mount();
    await act(async () => {});
    expect(tree.root.findAllByType(PlotRow).map((r) => r.props.plot.id)).toEqual(['p1', 'p2']);
    const t = texts(tree).join('|');
    expect(t).toContain('Fades in 10h');
    expect(t).toContain('5d left');
    expect(t).toContain('Held 2 attacks · Reinforced 1×');
    // The summary strip over the list.
    expect(t).toContain('Fading soon');
    expect(t).toContain('Held this week');
  });

  it('counts the holding in its tab only once the answer is in', async () => {
    const tree = mount();
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'Holding').length).toBeGreaterThan(0);
    await act(async () => {});
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'Holding (2)').length).toBeGreaterThan(0);
  });

  it('frames the map on the whole plot when a plot is tapped', async () => {
    const tree = mount();
    await act(async () => {});
    const first = tree.root.findAllByType(PlotRow)[0];
    act(() => first.props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('Map', {
      screen: 'MapMain',
      params: {
        focus: {
          lat: 1.3005,
          lon: 103.8005,
          ring: [[103.8, 1.3], [103.801, 1.3], [103.801, 1.301], [103.8, 1.301]],
        },
      },
    });
  });

  it('keeps a fortnight of what happened, newest first, under History', async () => {
    const tree = mount();
    await act(async () => {});
    press(tree, 'History');
    const beats = tree.root.findAllByType(BeatRow);
    expect(beats.map((b) => b.props.beat.kind)).toEqual(['held', 'faded', 'lost']);
    const t = texts(tree).join('|');
    expect(t).toContain('Held against denise');
    expect(t).toContain('Lost to denise');
    expect(t).toContain('Last 14 days');
    // A beat with no place to show is not a dead button.
    expect(beats[2].props.onPress).toBeUndefined();
    act(() => beats[0].props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('Map', {
      screen: 'MapMain',
      params: { focus: { lat: 1.3, lon: 103.8 } },
    });
  });

  it('says so when there is no land, and offers the run that fixes it', async () => {
    mockLand = land({ plots: [], summary: { plots: 0, area_m2: 0 } });
    const tree = mount();
    await act(async () => {});
    expect(texts(tree)).toContain('No land right now');
    act(() => tree.root.findByType(EmptyState).props.onAction());
    expect(navigation.navigate).toHaveBeenCalledWith('Record');
  });

  it('says so when nothing has happened yet', async () => {
    mockLand = land({ history: [] });
    const tree = mount();
    await act(async () => {});
    press(tree, 'History');
    expect(texts(tree)).toContain('Nothing yet');
  });

  it('turns a failed request into a sentence, not a blank page', async () => {
    api.myTerritory = jest.fn(() => Promise.reject(new Error('Request failed (404)')));
    const tree = mount();
    await act(async () => {});
    expect(texts(tree)).toContain('Could not load your land');
  });
});
