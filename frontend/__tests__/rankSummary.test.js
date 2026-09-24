/**
 * The top of the rank ladder: ONE status row (your ranked portrait, tier,
 * points, percentile — each once) and one line of explanation, so the ladder
 * starts sooner. The frame goes round the portrait, never round the numeral.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { CurrentRankSummary } from '../src/components/rank/RankLadderKit';
import RankedAvatar from '../src/components/identity/RankedAvatar';
import RankCrest from '../src/components/identity/RankCrest';
import { standingFrom } from '../src/config/rankLadder';
import { RANK_NOTE, RANK_NOTE_MORE } from '../src/screens/RankLadderScreen';

const all = (tree, C) => {
  const a = tree.root.findAllByType(C);
  return a.length || !C.type ? a : tree.root.findAllByType(C.type);
};
const words = (tree) =>
  tree.root.findAllByType(Text).map((n) => [].concat(n.props.children ?? []).join('')).join('|');

const mythic = standingFrom({ key: 'mythic', points: 2481, floor: 2400 });

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <CurrentRankSummary standing={mythic} topPercent={11} equipped={{}} note={RANK_NOTE} noteMore={RANK_NOTE_MORE} />
    );
  });
  return tree;
}

describe('CurrentRankSummary', () => {
  it('frames the runner, not the numeral', () => {
    const tree = mount();
    expect(all(tree, RankedAvatar)).toHaveLength(1);
    expect(all(tree, RankCrest)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('says the rank, the points and the percentile once each', () => {
    const tree = mount();
    const t = words(tree);
    expect(t.split('MYTHIC III')).toHaveLength(2);
    expect(t).toContain('2,481 pts');
    expect(t.split('Top 11%')).toHaveLength(2);
    expect(t).not.toContain('of runners');
    expect(t).not.toContain('Top of the ladder');
    act(() => tree.unmount());
  });

  it('keeps the explanation to one line until asked', () => {
    const tree = mount();
    expect(words(tree)).toContain(RANK_NOTE);
    expect(words(tree)).not.toContain(RANK_NOTE_MORE);
    const info = tree.root.find((n) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
    act(() => info.props.onPress());
    expect(words(tree)).toContain(RANK_NOTE_MORE);
    act(() => tree.unmount());
  });
});
