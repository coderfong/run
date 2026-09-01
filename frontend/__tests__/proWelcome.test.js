/**
 * ProWelcome — the full-screen moment a PASER PRO subscription goes live.
 *
 * The contract worth guarding here is small and behavioural: it renders
 * nothing until it is asked to, it names what was unlocked, its headline
 * tells a fresh subscriber apart from a returning one, and a tap hands
 * control back. The look is not asserted.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

// The animation mechanics are not the contract. Reanimated's generic mock
// still runs the motion primitives through their loops, which can hold an
// otherwise synchronous render open — keep the component shapes, drop the
// clocks. Mirrors __tests__/ResultScreen.test.js.
jest.mock('../src/ui/motion', () => {
  const React2 = require('react');
  const Pass = ({ children }) => React2.createElement(React2.Fragment, null, children);
  const PressableScale = ({ children, ...props }) =>
    React2.createElement('PressableScaleStub', props, children);
  return {
    haptic: { success: jest.fn(), light: jest.fn() },
    useReduceMotion: () => true,
    staggerDelay: () => 0,
    Reveal: Pass,
    Confetti: () => null,
    PressableScale,
  };
});

jest.mock('../src/components/RewardReveal', () => ({
  RevealRays: () => null,
}));
jest.mock('../src/components/GameAnimation', () => () => null);
jest.mock('../src/components/AppIcon', () => () => null);

import ProWelcome from '../src/components/ProWelcome';
import { PRO_PERKS } from '../src/config/pro';

const flatten = (node) => {
  const out = [];
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.children) walk(n.children);
  };
  walk(node);
  return out.join(' ');
};

const textOf = (tree) => flatten(tree.toJSON());

describe('ProWelcome', () => {
  it('renders nothing while it is not visible', () => {
    let tree;
    act(() => { tree = renderer.create(<ProWelcome visible={false} onClose={() => {}} />); });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  it('welcomes a fresh subscriber and lists what PRO unlocked', () => {
    let tree;
    act(() => { tree = renderer.create(<ProWelcome visible onClose={() => {}} />); });

    const copy = textOf(tree);
    expect(copy).toContain('PASER PRO');
    expect(copy).toContain("YOU'RE IN");
    expect(copy).not.toContain('WELCOME BACK');
    // The first named perk from the shared paywall list is on screen.
    expect(copy).toContain(PRO_PERKS[0][1]);

    act(() => tree.unmount());
  });

  it('greets a returning subscriber without re-selling', () => {
    let tree;
    act(() => { tree = renderer.create(<ProWelcome visible returning onClose={() => {}} />); });

    const copy = textOf(tree);
    expect(copy).toContain('WELCOME BACK');
    expect(copy).not.toContain("YOU'RE IN");

    act(() => tree.unmount());
  });

  it('hands control back when the backdrop is tapped', () => {
    const onClose = jest.fn();
    let tree;
    act(() => { tree = renderer.create(<ProWelcome visible onClose={onClose} />); });

    const dismiss = tree.root.findByProps({ accessibilityLabel: 'Dismiss' });
    act(() => dismiss.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });

  it('fires one success haptic as it arrives', () => {
    const { haptic } = require('../src/ui/motion');
    haptic.success.mockClear();
    let tree;
    act(() => { tree = renderer.create(<ProWelcome visible onClose={() => {}} />); });
    expect(haptic.success).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});
