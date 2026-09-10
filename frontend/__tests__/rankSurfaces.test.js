// The three rank surfaces, rendered.
//
// The ladder and the ceremony are the two screens that replaced the Elo card,
// and both are mostly SVG and animation — the kind of component where a wrong
// prop shows up as a blank screen rather than as a thrown error. These mount
// them against real payload shapes and assert on the text, which is the part a
// player actually reads.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import RankLadder from '../src/components/rank/RankLadder';
import RankUpCeremony from '../src/components/rank/RankUpCeremony';
import RankCard, { rankProgressCopy } from '../src/components/rank/RankCard';
import { standingFrom } from '../src/config/rankLadder';

const FLOORS = [800, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2150, 2400];
const SHARES = [100, 88, 71, 54, 33, 18, 9, 4, 2, 1];

// A gold runner, part way into the tier — the ordinary case.
const GOLD = standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 });

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return (Array.isArray(c) ? c.flat(3).join('') : String(c ?? ''));
  });
}

function render(el) {
  let tree;
  act(() => { tree = renderer.create(el); });
  return tree;
}

describe('the ladder', () => {
  test('draws every tier, with the measured percentile on each', () => {
    const tree = render(
      <RankLadder standing={GOLD} floors={FLOORS} shares={SHARES} equipped={{}} />
    );
    const t = texts(tree).join('|');
    // All ten rungs.
    for (const label of ['Wood', 'Bronze', 'Silver', 'Gold', 'Platinum',
      'Diamond', 'Onyx', 'Ember', 'Prismatic', 'Mythic']) {
      expect(t).toContain(label.toUpperCase());
    }
    // The current rung names its division, the others name the tier.
    expect(t).toContain('GOLD II');
    expect(t).toContain('OF RUNNERS');
    // Your own points, on the rail.
    expect(t).toContain('1,420');
  });

  test('omits the percentile line entirely when the count has not landed', () => {
    // Never a placeholder number: the line is a measurement or it is absent.
    const tree = render(<RankLadder standing={GOLD} floors={[]} shares={[]} equipped={{}} />);
    expect(texts(tree).join('|')).not.toContain('OF RUNNERS');
  });

  test('keeps your own total inside its rung at the top of the ladder', () => {
    // Positioned as a percentage of the rung, the chip sat at bottom: '100%'
    // for a Mythic runner — whose progress is 1 by definition — which put it
    // entirely above the ladder, behind the page header. The one number that
    // runner opened the screen to read was the one number not on it.
    const top = standingFrom({ key: 'mythic', points: 3000, floor: 2400, next_points: null });
    const tree = render(
      <RankLadder standing={top} floors={FLOORS} shares={SHARES} equipped={{}} />
    );

    const label = tree.root
      .findAllByType(Text)
      .find((n) => String(n.props.children ?? '') === '3,000');
    expect(label).toBeTruthy();

    // Walk out of the chip to the box that places it, and then to the rung
    // that box has to stay inside — rather than restating either height here,
    // where it would go stale the moment the layout is retuned.
    let marker = null;
    let rung = null;
    for (let up = label.parent; up; up = up.parent) {
      const flat = StyleSheet.flatten(up.props.style) || {};
      if (!marker && typeof flat.bottom === 'number' && typeof flat.height === 'number') {
        marker = flat;
      } else if (marker && typeof flat.height === 'number' && flat.bottom == null) {
        rung = flat;
        break;
      }
    }
    expect(marker).toBeTruthy();
    expect(rung).toBeTruthy();
    expect(marker.bottom).toBeGreaterThanOrEqual(0);
    expect(marker.bottom + marker.height).toBeLessThanOrEqual(rung.height);
  });

  test('renders for a runner at the very bottom and the very top', () => {
    for (const standing of [
      standingFrom({ key: 'wood', points: 0 }),
      standingFrom({ key: 'mythic', points: 3000, floor: 2400, next_points: null }),
    ]) {
      const tree = render(
        <RankLadder standing={standing} floors={FLOORS} shares={SHARES} equipped={{}} />
      );
      expect(tree.toJSON()).toBeTruthy();
    }
  });
});

describe('the promotion ceremony', () => {
  const from = standingFrom({ key: 'silver', points: 1340, floor: 1200, next_points: 1350 });
  const to = standingFrom({ key: 'gold', points: 1355, floor: 1350, next_points: 1500 });

  // The ceremony is a timeline of setTimeouts. On real timers they land after
  // the assertions, on a tree the next test has already torn down.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('changes the badge INSIDE the light, not before it', () => {
    // The whole trick: you look away into the glare and look back at something
    // better. Naming the new tier while the old badge is still on screen would
    // give the swap away.
    const tree = render(
      <RankUpCeremony visible from={from} to={to} topPercent={54} equipped={{}} onDone={() => {}} />
    );
    expect(texts(tree).join('|')).not.toContain('Tap to continue');

    act(() => { jest.advanceTimersByTime(2500); });
    const t = texts(tree).join('|');
    expect(t).toContain('GOLD I');
    expect(t).toContain('TOP 54% ');
  });

  test('holds until tapped rather than dismissing itself', () => {
    const onDone = jest.fn();
    const tree = render(
      <RankUpCeremony visible from={from} to={to} equipped={{}} onDone={onDone} />
    );
    act(() => { jest.advanceTimersByTime(30000); });
    expect(onDone).not.toHaveBeenCalled();
    expect(texts(tree).join('|')).toContain('Tap to continue');
  });

  test('renders nothing with no destination', () => {
    const tree = render(<RankUpCeremony visible from={from} to={null} onDone={() => {}} />);
    expect(tree.toJSON()).toBeNull();
  });

  test('unmounting mid ceremony does not leave a timer to land on nothing', () => {
    const tree = render(
      <RankUpCeremony visible from={from} to={to} equipped={{}} onDone={() => {}} />
    );
    act(() => { tree.unmount(); });
    expect(() => act(() => { jest.advanceTimersByTime(30000); })).not.toThrow();
  });
});

describe('the compact card', () => {
  test('leads with the tier and says what is next', () => {
    const tree = render(<RankCard standing={GOLD} equipped={{}} />);
    const t = texts(tree).join('|');
    expect(t).toContain('GOLD II');
    expect(t).toContain('1,420 rank points');
  });

  test('names the next DIVISION while one is left, then the next tier', () => {
    expect(rankProgressCopy(GOLD)).toBe('80 rank points to Gold III');
    const nearlyPlatinum = standingFrom({ key: 'gold', points: 1490, floor: 1350, next_points: 1500 });
    expect(rankProgressCopy(nearlyPlatinum)).toBe('10 rank points to the next tier');
  });

  test('the top of the ladder has nothing left to ask for', () => {
    const top = standingFrom({ key: 'mythic', points: 3000, floor: 2400, next_points: null });
    expect(rankProgressCopy(top)).toBe('Top of the ladder');
  });

  test('renders a club, which has a crest instead of a runner', () => {
    const tree = render(
      <RankCard title="Club rank" standing={GOLD} emblem={null} />
    );
    expect(texts(tree).join('|')).toContain('CLUB RANK');
  });

  test('renders nothing without a standing', () => {
    const tree = render(<RankCard standing={null} />);
    expect(tree.toJSON()).toBeNull();
  });
});
