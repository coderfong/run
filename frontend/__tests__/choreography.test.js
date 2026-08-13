// The claim choreography pack, held to its own contract.
//
// `validateChoreography` states the rules a style must satisfy to be playable
// — one reveal, one haptic, known actions, no two actor beats overlapping. The
// archetypes build every style in the pack, so a rule broken there is broken
// fifteen times over and shows up as a celebration that silently skips a beat.

import {
  ENCOUNTER_MODE,
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

  test('each style has a distinct scene skeleton', () => {
    const used = CAPTURE_STYLES.map((s) => s.archetype);
    expect(new Set(used).size).toBe(used.length);
  });

  test('only explicit duels opt into collision choreography', () => {
    const duels = CAPTURE_STYLES.filter((s) => s.encounterMode === ENCOUNTER_MODE.DUEL);
    expect(duels.map((s) => s.id).sort()).toEqual(['angel_vs_demon', 'sword_slash']);
    expect(duels.every((s) => s.showAttacker && s.showDefender)).toBe(true);
    expect(CAPTURE_STYLES.some((s) => !s.showAttacker)).toBe(true);
    expect(CAPTURE_STYLES.some((s) => s.showDefender && s.encounterMode !== ENCOUNTER_MODE.DUEL)).toBe(true);
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
