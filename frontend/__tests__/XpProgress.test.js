/**
 * The ladder maths behind the post-run XP bar.
 *
 * The bar is the one place in the app where a number has to be shown MOVING
 * between two states, and the interesting case is the one nobody sees in
 * development: a gain that carries the runner past a level boundary, which has
 * to fill the track, empty it and keep going rather than jump to a percentage.
 * The animation itself is Reanimated's problem; the split into passes is ours,
 * and it is pure arithmetic, so it is tested here.
 */

import { xpSteps } from '../src/components/XpProgress';
import { RevealRays } from '../src/components/RewardReveal';
import { MAX_LEVEL, levelFromXp, xpForLevel } from '../src/config/progression';

describe('xpSteps', () => {
  it('exports the shared ray fan used by the full-screen level-up celebration', () => {
    expect(typeof RevealRays).toBe('function');
  });

  it('is a single pass when the gain stays inside one level', () => {
    // Level 1 spans 100..399.
    const steps = xpSteps(150, 173);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ level: 1, fromXp: 50, toXp: 73, span: 300 });
    expect(steps[0].from).toBeCloseTo(50 / 300);
    expect(steps[0].to).toBeCloseTo(73 / 300);
  });

  it('fills, empties and carries on when the run levels up', () => {
    // 380 -> 420 crosses the level 2 boundary at 400.
    const steps = xpSteps(380, 420);
    expect(steps.map((s) => s.level)).toEqual([1, 2]);
    // The first pass must reach the END of its track, or the level-up reads as
    // a jump from three-quarters full.
    expect(steps[0].to).toBe(1);
    expect(steps[1].from).toBe(0);
    expect(steps[1]).toMatchObject({ fromXp: 0, toXp: 20, span: 500 });
  });

  it('crosses several levels in order', () => {
    const steps = xpSteps(0, xpForLevel(3) + 10);
    expect(steps.map((s) => s.level)).toEqual([0, 1, 2, 3]);
    expect(steps.slice(0, 3).every((s) => s.to === 1)).toBe(true);
    expect(steps[3].toXp).toBe(10);
  });

  it('lands exactly on a boundary as a completed level, not a stalled one', () => {
    const steps = xpSteps(xpForLevel(2) - 40, xpForLevel(3));
    expect(steps[steps.length - 1].level).toBe(3);
    expect(levelFromXp(xpForLevel(3))).toBe(3);
  });

  it('fills the track at the top of the ladder rather than tracking a level 51', () => {
    const steps = xpSteps(xpForLevel(MAX_LEVEL) - 100, xpForLevel(MAX_LEVEL) + 5000);
    const last = steps[steps.length - 1];
    expect(last.level).toBe(MAX_LEVEL);
    expect(last.to).toBe(1);
  });

  it('never runs backwards, whatever it is handed', () => {
    const steps = xpSteps(900, 400);
    expect(steps).toHaveLength(1);
    expect(steps[0].to).toBeGreaterThanOrEqual(steps[0].from);
  });
});
