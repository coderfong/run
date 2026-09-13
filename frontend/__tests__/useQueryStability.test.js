/**
 * A focus refresh that brings back what is already on screen renders nothing.
 *
 * Every screen revalidates each of its queries when it is focused. Before this,
 * each of those cost two renders of the screen whatever came back: once as
 * `refreshing` went on, once as it went off with a new but identical response.
 * No screen reads `refreshing` (the pull-to-refresh spinners keep their own
 * state), and ProfileScreen runs seven queries, so opening the You tab was
 * fourteen full renders of the page to draw it exactly as it was.
 *
 * What is counted is the SUBTREE: a child that re-renders whenever the screen
 * using the query really does. Setting a state to the value it already holds
 * can still call the component itself once, and React then skips its children,
 * which is the work that matters.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { NavigationContext } from '@react-navigation/native';

import { useQuery } from '../src/hooks/useQuery';

function fakeScreen() {
  const listeners = new Set();
  return {
    isFocused: () => true,
    addListener: (type, callback) => {
      const entry = { type, callback };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    focus() {
      listeners.forEach((entry) => { if (entry.type === 'focus') entry.callback(); });
    },
  };
}

// Stands in for the rest of the screen: renders whenever the screen does.
function Subtree({ seen, value }) {
  seen(value);
  return null;
}

function Screen({ queryKey, fetcher, seen, readRefreshing = false }) {
  const query = useQuery(queryKey, fetcher, { staleMs: 0 });
  const value = readRefreshing
    ? { data: query.data, refreshing: query.refreshing }
    : { data: query.data };
  return <Subtree seen={seen} value={value} />;
}

async function mount(element, screen) {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <NavigationContext.Provider value={screen}>{element}</NavigationContext.Provider>
    );
  });
  return tree;
}

describe('useQuery on a refresh that changes nothing', () => {
  it('does not render the screen again', async () => {
    const screen = fakeScreen();
    let payload = { runs: 3 };
    // A brand new object every call, the way the network hands them back.
    const fetcher = jest.fn(async () => ({ ...payload }));
    const renders = [];
    const tree = await mount(
      <Screen queryKey="stable:stats" fetcher={fetcher} seen={(v) => renders.push(v)} />,
      screen
    );
    expect(renders[renders.length - 1].data).toEqual({ runs: 3 });
    const settled = renders.length;

    await act(async () => { screen.focus(); });
    await act(async () => { screen.focus(); });
    await act(async () => { screen.focus(); });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(renders.length).toBe(settled);

    // A real change still arrives, in one render.
    payload = { runs: 4 };
    await act(async () => { screen.focus(); });
    expect(renders.length).toBe(settled + 1);
    expect(renders[renders.length - 1].data).toEqual({ runs: 4 });
    act(() => tree.unmount());
  });

  it('renders for `refreshing` only when something reads it', async () => {
    const quiet = fakeScreen();
    const quietRenders = [];
    const quietTree = await mount(
      <Screen queryKey="stable:quiet" fetcher={async () => ({ a: 1 })} seen={(v) => quietRenders.push(v)} />,
      quiet
    );
    const quietSettled = quietRenders.length;
    await act(async () => { quiet.focus(); });
    expect(quietRenders.length).toBe(quietSettled);
    act(() => quietTree.unmount());

    // A reader still sees the flag go on and off around the fetch.
    const loud = fakeScreen();
    const loudRenders = [];
    const loudTree = await mount(
      <Screen
        queryKey="stable:loud"
        fetcher={async () => ({ a: 1 })}
        readRefreshing
        seen={(v) => loudRenders.push(v)}
      />,
      loud
    );
    const loudSettled = loudRenders.length;
    await act(async () => { loud.focus(); });
    const during = loudRenders.slice(loudSettled).map((r) => r.refreshing);
    expect(during).toContain(true);
    expect(loudRenders[loudRenders.length - 1].refreshing).toBe(false);
    act(() => loudTree.unmount());
  });
});
