// What the choreography rework actually guarantees, at runtime.
//
// The rules themselves are authored in choreography.js and checked against the
// whole pack in choreography.test.js. This file checks the PLAYER honours them
// on a real tree — every one of these is a regression that shipped, and every
// one of them is a thing a viewer directly complained about:
//
//   * sprites that outlived their beat and were still on screen three beats
//     later, because the player only set a cleanup timer when a step happened
//     to declare a duration and almost none did
//   * two or three unrelated sprites on screen at once, because the cap was
//     three with oldest-first eviction rather than one hero and one consequence
//   * art that accumulated across replays
//   * the ground changing hands behind an opaque black curtain

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CaptureStylePlayer, { spriteSpeedForWindow } from '../src/effects/CaptureStylePlayer';
import { CAPTURE_STYLES, getCaptureStyle } from '../src/effects/captureStyles';
import { EFFECT_SLOT, isCausalAnchor } from '../src/effects/choreography';
import { CAPTURE_LAYER } from '../src/effects/layers';
import { getEffect } from '../src/effects/effectRegistry';

jest.mock('../src/effects/EffectPlayer', () => () => null);
jest.mock('../src/effects/ReactionEffect', () => () => null);
// Renders, rather than returning null, so the stacking contract below is
// something this file can actually observe instead of assume.
jest.mock('../src/effects/EnvironmentLayer', () => {
  const { View } = require('react-native');
  const React2 = require('react');
  return function MockEnvironmentLayer({ items = [], air }) {
    if (!items.length) return null;
    return React2.createElement(View, {
      testID: air ? 'env-air' : 'env-ground',
      style: { zIndex: air ? 45 : 22 },
    });
  };
});

const bounds = { width: 390, height: 620 };
const common = {
  bounds,
  territoryRings: [[
    { x: 60, y: 160 }, { x: 340, y: 160 }, { x: 340, y: 560 }, { x: 60, y: 560 },
  ]],
  claimPoint: { x: 195, y: 350 },
  safeInsets: { top: 120, right: 20, bottom: 24, left: 20 },
};

const spritesOf = (style) => style.sequence.filter(
  (step) => step.track === 'effect' && step.action !== 'projectile'
);

describe('a sprite cannot outlive the beat that fired it', () => {
  test('every sprite in the pack declares the window it may occupy', () => {
    CAPTURE_STYLES.forEach((style) => {
      spritesOf(style).forEach((step) => {
        expect(step.hold).toBeGreaterThan(0);
        // Half a second is already most of a beat at this pace. Anything much
        // longer is a sprite that will still be playing over the next one.
        expect(step.hold).toBeLessThanOrEqual(800);
      });
    });
  });

  test('playback is derived so the art fits its window rather than the sheet', () => {
    // The concrete regression: `magic_spell_01` is 81 frames at 30fps, so it
    // runs 2.7 seconds at its natural pace. A style asking for it inside a
    // 500ms beat used to get all 2.7 seconds of it, straight over the impact,
    // the reveal and the exit.
    const long = getEffect('magic_spell_01');
    expect(long.frameCount / long.fps).toBeGreaterThan(2);
    expect(spriteSpeedForWindow(long, 500)).toBeGreaterThan(1.5);

    // ...and the other direction: a short sheet in a long window is slowed
    // rather than left holding a dead frame.
    const short = getEffect('impact_shock_01');
    expect(spriteSpeedForWindow(short, 500)).toBeLessThan(1.2);

    // Neither is pushed past the point where the art stops reading as itself.
    CAPTURE_STYLES.forEach((style) => {
      spritesOf(style).forEach((step) => {
        const spec = getEffect(step.effect);
        if (!spec) return; // optional, licence-gated art
        const speed = spriteSpeedForWindow(spec, step.hold);
        expect(speed).toBeGreaterThanOrEqual(0.7);
        expect(speed).toBeLessThanOrEqual(2.4);
      });
    });
  });

  test('a sprite is removed at the end of its window even if its sheet is longer', () => {
    jest.useFakeTimers();
    const style = getCaptureStyle('meteor_claim');
    const impact = style.sequence.find((s) => s.action === 'haptic');
    const hero = spritesOf(style).find((s) => s.start === impact.start);
    expect(hero).toBeTruthy();

    // `warm_explosion_01` is 750ms of sheet inside a 520ms window, so under the
    // old "remove when the art says it is finished" behaviour it would still be
    // on screen when the ground started turning over.
    const spec = getEffect(hero.effect);
    expect((spec.frameCount / spec.fps) * 1000).toBeGreaterThan(hero.hold);

    let tree;
    act(() => {
      tree = renderer.create(<CaptureStylePlayer {...common} style="meteor_claim" />);
    });
    // Host nodes only. react-test-renderer surfaces both the composite element
    // and the host instance it renders to, so an unfiltered findAll counts
    // every sprite twice and the assertion below would be off by a factor.
    const sprites = () => tree.root.findAll(
      (node) => typeof node.type === 'string'
        && typeof node.props.testID === 'string'
        && node.props.testID.startsWith('capture-sprite:')
    );

    act(() => jest.advanceTimersByTime(hero.start + 10));
    expect(sprites().length).toBe(1);

    // One frame before the window closes it is still there...
    act(() => jest.advanceTimersByTime(hero.hold - 40));
    expect(sprites().length).toBe(1);
    // ...and one frame after, it is gone, on the player's own timer rather than
    // on whatever the sprite sheet felt like doing.
    act(() => jest.advanceTimersByTime(60));
    expect(sprites().length).toBe(0);

    act(() => tree.unmount());
    jest.useRealTimers();
  });
});

describe('one thing is happening at a time', () => {
  test('no two sprites in a style share a slot at the same moment', () => {
    CAPTURE_STYLES.forEach((style) => {
      const bySlot = {};
      spritesOf(style).forEach((step) => {
        const slot = step.slot || EFFECT_SLOT.HERO;
        (bySlot[slot] = bySlot[slot] || []).push(step);
      });
      Object.entries(bySlot).forEach(([slot, steps]) => {
        steps.sort((a, b) => a.start - b.start).forEach((step, i) => {
          const next = steps[i + 1];
          if (!next) return;
          expect(`${style.id}:${slot}:${next.start}`)
            .toBe(`${style.id}:${slot}:${Math.max(next.start, step.start + step.hold)}`);
        });
      });
    });
  });

  test('at most one hero and one consequence are ever live together', () => {
    CAPTURE_STYLES.forEach((style) => {
      const events = [];
      spritesOf(style).forEach((step) => {
        events.push({ at: step.start, delta: 1 });
        events.push({ at: step.start + step.hold, delta: -1 });
      });
      events.sort((a, b) => (a.at - b.at) || (a.delta - b.delta));
      let live = 0;
      events.forEach((e) => {
        live += e.delta;
        expect(live).toBeLessThanOrEqual(2);
      });
    });
  });
});

describe('every piece of art belongs to something', () => {
  test('no sprite is placed at a point chosen by a hash', () => {
    // `randomTerritoryPoint` was the anchor for one decorative sprite in
    // eighteen of the thirty-eight styles, nearly always fired AFTER the
    // impact. It is not a legal effect anchor any more: art that cannot say
    // what put it there is the definition of a particle with no purpose.
    CAPTURE_STYLES.forEach((style) => {
      spritesOf(style).forEach((step) => {
        expect(step.anchor).not.toBe('randomTerritoryPoint');
        expect(isCausalAnchor(step.anchor)).toBe(true);
      });
    });
  });

  test('nothing is fired over the top of the ground changing hands', () => {
    CAPTURE_STYLES.forEach((style) => {
      const ground = style.sequence.find((s) => s.action === 'territoryReveal');
      const ends = ground.start + ground.duration;
      spritesOf(style).forEach((step) => {
        expect(step.start).toBeLessThan(ends);
      });
    });
  });
});

describe('the map is the stage, not a curtain', () => {
  test('the scrim is under the reveal, so the takeover is visible while it happens', () => {
    // The regression this replaces: an opaque black backdrop at zIndex 24, over
    // a reveal at 20, lifted only once a defender started leaving. The single
    // beat the whole sequence exists to deliver played behind it.
    expect(CAPTURE_LAYER.MAP_SCRIM).toBeLessThan(CAPTURE_LAYER.TERRITORY_REVEAL);
  });

  test('ground-level world sits under the cast and air-level over it', () => {
    expect(CAPTURE_LAYER.ENVIRONMENT_GROUND).toBeLessThan(CAPTURE_LAYER.CHARACTER);
    expect(CAPTURE_LAYER.ENVIRONMENT_AIR).toBeGreaterThan(CAPTURE_LAYER.CHARACTER);
  });

  test('the player renders its layers as siblings, not inside one stacking context', () => {
    // A parent zIndex opens a stacking context, so the old single wrapper
    // carrying FOREGROUND_FX (40) made every child paint at 40 regardless of
    // its own zIndex — which is how a shadow "cast on the ground" ended up
    // drawn over the face of the person standing in it, and why the ground
    // track's documented 22 was a lie for as long as it existed.
    jest.useFakeTimers();
    const style = getCaptureStyle('meteor_claim');
    // Far enough in that the shadow, the hero sprite and the dust are all live.
    const impact = style.sequence.find((s) => s.action === 'haptic');

    let tree;
    act(() => {
      tree = renderer.create(<CaptureStylePlayer {...common} style="meteor_claim" />);
    });
    act(() => jest.advanceTimersByTime(impact.start + 120));

    const ground = tree.root.findAllByProps({ testID: 'env-ground' })[0];
    expect(ground).toBeTruthy();

    // The ground layer must NOT be inside anything carrying FOREGROUND_FX.
    const enclosing = [];
    for (let node = ground.parent; node; node = node.parent) {
      const flat = [].concat(node.props?.style || []).filter(Boolean);
      flat.forEach((entry) => {
        if (entry && typeof entry === 'object' && entry.zIndex != null) enclosing.push(entry.zIndex);
      });
    }
    expect(enclosing).not.toContain(CAPTURE_LAYER.FOREGROUND_FX);

    act(() => tree.unmount());
    jest.useRealTimers();
  });
});

describe('replaying does not accumulate', () => {
  test('twenty replays leave nothing behind and complete exactly twenty times', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    const style = getCaptureStyle('meteor_claim');
    let tree;
    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer {...common} style="meteor_claim" playToken={0} onComplete={onComplete} />
      );
    });
    for (let i = 1; i <= 20; i += 1) {
      act(() => jest.advanceTimersByTime(style.duration + 40));
      act(() => {
        tree.update(
          <CaptureStylePlayer {...common} style="meteor_claim" playToken={i} onComplete={onComplete} />
        );
      });
    }
    act(() => jest.advanceTimersByTime(style.duration + 40));
    expect(onComplete).toHaveBeenCalledTimes(21);
    // Everything scheduled by every one of those runs has been cancelled or
    // fired; nothing is still pending.
    expect(jest.getTimerCount()).toBe(0);
    act(() => tree.unmount());
    jest.useRealTimers();
  });

  test('slow motion stretches the schedule without changing what happens', () => {
    jest.useFakeTimers();
    const style = getCaptureStyle('meteor_claim');
    const normal = [];
    const slowed = [];
    let a;
    let b;
    act(() => {
      a = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="meteor_claim"
          cast={{ current: { play: (s) => normal.push(s.name), reset: jest.fn() } }}
        />
      );
    });
    act(() => jest.advanceTimersByTime(style.duration + 100));
    act(() => a.unmount());

    act(() => {
      b = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="meteor_claim"
          timeScale={4}
          cast={{ current: { play: (s) => slowed.push(s.name), reset: jest.fn() } }}
        />
      );
    });
    // A quarter of the way through the stretched schedule is the whole scene.
    act(() => jest.advanceTimersByTime(style.duration * 4 + 400));
    act(() => b.unmount());

    expect(slowed).toEqual(normal);
    expect(normal.length).toBeGreaterThan(0);
    jest.useRealTimers();
  });
});
