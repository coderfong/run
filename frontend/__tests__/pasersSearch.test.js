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

// The search box is secondary now: it does not exist on the page until asked
// for (+Add -> Search by username), so a test that wants to type into it has
// to open it exactly the way a runner would first.
async function openSearch(tree) {
  const add = tree.root.find(
    (n) => n.props?.accessibilityLabel === 'Add' && typeof n.props.onPress === 'function'
  );
  await act(async () => { add.props.onPress(); });
  const searchRow = tree.root.find(
    (n) => n.props?.accessibilityLabel === 'Search by username' && typeof n.props.onPress === 'function'
  );
  await act(async () => { searchRow.props.onPress(); });
}

async function type(tree, text) {
  await openSearch(tree);
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

/**
 * The page is a SHOWCASE: your pasers whole, head to shoes, so what they wear
 * can be seen. Adding is one button in the header and one line at the foot,
 * and an empty page says what to do in two buttons.
 */
describe('PasersScreen showcase', () => {
  const { Text } = require('react-native');
  const RunnerFigure = require('../src/components/identity/RunnerFigure').default;
  const Sheet = require('../src/components/ui/Sheet').default;
  const words = (tree) =>
    tree.root.findAllByType(Text).map((n) => [].concat(n.props.children ?? []).join(''));
  const figures = (tree) => {
    const direct = tree.root.findAllByType(RunnerFigure);
    return direct.length || !RunnerFigure.type ? direct : tree.root.findAllByType(RunnerFigure.type);
  };

  beforeEach(() => {
    mockResults = [];
    jest.clearAllMocks();
  });

  it('shows every paser as a full-body runner with their name and rank', async () => {
    mockPasers = {
      pasers: [
        hit({ user_id: 'p1', username: 'jonfong78', rank_key: 'mythic', state: 'paser' }),
        hit({ user_id: 'p2', username: 'runner123', rank_key: 'ember', state: 'paser' }),
      ],
      incoming: [],
      outgoing: [],
    };
    const tree = mount();
    await act(async () => {});
    const all = words(tree);
    // Both fit on the scene itself (well under SHOWCASE_MAX), so neither
    // spills into the plain grid below it — no "Your Pasers" heading, because
    // there is nothing left over for it to introduce.
    expect(all).not.toContain('Your Pasers');
    expect(all).toContain('jonfong78');
    expect(all).toContain('runner123');
    expect(figures(tree).length).toBe(2);
    // Rank reads as the crest beside the name, not a text label, so it is
    // asserted through accessibility rather than visible caption text.
    const card = tree.root.find((n) => typeof n.props?.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('jonfong78') && typeof n.props.onPress === 'function');
    expect(card.props.accessibilityLabel).toContain('Mythic');
    act(() => card.props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('RunnerProfile', { userId: 'p1', username: 'jonfong78' });
    act(() => tree.unmount());
  });

  it('tells a runner with no pasers what to do', async () => {
    mockPasers = { pasers: [], incoming: [], outgoing: [] };
    const tree = mount();
    await act(async () => {});
    const all = words(tree);
    expect(all).toContain('No Pasers yet');
    expect(all).toContain('Find a Paser');
    expect(all).toContain('Share my code');
    act(() => tree.unmount());
  });

  it('opens the add sheet from the header', async () => {
    mockPasers = { pasers: [hit({ user_id: 'p1', state: 'paser' })], incoming: [], outgoing: [] };
    const tree = mount();
    await act(async () => {});
    expect(tree.root.findByType(Sheet).props.visible).toBe(false);
    const add = tree.root.find((n) => n.props?.accessibilityLabel === 'Add' && typeof n.props.onPress === 'function');
    act(() => add.props.onPress());
    expect(tree.root.findByType(Sheet).props.visible).toBe(true);
    act(() => tree.unmount());
  });
});
