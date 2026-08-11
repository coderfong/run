import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CaptureStylePlayer, { validateCaptureStyle } from '../src/effects/CaptureStylePlayer';

jest.mock('../src/effects/EffectPlayer', () => () => null);
jest.mock('../src/effects/ReactionEffect', () => () => null);

const bounds = { width: 390, height: 620 };
const rings = [[
  { x: 60, y: 160 }, { x: 340, y: 160 }, { x: 340, y: 560 }, { x: 60, y: 560 },
]];
const common = {
  bounds,
  territoryRings: rings,
  claimPoint: { x: 195, y: 350 },
  safeInsets: { top: 120, right: 20, bottom: 24, left: 20 },
};

describe('CaptureStylePlayer lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('reduced-motion completion callback fires exactly once', () => {
    const onComplete = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="thunderstrike" reducedMotion onComplete={onComplete} />
      );
    });
    act(() => jest.advanceTimersByTime(220));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(2000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('unmount halfway clears every timer and suppresses completion', () => {
    const onComplete = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="cosmic_bloom" onComplete={onComplete} />
      );
    });
    act(() => jest.advanceTimersByTime(300));
    act(() => tree.unmount());
    act(() => jest.advanceTimersByTime(4000));
    expect(onComplete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('50 rapid replays do not accumulate timers or stale completions', () => {
    const onComplete = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="radiant_claim" playToken={0} reducedMotion onComplete={onComplete} />
      );
    });
    for (let token = 1; token <= 50; token += 1) {
      act(() => {
        tree.update(
          <CaptureStylePlayer {...common} style="radiant_claim" playToken={token} reducedMotion onComplete={onComplete} />
        );
      });
      expect(jest.getTimerCount()).toBeLessThanOrEqual(3);
    }
    act(() => jest.advanceTimersByTime(220));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a release-blocked optional effect is skipped and the style still completes', () => {
    const onComplete = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="glitch_takeover" onComplete={onComplete} />
      );
    });
    act(() => jest.advanceTimersByTime(2000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('invalid capture-style effects are reported while missing optional effects are allowed', () => {
    const actions = [
      { action: 'territoryReveal', start: 10 },
      { action: 'haptic', start: 10, style: 'light' },
    ];
    expect(validateCaptureStyle({
      id: 'broken', duration: 900,
      sequence: [{ effect: 'not-registered', start: 0 }, ...actions],
    })).toEqual(expect.arrayContaining([expect.stringContaining('missing effect')]));
    expect(validateCaptureStyle({
      id: 'optional', duration: 900,
      sequence: [{ effect: 'not-registered', start: 0, optional: true }, ...actions],
    })).toEqual([]);
  });
});
