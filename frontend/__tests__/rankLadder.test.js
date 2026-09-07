// The ladder model — tiers, divisions, and the two payload shapes it has to
// read. Replaces eloProgress.test.js, which tested the copy on a card that no
// longer exists.

import {
  DIVISIONS,
  RANK_TIERS,
  divisionFloor,
  ladderRungs,
  numeral,
  standingFrom,
  tierAt,
  tierByKey,
} from '../src/config/rankLadder';

const FLOORS = [800, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2150, 2400];

describe('the ladder itself', () => {
  test('carries the ten tier keys the rest of the app already uses', () => {
    // Portrait borders, map filters and both backend ladders are keyed on
    // these. A rename here silently unstyles every badge in the app.
    expect(RANK_TIERS.map((t) => t.key)).toEqual([
      'wood', 'bronze', 'silver', 'gold', 'platinum',
      'diamond', 'onyx', 'ember', 'prismatic', 'mythic',
    ]);
  });

  test('every tier has a usable colour, glow and ink', () => {
    for (const tier of RANK_TIERS) {
      for (const key of ['color', 'glow', 'ink']) {
        expect(tier[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  test('an unknown key falls back to the bottom rather than exploding', () => {
    expect(tierByKey('platinum-plus').key).toBe('wood');
    expect(tierByKey(undefined).key).toBe('wood');
  });

  test('tier indexes are clamped at both ends', () => {
    expect(tierAt(-4).key).toBe('wood');
    expect(tierAt(99).key).toBe('mythic');
  });
});

describe('standing, from a payload carrying a tier floor', () => {
  test('splits the tier band into divisions that run upward', () => {
    const low = standingFrom({ key: 'gold', points: 1360, floor: 1350, next_points: 1500 });
    const mid = standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 });
    const high = standingFrom({ key: 'gold', points: 1490, floor: 1350, next_points: 1500 });
    expect([low.division, mid.division, high.division]).toEqual([1, 2, 3]);
    expect([low.name, mid.name, high.name]).toEqual(['Gold I', 'Gold II', 'Gold III']);
  });

  test('states the exact gap to the next tier', () => {
    const s = standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 });
    expect(s.toNext).toBe(80);
    expect(s.isTop).toBe(false);
  });

  test('the division bar fills within the division, not the whole tier', () => {
    // Halfway through Gold is the START of division two, not half a bar.
    const s = standingFrom({ key: 'gold', points: 1425, floor: 1350, next_points: 1500 });
    expect(s.progress).toBeCloseTo(0.5, 5);
    expect(s.division).toBe(2);
    expect(s.divisionProgress).toBeCloseTo(0.5, 5);
  });

  test('the top tier reads as finished rather than as 4% of nothing', () => {
    const s = standingFrom({ key: 'mythic', points: 2600, floor: 2400, next_points: null });
    expect(s.isTop).toBe(true);
    expect(s.progress).toBe(1);
    expect(s.division).toBe(DIVISIONS);
    expect(s.toNext).toBeNull();
    expect(s.name).toBe('Mythic III');
  });

  test('a floor above the points cannot drive progress negative', () => {
    const s = standingFrom({ key: 'gold', points: 1300, floor: 1350, next_points: 1500 });
    expect(s.progress).toBe(0);
    expect(s.division).toBe(1);
  });
});

describe('standing, from a payload carrying progress but no floor', () => {
  // /me/stats sends `rank_progress` already worked out and no floor at all.
  // Treating a missing floor as equal to the points would put every profile in
  // the app on division one, nought percent.
  test('falls back to the supplied progress', () => {
    const s = standingFrom({
      rank_key: 'platinum',
      rank_points: 1560,
      rank_next_points: 1650,
      rank_progress: 0.72,
    });
    expect(s.key).toBe('platinum');
    expect(s.progress).toBeCloseTo(0.72, 5);
    expect(s.division).toBe(3);
    expect(s.name).toBe('Platinum III');
  });

  test('an empty payload is a valid bottom of the ladder, not a crash', () => {
    const s = standingFrom(undefined);
    expect(s.key).toBe('wood');
    expect(s.name).toBe('Wood I');
    expect(s.points).toBe(0);
  });

  test('a missing threshold is not the top of the ladder', () => {
    // The bug this exists to stop: reading a null `next` as "nothing above me"
    // put every brand new account on "Wood III, top of the ladder".
    for (const key of ['wood', 'gold', 'prismatic']) {
      const s = standingFrom({ key, points: 0 });
      expect(s.isTop).toBe(false);
      expect(s.division).toBe(1);
      expect(s.progress).toBe(0);
    }
    // Only the actual ceiling is the ceiling.
    expect(standingFrom({ key: 'mythic', points: 9999 }).isTop).toBe(true);
  });
});

describe('the rungs the ladder screen draws', () => {
  test('one per tier, bottom first, each with three divisions', () => {
    const rungs = ladderRungs({ floors: FLOORS, shares: [100, 88, 71, 54, 33, 18, 9, 4, 2, 1] });
    expect(rungs).toHaveLength(RANK_TIERS.length);
    expect(rungs[0].key).toBe('wood');
    expect(rungs.at(-1).key).toBe('mythic');
    expect(rungs[3].divisions.map((d) => d.name))
      .toEqual(['Gold I', 'Gold II', 'Gold III']);
  });

  test('division floors climb through the tier band', () => {
    const gold = ladderRungs({ floors: FLOORS }).find((r) => r.key === 'gold');
    const floors = gold.divisions.map((d) => d.floor);
    expect(floors).toEqual([1350, 1400, 1450]);
    expect(floors).toEqual([...floors].sort((a, b) => a - b));
  });

  test('percentiles are omitted, never invented, when the count has not landed', () => {
    // The line under a plaque is a measurement. With no data it must be absent
    // rather than a plausible looking guess.
    const rungs = ladderRungs({ floors: FLOORS });
    expect(rungs.every((r) => r.topPercent == null)).toBe(true);
  });

  test('draws with no data at all', () => {
    const rungs = ladderRungs();
    expect(rungs).toHaveLength(RANK_TIERS.length);
    expect(rungs[0].floor).toBeNull();
  });

  test('the top tier has no band above it to divide', () => {
    expect(divisionFloor(FLOORS, 9, 2)).toBe(2400);
  });
});

describe('numerals', () => {
  test('run I, II, III and clamp outside that', () => {
    expect([1, 2, 3].map(numeral)).toEqual(['I', 'II', 'III']);
    expect(numeral(0)).toBe('I');
    expect(numeral(9)).toBe('III');
  });
});
