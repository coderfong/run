import React from 'react';
import renderer, { act } from 'react-test-renderer';

import EffectPlayer, { effectDurationMs, validateEffectSpec } from '../src/effects/EffectPlayer';

jest.mock('../src/effects/LottieEffect', () => {
  const React2 = require('react');
  return function LottieFailureHarness({ source, onComplete, onError }) {
    React2.useEffect(() => {
      if (source?.mode === 'double') {
        onComplete?.();
        onComplete?.();
      }
      if (source?.mode === 'errorThenFinish') {
        onError?.(new Error('lottie failed'));
        onComplete?.();
      }
    }, [onComplete, onError, source]);
    return null;
  };
});

const lottie = (mode = 'never') => ({
  id: `test-${mode}`,
  type: 'lottie',
  source: { mode },
  duration: 500,
});

const sprite = (overrides = {}) => ({
  id: 'test-sprite',
  type: 'sprite',
  source: 1,
  frameWidth: 32,
  frameHeight: 32,
  columns: 4,
  rows: 3,
  frameCount: 10,
  fps: 20,
  ...overrides,
});

describe('EffectPlayer failure and interruption safety', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('unknown effect ID fails and completes exactly once', async () => {
    const onError = jest.fn();
    const onComplete = jest.fn();
    await act(async () => {
      renderer.create(<EffectPlayer effect="missing-effect" reducedMotion={false} onError={onError} onComplete={onComplete} />);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing sprite source', sprite({ source: null })],
    ['invalid frame metadata', sprite({ frameCount: 13 })],
    ['unsupported effect type', { id: 'video', type: 'video', source: 1 }],
  ])('%s fails gracefully', async (_name, effect) => {
    const onError = jest.fn();
    const onComplete = jest.fn();
    await act(async () => {
      renderer.create(<EffectPlayer effect={effect} reducedMotion={false} onError={onError} onComplete={onComplete} />);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('duplicate native completion and error callbacks are idempotent', async () => {
    const onError = jest.fn();
    const onComplete = jest.fn();
    await act(async () => {
      renderer.create(<EffectPlayer effect={lottie('errorThenFinish')} reducedMotion={false} onError={onError} onComplete={onComplete} />);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    const doubleComplete = jest.fn();
    await act(async () => {
      renderer.create(<EffectPlayer effect={lottie('double')} reducedMotion={false} onComplete={doubleComplete} />);
    });
    expect(doubleComplete).toHaveBeenCalledTimes(1);
  });

  test('fallback timeout completes when the native callback never arrives', async () => {
    const onComplete = jest.fn();
    await act(async () => {
      renderer.create(<EffectPlayer effect={lottie()} reducedMotion={false} onComplete={onComplete} />);
    });
    act(() => jest.advanceTimersByTime(1149));
    expect(onComplete).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('unmount halfway cancels the fallback and never calls completion', async () => {
    const onComplete = jest.fn();
    let tree;
    await act(async () => {
      tree = renderer.create(<EffectPlayer effect={lottie()} reducedMotion={false} onComplete={onComplete} />);
    });
    act(() => jest.advanceTimersByTime(200));
    act(() => tree.unmount());
    act(() => jest.advanceTimersByTime(2000));
    expect(onComplete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('reduced motion completes without mounting the decorative animation', async () => {
    const onComplete = jest.fn();
    await act(async () => {
      renderer.create(<EffectPlayer effect={lottie('double')} reducedMotion onComplete={onComplete} />);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('duration and metadata helpers cover partial sprite grids', () => {
    expect(validateEffectSpec(sprite())).toEqual({ valid: true, reason: null });
    expect(validateEffectSpec(sprite({ frameCount: 13 })).valid).toBe(false);
    expect(effectDurationMs(sprite(), 2)).toBe(250);
  });
});
