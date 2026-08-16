/**
 * ScreenIn holds a screen's opacity down until its content is ready.
 *
 * The failure mode worth a test is not the fade — Reanimated is mocked here and
 * the opacity is its problem anyway — it is the DEADLOCK. GlobalMapScreen waits
 * for the map to report that it finished loading, and the map can only report
 * that if it is mounted and doing its work behind the held opacity. A ScreenIn
 * that skipped rendering its children until `ready` would wait forever on an
 * event that nothing was left alive to fire.
 */

import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { ScreenIn, useArrival } from '../src/ui/motion';

const texts = (tree) =>
  tree.root.findAllByType(Text).map((n) => n.props.children);

describe('ScreenIn', () => {
  // The guard is a real timer. Fake them so the reveal it eventually forces
  // lands inside the test rather than after it has finished.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const mount = (props) => {
    let tree;
    act(() => {
      tree = renderer.create(
        <ScreenIn {...props}>
          <Text>board</Text>
        </ScreenIn>
      );
    });
    return tree;
  };

  it('renders its children while it is still waiting to reveal them', () => {
    const tree = mount({ ready: false });
    expect(texts(tree)).toEqual(['board']);
    act(() => tree.unmount());
  });

  it('mounts children before it is armed, so nothing is waiting on focus', () => {
    const tree = mount({ ready: false, armed: false });
    expect(texts(tree)).toEqual(['board']);
    act(() => tree.unmount());
  });

  it('survives its own guard firing on content that never became ready', () => {
    const tree = mount({ ready: false, timeoutMs: 500 });
    act(() => jest.advanceTimersByTime(600));
    expect(texts(tree)).toEqual(['board']);
    act(() => tree.unmount());
  });
});

/**
 * The latch behind the skeleton-to-data fade. Everything the app does with it
 * hangs off one question — was anybody actually kept waiting? — and getting
 * that wrong in the safe-looking direction (always true) puts a fade on every
 * cache-warm screen in the app, which is the look the response cache exists
 * to remove.
 */
describe('useArrival', () => {
  function Probe({ loading }) {
    return <Text>{String(useArrival(loading))}</Text>;
  }

  it('stays false for content that was never loading', () => {
    let tree;
    act(() => { tree = renderer.create(<Probe loading={false} />); });
    expect(texts(tree)).toEqual(['false']);
    act(() => tree.update(<Probe loading={false} />));
    expect(texts(tree)).toEqual(['false']);
  });

  it('is true on the very render that stops loading, not the one after', () => {
    let tree;
    act(() => { tree = renderer.create(<Probe loading />); });
    expect(texts(tree)).toEqual(['true']);
    act(() => tree.update(<Probe loading={false} />));
    expect(texts(tree)).toEqual(['true']);
  });

  it('stays latched through later refreshes', () => {
    let tree;
    act(() => { tree = renderer.create(<Probe loading />); });
    act(() => tree.update(<Probe loading={false} />));
    act(() => tree.update(<Probe loading={false} />));
    expect(texts(tree)).toEqual(['true']);
  });
});
