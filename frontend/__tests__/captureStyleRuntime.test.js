import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CaptureStylePlayer, { validateCaptureStyle } from '../src/effects/CaptureStylePlayer';
import { CAPTURE_STYLES, captureStyleShape } from '../src/effects/captureStyles';

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

describe('every claim celebration is its own celebration', () => {
  // The pack used to be fifteen sprite playlists sharing one piece of
  // choreography: three sheets on the territory's visual centre, a sideways
  // rattle, a radial reveal. Different art, identical event — which is what
  // "sure I see different animations, but the action is the same" meant.
  //
  // `captureStyleShape` strips the art out and leaves the movement, so these
  // assert the thing that was actually wrong.
  test('no two styles share a movement shape', () => {
    const shapes = new Map();
    for (const style of CAPTURE_STYLES) {
      const shape = captureStyleShape(style);
      expect(shapes.has(shape)).toBe(false);
      shapes.set(shape, style.id);
    }
    expect(shapes.size).toBe(CAPTURE_STYLES.length);
  });

  test('the pack uses the whole anchor vocabulary, not just the centre', () => {
    const anchors = new Set();
    for (const style of CAPTURE_STYLES) {
      for (const step of style.sequence) {
        if (!step.action) anchors.add(step.anchor || 'territoryVisualCenter');
      }
    }
    // Centre-only is the state this pass existed to leave behind. Eight is
    // comfortably more than "a couple of styles happen to differ".
    expect(anchors.size).toBeGreaterThanOrEqual(8);
  });

  test('stage movement is not one gesture repeated', () => {
    const cues = new Set();
    for (const style of CAPTURE_STYLES) {
      for (const step of style.sequence) {
        if (step.action === 'screenShake') cues.add(`shake:${step.axis || 'x'}`);
        if (step.action === 'cameraPunch') cues.add('punch');
      }
    }
    // Sideways, vertical, both, and the camera push.
    expect(cues).toEqual(new Set(['shake:x', 'shake:y', 'shake:both', 'punch']));
  });

  test('some styles reveal the ground before the impact and some after', () => {
    const order = CAPTURE_STYLES.map((style) => {
      const reveal = style.sequence.find((s) => s.action === 'territoryReveal');
      const impact = style.sequence.find((s) => s.action === 'haptic');
      return reveal.start < impact.start ? 'before' : 'after';
    });
    // Whether the land arrives and is then struck, or the strike is what puts
    // it there, is the biggest single difference between two celebrations.
    expect(new Set(order)).toEqual(new Set(['before', 'after']));
  });
});

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
