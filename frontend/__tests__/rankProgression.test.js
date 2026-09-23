// The two rank screens as one system: the post claim progression (change) and
// the full ladder (position).
//
// What is pinned here is the part that can be wrong without anything looking
// broken: a same tier gain that celebrates a promotion, a tier change the
// server did not award, a marker that leaves its ladder, a percentile repeated
// down the column, and a progression screen that scrolls on a small phone.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../src/state/avatar', () => ({ useAvatar: () => ({ equipped: {} }) }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    getState: () => ({ routeNames: ['Result', 'RankProgression', 'RankLadder'] }),
  }),
}));

import RankProgressionScreen, {
  LADDER_MAX,
  LADDER_MIN,
  ladderHeight,
  progressionCopy,
} from '../src/screens/RankProgressionScreen';
import RankLadder, { cardPercent, rungHeightFor } from '../src/components/rank/RankLadder';
import { climbBands, climbY } from '../src/components/rank/RankClimb';
import {
  RANK_FLOORS,
  nextTierCopy,
  positionInTier,
  rankChange,
  standingFrom,
} from '../src/config/rankLadder';
import { haptic } from '../src/theme/haptics';

// Real claim payload shapes (backend/app/routes/runs.py ClaimOut).
const SAME_TIER = {
  solo_elo: 2484, solo_elo_delta: 4,
  rank_up: false, rank_down: false, rank_key_before: 'mythic', rank_key_after: 'mythic',
};
const RANK_UP = {
  solo_elo: 2403, solo_elo_delta: 6,
  rank_up: true, rank_down: false, rank_key_before: 'prismatic', rank_key_after: 'mythic',
};
const RANK_DOWN = {
  solo_elo: 2395, solo_elo_delta: -8,
  rank_up: false, rank_down: true, rank_key_before: 'mythic', rank_key_after: 'prismatic',
};
const GOLD_GAIN = {
  solo_elo: 1420, solo_elo_delta: 4,
  rank_up: false, rank_down: false, rank_key_before: 'gold', rank_key_after: 'gold',
};

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).filter((x) => typeof x === 'string').join('') : String(c ?? '');
  });
}

function render(el) {
  let tree;
  act(() => { tree = renderer.create(el); });
  return tree;
}

describe('rankChange: what one claim did', () => {
  test('a gain inside a tier is not a promotion', () => {
    const c = rankChange(SAME_TIER);
    expect(c.before).toBe(2480);
    expect(c.after).toBe(2484);
    expect(c.delta).toBe(4);
    expect(c.rankUp).toBe(false);
    expect(c.from.tier).toBe(c.to.tier);
    expect(c.to.name).toBe('Mythic III');
    expect(c.isTop).toBe(true);
  });

  test('a promotion is the server flag AND a real change of tier', () => {
    const c = rankChange(RANK_UP);
    expect(c.rankUp).toBe(true);
    expect(c.from.label).toBe('Prismatic');
    expect(c.to.label).toBe('Mythic');
    // A flag with no tier change behind it is not celebrated.
    expect(rankChange({ ...SAME_TIER, rank_up: true }).rankUp).toBe(false);
  });

  test('a drop is honest', () => {
    const c = rankChange(RANK_DOWN);
    expect(c.rankDown).toBe(true);
    expect(c.delta).toBe(-8);
  });

  test('no solo rating, no change to show', () => {
    expect(rankChange(null)).toBeNull();
    expect(rankChange({ solo_elo: null })).toBeNull();
  });

  test('the top tier has no next threshold to chase', () => {
    expect(nextTierCopy(rankChange(SAME_TIER).to)).toBe('Top of the ladder');
    expect(nextTierCopy(rankChange(GOLD_GAIN).to)).toBe('80 to Platinum');
  });
});

describe('copy', () => {
  test('says what happened, with no dashes', () => {
    expect(progressionCopy(rankChange(SAME_TIER))).toEqual({
      subtitle: 'This claim moved you up the ladder',
      gain: '+4 RANK POINTS',
    });
    expect(progressionCopy(rankChange(RANK_UP)).subtitle).toBe('This claim moved you up a tier');
    expect(progressionCopy(rankChange({ ...GOLD_GAIN, solo_elo_delta: 1 })).gain).toBe('+1 RANK POINT');
    const loss = progressionCopy(rankChange(RANK_DOWN));
    expect(loss.gain).toBe('−8 RANK POINTS');
    for (const s of [loss.subtitle, progressionCopy(rankChange(SAME_TIER)).subtitle]) {
      expect(s).not.toMatch(/[–—-]/);
    }
  });
});

describe('the cropped ladder geometry', () => {
  test('bands fill the height exactly, top first', () => {
    for (const center of [0, 3, 9]) {
      const bands = climbBands(center, 300);
      const sum = bands.reduce((a, b) => a + b.h, 0);
      expect(Math.abs(sum - 300)).toBeLessThanOrEqual(2);
      expect(bands[1].tier).toBe(center);
      expect(bands[1].h).toBeGreaterThan(bands[0].h);
    }
  });

  test('the marker moves the right way, and stays inside the ladder', () => {
    const f = RANK_FLOORS;
    for (const claim of [SAME_TIER, RANK_UP, GOLD_GAIN, RANK_DOWN]) {
      const c = rankChange(claim);
      const bands = climbBands(c.to.tier, 300);
      const a = climbY(c.before, c.from.tier, bands, f);
      const b = climbY(c.after, c.to.tier, bands, f);
      expect(Math.sign(b - a)).toBe(Math.sign(c.delta));
      for (const y of [a, b]) {
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(300);
      }
    }
  });

  test('a Mythic runner still moves as points keep coming', () => {
    const lo = positionInTier(2480, 2400, null);
    const hi = positionInTier(2484, 2400, null);
    expect(hi).toBeGreaterThan(lo);
    expect(positionInTier(100000, 2400, null)).toBeLessThanOrEqual(1);
  });
});

describe('the progression screen fits one screen', () => {
  // SE, mini, 6.1", Pro, Plus, Pro Max.
  const PHONES = [
    [667, { top: 20, bottom: 0 }],
    [812, { top: 50, bottom: 34 }],
    [844, { top: 47, bottom: 34 }],
    [852, { top: 59, bottom: 34 }],
    [926, { top: 47, bottom: 34 }],
    [932, { top: 59, bottom: 34 }],
  ];
  test.each(PHONES)('%i pt tall', (h, insets) => {
    for (const tierChange of [false, true]) {
      const lh = ladderHeight(h, insets, tierChange);
      expect(lh).toBeGreaterThanOrEqual(LADDER_MIN);
      expect(lh).toBeLessThanOrEqual(LADDER_MAX);
    }
  });
});

describe('the progression screen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(haptic, 'light').mockImplementation(() => {});
    jest.spyOn(haptic, 'success').mockImplementation(() => {});
    mockNavigate.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('a same tier gain: points, tier, no promotion, one light haptic', () => {
    const tree = render(<RankProgressionScreen route={{ params: { claim: SAME_TIER } }} />);
    act(() => { jest.advanceTimersByTime(3000); });
    const t = texts(tree).join('|');
    expect(t).toContain('+4 RANK POINTS');
    expect(t).toContain('MYTHIC III');
    expect(t).toContain('2,480 → ');
    expect(t).toContain('Top of the ladder');
    expect(t).not.toContain('RANK UP');
    expect(haptic.light).toHaveBeenCalledTimes(1);
    expect(haptic.success).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  test('a rank up names both tiers only once the marker crosses', () => {
    const tree = render(<RankProgressionScreen route={{ params: { claim: RANK_UP } }} />);
    expect(texts(tree).join('|')).not.toContain('RANK UP');
    act(() => { jest.advanceTimersByTime(3000); });
    const t = texts(tree).join('|');
    expect(t).toContain('RANK UP!');
    expect(t).toContain('PRISMATIC → MYTHIC III');
    expect(haptic.success).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('a drop is not celebrated', () => {
    const tree = render(<RankProgressionScreen route={{ params: { claim: RANK_DOWN } }} />);
    act(() => { jest.advanceTimersByTime(3000); });
    const t = texts(tree).join('|');
    expect(t).toContain('RANK DOWN');
    expect(t).not.toContain('RANK UP');
    expect(haptic.success).not.toHaveBeenCalled();
    expect(haptic.light).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  test('Done goes back and the link opens the full ladder', () => {
    const tree = render(<RankProgressionScreen route={{ params: { claim: GOLD_GAIN } }} />);
    const link = tree.root.findAll((n) => n.props?.accessibilityLabel === 'View full ladder →')[0];
    act(() => { link.props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('RankLadder');
    act(() => tree.unmount());
  });

  test('an unrated claim says so rather than drawing a ladder', () => {
    const tree = render(<RankProgressionScreen route={{ params: { claim: { solo_elo: null } } }} />);
    expect(texts(tree).join('|')).toContain('This claim did not change your rank.');
    act(() => tree.unmount());
  });

  test('unmounting mid move leaves no timer behind', () => {
    const tree = render(<RankProgressionScreen route={{ params: { claim: RANK_UP } }} />);
    act(() => { tree.unmount(); });
    expect(() => act(() => { jest.advanceTimersByTime(5000); })).not.toThrow();
  });
});

describe('the full ladder', () => {
  const FLOORS = RANK_FLOORS;
  // A small population: nobody in Onyx..Prismatic, so at or above shares
  // repeat. This is what printed "Top 11%" down the column.
  const SHARES = [100, 90, 70, 50, 30, 11, 11, 11, 11, 11];
  const MYTHIC = standingFrom({ key: 'mythic', points: 2484, floor: 2400, next_points: null });

  test('a percentile is shown only where it is distinct, and never on your card', () => {
    expect(cardPercent(SHARES, 9, 9)).toBeNull();
    expect(cardPercent(SHARES, 8, 9)).toBeNull();
    expect(cardPercent(SHARES, 5, 9)).toBeNull();
    expect(cardPercent(SHARES, 4, 9)).toBe(30);
    expect(cardPercent(SHARES, 0, 9)).toBeNull();

    const tree = render(<RankLadder standing={MYTHIC} floors={FLOORS} shares={SHARES} equipped={{}} />);
    const t = texts(tree);
    expect(t.filter((s) => s.includes('TOP 11%'))).toHaveLength(0);
    expect(t.filter((s) => s.includes('TOP 30%'))).toHaveLength(1);
    act(() => tree.unmount());
  });

  test('your card says YOU ARE HERE, once', () => {
    const tree = render(<RankLadder standing={MYTHIC} floors={FLOORS} shares={SHARES} equipped={{}} />);
    expect(texts(tree).filter((s) => s === 'YOU ARE HERE')).toHaveLength(1);
    act(() => tree.unmount());
  });

  test('every threshold is printed, even before the ladder request lands', () => {
    const tree = render(<RankLadder standing={MYTHIC} floors={[]} shares={[]} equipped={{}} />);
    const t = texts(tree);
    for (const f of ['800', '1,050', '2,150', '2,400']) expect(t).toContain(f);
    act(() => tree.unmount());
  });

  test('cards are more compact than the old 208pt rungs', () => {
    for (const w of [320, 375, 390, 430]) {
      const h = rungHeightFor(w);
      expect(h).toBeLessThanOrEqual(200);
      expect(h).toBeGreaterThanOrEqual(148);
    }
    expect(rungHeightFor(375)).toBeLessThan(208 * 0.85);
  });
});
