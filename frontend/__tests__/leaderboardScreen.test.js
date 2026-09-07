// The Leaderboard hub, after it was given the app's panel header.
//
// It was the last hub still opening as a bare segmented control on an empty
// page under the plain native title bar. The header is not decoration here:
// its colour and its sentence are what say WHICH board you are looking at
// before you have read a single row.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

import LeaderboardScreen from '../src/screens/LeaderboardScreen';
import { brand } from '../src/theme';

// The board itself has its own tests; this is about the screen around it.
jest.mock('../src/components/LeaderboardView', () => {
  const { Text: T } = require('react-native');
  return function LeaderboardView({ board }) {
    return <T>{`board:${board}`}</T>;
  };
});

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  addListener: jest.fn(() => jest.fn()),
  isFocused: () => true,
  getParent: () => ({ navigate: jest.fn() }),
};

function mount() {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <LeaderboardScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  return tree;
}

function texts(tree) {
  return tree.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(3).join('') : String(c ?? '');
  }).join('|');
}

function tab(tree, label) {
  return tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function'
      && String(n.props?.accessibilityLabel || '').includes(label)
  )[0];
}

/** Every backgroundColor anywhere in the tree, flattened. */
function fills(tree) {
  const out = [];
  tree.root.findAll((n) => {
    const st = n.props?.style;
    const list = Array.isArray(st) ? st : [st];
    for (const x of list) {
      if (x && typeof x === 'object' && x.backgroundColor) out.push(x.backgroundColor);
    }
    return false;
  });
  return out;
}

describe('the leaderboard hub', () => {
  test('opens on the rank board, and names what the board is', () => {
    const tree = mount();
    const t = texts(tree);
    expect(t).toContain('Standings');
    expect(t).toContain('Rank');
    // The sentence is the point: "Rank" alone says nothing.
    expect(t).toContain('Where every runner stands on the ladder');
    expect(t).toContain('board:rank');
  });

  test('switching board changes the header sentence AND its colour', () => {
    const tree = mount();
    expect(fills(tree)).toContain(brand.purple);

    act(() => { tab(tree, 'Land').props.onPress(); });

    const t = texts(tree);
    expect(t).toContain('Who is holding the most ground right now');
    expect(t).toContain('board:land');
    // Felt as well as read.
    expect(fills(tree)).toContain(brand.teal);
    expect(fills(tree)).not.toContain(brand.purple);
  });

  test('every board has a title, a sentence and a colour', () => {
    // A third board must not be addable without deciding all three.
    const tree = mount();
    for (const label of ['Rank', 'Land']) {
      act(() => { tab(tree, label).props.onPress(); });
      const t = texts(tree);
      expect(t).toContain(label);
      expect(t).toMatch(/Where every runner stands|Who is holding the most/);
    }
  });

  test('back falls through to Home when there is nothing to pop', () => {
    const solo = { ...navigation, canGoBack: () => false };
    let tree;
    act(() => {
      tree = renderer.create(
        <NavigationContext.Provider value={solo}>
          <LeaderboardScreen navigation={solo} />
        </NavigationContext.Provider>
      );
    });
    const back = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function'
        && /back/i.test(String(n.props?.accessibilityLabel || ''))
    )[0];
    expect(back).toBeTruthy();
    act(() => { back.props.onPress(); });
    expect(solo.navigate).toHaveBeenCalledWith('HomeMain');
  });
});
