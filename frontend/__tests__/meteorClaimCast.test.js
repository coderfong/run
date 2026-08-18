// Meteor Claim, the reference cutscene, against every cast size it can be
// played at.
//
// This is the file that pins the behaviour the whole rework is about. The old
// system could not have passed it: rivals were mounted by a collision that ran
// before the style, thrown off screen by it, and unmounted before the meteor
// existed — so "are the defenders still on screen when the meteor lands" had
// the answer "there were never any defenders in this style".
//
// What is asserted here for 0, 1, 2 and 3 rivals:
//
//   * the sequence is valid at that size
//   * every rival that was returned has choreography
//   * they are still mounted when the meteor lands, and are displaced BY it
//   * they leave only on their own exit beat, after the ground has turned over
//   * nobody is asked to do two things at once
//   * empty ground plays the same style with the defender track simply absent

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CaptureStylePlayer from '../src/effects/CaptureStylePlayer';
import {
  ACTION,
  DRAMA_SCALE,
  ROLE,
  actorActionSpec,
  expandCast,
  isExitAction,
  timelineFor,
  validateChoreography,
} from '../src/effects/choreography';
import { getCaptureStyle } from '../src/effects/captureStyles';

jest.mock('../src/effects/EffectPlayer', () => () => null);
jest.mock('../src/effects/ReactionEffect', () => () => null);
jest.mock('../src/effects/EnvironmentLayer', () => () => null);

const METEOR = getCaptureStyle('meteor_claim');
const CAST_SIZES = [0, 1, 2, 3];

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

// A stand-in cast: enough for the player to address, laid out in a line.
const rectsFor = (count) => Array.from({ length: count }, (_, i) => ({
  x: 140 + i * 50, y: 300, width: 44, height: 44,
}));

const expandFor = (count) => expandCast(METEOR.sequence, {
  defenderCount: count, seed: `meteor-cast-${count}`,
});

const defenderBeats = (steps) =>
  steps.filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER);

const isExitStep = (step) =>
  step.exit || (step.actions || [step.name]).every((name) => isExitAction(name));

describe.each(CAST_SIZES)('Meteor Claim against %i defenders', (count) => {
  const expanded = expandFor(count);
  const impact = METEOR.sequence.find((s) => s.action === 'haptic').start;
  const ground = METEOR.sequence.find((s) => s.action === 'territoryReveal').start;

  test('produces a valid sequence', () => {
    expect(validateChoreography(METEOR)).toEqual([]);
    expect(expanded.length).toBeGreaterThan(0);
    // Sorted, and nothing scheduled past the style's own end.
    expanded.forEach((step, i) => {
      if (i) expect(step.start).toBeGreaterThanOrEqual(expanded[i - 1].start);
      expect(step.start).toBeLessThanOrEqual(METEOR.duration);
    });
  });

  test('every returned defender has choreography', () => {
    const busy = new Set(defenderBeats(expanded).map((s) => s.index));
    expect([...busy].sort((a, b) => a - b)).toEqual(
      Array.from({ length: count }, (_, i) => i)
    );
  });

  if (count === 0) {
    test('empty ground plays the same style with no rivals in it', () => {
      expect(defenderBeats(expanded)).toHaveLength(0);
      // The meteor still falls, the ground still changes hands, the runner
      // still wins. It is one authored style, not two.
      expect(expanded.some((s) => s.action === 'projectile')).toBe(true);
      expect(expanded.some((s) => s.action === 'territoryReveal')).toBe(true);
      expect(expanded.some((s) => s.action === 'victory')).toBe(true);
    });
  } else {
    test('they are still on screen when the meteor lands', () => {
      // Nothing may take a rival off the scene before the impact. Their exit
      // has to be caused by the event, which means it comes after it.
      defenderBeats(expanded).filter(isExitStep).forEach((step) => {
        expect(step.start).toBeGreaterThan(impact);
        expect(step.start).toBeGreaterThan(ground);
      });
    });

    test('they look up before it lands and are thrown off it afterwards', () => {
      const beats = defenderBeats(expanded);
      const noticed = beats.filter((s) => s.name === ACTION.LOOK_UP);
      expect(noticed).toHaveLength(count);
      noticed.forEach((s) => expect(s.start).toBeLessThan(impact));

      const thrown = beats.filter((s) => s.name === ACTION.SHOCKWAVE_KNOCKBACK);
      expect(thrown).toHaveLength(count);
      thrown.forEach((s) => {
        expect(s.start).toBeGreaterThanOrEqual(impact);
        // Away from the crater that actually formed, not a fixed direction.
        expect(s.from).toBe('territoryVisualCenter');
      });
    });

    test('each defender stays mounted until their own exit beat', () => {
      for (let index = 0; index < count; index += 1) {
        const line = timelineFor(expanded, ROLE.DEFENDER, index);
        expect(line.length).toBeGreaterThanOrEqual(3);
        const exits = line.filter(isExitStep);
        expect(exits).toHaveLength(1);
        // The exit is the LAST thing they do. Anything scheduled after it
        // would be a beat played by somebody who has already left.
        expect(line[line.length - 1]).toBe(exits[0]);
      }
    });

    test('they do not all leave the same way', () => {
      // MOVED FROM THE NOTICE BEAT TO THE EXIT BEAT, deliberately.
      //
      // This used to check the scatter that ran while the meteor was falling,
      // where three rivals dodged left, braced and ducked from a seeded pool.
      // That variety was in the wrong place: there is one right answer to a
      // rock falling out of the sky, and everybody looking up at it together is
      // a clearer read than one of them glancing sideways. The notice beat is
      // uniform now.
      //
      // Where a seeded pool genuinely earns its keep is the exit — three people
      // running off in three directions is a rout, three people running off in
      // formation is a chorus line. Checked across seeds rather than on one,
      // since any single claim may legitimately land on a repeat.
      if (count < 2) return;
      const exitWindow = expandCast(METEOR.sequence, { defenderCount: count, seed: 'shape' })
        .filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER && isExitStep(s));
      expect(exitWindow.length).toBe(count);

      const distinct = Array.from({ length: 25 }, (_, i) => {
        const beats = expandCast(METEOR.sequence, { defenderCount: count, seed: `c${i}` })
          .filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER && isExitStep(s));
        return new Set(beats.map((s) => s.name)).size;
      });
      expect(distinct.some((n) => n > 1)).toBe(true);
    });

    test('nobody is asked to do two things at once', () => {
      for (let index = 0; index < count; index += 1) {
        const line = timelineFor(expanded, ROLE.DEFENDER, index);
        line.forEach((step, i) => {
          const next = line[i + 1];
          if (!next) return;
          const spec = actorActionSpec(step.name);
          if (step.hold || spec.hold) return;
          expect(next.start).toBeGreaterThanOrEqual(
            step.start + (step.duration || spec.duration) - 1
          );
        });
      }
    });
  }

  test('the player drives that many bodies and still cues the ground once', () => {
    jest.useFakeTimers();
    const played = [];
    const cast = { current: { play: (step) => played.push(step), reset: jest.fn() } };
    const onTerritoryReveal = jest.fn();
    const onComplete = jest.fn();
    let tree;

    act(() => {
      tree = renderer.create(
        <CaptureStylePlayer
          {...common}
          style="meteor_claim"
          defenderCount={count}
          defenderRects={rectsFor(count)}
          seed={`meteor-cast-${count}`}
          cast={cast}
          onTerritoryReveal={onTerritoryReveal}
          onComplete={onComplete}
        />
      );
    });
    act(() => jest.advanceTimersByTime(METEOR.duration + 200));

    const toDefenders = played.filter((s) => s.role === ROLE.DEFENDER);
    expect(new Set(toDefenders.map((s) => s.index)).size).toBe(count);
    // Directional beats reach the actor with a RESOLVED point, so the body
    // can work out its own displacement vector.
    toDefenders
      .filter((s) => s.name === ACTION.SHOCKWAVE_KNOCKBACK)
      .forEach((s) => {
        expect(s.originPoint).toEqual(
          expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
        );
      });
    expect(onTerritoryReveal).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    // A meteor never asks for contact, whoever is standing there.
    expect(played.some((s) => s.action === 'contact')).toBe(false);

    act(() => tree.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
