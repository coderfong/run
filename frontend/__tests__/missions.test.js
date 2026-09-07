// The missions screen, driven through a claim.
//
// The interesting part is not the list, it is what happens when you tap a
// finished mission: the card has to settle, the coins have to leave it, and
// the day banner has to advance — all off the claim RESPONSE rather than a
// second round trip, so it happens on the frame you tapped.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import MissionsScreen from '../src/screens/MissionsScreen';
import MissionCard from '../src/components/missions/MissionCard';
import DayStrip from '../src/components/missions/DayStrip';
import { api } from '../src/api/client';
import { invalidate } from '../src/api/cache';

jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({ equipped: {}, isUnlocked: () => false, refreshUnlocks: jest.fn() }),
}));

const mission = (over = {}) => ({
  id: 'distance_5k',
  text: 'Run 5 km',
  metric: 'distance',
  goal: 5000,
  value: 5000,
  progress: 1,
  complete: true,
  claimed: false,
  reward: 300,
  ...over,
});

const DAY = {
  today: '2026-09-07',
  day: '2026-09-07',
  total: 4,
  complete_count: 1,
  all_complete: false,
  bonus_claimed: false,
  bonus_rarity: 'rare',
  missions: [
    mission(),
    mission({ id: 'run_once', text: 'Finish a run', metric: 'runs', goal: 1, value: 0,
              progress: 0, complete: false }),
    mission({ id: 'steal_once', text: 'Take ground from a rival', metric: 'steals', goal: 1,
              value: 0, progress: 0, complete: false }),
    mission({ id: 'rank_60', text: 'Earn 60 rank points', metric: 'rank_points', goal: 60,
              value: 12, progress: 0.2, complete: false }),
  ],
  week: [
    { day: '2026-09-07', locked: false, complete_count: 1, total: 4, all_complete: false, bonus_claimed: false },
    { day: '2026-09-08', locked: true, complete_count: 0, total: 4, all_complete: false, bonus_claimed: false },
  ],
};

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).join('') : String(c ?? '');
  }).join('|');
}

function pressable(tree, match) {
  return tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function'
      && typeof n.props?.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.includes(match)
  )[0];
}

beforeEach(() => {
  invalidate('me:');
  jest.restoreAllMocks();
});

describe('a mission card', () => {
  test('writes the goal in the metric\'s own unit', () => {
    // "1847/5000" would be technically right and unreadable.
    const t = (m) => {
      let tree;
      act(() => { tree = renderer.create(<MissionCard mission={m} onClaim={() => {}} />); });
      return texts(tree);
    };
    expect(t(mission({ value: 1800, goal: 5000, metric: 'distance', complete: false })))
      .toContain('1.8 / 5 km');
    expect(t(mission({ value: 540, goal: 1800, metric: 'duration', complete: false })))
      .toContain('9 / 30 min');
    expect(t(mission({ value: 3, goal: 24, metric: 'runs', complete: false })))
      .toContain('3 / 24');
  });

  test('only a finished, uncollected mission can be pressed', () => {
    const onClaim = jest.fn();
    const render1 = (m) => {
      let tree;
      act(() => { tree = renderer.create(<MissionCard mission={m} onClaim={onClaim} />); });
      return tree;
    };
    expect(texts(render1(mission()))).toContain('Claim');
    expect(texts(render1(mission({ complete: false })))).not.toContain('Claim');
    expect(texts(render1(mission({ claimed: true })))).not.toContain('Claim');
  });
});

describe('the week strip', () => {
  test('a future day is locked and carries no press handler at all', () => {
    // Not "pressable but ignored" — a locked day is handed no onPress, so it
    // cannot be tapped and reports itself disabled to a screen reader.
    const onSelect = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <DayStrip week={DAY.week} selected="2026-09-07" onSelect={onSelect} />
      );
    });
    const locked = tree.root.findAll(
      (n) => n.props?.accessibilityLabel?.includes?.('not started yet')
    )[0];
    expect(locked).toBeTruthy();
    expect(locked.props.onPress).toBeUndefined();
    expect(locked.props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('today is selectable and reports its progress', () => {
    const onSelect = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <DayStrip week={DAY.week} selected="2026-09-07" onSelect={onSelect} />
      );
    });
    const today = pressable(tree, '1 of 4 missions done');
    expect(today).toBeTruthy();
    act(() => { today.props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith('2026-09-07');
  });
});

describe('the screen', () => {
  test('collecting a mission settles it off the response, without a refetch', async () => {
    jest.spyOn(api, 'missions').mockResolvedValue(DAY);
    const claimed = {
      ...DAY,
      complete_count: 1,
      missions: DAY.missions.map((m, i) => (i === 0 ? { ...m, claimed: true } : m)),
    };
    const claim = jest.spyOn(api, 'claimMission').mockResolvedValue({
      ok: true, mission_id: 'distance_5k', reward: 300, ...claimed,
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<MissionsScreen navigation={{ canGoBack: () => false }} />);
    });
    expect(texts(tree)).toContain('Run 5 km');
    expect(texts(tree)).toContain('Claim');

    const card = pressable(tree, 'Collect 300 coins');
    await act(async () => { await card.props.onPress(); });

    expect(claim).toHaveBeenCalledWith('distance_5k', null);
    // Settled from the response: the Claim tab is gone with no second fetch.
    expect(api.missions).toHaveBeenCalledTimes(1);
    expect(texts(tree)).not.toContain('Claim');
  });

  test('the day bonus grants a box and drops straight into the gamble', async () => {
    const done = {
      ...DAY,
      complete_count: 4,
      all_complete: true,
      missions: DAY.missions.map((m) => ({ ...m, complete: true, progress: 1, claimed: true })),
    };
    jest.spyOn(api, 'missions').mockResolvedValue(done);
    const bonus = jest.spyOn(api, 'claimMissionBonus').mockResolvedValue({ ok: true, rarity: 'rare' });
    const open = jest.spyOn(api, 'openLootbox').mockResolvedValue({
      rarity: 'rare', final_rarity: 'epic', chances: 3,
      steps: [{ upgraded: false, rarity: 'rare' }, { upgraded: true, rarity: 'epic' },
              { upgraded: false, rarity: 'epic' }],
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<MissionsScreen navigation={{ canGoBack: () => false }} />);
    });

    const banner = pressable(tree, 'Collect your box');
    await act(async () => { await banner.props.onPress(); });

    expect(bonus).toHaveBeenCalled();
    // The box is the reward, so it opens rather than being announced.
    expect(open).toHaveBeenCalled();
    expect(texts(tree)).toContain('RARE');
    expect(texts(tree)).toContain('Tap! Tap!');
  });

  test('a stale claim re-reads instead of showing an error', async () => {
    // Another device collected it, or the run that finished the mission was
    // still in flight. Both are 409/403 and both are fixed by re-reading.
    jest.spyOn(api, 'missions').mockResolvedValue(DAY);
    const err = Object.assign(new Error('already collected'), { status: 409 });
    jest.spyOn(api, 'claimMission').mockRejectedValue(err);

    let tree;
    await act(async () => {
      tree = renderer.create(<MissionsScreen navigation={{ canGoBack: () => false }} />);
    });
    const card = pressable(tree, 'Collect 300 coins');
    await act(async () => { await card.props.onPress(); });

    // Re-read: the first load plus the recovery read.
    expect(api.missions.mock.calls.length).toBeGreaterThan(1);
  });
});
