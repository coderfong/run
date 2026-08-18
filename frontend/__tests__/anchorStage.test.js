// The "capture animation plays in the top-left corner" regression.
//
// Every anchor is clamped into the stage's safe rect. When the stage had no
// size — ResultScreen measures its map into state that used to start null —
// the safe rect was zero by zero and the clamp sent every point to (0, 0).
import { layoutDefenders, resolveEffectAnchor, territoryVisualCenter } from '../src/effects/anchors';

// A square of ground in the middle of a 390x800 stage.
const RINGS = [[
  { x: 120, y: 300 }, { x: 270, y: 300 }, { x: 270, y: 450 }, { x: 120, y: 450 },
]];
const CLAIM = { x: 195, y: 375 };

const atOrigin = (p) => p.x === 0 && p.y === 0;

describe('anchors with no measured stage', () => {
  const missing = [undefined, null, {}, { width: 0, height: 0 }];

  test.each(missing)('screenCenter does not collapse to the corner (%p)', (bounds) => {
    const point = resolveEffectAnchor('screenCenter', { bounds, claimPoint: CLAIM });
    expect(atOrigin(point)).toBe(false);
    expect(point.x).toBeGreaterThan(1);
    expect(point.y).toBeGreaterThan(1);
  });

  test.each(missing)('a real claim point survives the clamp (%p)', (bounds) => {
    const point = resolveEffectAnchor('characterCenter', {
      bounds,
      claimPoint: CLAIM,
      territoryRings: RINGS,
      characterRect: { x: 166, y: 346, width: 58, height: 58 },
    });
    expect(atOrigin(point)).toBe(false);
    // It is the character's own centre, not a corner and not the screen middle.
    expect(point.x).toBeCloseTo(195, 0);
    expect(point.y).toBeCloseTo(375, 0);
  });

  test('defenders are laid out on the ground, not stacked in the corner', () => {
    const rects = layoutDefenders(3, { bounds: null, claimPoint: CLAIM, territoryRings: RINGS }, 'seed', 40);
    expect(rects).toHaveLength(3);
    rects.forEach((rect) => {
      expect(atOrigin({ x: rect.x, y: rect.y })).toBe(false);
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.y).toBeGreaterThan(0);
    });
  });

  test('the territory visual centre stays inside the territory', () => {
    const point = territoryVisualCenter(RINGS, null, undefined, CLAIM);
    expect(point.x).toBeGreaterThanOrEqual(120);
    expect(point.x).toBeLessThanOrEqual(270);
    expect(point.y).toBeGreaterThanOrEqual(300);
    expect(point.y).toBeLessThanOrEqual(450);
  });
});

describe('anchors with a measured stage are unchanged', () => {
  const bounds = { width: 390, height: 800 };

  test('screenCenter is the middle of the box it was given', () => {
    const point = resolveEffectAnchor('screenCenter', { bounds, claimPoint: CLAIM });
    expect(point.x).toBeCloseTo(195, 0);
    expect(point.y).toBeCloseTo(400, 0);
  });

  test('a point outside the stage is still clamped back inside it', () => {
    const point = resolveEffectAnchor('characterCenter', {
      bounds,
      claimPoint: CLAIM,
      characterRect: { x: 9000, y: 9000, width: 58, height: 58 },
    });
    expect(point.x).toBeLessThanOrEqual(390);
    expect(point.y).toBeLessThanOrEqual(800);
  });
});
