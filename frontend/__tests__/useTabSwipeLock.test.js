// A sideways scroller on a tab page has to hold the tab pager still, or the
// drag that should scroll it swipes to the next tab instead. The lock must also
// always come off — a tab left unswipeable is its own bug.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useTabSwipeLock } from '../src/hooks/useTabSwipeLock';

function tabNavigation() {
  const setOptions = jest.fn();
  return { setOptions, navigation: { getParent: () => ({ setOptions }) } };
}

function mount(navigation) {
  let held;
  function Probe() {
    held = useTabSwipeLock(navigation);
    return null;
  }
  let tree;
  act(() => { tree = renderer.create(<Probe />); });
  return { tree, lock: (on) => act(() => { held(on); }) };
}

describe('useTabSwipeLock', () => {
  test('turns the tab swipe off while held and back on when let go', () => {
    const { setOptions, navigation } = tabNavigation();
    const { lock } = mount(navigation);
    lock(true);
    expect(setOptions).toHaveBeenLastCalledWith({ swipeEnabled: false });
    lock(false);
    expect(setOptions).toHaveBeenLastCalledWith({ swipeEnabled: true });
  });

  test('a touch end and a scroll end for one drag set the option once', () => {
    const { setOptions, navigation } = tabNavigation();
    const { lock } = mount(navigation);
    lock(true);
    lock(false);
    lock(false);
    expect(setOptions).toHaveBeenCalledTimes(2);
  });

  test('never leaves the tab locked behind an unmounted screen', () => {
    const { setOptions, navigation } = tabNavigation();
    const { tree, lock } = mount(navigation);
    lock(true);
    act(() => { tree.unmount(); });
    expect(setOptions).toHaveBeenLastCalledWith({ swipeEnabled: true });
  });

  test('does nothing outside a navigator', () => {
    const { lock } = mount(undefined);
    expect(() => lock(true)).not.toThrow();
  });
});
