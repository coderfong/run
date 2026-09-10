// Rank down: the demotion screen, and the check that decides when it plays.
//
// A promotion is celebrated on the claim that earned it. A drop mostly lands
// with the app closed, so it is told on the way back in by comparing the tier
// last shown on this device with the tier the server reports now. These press
// that comparison from every side, because the two failures are both bad: a
// demotion nobody is told about, and one that is told twice (or on a fresh
// install, for a drop that happened weeks ago).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import RankDownCeremony from '../src/components/rank/RankDownCeremony';
import RankDropWatcher from '../src/components/rank/RankDropWatcher';
import { api } from '../src/api/client';
import { standingFrom } from '../src/config/rankLadder';
import {
  onRankCheck,
  rankChange,
  readSeenRank,
  requestRankCheck,
  writeSeenRank,
} from '../src/rank/rankSeen';

jest.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../src/state/avatar', () => ({ useAvatar: () => ({ equipped: {} }) }));

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).join('') : String(c ?? '');
  }).join('|');
}

/** The pressable page carrying this label, if the demotion is on screen. */
function page(tree, label) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress !== 'undefined'
  )[0];
}

const dropped = (tree) => tree.root.findAll(
  (n) => typeof n.type === 'string' && String(n.props?.accessibilityLabel || '').startsWith('Dropped to')
);

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());
beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('what a change in tier calls for', () => {
  test('a first sighting is recorded, never shown', () => {
    expect(rankChange(null, 'silver')).toBe('init');
  });
  test('a lower tier is a drop', () => {
    expect(rankChange('gold', 'silver')).toBe('down');
    expect(rankChange('mythic', 'wood')).toBe('down');
  });
  test('a higher tier is recorded quietly', () => {
    expect(rankChange('silver', 'gold')).toBe('up');
  });
  test('the same tier, or no reading at all, is nothing', () => {
    expect(rankChange('gold', 'gold')).toBe('same');
    expect(rankChange('gold', null)).toBe('same');
  });
});

describe('the seen record', () => {
  test('is kept per account', async () => {
    await writeSeenRank('u1', 'gold');
    await writeSeenRank('u2', 'wood');
    expect(await readSeenRank('u1')).toBe('gold');
    expect(await readSeenRank('u2')).toBe('wood');
    expect(await readSeenRank(null)).toBeNull();
  });

  test('a check can be requested, and a listener can leave', () => {
    const fn = jest.fn();
    const off = onRankCheck(fn);
    requestRankCheck();
    off();
    requestRankCheck();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('the demotion screen', () => {
  const from = standingFrom({ key: 'gold', progress: 0 });
  const to = standingFrom({ key: 'silver', progress: 0.9 });
  const render = (el) => {
    let tree;
    act(() => { tree = renderer.create(el); });
    return tree;
  };

  test('lands on the lower tier and says how to climb back', () => {
    const tree = render(<RankDownCeremony visible from={from} to={to} equipped={{}} onDone={() => {}} />);
    expect(texts(tree)).not.toContain('Tap to continue');

    act(() => { jest.advanceTimersByTime(2500); });
    const t = texts(tree);
    expect(t).toContain('SILVER III');
    expect(t).toContain('Take land back to climb.');
    expect(t).toContain('Tap to continue');
    act(() => tree.unmount());
  });

  test('holds until tapped rather than dismissing itself', () => {
    const onDone = jest.fn();
    const tree = render(<RankDownCeremony visible from={from} to={to} equipped={{}} onDone={onDone} />);
    act(() => { jest.advanceTimersByTime(30000); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  test('renders nothing with no destination', () => {
    const tree = render(<RankDownCeremony visible from={from} to={null} onDone={() => {}} />);
    expect(tree.toJSON()).toBeNull();
  });

  test('unmounting mid drop does not leave a timer to land on nothing', () => {
    const tree = render(<RankDownCeremony visible from={from} to={to} equipped={{}} onDone={() => {}} />);
    act(() => { tree.unmount(); });
    expect(() => act(() => { jest.advanceTimersByTime(30000); })).not.toThrow();
  });
});

describe('the return-to-app check', () => {
  const onYouPage = { isReady: () => true, getCurrentRoute: () => ({ name: 'YouMain' }) };

  async function mount(navigationRef = onYouPage) {
    let tree;
    await act(async () => {
      tree = renderer.create(<RankDropWatcher ready navigationRef={navigationRef} />);
    });
    return tree;
  }

  test('a first sighting is recorded and nothing plays', async () => {
    jest.spyOn(api, 'meStats').mockResolvedValue({ rank_key: 'gold' });
    const tree = await mount();
    expect(dropped(tree)).toHaveLength(0);
    expect(await readSeenRank('u1')).toBe('gold');
    act(() => tree.unmount());
  });

  test('a tier lost while away plays the demotion', async () => {
    await writeSeenRank('u1', 'gold');
    jest.spyOn(api, 'meStats').mockResolvedValue({ rank_key: 'silver' });
    const tree = await mount();
    expect(dropped(tree).length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  test('a promotion is recorded quietly', async () => {
    await writeSeenRank('u1', 'silver');
    jest.spyOn(api, 'meStats').mockResolvedValue({ rank_key: 'gold' });
    const tree = await mount();
    expect(dropped(tree)).toHaveLength(0);
    expect(await readSeenRank('u1')).toBe('gold');
    act(() => tree.unmount());
  });

  test('never over a live run', async () => {
    await writeSeenRank('u1', 'gold');
    const stats = jest.spyOn(api, 'meStats').mockResolvedValue({ rank_key: 'silver' });
    const tree = await mount({ isReady: () => true, getCurrentRoute: () => ({ name: 'Record' }) });
    expect(stats).not.toHaveBeenCalled();
    expect(dropped(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  test('dismissing records the new tier, so it is told once', async () => {
    await writeSeenRank('u1', 'gold');
    jest.spyOn(api, 'meStats').mockResolvedValue({ rank_key: 'silver' });
    const tree = await mount();
    act(() => { jest.advanceTimersByTime(2500); });
    const target = page(tree, 'Dropped to Silver I. Tap to continue.');
    expect(target).toBeTruthy();
    await act(async () => { target.props.onPress(); });
    expect(await readSeenRank('u1')).toBe('silver');
    expect(dropped(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });
});
