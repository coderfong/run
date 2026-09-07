// The horizontal rank rail that sits under the portrait on the You page.
//
// The interesting part is the geometry: one continuous track through ten
// nodes, filled to exactly where the runner is standing. Get the marker
// arithmetic wrong and it still renders — just pointing at the wrong tier —
// which is the kind of bug only a measurement catches.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, Text } from 'react-native';

import RankRail from '../src/components/rank/RankRail';
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
    const st = n.props?.style;
    if (!Array.isArray(st)) return false;
    const flat = Object.assign({}, ...st.filter((x) => x && typeof x === 'object'));
    return flat.position === 'absolute'
      && flat.height === 6
      && flat.backgroundColor === standing.color;
  })[0];
  if (!bar) return null;
  return Object.assign({}, ...bar.props.style.filter((x) => x && typeof x === 'object')).width;
}

describe('the rail', () => {
  test('shows every tier as a milestone, with its threshold', () => {
    const tree = render(
      <RankRail standing={standingFrom({ key: 'gold', points: 1420, floor: 1350, next_points: 1500 })}
                floors={FLOORS} onPress={() => {}} />
    );
    const t = texts(tree);
    for (const tier of RANK_TIERS) expect(t).toContain(tier.label);
    expect(t).toContain('1,350');
    expect(t).toContain('2,400');
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
    const tree = render(
      <RankRail standing={standingFrom({ key: 'mythic', points: 99999, floor: 2400, next_points: null })}
                floors={FLOORS} onPress={() => {}} />
    );
    // Nine gaps between ten node centres.
    const top = standingFrom({ key: 'mythic', points: 99999, floor: 2400, next_points: null });
    expect(fillWidth(tree, top)).toBeLessThanOrEqual(9 * 84);
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
