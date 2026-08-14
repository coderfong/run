// The claim choreography pack, held to its own contract.
//
// `validateChoreography` states the rules a style must satisfy to be playable.
// The rules that matter most here are the ones the rework exists to enforce:
// the rivals are in the scene, they react before the ground turns over, they
// leave under their own power, and only a duel is allowed a collision.

import {
  ACTION,
  ENCOUNTER_MODE,
  POST_REVEAL_BUDGET,
  ROLE,
  actorActionSpec,
  choreographyProfile,
  choreographySignature,
  expandCast,
  isExitAction,
  timelineFor,
  validateChoreography,
} from '../src/effects/choreography';
import { CAPTURE_STYLES, getCaptureStyle } from '../src/effects/captureStyles';
import { HAPTIC_STYLES } from '../src/theme/haptics';

const CAST_SIZES = [0, 1, 2, 3];

const defenderStepsOf = (style) =>
  style.sequence.filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER);

const isExitStep = (step) =>
  step.exit || (step.actions || [step.name]).every((name) => isExitAction(name));

describe('every capture style is playable', () => {
  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))('%s satisfies the contract', (id, style) => {
    expect(validateChoreography(style)).toEqual([]);
  });
});

describe('the rivals are in the scene', () => {
  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))(
    '%s gives the defenders something to do before and after the takeover',
    (id, style) => {
      const steps = defenderStepsOf(style);
      const ground = style.sequence.find((s) => s.action === 'territoryReveal');
      expect(steps.length).toBeGreaterThan(0);
      // React BEFORE: without this the event is a cutaway rather than
      // something happening to somebody.
      expect(steps.some((s) => s.start < ground.start)).toBe(true);
      // And leave afterwards, rather than being deleted by the system.
      expect(steps.some(isExitStep)).toBe(true);
      expect(steps.filter(isExitStep).every((s) => s.start > 0)).toBe(true);
    }
  );

  test('no style needs a collision to involve the people it is taking ground from', () => {
    const withContact = CAPTURE_STYLES.filter((s) => s.usesContact);
    // Exactly two styles are about a clash. The other twenty-eight involve
    // their rivals through the event itself.
    expect(withContact.map((s) => s.id).sort()).toEqual(['angel_vs_demon', 'sword_slash']);
    expect(withContact.every((s) => s.encounterMode === ENCOUNTER_MODE.DUEL)).toBe(true);
  });

  test.each(['meteor_claim', 'paint_bomb', 'black_hole', 'dragon_sweep', 'neon_grid_hack'])(
    '%s never opens with a generic bump',
    (id) => {
      const style = getCaptureStyle(id);
      expect(style.usesContact).toBe(false);
      expect(style.sequence.some((s) => s.action === 'contact')).toBe(false);
      // The first thing that happens to a rival in these styles is a reaction
      // to something in the world, never a shove from the attacker.
      const firstDefenderBeat = defenderStepsOf(style)[0];
      const pool = firstDefenderBeat.actions || [firstDefenderBeat.name];
      pool.forEach((name) => {
        expect(actorActionSpec(name).exit).toBeFalsy();
      });
      expect(pool.some((name) => [
        ACTION.LOOK_UP, ACTION.NOTICE, ACTION.SURPRISED, ACTION.LOOK_LEFT, ACTION.LOOK_RIGHT,
      ].includes(name))).toBe(true);
    }
  );

  test('an environmental style cannot smuggle a collision in', () => {
    const environmental = CAPTURE_STYLES.find((s) => s.id === 'meteor_claim');
    const broken = {
      ...environmental,
      usesContact: true,
      sequence: [...environmental.sequence, { track: 'attacker', action: 'contact', start: 300, variant: 'bonk' }],
    };
    expect(validateChoreography(broken)).toEqual(
      expect.arrayContaining([expect.stringContaining('only a duel may use direct contact')])
    );
  });
});

describe('the cast is resolved against the real claim', () => {
  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))(
    '%s mounts every defender at 1, 2 and 3',
    (id, style) => {
      [1, 2, 3].forEach((count) => {
        const expanded = expandCast(style.sequence, { defenderCount: count, seed: id });
        const busy = new Set(
          expanded.filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER).map((s) => s.index)
        );
        expect([...busy].sort()).toEqual(Array.from({ length: count }, (_, i) => i));
      });
    }
  );

  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))(
    '%s drops every defender beat when the ground was empty',
    (id, style) => {
      const expanded = expandCast(style.sequence, { defenderCount: 0, seed: id });
      expect(expanded.some((s) => s.action === 'actor' && s.role === ROLE.DEFENDER)).toBe(false);
      // Everything else survives: the same authored style is the empty-ground
      // choreography, not a second one.
      expect(expanded.some((s) => s.action === 'territoryReveal')).toBe(true);
      expect(expanded.some((s) => s.action === 'actor' && s.role === ROLE.ATTACKER)).toBe(true);
      expect(expanded.some((s) => s.action === 'victory')).toBe(true);
    }
  );

  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))(
    '%s never asks one body to do two things at once',
    (id, style) => {
      CAST_SIZES.forEach((count) => {
        const expanded = expandCast(style.sequence, { defenderCount: count, seed: id });
        const bodies = [
          [ROLE.ATTACKER, 0],
          ...Array.from({ length: count }, (_, i) => [ROLE.DEFENDER, i]),
        ];
        bodies.forEach(([role, index]) => {
          const line = timelineFor(expanded, role, index);
          line.forEach((step, i) => {
            const next = line[i + 1];
            if (!next) return;
            const spec = actorActionSpec(step.name);
            if (step.hold || spec.hold) return;
            const ends = step.start + (step.duration || spec.duration);
            expect(next.start).toBeGreaterThanOrEqual(ends - 1);
          });
        });
      });
    }
  );

  test('the same claim always produces the same reactions, and different claims do not', () => {
    const style = getCaptureStyle('meteor_claim');
    const read = (seed) => expandCast(style.sequence, { defenderCount: 3, seed })
      .filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER)
      .map((s) => `${s.index}:${s.name}`)
      .join(',');

    const once = read('territory-abc');
    for (let i = 0; i < 10; i += 1) expect(read('territory-abc')).toBe(once);

    const others = new Set(
      Array.from({ length: 40 }, (_, i) => read(`territory-${i}`))
    );
    expect(others.size).toBeGreaterThan(1);
  });

  test('one event produces several different reactions rather than a chorus line', () => {
    // The regression this guards is three people all dodging left. Across a
    // spread of claims a scatter beat has to actually spread.
    const style = getCaptureStyle('meteor_claim');
    const scatterStart = style.sequence.find(
      (s) => s.action === 'actor' && s.role === ROLE.DEFENDER && s.actions
    ).start;
    const varied = Array.from({ length: 30 }, (_, i) => {
      const picks = expandCast(style.sequence, { defenderCount: 3, seed: `claim-${i}` })
        .filter((s) => s.action === 'actor' && s.role === ROLE.DEFENDER && s.start >= scatterStart
          && s.start < scatterStart + 300)
        .map((s) => s.name);
      return new Set(picks).size;
    });
    expect(varied.some((distinct) => distinct > 1)).toBe(true);
  });
});

describe('the narrative shape', () => {
  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))(
    '%s runs attacker initiates → reveal → victory, in that order',
    (id, style) => {
      const first = (action) => style.sequence.find((s) => s.action === action);
      const ground = first('territoryReveal');
      const win = first('victory');
      const opener = style.sequence.find((s) => s.action === 'actor' && s.role === ROLE.ATTACKER);
      expect(opener.start).toBeLessThan(ground.start);
      expect(win.start).toBeGreaterThan(ground.start);
    }
  );

  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))(
    '%s finishes inside the window the controller keeps it mounted for',
    (id, style) => {
      // The style is unmounted at the handoff to the permanent Mapbox layer.
      // Anything scheduled past that is a beat nobody sees — which for these
      // styles means rivals frozen mid-retreat.
      const ground = style.sequence.find((s) => s.action === 'territoryReveal');
      expect(style.duration - ground.start).toBeLessThanOrEqual(POST_REVEAL_BUDGET);
      expect(style.sequence.every((s) => s.start <= style.duration)).toBe(true);
    }
  );

  test('an unknown haptic fails validation instead of silently feeling like nothing', () => {
    // Five styles shipped asking for a 'heavy' that did not exist. `haptic[x]?.()`
    // made it a no-op, so their climax had no feel at all and nothing failed.
    const style = getCaptureStyle('meteor_claim');
    const broken = {
      ...style,
      sequence: style.sequence.map((s) => (s.action === 'haptic' ? { ...s, style: 'earthquake' } : s)),
    };
    expect(validateChoreography(broken)).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown haptic style earthquake')])
    );
  });

  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))('%s asks only for haptics that exist', (id, style) => {
    style.sequence
      .filter((s) => s.action === 'haptic')
      .forEach((s) => expect(HAPTIC_STYLES).toContain(s.style));
  });

  test('a directional beat must say what it is directional about', () => {
    const style = getCaptureStyle('meteor_claim');
    const broken = {
      ...style,
      sequence: style.sequence.map((s) => (
        s.name === ACTION.SHOCKWAVE_KNOCKBACK ? { ...s, from: undefined } : s
      )),
    };
    // Without an origin every rival would be blown the same way regardless of
    // where the crater is, which is the tell that nothing really happened.
    expect(validateChoreography(broken)).toEqual(
      expect.arrayContaining([expect.stringContaining('directional but names no origin')])
    );
  });
});

describe('every capture style is its own animation', () => {
  test('no two styles share a choreography signature', () => {
    const seen = new Map();
    for (const style of CAPTURE_STYLES) {
      const signature = choreographySignature(style);
      expect(signature).not.toBe('');
      expect(seen.has(signature)).toBe(false);
      seen.set(signature, style.id);
    }
  });

  test('each style has a distinct scene skeleton', () => {
    const used = CAPTURE_STYLES.map((s) => s.archetype);
    expect(new Set(used).size).toBe(used.length);
  });

  test('the world does the work in most of them, not the sprite sheet', () => {
    // The point of the environment track: shadows, cracks, sweeps and dust
    // carry the narrative without adding art. If this drops, the pack has
    // drifted back toward stacking particles.
    const withWorld = CAPTURE_STYLES.filter((s) => s.usesEnvironment);
    expect(withWorld.length).toBeGreaterThanOrEqual(Math.floor(CAPTURE_STYLES.length * 0.75));
  });

  test('some styles hand the ground over before the impact and some after', () => {
    const order = CAPTURE_STYLES.map((s) => choreographyProfile(s).revealsBeforeImpact);
    expect(new Set(order)).toEqual(new Set([true, false]));
  });

  test('something travels in at least a third of them', () => {
    // A projectile is what makes a throw a throw; without one a strike from the
    // sky is two unrelated flashes.
    const flying = CAPTURE_STYLES.filter((s) => choreographyProfile(s).flights > 0);
    expect(flying.length).toBeGreaterThanOrEqual(Math.floor(CAPTURE_STYLES.length / 3));
  });
});
