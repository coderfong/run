// The claim choreography pack, held to its own contract.
//
// `validateChoreography` states the rules a style must satisfy to be playable
// — one reveal, one haptic, known actions, no two actor beats overlapping. The
// archetypes build every style in the pack, so a rule broken there is broken
// fifteen times over and shows up as a celebration that silently skips a beat.

import {
  ARCHETYPE_IDS,
  choreographyProfile,
  choreographySignature,
  validateChoreography,
} from '../src/effects/choreography';
import { CAPTURE_STYLES } from '../src/effects/captureStyles';

describe('every capture style is playable', () => {
  test.each(CAPTURE_STYLES.map((s) => [s.id, s]))('%s satisfies the contract', (id, style) => {
    expect(validateChoreography(style)).toEqual([]);
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

  test('each archetype is used exactly once', () => {
    const used = CAPTURE_STYLES.map((s) => s.archetype);
    expect(new Set(used).size).toBe(used.length);
    for (const archetype of used) expect(ARCHETYPE_IDS).toContain(archetype);
  });

  test('the runner actually does something in most of them', () => {
    // The point of the rework: the claim is something the runner DOES, not a
    // sprite that happens near them.
    const acting = CAPTURE_STYLES.filter((s) => choreographyProfile(s).actors.length > 0);
    expect(acting.length).toBeGreaterThanOrEqual(CAPTURE_STYLES.length - 2);
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
