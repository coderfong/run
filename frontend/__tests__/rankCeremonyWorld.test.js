// The rank ceremonies and the tier's world.
//
// What these pin (2026-09-14): the promotion stood the runner's portrait in the
// middle of the tier's illustration and covered it, so a promotion to Gold
// showed your own face in a gold frame and none of the scene. The world is the
// badge's sibling now, above it and at the art's own shape, and the demotion
// opens the tier it lands in the same way.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import RankUpCeremony from '../src/components/rank/RankUpCeremony';
import RankDownCeremony from '../src/components/rank/RankDownCeremony';
import RankBadge from '../src/components/rank/RankBadge';
import RankWorld from '../src/components/rank/RankWorld';
import { standingFrom } from '../src/config/rankLadder';
import { RANK_ART_ASPECT, rankArt } from '../src/config/rankArt';
import { Image } from '../src/ui/image';

const SILVER = standingFrom({ key: 'silver', points: 1340, floor: 1200, next_points: 1350 });
const GOLD = standingFrom({ key: 'gold', points: 1355, floor: 1350, next_points: 1500 });

function render(element) {
  let tree;
  act(() => { tree = renderer.create(element); });
  return tree;
}

const sources = (node) => node.findAllByType(Image).map((n) => n.props.source);

// Both ceremonies are timelines of setTimeouts; on real timers they land after
// the assertions.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe.each([
  ['promotion', RankUpCeremony, SILVER, GOLD, 'gold', 'silver'],
  ['demotion', RankDownCeremony, GOLD, SILVER, 'silver', 'gold'],
])('the %s', (_, Ceremony, from, to, into, left) => {
  function landed() {
    const tree = render(<Ceremony visible from={from} to={to} equipped={{}} onDone={() => {}} />);
    act(() => { jest.advanceTimersByTime(2500); });
    return tree;
  }

  test('opens the world it lands in, not the one it left', () => {
    const tree = landed();
    expect(sources(tree.root.findByType(RankWorld))).toEqual([rankArt(into).source]);
    expect(sources(tree.root)).not.toContain(rankArt(left).source);
    act(() => tree.unmount());
  });

  test('stands nothing on the art', () => {
    const tree = landed();
    // The runner is still on the screen, under the world rather than in it.
    expect(tree.root.findAllByType(RankBadge)).toHaveLength(1);
    expect(tree.root.findByType(RankWorld).findAllByType(RankBadge)).toHaveLength(0);
    act(() => tree.unmount());
  });

  test('shows the scene whole, at its own shape', () => {
    // A letterbox cut from the art is how the tops of the scenes went missing.
    const tree = landed();
    const box = StyleSheet.flatten(tree.root.findByType(RankWorld).children[0].props.style);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBe(Math.round(box.width / RANK_ART_ASPECT));
    act(() => tree.unmount());
  });
});
