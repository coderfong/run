// The horizontal rank rail that sits under the portrait on the You page.
//
// Two things are worth a test here.
//
// The geometry: one continuous track through ten nodes, filled to exactly
// where the runner is standing. Get the marker arithmetic wrong and it still
// renders — just pointing at the wrong tier — which is the kind of bug only a
// measurement catches.
//
// The HEIGHT: this is a horizontal ScrollView nested inside the profile page's
// vertical one, and an unsized one takes the parent's height rather than its
// content's. That shipped once, and it pushed the entire You page below the
// fold — the stat wall, the streak, the trophies, the run list and every
// setting — so the page looked as though everything under the portrait had
// been deleted. The rail must state its own height.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text } from 'react-native';

import RankRail, { RAIL_H } from '../src/components/rank/RankRail';
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

/**
 * Width of the FILLED portion of the track.
 *
 * Matched on the tier's colour, not on document order: the empty track behind
 * it has the same shape and the same height, and picking the wrong one silently
 * returns the rail's full length for every input — which looks like a passing
 * monotonicity test right up until it does not.
 */
function fillWidth(tree, standing) {
  const bar = tree.root.findAll((n) => {
    const flat = StyleSheet.flatten(n.props?.style);
    return !!flat
      && flat.backgroundColor === standing.color
      && typeof flat.width === 'number'
      && flat.borderWidth === undefined;
  })[0];
  return bar ? StyleSheet.flatten(bar.props.style).width : null;
}

describe('the rail', () => {
  test('null thresholds preserve supplied progress and use loaded ladder floors', () => {
    const standing = standingFrom({ rank_key: 'wood', rank_points: 1000, floor: null, rank_next_points: null, rank_progress: 0.8 });
    expect(standing.progress).toBe(0.8);
    expect(standing.next).toBeNull();
    const tree = render(<RankRail standing={standing} floors={FLOORS} onPress={() => {}} />);
    expect(texts(tree)).toContain('50 to Bronze');
  });

  test('the position marker follows progress and paints after the nodes', () => {
    const standing = standingFrom({ key: 'gold', points: 1425, floor: 1350, next_points: 1500 });
    const tree = render(<RankRail standing={standing} floors={FLOORS} onPress={() => {}} />);
    const marker = tree.root.findAll((n) => n.props.testID === 'rank-position-marker')[0];
    const style = StyleSheet.flatten(marker.props.style);
    expect(style.left + style.width / 2).toBe(3 * 66 + 33 + 0.5 * 66);
    expect(marker.parent.children[marker.parent.children.length - 1]).toBe(marker);
    expect(style.top + style.height).toBeLessThan(22);
  });

  test('shows every tier as a milestone', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const t = texts(tree);
    for (const tier of RANK_TIERS) expect(t).toContain(tier.label);
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
    // /me/stats sends a progress fraction and no next-tier points at all. The
    // rail must still say what the number to beat is rather than "0 to go".
    const tree = render(
      <RankRail standing={standingFrom({ rank_key: 'wood', rank_points: 1000, rank_progress: 0.8 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const t = texts(tree);
    expect(t).toContain('1,000 / 1,050');
    expect(t).toContain('50 to Bronze');
  });

  test('is horizontally scrollable, inside a vertically scrolling page', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'wood', points: 0 })} floors={FLOORS} onPress={() => {}} />
    );
    const sv = tree.root.findAllByType(ScrollView)[0];
    expect(sv.props.horizontal).toBe(true);
    // Without these the parent ScrollView swallows the drag on Android.
    expect(sv.props.nestedScrollEnabled).toBe(true);
    expect(sv.props.directionalLockEnabled).toBe(true);
  });

  test('states its own height, so it cannot swallow the page under it', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'wood', points: 0 })} floors={FLOORS} onPress={() => {}} />
    );
    const sv = tree.root.findAllByType(ScrollView)[0];
    expect(typeof StyleSheet.flatten(sv.props.style).height).toBe('number');

    const wrap = tree.root.findAll(
      (n) => String(n.props?.accessibilityLabel || '').includes('Open the rank ladder')
    )[0];
    expect(StyleSheet.flatten(wrap.props.style).height).toBe(RAIL_H);
    // Compact enough to sit between the portrait and the runner actions.
    expect(RAIL_H).toBeLessThan(90);
  });

  test('the fill grows monotonically as the runner climbs', () => {
    const widths = [
      standingFrom({ key: 'wood', points: 800, floor: 800, next_points: 1050 }),
      standingFrom({ key: 'silver', points: 1200, floor: 1200, next_points: 1350 }),
      standingFrom({ key: 'gold', points: 1490, floor: 1350, next_points: 1500 }),
      standingFrom({ key: 'mythic', points: 2600, floor: 2400, next_points: null }),
    ].map((standing) => fillWidth(
      render(<RankRail standing={standing} floors={FLOORS} onPress={() => {}} />), standing
    ));

    expect(widths.every((w) => typeof w === 'number')).toBe(true);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  test('progress within a tier moves the fill without changing tier', () => {
    const early = standingFrom({ key: 'gold', points: 1360, floor: 1350, next_points: 1500 });
    const late = standingFrom({ key: 'gold', points: 1490, floor: 1350, next_points: 1500 });
    const low = fillWidth(render(<RankRail standing={early} floors={FLOORS} onPress={() => {}} />), early);
    const high = fillWidth(render(<RankRail standing={late} floors={FLOORS} onPress={() => {}} />), late);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });

  test('the top of the ladder does not overrun the end of the track', () => {
    const top = standingFrom({ key: 'mythic', points: 99999, floor: 2400, next_points: null });
    const tree = render(<RankRail standing={top} floors={FLOORS} onPress={() => {}} />);
    // Nine gaps between ten node centres, less the track's own stroke.
    expect(fillWidth(tree, top)).toBeLessThanOrEqual(9 * 66);
    expect(texts(tree)).toContain('Top of the ladder');
  });

  test('marks the division you are in, on the tier you are in', () => {
    // "Wood III" is a claim about WHERE in the band you are standing. The
    // numeral rides the current node so the rail backs the plaque up.
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
    // The ladder count is a second, slower request. The rail must not wait on it.
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={[]} onPress={() => {}} />
    );
    expect(tree.toJSON()).toBeTruthy();
    expect(texts(tree)).toContain('Gold');
  });
});
