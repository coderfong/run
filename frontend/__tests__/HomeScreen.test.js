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

import { NavigationContext } from '@react-navigation/native';

import HomeScreen from '../src/screens/HomeScreen';

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
