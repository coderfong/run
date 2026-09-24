/**
 * The capture cutscenes change a runner's expression by swapping in a face
 * from the catalogue (src/components/claim/expressions.js). A face id that is
 * not in the catalogue falls back to the default face without any error, so
 * this is the check that catches a face deleted in the Fit Studio. Hiding a
 * face is fine: hidden items still resolve.
 */

import { ITEMS } from '../src/config/cosmetics';
import { FACE, attackerFace, defenderFace, faceForAction } from '../src/components/claim/expressions';

const faces = new Set(ITEMS.face.map((f) => f.id));

it('uses only faces that exist in the catalogue', () => {
  const missing = Object.entries(FACE).filter(([, id]) => !faces.has(id));
  expect(missing).toEqual([]);
});

it('maps every beat and action to a named expression', () => {
  const keys = [
    ...['intro', 'attack', 'victory'].flatMap((beat) => ['chomp', 'bonk', 'zap'].map((v) => attackerFace(v, beat))),
    defenderFace('chomp', 'impact'),
    defenderFace('bonk', 'impact'),
    ...['knockback', 'notice', 'celebrate', 'portalExit', 'wince', 'throw'].map(faceForAction),
  ];
  for (const key of keys) expect([key, FACE[key]]).toEqual([key, expect.any(String)]);
});

it('makes the hit read as a change of face for the attacker', () => {
  expect(FACE[attackerFace('bonk', 'attack')]).not.toBe(FACE[attackerFace('bonk', 'intro')]);
  expect(FACE[attackerFace('chomp', 'attack')]).not.toBe(FACE[attackerFace('chomp', 'intro')]);
});
