import React, { useRef } from 'react';
import renderer, { act } from 'react-test-renderer';

import useClaimSequence, {
  CAPTURE_VARIANTS,
  pickCaptureVariant,
} from '../src/components/claim/useClaimSequence';

jest.mock('../src/components/claim/useClaimReveal', () => {
  const React2 = require('react');
  return function useClaimRevealHarness() {
    const [reveal, setReveal] = React2.useState(null);
    const [finalVisible, setFinalVisible] = React2.useState(false);
    const focus = React2.useCallback(async () => ({
      claimPoint: { x: 195, y: 350 },
      rings: [[{ x: 70, y: 180 }, { x: 320, y: 180 }, { x: 320, y: 540 }, { x: 70, y: 540 }]],
    }), []);
    const reset = React2.useCallback(() => { setReveal(null); setFinalVisible(false); }, []);
    const startReveal = React2.useCallback((projection) => setReveal(projection), []);
    const clearOverlay = React2.useCallback(() => setReveal(null), []);
    const showFinalTerritory = React2.useCallback(() => setFinalVisible(true), []);
    return {
      reduced: false,
      reveal,
      finalVisible,
      focus,
      reset,
      startReveal,
      clearOverlay,
      showFinalTerritory,
    };
  };
});

jest.mock('../src/components/claim/runFlyover', () => ({
  flyRun: jest.fn(async () => {}),
  levelCamera: jest.fn(),
}));

let latest;
function Harness() {
  const mapRef = useRef({});
  latest = useClaimSequence({ mapRef, userId: null });
  return null;
}

const claim = { territory: {}, victims: [{ user_id: 'rival', defended: false }] };
const center = { latitude: 1.3, longitude: 103.8 };

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('claim sequence cancellation and skip safety', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('unmount resolves cancelled waits and leaves no retained timers', async () => {
    let tree;
    let run;
    await act(async () => { tree = renderer.create(<Harness />); });
    await act(async () => {
      run = latest.start(claim, center);
      await flush();
    });
    act(() => tree.unmount());
    // This promise used to remain pending forever because clearTimeout did
    // not resolve the cancelled wait. Awaiting it without advancing clocks is
    // the regression assertion.
    await run;
  });

  test('skip immediately reaches the ownership/payoff end state', async () => {
    let tree;
    let run;
    await act(async () => { tree = renderer.create(<Harness />); });
    await act(async () => {
      run = latest.start(claim, center);
      await flush();
    });
    act(() => latest.skip());
    await act(async () => {
      await run;
      await flush();
    });
    expect(latest.showPayoff).toBe(true);
    expect(latest.showPermanentTerritory).toBe(true);
    expect(latest.showCaptureStyle).toBe(false);
    expect(latest.showEncounter).toBe(false);
    act(() => tree.unmount());
  });

  test('capture style cues the controller-owned territory reveal', async () => {
    let tree;
    let run;
    await act(async () => { tree = renderer.create(<Harness />); });
    await act(async () => {
      run = latest.start(claim, center);
      await flush();
      latest.onImpact();
      await flush();
    });

    expect(latest.showCaptureStyle).toBe(true);
    expect(latest.showReveal).toBe(false);

    await act(async () => {
      latest.onCaptureRevealCue();
      await flush();
    });

    expect(latest.showReveal).toBe(true);
    act(() => latest.skip());
    await act(async () => { await run; });
    act(() => tree.unmount());
  });

  test('a non-duel style starts instead of the collision encounter', async () => {
    let tree;
    let run;
    await act(async () => { tree = renderer.create(<Harness />); });
    await act(async () => {
      run = latest.start(claim, center, { captureStyle: 'meteor_claim' });
      await flush();
    });
    expect(latest.captureStyleMeta.encounterMode).toBe('projectile');
    expect(latest.showCaptureStyle).toBe(true);
    expect(latest.showEncounter).toBe(false);
    act(() => latest.skip());
    await act(async () => { await run; });
    act(() => tree.unmount());
  });

  test('an explicit duel owns collision and starts its style at impact', async () => {
    let tree;
    let run;
    await act(async () => { tree = renderer.create(<Harness />); });
    await act(async () => {
      run = latest.start(claim, center, { captureStyle: 'sword_slash' });
      await flush();
    });
    expect(latest.showEncounter).toBe(true);
    expect(latest.showCaptureStyle).toBe(false);
    await act(async () => {
      latest.onImpact();
      await flush();
    });
    expect(latest.showCaptureStyle).toBe(true);
    act(() => latest.skip());
    await act(async () => { await run; });
    act(() => tree.unmount());
  });
});

describe('capture encounter variation', () => {
  test('uses the territory identity to choose a stable encounter', () => {
    expect(pickCaptureVariant('territory-123')).toBe(pickCaptureVariant('territory-123'));
    expect(CAPTURE_VARIANTS).toContain(pickCaptureVariant('territory-123'));
  });

  test('the selector reaches every shipped encounter across claims', () => {
    const selected = new Set(
      Array.from({ length: 100 }, (_, index) => pickCaptureVariant(`territory-${index}`))
    );
    expect(selected).toEqual(new Set(CAPTURE_VARIANTS));
  });
});
