/**
 * Searching a runner by username must render. The Pasers screen swaps its whole
 * body for search results, and those rows carry fields the pasers list never
 * does (`state: 'none'`, a `request_id`, runners outside your social graph with
 * any rank and any avatar) — so a crash here is a crash nobody's own list can
 * reproduce.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockPasers = { pasers: [], incoming: [], outgoing: [] };
let mockResults = [];

jest.mock('../src/api/client', () => {
  const named = {
    pasers: jest.fn(() => Promise.resolve(mockPasers)),
    searchPasers: jest.fn(() => Promise.resolve(mockResults)),
  };
  return {
    api: new Proxy(named, {
      get: (target, prop) =>
        target[prop] || (target[prop] = jest.fn(() => Promise.resolve({}))),
    }),
    ApiError: class ApiError extends Error {},
    API_BASE: 'http://test',
    apiImageUri: jest.fn((p) => (p ? `http://test${p}` : null)),
    apiPhotoSource: jest.fn((p) => (p ? { uri: `http://test${p}` } : null)),
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
  useAuth: () => ({ user: { id: 'u1', username: 'runner' } }),
}));

import { NavigationContext } from '@react-navigation/native';
import PasersScreen from '../src/screens/PasersScreen';

const navigation = {
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  canGoBack: () => true,
  goBack: jest.fn(),
  isFocused: () => true,
  getParent: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
};

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <PasersScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

async function type(tree, text) {
  const field = tree.root.findAll(
    (n) => n.props && n.props.placeholder === 'Find a runner by username'
  )[0];
  await act(async () => { field.props.onChangeText(text); });
}

const hit = (over = {}) => ({
  user_id: 'u2',
  username: 'someone',
  avatar: {},
  clan_tag: null,
  clan_color: null,
  rank_key: 'wood',
  level: 3,
  state: 'none',
  request_id: null,
  ...over,
});

describe('PasersScreen search', () => {
  beforeEach(() => {
    mockPasers = { pasers: [], incoming: [], outgoing: [] };
    mockResults = [];
    jest.clearAllMocks();
  });

  it('renders results for a username search', async () => {
    mockResults = [hit(), hit({ user_id: 'u3', username: 'another', state: 'pending_in', request_id: 'r1' })];
    const tree = mount();
    await act(async () => {});
    await type(tree, 'som');
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('renders a hit whose fields are missing or unknown', async () => {
    mockResults = [
      { user_id: 'bare' },
      hit({ user_id: 'u4', username: null, avatar: null, rank_key: null, level: null }),
      hit({ user_id: 'u5', rank_key: 'unknown-tier', clan_color: { stroke: '#f00' }, clan_tag: 'ABC' }),
    ];
    const tree = mount();
    await act(async () => {});
    await type(tree, 'som');
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('renders the empty state when nothing matches', async () => {
    const tree = mount();
    await act(async () => {});
    await type(tree, 'zzz');
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });

  it('survives the search request failing', async () => {
    const { api } = require('../src/api/client');
    api.searchPasers.mockRejectedValue(new Error('500'));
    const tree = mount();
    await act(async () => {});
    await type(tree, 'som');
    expect(tree).toBeTruthy();
    act(() => tree.unmount());
  });
});
