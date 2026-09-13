/**
 * What a steal costs a feed card, pinned.
 *
 * Measured 2026-09-13 under react-test-renderer, host views counted off
 * `toJSON()` the way the 241 → 86 frame pass was measured, one settled card:
 *
 *                        views  images  rigs  full-size decodes
 *   plain run               58       7     1         0
 *   steal, 4 victims       197      56    13        48   before
 *   steal, 4 victims       135      28     5         0   after
 *
 * Every victim's head used to be THREE complete runners: two stacked on the bar
 * so a sad face could cross-fade, and one more for the blast, mounted at
 * opacity zero whether or not anything was playing. Each of them decoded its
 * layers at full size (512px). How heavy Home was therefore depended on how
 * many multi-victim steals were in the feed, which is data, not code, and is
 * why it could get slower between builds that did not touch it.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../src/api/client', () => {
  const named = {};
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
jest.mock('../src/api/cache', () => ({
  fetchAndCache: jest.fn((_key, fetcher) => fetcher()),
  getCached: jest.fn(() => undefined),
  setCached: jest.fn((_key, value) => value),
  updateCached: jest.fn(),
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
jest.mock('../src/effects/ReactionEffect', () => 'ReactionEffect');

import { NavigationContext } from '@react-navigation/native';
import FeedCard from '../src/components/FeedCard';
import CharacterRig from '../src/components/character/CharacterRig';
import TerritoryStealBanner from '../src/components/TerritoryStealBanner';
import { Image as UIImage } from '../src/ui/image';

const navigation = {
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  isFocused: () => true,
  getParent: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
};

const victim = (id) => ({ user_id: id, username: `v${id}`, area_m2: 4000, avatar: {} });
const steal = (count) => ({
  id: `steal-${count}`,
  user_id: 'u2',
  username: 'someone',
  distance_m: 5000,
  duration_s: 1800,
  area_m2: 120000,
  created_at: new Date().toISOString(),
  avatar: {},
  stolen_m2: 9000,
  victims: Array.from({ length: count }, (_, i) => victim(String(i))),
});

function hostViews(json) {
  let views = 0;
  let images = 0;
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    views += 1;
    if (/image/i.test(String(node.type))) images += 1;
    walk(node.children);
  };
  walk(json);
  return { views, images };
}

function mountCard(item) {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <FeedCard item={item} navigation={navigation} autoPlaySteal={false} screenFocused />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

const rigs = (tree) => tree.root.findAllByType(CharacterRig).length;
const fullSize = (tree) => tree.root.findAllByType(UIImage).filter((node) => node.props.crisp).length;

describe('a steal on a feed card', () => {
  it.each([1, 2, 4])('with %i victim(s) draws one runner per head, plus the card’s own', (count) => {
    const tree = mountCard(steal(count));
    expect(rigs(tree)).toBe(1 + count);
    act(() => tree.unmount());
  });

  it('decodes nothing at full resolution while it sits settled', () => {
    const tree = mountCard(steal(4));
    expect(fullSize(tree)).toBe(0);
    act(() => tree.unmount());
  });

  it('stays inside its view budget with four victims', () => {
    const tree = mountCard(steal(4));
    const { views, images } = hostViews(tree.toJSON());
    expect(views).toBeLessThanOrEqual(140);
    expect(images).toBeLessThanOrEqual(30);
    act(() => tree.unmount());
  });

  it('leaves nothing of the blast behind once a replay has played', () => {
    const tree = mountCard(steal(2));
    const banner = tree.root.findByType(TerritoryStealBanner);
    const replay = banner.findAll((node) =>
      typeof node.props?.onPress === 'function' &&
      String(node.props.accessibilityLabel || '').includes('Tap to replay')
    )[0];
    act(() => replay.props.onPress());
    // The mocked timing finishes at once, so this is the settled state after
    // a play: the bomb, the sheets and the thrown heads are gone again.
    expect(rigs(tree)).toBe(1 + 2);
    act(() => tree.unmount());
  });
});
