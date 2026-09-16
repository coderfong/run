/**
 * LevelUpCelebration — the full-screen moment a level is crossed.
 *
 * The look is not the contract; the shape of the moment is. It says nothing
 * until it is asked to, it counts from the level the run STARTED at to the one
 * it reached, the new number lands at the hit and not before, an impatient tap
 * brings the hit forward rather than throwing the moment away, and once it has
 * landed it lets go on its own.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockReduced = false;

// The motion mechanics are not the contract, and reanimated's generic mock
// drives its primitives through real loops, which can hold a synchronous
// render open. Keep the shapes, drop the clocks. Mirrors proWelcome.test.js.
jest.mock('../src/ui/motion', () => ({
  haptic: { success: jest.fn(), light: jest.fn(), medium: jest.fn(), heavy: jest.fn() },
  useReduceMotion: () => mockReduced,
  useOnScreen: () => true,
  Confetti: () => null,
}));

jest.mock('../src/components/RewardReveal', () => ({ RevealRays: () => null }));
jest.mock('../src/components/GameAnimation', () => () => null);
jest.mock('../src/components/character/CharacterRig', () => {
  const React2 = require('react');
  return {
    __esModule: true,
    default: () => React2.createElement('CharacterRigStub'),
    BODY_RATIO: 640 / 248,
    HEADROOM: 0.14,
  };
});

import LevelUpCelebration, { AUTO_MS_REDUCED, HIT_AT, HOLD_MS } from '../src/components/LevelUpCelebration';
import { haptic } from '../src/ui/motion';

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

const render = (el) => {
  let tree;
  act(() => { tree = renderer.create(el); });
  return tree;
};

const page = (tree) => tree.root.findAll(
  (n) => String(n.props?.accessibilityLabel || '').startsWith('Level up.') && typeof n.props?.onPress === 'function'
)[0];

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  mockReduced = false;
  haptic.success.mockClear();
});

describe('LevelUpCelebration', () => {
  it('renders nothing without a level', () => {
    const tree = render(<LevelUpCelebration visible level={null} onClose={() => {}} />);
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  it('counts from the level the run started at, not always the one below', () => {
    const tree = render(<LevelUpCelebration visible level={12} from={10} equipped={{}} onClose={() => {}} />);
    const copy = flatten(tree.toJSON());
    expect(copy).toContain('10');
    expect(copy).toContain('12');
    act(() => tree.unmount());
  });

  it('falls back to the level below when the caller does not say', () => {
    const tree = render(<LevelUpCelebration visible level={12} equipped={{}} onClose={() => {}} />);
    expect(flatten(tree.toJSON())).toContain('11');
    act(() => tree.unmount());
  });

  it('keeps the hit, and its haptic, until the build is done', () => {
    const tree = render(<LevelUpCelebration visible level={12} equipped={{}} onClose={() => {}} />);
    act(() => { jest.advanceTimersByTime(HIT_AT - 50); });
    expect(haptic.success).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(100); });
    expect(haptic.success).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('brings the hit forward on an impatient tap instead of dismissing', () => {
    const onClose = jest.fn();
    const tree = render(<LevelUpCelebration visible level={12} equipped={{}} onClose={onClose} />);
    act(() => { page(tree).props.onPress(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(haptic.success).toHaveBeenCalledTimes(1);
    // ...and only then does a tap hand control back.
    act(() => { page(tree).props.onPress(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('lets go on its own once the new number has held', () => {
    const onClose = jest.fn();
    const tree = render(<LevelUpCelebration visible level={12} equipped={{}} onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(HIT_AT + HOLD_MS - 100); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('lands at once under Reduce Motion, with no old number to knock off', () => {
    mockReduced = true;
    const onClose = jest.fn();
    const tree = render(<LevelUpCelebration visible level={12} from={11} equipped={{}} onClose={onClose} />);
    const copy = flatten(tree.toJSON());
    expect(copy).toContain('12');
    expect(copy).not.toContain('11');
    expect(copy).toContain('LEVEL');
    expect(haptic.success).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(AUTO_MS_REDUCED + 50); });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('says nothing with a dash in it', () => {
    const tree = render(<LevelUpCelebration visible level={12} equipped={{}} onClose={() => {}} />);
    act(() => { jest.advanceTimersByTime(HIT_AT + 100); });
    expect(flatten(tree.toJSON())).not.toMatch(/[-–—]/);
    act(() => tree.unmount());
  });

  it('leaves no timer behind to land on nothing', () => {
    const onClose = jest.fn();
    const tree = render(<LevelUpCelebration visible level={12} equipped={{}} onClose={onClose} />);
    act(() => { tree.unmount(); });
    expect(() => act(() => { jest.advanceTimersByTime(30000); })).not.toThrow();
    expect(onClose).not.toHaveBeenCalled();
  });
});
