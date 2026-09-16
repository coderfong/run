// The box gamble, driven by taps.
//
// The static checks catch a missing import; only rendering catches a screen
// that mounts and then does the wrong thing when you press it. These press the
// real component through whole server sequences and assert on what it says,
// because the captions and the pips ARE the mechanic: they are the only thing
// telling the player what a tap just did.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import LootboxGamble from '../src/components/lootbox/LootboxGamble';
import Chest, {
  CHEST_COLORS,
  ChestBase,
  ChestLid,
  ChestLidInside,
  chestColors,
} from '../src/components/lootbox/Chest';
import { openingPlan } from '../src/components/lootbox/openingPlan';

// Sequences exactly as backend/app/lootbox.py hands them over.
const lucky = {
  rarity: 'rare',
  final_rarity: 'epic',
  chances: 3,
  steps: [
    { upgraded: false, rarity: 'rare' },
    { upgraded: true, rarity: 'epic' },
    { upgraded: false, rarity: 'epic' },
  ],
};
const unlucky = {
  rarity: 'common',
  final_rarity: 'common',
  chances: 3,
  steps: [
    { upgraded: false, rarity: 'common' },
    { upgraded: false, rarity: 'common' },
    { upgraded: false, rarity: 'common' },
  ],
};
const topped = { rarity: 'legendary', final_rarity: 'legendary', chances: 0, steps: [] };
const reward = { kind: 'cosmetic', key: 'headwear:test-hat', label: 'Test Hat' };

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}

/** The one full-screen pressable that spends a chance. */
function tapOnce(tree) {
  const area = tree.root.findAll(
    (n) => typeof n.props?.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.includes('chest')
      && typeof n.props.onPress === 'function'
  )[0];
  act(() => { area.props.onPress(); });
}

describe('the chest drawing', () => {
  test('has a full palette for every rarity a box can be', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legendary']) {
      const c = chestColors(rarity);
      for (const slot of ['page', 'body', 'shade', 'deep', 'ink']) {
        expect(c[slot]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  test('an unknown rarity still draws, at the floor', () => {
    expect(chestColors('mythic-typo')).toBe(CHEST_COLORS.common);
  });

  test('renders shut and open without throwing', () => {
    let t;
    act(() => { t = renderer.create(<Chest width={200} rarity="epic" />); });
    expect(t.toJSON()).toBeTruthy();
    act(() => { t.update(<Chest width={200} rarity="epic" open />); });
    expect(t.toJSON()).toBeTruthy();
  });

  test('the gamble swaps from its shut pose to its open pose under the flash', () => {
    jest.useFakeTimers();
    let t;
    act(() => { t = renderer.create(<LootboxGamble visible sequence={lucky} reward={reward} />); });
    expect(t.root.findAllByType(ChestLid)).toHaveLength(1);
    expect(t.root.findAllByType(ChestLidInside)).toHaveLength(0);
    expect(t.root.findAllByType(ChestBase)).toHaveLength(1);
    tapOnce(t);
    act(() => jest.advanceTimersByTime(400));
    tapOnce(t);
    act(() => jest.advanceTimersByTime(400));
    tapOnce(t);
    act(() => jest.advanceTimersByTime(openingPlan('epic').swapAt + 20));
    expect(t.root.findAllByType(ChestLid)).toHaveLength(0);
    expect(t.root.findAllByType(ChestLidInside)).toHaveLength(1);
    act(() => t.unmount());
    jest.useRealTimers();
  });
});

describe('mystery swipes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test.each([lucky, unlucky, topped])('every outcome stays hidden until three inputs, then waits for Collect: %j', (sequence) => {
    const onCollect = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={sequence} reward={reward} onCollect={onCollect} />); });
    expect(texts(tree)).toContain('MYSTERY');
    expect(texts(tree)).not.toContain('What’s inside? Tap also works.');
    for (let i = 0; i < 2; i += 1) {
      tapOnce(tree);
      act(() => jest.advanceTimersByTime(400));
      expect(texts(tree)).toContain('MYSTERY');
      expect(onCollect).not.toHaveBeenCalled();
    }
    tapOnce(tree);
    expect(texts(tree)).toContain('MYSTERY');
    act(() => jest.advanceTimersByTime(openingPlan(sequence.final_rarity).swapAt + 20));
    expect(texts(tree)).toContain(sequence.final_rarity.toUpperCase());
    expect(texts(tree)).toContain('Test Hat');
    expect(texts(tree)).toContain('COLLECT');
    expect(onCollect).not.toHaveBeenCalled();
    const collect = tree.root.find((n) => n.props?.accessibilityLabel === 'COLLECT');
    act(() => collect.props.onPress());
    expect(onCollect).toHaveBeenCalledWith(sequence.final_rarity, reward);
    act(() => tree.unmount());
  });

  test('rapid repeated inputs cannot skip the mystery beats', () => {
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} />); });
    tapOnce(tree);
    tapOnce(tree);
    const area = tree.root.findAll((n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes('Mystery chest'))[0];
    expect(area.props.accessibilityLabel).toContain('2 charges remaining');
    act(() => tree.unmount());
  });

  test('closing mid-open cancels the reveal and never collects', () => {
    const onCollect = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} reward={reward} onCollect={onCollect} />); });
    for (let i = 0; i < 3; i += 1) {
      tapOnce(tree);
      act(() => jest.advanceTimersByTime(400));
    }
    act(() => tree.update(<LootboxGamble visible={false} sequence={lucky} reward={reward} onCollect={onCollect} />));
    act(() => jest.advanceTimersByTime(2000));
    expect(onCollect).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
