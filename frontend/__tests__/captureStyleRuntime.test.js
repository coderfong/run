import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CaptureStylePlayer, { defenderReactionForTransition, validateCaptureStyle } from '../src/effects/CaptureStylePlayer';
import { ACTOR_ACTION, ENCOUNTER_MODE, REVEAL_ORIGIN, REVEAL_TRANSITION, effect, reveal } from '../src/effects/choreography';

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

// The pack's own identity rules moved to choreography.test.js when the
// styles became archetypes plus paint: `choreographySignature` is the thing
// that knows what a movement IS, and duplicating a weaker version of it here
// would only ever go stale. What stays in this file is the PLAYER.

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

  test('the reveal cue carries how and from where, not just when', () => {
    // The controller starts the territory transition on this callback. It used
    // to be an argumentless "now", so the canvas had no way to know which of
    // fifteen styles had asked and played a radial wipe for all of them.
    const onTerritoryReveal = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="earthshaker" onTerritoryReveal={onTerritoryReveal} />
      );
    });
    act(() => jest.advanceTimersByTime(3000));
    expect(onTerritoryReveal).toHaveBeenCalledTimes(1);
    expect(onTerritoryReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        transition: REVEAL_TRANSITION.CRACK_GLOW,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
      })
    );
    act(() => tree.unmount());
  });

  test('every body beat reaches the actor, in order', () => {
    const play = jest.fn();
    const actor = { current: { play, reset: jest.fn() } };
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="earthshaker" actor={actor} />
      );
    });
    act(() => jest.advanceTimersByTime(3000));
    expect(play.mock.calls.map(([step]) => step.name)).toEqual(['jump', 'slam']);
    act(() => tree.unmount());
  });

  test('camera cues reach the stage, and the stage is handed back at rest', () => {
    const runCamera = jest.fn();
    const stage = { runCamera, runShake: jest.fn(), reset: jest.fn(), stop: jest.fn(), style: {} };
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="void_collapse" stage={stage} />
      );
    });
    act(() => jest.advanceTimersByTime(3000));
    const cues = runCamera.mock.calls.map(([step]) => step.name);
    expect(cues).toContain('zoomIn');
    expect(cues).toContain('freeze');
    // Whatever a style does to the scene, the victory beat must not inherit
    // it — a claim that ended zoomed would frame the payoff wrong.
    expect(cues[cues.length - 1]).toBe('release');
    act(() => tree.unmount());
  });

  test('a style with no stage and no actor still reveals and still completes', () => {
    // Both are optional on purpose: the animation gallery mounts the player
    // bare, and a missing scene must never cost the claim its reveal.
    const onComplete = jest.fn();
    const onTerritoryReveal = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="inferno"
          onComplete={onComplete}
          onTerritoryReveal={onTerritoryReveal}
        />
      );
    });
    act(() => jest.advanceTimersByTime(3000));
    expect(onTerritoryReveal).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('reduced motion keeps the turnover and drops the choreography', () => {
    const onTerritoryReveal = jest.fn();
    const play = jest.fn();
    const runCamera = jest.fn();
    const actor = { current: { play, reset: jest.fn() } };
    const stage = { runCamera, runShake: jest.fn(), reset: jest.fn(), stop: jest.fn(), style: {} };
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="earthshaker"
          reducedMotion
          actor={actor}
          stage={stage}
          onTerritoryReveal={onTerritoryReveal}
        />
      );
    });
    act(() => jest.advanceTimersByTime(220));
    // The ground still changes hands, and it still changes hands the way this
    // style changes it — a freeze and a shatter are different events, not
    // different amounts of motion.
    expect(onTerritoryReveal).toHaveBeenCalledWith(
      expect.objectContaining({ transition: REVEAL_TRANSITION.CRACK_GLOW })
    );
    // No jumping, no slamming, no camera.
    expect(play).not.toHaveBeenCalled();
    expect(runCamera.mock.calls.filter(([s]) => s.name !== 'release')).toHaveLength(0);
    act(() => tree.unmount());
  });

  test('invalid capture-style effects are reported while missing optional effects are allowed', () => {
    // A reveal now has to say HOW the ground turns over and from where — a
    // freeze and a shatter are different events, not different art over the
    // same wipe — so the fixture states one rather than leaving it undefined.
    const actions = [
      reveal(10, {
        transition: REVEAL_TRANSITION.RADIAL,
        origin: REVEAL_ORIGIN.CLAIM_POINT,
      }),
      { action: 'haptic', start: 10, style: 'light' },
    ];
    const metadata = {
      encounterMode: ENCOUNTER_MODE.TERRITORY_ONLY,
      showAttacker: false,
      showDefender: false,
      usesProjectile: false,
      territoryTransition: REVEAL_TRANSITION.RADIAL,
      revealOrigin: REVEAL_ORIGIN.CLAIM_POINT,
    };
    expect(validateCaptureStyle({
      id: 'broken', duration: 900, ...metadata,
      // Built through `effect()` so it carries `track: 'effect'` — the
      // validator only inspects that track, and a bare object slips past it.
      sequence: [effect(0, 'not-registered'), ...actions],
    })).toEqual(expect.arrayContaining([expect.stringContaining('missing effect')]));
    expect(validateCaptureStyle({
      id: 'optional', duration: 900, ...metadata,
      sequence: [effect(0, 'not-registered', { optional: true }), ...actions],
    })).toEqual([]);
  });
});

describe('captured rival reactions', () => {
  test('the territory transition determines the rival response', () => {
    expect(defenderReactionForTransition(REVEAL_TRANSITION.SHOCKWAVE).name).toBe(ACTOR_ACTION.KNOCKBACK);
    expect(defenderReactionForTransition(REVEAL_TRANSITION.DISSOLVE).name).toBe(ACTOR_ACTION.PULLED);
    expect(defenderReactionForTransition(REVEAL_TRANSITION.ELECTRIFY)).toEqual({
      name: ACTOR_ACTION.RECOIL,
      jitter: true,
    });
  });
});
