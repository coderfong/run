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
import Chest, { CHEST_COLORS, chestColors } from '../src/components/lootbox/Chest';

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
});

describe('spending chances', () => {
  test('counts down, then invites the open', () => {
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} onOpened={() => {}} />); });

    // Three chances left: nothing but "keep tapping".
    expect(texts(tree)).toContain('Tap! Tap!');
    expect(texts(tree)).toContain('RARE');

    tapOnce(tree);
    expect(texts(tree)).toContain('Tap! Tap!');

    // The second tap is the one that upgrades: the label follows immediately,
    // because the wash starts on the same frame.
    tapOnce(tree);
    expect(texts(tree)).toContain('EPIC');
    expect(texts(tree)).toContain('1 chance left!');

    tapOnce(tree);
    expect(texts(tree)).toContain('Tap to open!');
  });

  test('an unlucky box still reaches the open, at its floor', () => {
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={unlucky} onOpened={() => {}} />); });
    for (let i = 0; i < 3; i += 1) tapOnce(tree);
    expect(texts(tree)).toContain('Tap to open!');
    // Never promoted, so it is still what it was granted at. Nothing was lost.
    expect(texts(tree)).toContain('COMMON');
  });

  test('a box with no chances opens on the first tap', () => {
    // A legendary box has nothing to gamble for, and must not show pips it
    // cannot spend or a caption telling you to tap tap.
    let tree;
    const onOpened = jest.fn();
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={topped} onOpened={onOpened} />); });
    expect(texts(tree)).toContain('Tap to open!');
    expect(texts(tree)).not.toContain('Tap! Tap!');
  });

  test('hands over the rarity the taps actually reached, not the granted one', () => {
    jest.useFakeTimers();
    const onOpened = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={lucky} onOpened={onOpened} />); });
    for (let i = 0; i < 3; i += 1) tapOnce(tree);
    tapOnce(tree);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(onOpened).toHaveBeenCalledWith('epic');
    jest.useRealTimers();
  });

  test('taps after the open are ignored, so it can only pay out once', () => {
    jest.useFakeTimers();
    const onOpened = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={unlucky} onOpened={onOpened} />); });
    for (let i = 0; i < 6; i += 1) tapOnce(tree);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(onOpened).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('renders nothing without a sequence', () => {
    let tree;
    act(() => { tree = renderer.create(<LootboxGamble visible sequence={null} onOpened={() => {}} />); });
    expect(tree.toJSON()).toBeNull();
  });
});
