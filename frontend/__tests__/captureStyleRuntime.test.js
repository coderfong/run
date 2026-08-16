import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CaptureStylePlayer, {
  REDUCED_BEATS,
  buildCapturePlan,
  validateCaptureStyle,
} from '../src/effects/CaptureStylePlayer';
import {
  ENCOUNTER_MODE,
  REVEAL_ORIGIN,
  REVEAL_TRANSITION,
  ROLE,
  effect,
  reveal,
} from '../src/effects/choreography';
import { getCaptureStyle, resolveCaptureStyle } from '../src/effects/captureStyles';

jest.mock('../src/effects/EffectPlayer', () => () => null);
jest.mock('../src/effects/ReactionEffect', () => () => null);
jest.mock('../src/effects/EnvironmentLayer', () => () => null);

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
const castOf = (played) => ({ current: { play: (step) => played.push(step), reset: jest.fn() } });

// The pack's own identity rules live in choreography.test.js: the signature is
// the thing that knows what a movement IS, and duplicating a weaker version of
// it here would only ever go stale. What stays in this file is the PLAYER.

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
    act(() => jest.advanceTimersByTime(REDUCED_BEATS.duration));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(3000));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('unmount halfway clears every timer and suppresses completion', () => {
    const onComplete = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="cosmic_bloom" defenderCount={2} onComplete={onComplete} />
      );
    });
    act(() => jest.advanceTimersByTime(300));
    act(() => tree.unmount());
    act(() => jest.advanceTimersByTime(6000));
    expect(onComplete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('50 rapid replays do not accumulate timers or stale completions', () => {
    const onComplete = jest.fn();
    let tree;
    const render = (token) => (
      <CaptureStylePlayer
        {...common}
        style="radiant_claim"
        playToken={token}
        reducedMotion
        onComplete={onComplete}
      />
    );
    act(() => { tree = renderer.create(render(0)); });
    for (let token = 1; token <= 50; token += 1) {
      act(() => { tree.update(render(token)); });
      // One timer per beat in the reduced plan plus the completion timer, and
      // never a second generation's worth stacked on top of it.
      const reducedPlanSteps = buildCapturePlan(getCaptureStyle('radiant_claim'), true).sequence.length;
      expect(jest.getTimerCount()).toBeLessThanOrEqual(reducedPlanSteps + 1);
    }
    act(() => jest.advanceTimersByTime(REDUCED_BEATS.duration));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a release-blocked optional effect is skipped and the style still completes', () => {
    const onComplete = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="glitch_takeover" defenderCount={2} onComplete={onComplete} />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('glitch_takeover').duration + 100));
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('the reveal cue carries how and from where, not just when', () => {
    // The controller starts the territory transition on this callback. It used
    // to be an argumentless "now", so the canvas had no way to know which
    // style had asked and played a radial wipe for all of them.
    const onTerritoryReveal = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="energy_pulse" onTerritoryReveal={onTerritoryReveal} />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('energy_pulse').duration + 200));
    expect(onTerritoryReveal).toHaveBeenCalledTimes(1);
    expect(onTerritoryReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        transition: REVEAL_TRANSITION.SHOCKWAVE,
        origin: REVEAL_ORIGIN.CHARACTER_FEET,
      })
    );
    act(() => tree.unmount());
  });

  test('every body beat reaches the right body, in order', () => {
    const played = [];
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="energy_pulse" defenderCount={2} cast={castOf(played)} />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('energy_pulse').duration + 200));

    const attackerBeats = played.filter((s) => s.role === ROLE.ATTACKER).map((s) => s.name);
    expect(attackerBeats).toEqual(['charge', 'slam', 'recoil', 'moveTo', 'celebrate']);

    // Both rivals are driven, individually, and every one of them is addressed
    // by index rather than as a group transform.
    const defenderBeats = played.filter((s) => s.role === ROLE.DEFENDER);
    expect(new Set(defenderBeats.map((s) => s.index))).toEqual(new Set([0, 1]));
    expect(defenderBeats.length).toBeGreaterThanOrEqual(6);

    act(() => tree.unmount());
  });

  test('a directional beat arrives with the point it is directional about', () => {
    // `defenderPosition - impactPosition` is what makes two rivals on opposite
    // sides of one crater move in opposite directions, and it only works if
    // the origin reaches the body as a resolved point.
    const played = [];
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="meteor_claim"
          defenderCount={3}
          defenderRects={[
            { x: 100, y: 300, width: 44, height: 44 },
            { x: 200, y: 300, width: 44, height: 44 },
            { x: 280, y: 380, width: 44, height: 44 },
          ]}
          cast={castOf(played)}
        />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('meteor_claim').duration + 200));
    const thrown = played.filter((s) => s.name === 'shockwaveKnockback');
    expect(thrown).toHaveLength(3);
    thrown.forEach((step) => {
      expect(Number.isFinite(step.originPoint?.x)).toBe(true);
      expect(Number.isFinite(step.originPoint?.y)).toBe(true);
    });
    act(() => tree.unmount());
  });

  test('camera cues reach the stage, and the stage is handed back at rest', () => {
    const runCamera = jest.fn();
    const stage = { runCamera, runShake: jest.fn(), reset: jest.fn(), stop: jest.fn(), style: {} };
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="energy_pulse" defenderCount={1} stage={stage} />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('energy_pulse').duration + 200));
    const cues = runCamera.mock.calls.map(([step]) => step.name);
    expect(cues).toContain('zoomIn');
    // Whatever a style does to the scene, the victory beat must not inherit
    // it — a claim that ended zoomed would frame the payoff wrong.
    expect(cues[cues.length - 1]).toBe('release');
    act(() => tree.unmount());
  });

  test('only a duel ever asks for contact', () => {
    const environmental = jest.fn();
    const duel = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="meteor_claim" defenderCount={2} onContact={environmental} />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('meteor_claim').duration + 200));
    expect(environmental).not.toHaveBeenCalled();
    act(() => tree.unmount());

    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="angel_vs_demon" defenderCount={2} onContact={duel} />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('angel_vs_demon').duration + 200));
    expect(duel).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('the victory beat is announced after the ground has turned over', () => {
    const order = [];
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="meteor_claim"
          defenderCount={1}
          onTerritoryReveal={() => order.push('ground')}
          onVictory={() => order.push('won')}
        />
      );
    });
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('meteor_claim').duration + 200));
    expect(order).toEqual(['ground', 'won']);
    act(() => tree.unmount());
  });

  test('a style with no stage and no cast still reveals and still completes', () => {
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
    // "inferno" is not a real style id — resolveCaptureStyle falls back to
    // DEFAULT_CAPTURE_STYLE_ID (meteor_claim), so that is what actually plays.
    act(() => jest.advanceTimersByTime(resolveCaptureStyle('meteor_claim').duration + 200));
    expect(onTerritoryReveal).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe('reduced motion keeps the story', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('the rivals are still in it, and still react and leave', () => {
    // The old reduced plan was the reveal plus a buzz, which is correct about
    // movement and wrong about information: a claim against three people that
    // plays back as a colour change has lost the three people.
    const played = [];
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="meteor_claim"
          defenderCount={3}
          reducedMotion
          cast={castOf(played)}
        />
      );
    });
    act(() => jest.advanceTimersByTime(REDUCED_BEATS.duration));

    const defenderBeats = played.filter((s) => s.role === ROLE.DEFENDER);
    expect(new Set(defenderBeats.map((s) => s.index))).toEqual(new Set([0, 1, 2]));
    // React, then leave. Both survive; only the travel is gone.
    expect(defenderBeats.some((s) => s.start === REDUCED_BEATS.react)).toBe(true);
    expect(defenderBeats.some((s) => s.start === REDUCED_BEATS.exit)).toBe(true);
    expect(played.some((s) => s.role === ROLE.ATTACKER)).toBe(true);
    act(() => tree.unmount());
  });

  test('the turnover still says which event it was, and the scene never moves', () => {
    const onTerritoryReveal = jest.fn();
    const runCamera = jest.fn();
    const runShake = jest.fn();
    const stage = { runCamera, runShake, reset: jest.fn(), stop: jest.fn(), style: {} };
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="energy_pulse"
          defenderCount={1}
          reducedMotion
          stage={stage}
          onTerritoryReveal={onTerritoryReveal}
        />
      );
    });
    act(() => jest.advanceTimersByTime(REDUCED_BEATS.duration));
    // A freeze and a shatter are different events, not different amounts of
    // motion, so the transition survives even here.
    expect(onTerritoryReveal).toHaveBeenCalledWith(
      expect.objectContaining({ transition: REVEAL_TRANSITION.SHOCKWAVE })
    );
    expect(runShake).not.toHaveBeenCalled();
    expect(runCamera.mock.calls.filter(([s]) => s.name !== 'release')).toHaveLength(0);
    act(() => tree.unmount());
  });

  test('every style collapses to one reveal, one light haptic and a cast that acts', () => {
    ['paint_bomb', 'energy_pulse', 'angel_vs_demon', 'ink_flood'].forEach((id) => {
      const plan = buildCapturePlan(getCaptureStyle(id), true);
      expect(plan.duration).toBe(REDUCED_BEATS.duration);
      expect(plan.sequence.filter((s) => s.action === 'territoryReveal')).toHaveLength(1);
      const haptics = plan.sequence.filter((s) => s.action === 'haptic');
      expect(haptics).toHaveLength(1);
      expect(haptics[0].style).toBe('light');
      expect(plan.sequence.some((s) => s.action === 'actor' && s.role === ROLE.DEFENDER)).toBe(true);
      expect(plan.sequence.some((s) => s.action === 'actor' && s.role === ROLE.ATTACKER)).toBe(true);
      expect(plan.sequence.some((s) => s.action === 'screenShake')).toBe(false);
      expect(plan.sequence.some((s) => s.action === 'projectile')).toBe(false);
    });
  });
});

describe('a half-wired style is reported rather than played', () => {
  const narrative = (extra = []) => [
    { track: 'attacker', action: 'actor', role: ROLE.ATTACKER, name: 'cast', start: 0 },
    {
      track: 'defenders', action: 'actor', role: ROLE.DEFENDER, target: 'all',
      name: 'lookUp', start: 200, actions: null,
    },
    reveal(500, {
      transition: REVEAL_TRANSITION.RADIAL,
      origin: REVEAL_ORIGIN.CLAIM_POINT,
    }),
    { track: 'feel', action: 'haptic', start: 520, style: 'light' },
    {
      // Clear of `lookUp`'s scaled duration (ACTOR_SPECS.LOOK_UP.duration is
      // stretched by DRAMA_SCALE, same as every real style's timing).
      track: 'defenders', action: 'actor', role: ROLE.DEFENDER, target: 'all',
      name: 'runLeft', start: 820, actions: null,
    },
    { track: 'victory', action: 'victory', start: 880 },
    ...extra,
  ];
  const metadata = {
    encounterMode: ENCOUNTER_MODE.TERRITORY_ONLY,
    usesProjectile: false,
    usesContact: false,
    territoryTransition: REVEAL_TRANSITION.RADIAL,
    revealOrigin: REVEAL_ORIGIN.CLAIM_POINT,
  };

  test('a missing effect is an error and an optional one is not', () => {
    expect(validateCaptureStyle({
      id: 'broken', duration: 1600, ...metadata,
      // Built through `effect()` so it carries `track: 'effect'` — the
      // validator only inspects that track, and a bare object slips past it.
      sequence: narrative([effect(100, 'not-registered')]),
    })).toEqual(expect.arrayContaining([expect.stringContaining('missing effect')]));

    expect(validateCaptureStyle({
      id: 'optional', duration: 1600, ...metadata,
      sequence: narrative([effect(100, 'not-registered', { optional: true })]),
    })).toEqual([]);
  });

  test('a style with nothing for the rivals to do fails', () => {
    const withoutDefenders = narrative().filter((s) => s.role !== ROLE.DEFENDER);
    expect(validateCaptureStyle({
      id: 'lonely', duration: 1600, ...metadata, sequence: withoutDefenders,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('no defender choreography'),
    ]));
  });
});
