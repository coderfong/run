// The rank rail that sits under the portrait on the You page.
//
// It draws ONLY the tier you are standing in — Wood I, Wood II, Wood III — and
// ends there. What is worth testing: that it never shows another tier, that
// the fill and marker land exactly where your progress through the tier says,
// and that it states its own height (an unsized version once buried the whole
// You page under the portrait).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text } from 'react-native';

import RankRail, { RAIL_H, divisionAt } from '../src/components/rank/RankRail';
import { RANK_TIERS, standingFrom } from '../src/config/rankLadder';

const FLOORS = [800, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2150, 2400];

function render(el) {
  let tree;
  act(() => { tree = renderer.create(el); });
  return tree;
}

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).join('') : String(c ?? '');
  }).join('|');
}

function pct(value) {
  return Number(String(value).replace('%', ''));
}

function fillPct(tree) {
  const bar = tree.root.findAll((n) => n.props.testID === 'rank-fill' && typeof n.type === 'string')[0]
    || tree.root.findAll((n) => n.props.testID === 'rank-fill')[0];
  return pct(StyleSheet.flatten(bar.props.style).width);
}

function markerPct(tree) {
  const m = tree.root.findAll((n) => n.props.testID === 'rank-position-marker')[0];
  return pct(StyleSheet.flatten(m.props.style).left);
}

describe('the rail', () => {
  test('null thresholds preserve supplied progress and use loaded ladder floors', () => {
    const standing = standingFrom({ rank_key: 'wood', rank_points: 1000, floor: null, rank_next_points: null, rank_progress: 0.8 });
    expect(standing.progress).toBe(0.8);
    const tree = render(<RankRail standing={standing} floors={FLOORS} onPress={() => {}} />);
    expect(texts(tree)).toContain('50 to Bronze');
  });

  test('shows only the divisions of the tier you are in, ending at that tier', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'wood', points: 1000, floor: 800, next_points: 1050 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const labels = texts(tree).split('|');
    expect(labels).toEqual(expect.arrayContaining(['Wood I', 'Wood II', 'Wood III']));
    // No other tier is drawn as a node. ("Bronze" may appear only in the
    // "50 to Bronze" line, which is the target, not a rung.)
    for (const tier of RANK_TIERS.slice(1)) {
      expect(labels.filter((l) => l.startsWith(tier.label))).toHaveLength(0);
    }
  });

  test('follows the tier on gold too', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const labels = texts(tree).split('|');
    expect(labels).toEqual(expect.arrayContaining(['Gold I', 'Gold II', 'Gold III']));
    expect(labels).not.toContain('Wood I');
  });

  test('the fill and marker sit at progress through the tier', () => {
    const standing = standingFrom({ key: 'gold', points: 1425, floor: 1350, next_points: 1500 });
    const tree = render(<RankRail standing={standing} floors={FLOORS} onPress={() => {}} />);
    expect(fillPct(tree)).toBeCloseTo(50);
    expect(markerPct(tree)).toBeCloseTo(50);
    const marker = tree.root.findAll((n) => n.props.testID === 'rank-position-marker')[0];
    expect(marker.parent.children[marker.parent.children.length - 1]).toBe(marker);
  });

  test('division nodes sit where each division begins', () => {
    expect(divisionAt(1)).toBe(0);
    expect(divisionAt(2)).toBeCloseTo(100 / 3);
    expect(divisionAt(3)).toBeCloseTo(200 / 3);
  });

  test('states where you stand and what you are chasing, in real numbers', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const t = texts(tree);
    expect(t).toContain('GOLD');
    expect(t).toContain('1,420 / 1,500');
    expect(t).toContain('80 to Platinum');
  });

  test('names the target off the ladder when the payload carries no threshold', () => {
    const tree = render(
      <RankRail standing={standingFrom({ rank_key: 'wood', rank_points: 1000, rank_progress: 0.8 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const t = texts(tree);
    expect(t).toContain('1,000 / 1,050');
    expect(t).toContain('50 to Bronze');
  });

  test('does not scroll sideways, so it never fights the tab pager', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'wood', points: 0 })} floors={FLOORS} onPress={() => {}} />
    );
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  });

  test('states its own height, so it cannot swallow the page under it', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'wood', points: 0 })} floors={FLOORS} onPress={() => {}} />
    );
    const wrap = tree.root.findAll(
      (n) => String(n.props?.accessibilityLabel || '').includes('Open the rank ladder')
    )[0];
    expect(StyleSheet.flatten(wrap.props.style).height).toBe(RAIL_H);
    expect(RAIL_H).toBeLessThan(90);
  });

  test('progress within a tier moves the fill', () => {
    const early = standingFrom({ key: 'gold', points: 1360, floor: 1350, next_points: 1500 });
    const late = standingFrom({ key: 'gold', points: 1490, floor: 1350, next_points: 1500 });
    const low = fillPct(render(<RankRail standing={early} floors={FLOORS} onPress={() => {}} />));
    const high = fillPct(render(<RankRail standing={late} floors={FLOORS} onPress={() => {}} />));
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });

  test('the top of the ladder is full and does not overrun the track', () => {
    const top = standingFrom({ key: 'mythic', points: 99999, floor: 2400, next_points: null });
    const tree = render(<RankRail standing={top} floors={FLOORS} onPress={() => {}} />);
    expect(fillPct(tree)).toBe(100);
    expect(texts(tree)).toContain('Top of the ladder');
    expect(texts(tree).split('|')).toContain('Mythic III');
  });

  test('marks the division you are in', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'wood', points: 1000, floor: 800, next_points: 1050 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const t = texts(tree);
    expect(t).toContain('WOOD III');
    expect(t.split('|')).toContain('III');
  });

  test('tapping opens the full ladder', () => {
    const onPress = jest.fn();
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={FLOORS} onPress={onPress} />
    );
    const btn = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function'
        && String(n.props?.accessibilityLabel || '').includes('Open the rank ladder')
    )[0];
    act(() => { btn.props.onPress(); });
    expect(onPress).toHaveBeenCalled();
  });

  test('draws before the thresholds have loaded', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={[]} onPress={() => {}} />
    );
    expect(tree.toJSON()).toBeTruthy();
    expect(texts(tree)).toContain('Gold');
  });
});
