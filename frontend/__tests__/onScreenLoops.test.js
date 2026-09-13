/**
 * Every endless loop parks when its screen is not the one being looked at.
 *
 * The app's tabs are never frozen: material top tabs carry no react-freeze, so
 * Home's feed, the avatar studio, a Missions screen left on top of a stack —
 * all stay mounted and live behind whatever tab is showing. And Reanimated 4
 * on iOS applies every animated frame as a commit of the whole shadow tree,
 * which every React update then has to queue behind. A loop nobody can see is
 * a tax on every tap in the app, so each primitive that loops asks
 * `useOnScreen` first. These pin that it does.
 */

import React from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { NavigationContext } from '@react-navigation/native';
import { withRepeat } from 'react-native-reanimated';

import { MascotLoader, Pulse, Skeleton, useOnScreen } from '../src/ui/motion';
import ArtFrame from '../src/ui/ArtFrame';
import CharacterRig from '../src/components/character/CharacterRig';
import TerritoryStealBanner from '../src/components/TerritoryStealBanner';

// The shared mock, with `withRepeat` made countable. It is the one call every
// endless loop in the app goes through.
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return { ...mock, __esModule: true, withRepeat: jest.fn(mock.withRepeat) };
});

// A screen's navigation object, reduced to what focus needs: whether it is
// focused, and focus/blur events when that changes.
function fakeScreen(focused) {
  const listeners = new Set();
  let current = focused;
  return {
    isFocused: () => current,
    addListener: (type, callback) => {
      const entry = { type, callback };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    listening: () => listeners.size,
    show(next) {
      current = next;
      const type = next ? 'focus' : 'blur';
      listeners.forEach((entry) => { if (entry.type === type) entry.callback(); });
    },
  };
}

const mount = (navigation, element) => {
  let tree;
  act(() => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>{element}</NavigationContext.Provider>
    );
  });
  return tree;
};

beforeEach(() => withRepeat.mockClear());

describe('useOnScreen', () => {
  function Probe({ enabled = true, seen }) {
    seen(useOnScreen(enabled));
    return null;
  }

  it('says yes outside a navigator, rather than throwing', () => {
    let value;
    let tree;
    act(() => { tree = renderer.create(<Probe seen={(v) => { value = v; }} />); });
    expect(value).toBe(true);
    act(() => tree.unmount());
  });

  it('follows the screen as it is shown and left', () => {
    const screen = fakeScreen(false);
    let value;
    const tree = mount(screen, <Probe seen={(v) => { value = v; }} />);
    expect(value).toBe(false);
    act(() => screen.show(true));
    expect(value).toBe(true);
    act(() => screen.show(false));
    expect(value).toBe(false);
    act(() => tree.unmount());
    expect(screen.listening()).toBe(0);
  });

  it('costs a caller that is not looping no subscription at all', () => {
    // Frames ask, a screen draws fifty of them, and almost none of them boil.
    const screen = fakeScreen(false);
    const tree = mount(screen, <Probe enabled={false} seen={() => {}} />);
    expect(screen.listening()).toBe(0);
    act(() => tree.unmount());
  });
});

describe('a loop on a screen nobody is looking at', () => {
  it.each([
    ['a Pulse', () => <Pulse><View /></Pulse>],
    ['a Skeleton', () => <Skeleton />],
    ['the mascot loader', () => <MascotLoader source={1} />],
    ['a boiling frame', () => <ArtFrame name="panel" width={200} height={120} boil />],
    ['a bobbing runner', () => <CharacterRig size={80} animate />],
  ])('%s starts nothing until its screen is shown', (_, make) => {
    const screen = fakeScreen(false);
    const tree = mount(screen, make());
    expect(withRepeat).not.toHaveBeenCalled();
    act(() => screen.show(true));
    expect(withRepeat).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('a steal banner’s heads only sulk while the feed is being looked at', () => {
    // One loop per head, on every steal in the feed, on a tab that never
    // unmounts. This is the one that was running behind every other screen.
    const victims = [
      { user_id: 'a', username: 'ana', avatar: {} },
      { user_id: 'b', username: 'bo', avatar: {} },
    ];
    const screen = fakeScreen(false);
    const tree = mount(
      screen,
      <TerritoryStealBanner trigger="run-1" victims={victims} amount="0.21 km²" autoPlay={false} haptics={false} />
    );
    expect(withRepeat).not.toHaveBeenCalled();
    act(() => screen.show(true));
    expect(withRepeat).toHaveBeenCalledTimes(victims.length);
    act(() => tree.unmount());
  });

  it('a steal banner scrolled out of view holds its heads still, on a focused screen', () => {
    // The feed keeps two screens of rows mounted either side of the one being
    // read. Their screen IS focused, so only the row's own answer parks them.
    const victims = [
      { user_id: 'a', username: 'ana', avatar: {} },
      { user_id: 'b', username: 'bo', avatar: {} },
    ];
    const screen = fakeScreen(true);
    const banner = (active) => (
      <NavigationContext.Provider value={screen}>
        <TerritoryStealBanner
          trigger="run-2"
          victims={victims}
          amount="0.3 km²"
          autoPlay={false}
          haptics={false}
          active={active}
        />
      </NavigationContext.Provider>
    );
    let tree;
    act(() => { tree = renderer.create(banner(false)); });
    expect(withRepeat).not.toHaveBeenCalled();
    act(() => tree.update(banner(true)));
    expect(withRepeat).toHaveBeenCalledTimes(victims.length);
    act(() => tree.unmount());
  });
});
