import {
  CAPTURE_STYLES,
  PLAYABLE_CAPTURE_STYLES,
  getCaptureStyle,
  pickCaptureStyle,
} from '../src/effects/captureStyles';
import {
  buildCapturePlan,
  effectIdForCaptureStep,
  validateCaptureStyle,
} from '../src/effects/CaptureStylePlayer';
import {
  buildTerritoryAnchorModel,
  fitEffectInBounds,
  pointInTerritory,
  resolveEffectAnchor,
} from '../src/effects/anchors';
import {
  getAllEffects,
  getEffect,
  getEffectsByCategory,
  getEffectsByTag,
  getEffectsByTags,
  getRandomEffectByTags,
} from '../src/effects/effectRegistry';
import manifest from '../assets/effects/import-manifest.json';
import { STEAL_FX } from '../src/components/TerritoryStealBanner';

// The two Lotties PASER authors itself, which the importer knows nothing about
// and so are not in its manifest count.
const BUILTIN_LOTTIE_COUNT = 2;
import { spriteFrameCoordinates } from '../src/effects/SpriteAnimation';

const BOUNDS = { width: 390, height: 620 };
const SAFE = { top: 120, right: 20, bottom: 24, left: 20 };
const SHAPES = {
  small: [[
    { x: 168, y: 300 }, { x: 220, y: 300 }, { x: 220, y: 348 }, { x: 168, y: 348 },
  ]],
  large: [[
    { x: 28, y: 132 }, { x: 362, y: 132 }, { x: 362, y: 582 }, { x: 28, y: 582 },
  ]],
  longNarrow: [[
    { x: 35, y: 290 }, { x: 360, y: 306 }, { x: 356, y: 352 }, { x: 32, y: 336 },
  ]],
  irregular: [[
    { x: 58, y: 186 }, { x: 314, y: 144 }, { x: 350, y: 282 }, { x: 270, y: 550 },
    { x: 132, y: 500 }, { x: 44, y: 348 },
  ]],
  partlyOffscreen: [[
    { x: 300, y: 190 }, { x: 520, y: 170 }, { x: 520, y: 490 }, { x: 294, y: 470 },
  ]],
  misleadingCentroid: [[
    { x: 40, y: 154 }, { x: 350, y: 154 }, { x: 350, y: 218 }, { x: 112, y: 218 },
    { x: 112, y: 470 }, { x: 350, y: 470 }, { x: 350, y: 544 }, { x: 40, y: 544 },
  ]],
};

describe('PASER release effect registry', () => {
  test('contains only release-approved assets with valid sprite metadata', () => {
    const effects = getAllEffects();
    // Counted off the import manifest rather than written down here. The
    // number moved every time the curated selection grew, and a hand-kept
    // total makes ADDING an approved asset look like a regression — which is
    // exactly backwards, since the thing worth guarding is that nothing
    // UNAPPROVED got in and that the registry matches what was imported.
    expect(effects).toHaveLength(manifest.selectedAssets + BUILTIN_LOTTIE_COUNT);
    expect(manifest.releaseApprovedOnly).toBe(true);
    effects.forEach((effect) => expect(effect.releaseApproved).toBe(true));
    effects.filter((effect) => effect.type === 'sprite').forEach((effect) => {
      expect(effect.frameWidth).toBeGreaterThan(0);
      expect(effect.frameHeight).toBeGreaterThan(0);
      expect(effect.fps).toBeGreaterThan(0);
      expect(effect.frameCount).toBeLessThanOrEqual(effect.columns * effect.rows);
      expect(effect.densityScales).toEqual([1, 2, 3]);
      expect(effect.source).toBeTruthy();
    });
    manifest.effects.forEach((effect) => {
      expect(effect.densityScales).toEqual([1, 2, 3]);
      expect(Object.keys(effect.densityVariants)).toEqual(['2', '3']);
      expect(effect.runtimeBytes).toBeGreaterThan(effect.fileSize);
    });
  });

  test('the steal detonation resolves to imported sprites drawn at whole-pixel steps', () => {
    // The banner sizes its anchors off these frames, so a re-import that drops
    // the pack or changes a grid has to fail here rather than on a phone.
    Object.values(STEAL_FX).forEach(({ id, width, height }) => {
      const spec = getEffect(id);
      expect(spec).toBeTruthy();
      expect(spec.type).toBe('sprite');
      expect(spec.releaseApproved).toBe(true);
      const scale = width / Math.max(spec.frameWidth, spec.frameHeight);
      expect(Math.round(spec.frameHeight * scale)).toBe(height);
      expect(scale * 10 % 1).toBe(0);
    });
  });

  test('supports category, tag, multi-tag and deterministic random queries', () => {
    expect(getEffectsByCategory('lightning').length).toBeGreaterThan(0);
    expect(getEffectsByTag('capture').length).toBeGreaterThan(20);
    expect(getEffectsByTags(['capture', 'electric'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'electric_impact_01' })])
    );
    expect(getRandomEffectByTags(['capture', 'electric'], () => 0)).toBeTruthy();
  });

  test('partial sprite grids clamp before unused cells for arbitrary columns', () => {
    expect(spriteFrameCoordinates(0, 4, 10)).toEqual({ column: 0, row: 0, frame: 0 });
    expect(spriteFrameCoordinates(9, 4, 10)).toEqual({ column: 1, row: 2, frame: 9 });
    expect(spriteFrameCoordinates(10, 4, 10)).toEqual({ column: 1, row: 2, frame: 9 });
    expect(spriteFrameCoordinates(999, 7, 8)).toEqual({ column: 0, row: 1, frame: 7 });
  });
});

describe('all capture styles and territory scenarios', () => {
  test('playable capture openings never enlarge thumbnail-sized artwork', () => {
    PLAYABLE_CAPTURE_STYLES.forEach((style) => {
      const opening = style.sequence.find((step) => !step.action && !step.optional);
      const spec = getEffect(effectIdForCaptureStep(opening));
      expect(Math.max(spec.frameWidth, spec.frameHeight)).toBeGreaterThanOrEqual(64);
      expect(spec.densityScales).toEqual([1, 2, 3]);
    });
  });

  test('all 29 have bounded duration, metadata, one reveal, one primary haptic, and valid required effects', () => {
    expect(CAPTURE_STYLES).toHaveLength(29);
    CAPTURE_STYLES.forEach((style) => {
      expect(getCaptureStyle(style.id)).toBe(style);
      expect(validateCaptureStyle(style)).toEqual([]);
      expect(style.duration).toBeGreaterThanOrEqual(800);
      expect(style.duration).toBeLessThanOrEqual(2400);
      expect(style.sequence.filter((step) => step.action === 'territoryReveal')).toHaveLength(1);
      expect(style.sequence.filter((step) => step.action === 'haptic')).toHaveLength(1);
      expect(style.beats.length).toBeGreaterThanOrEqual(4);
      expect(typeof style.showAttacker).toBe('boolean');
      expect(typeof style.showDefender).toBe('boolean');
      expect(typeof style.usesProjectile).toBe('boolean');
      expect(style.territoryTransition).toBeTruthy();
      expect(style.revealOrigin).toBeTruthy();
    });
  });

  test.each(Object.entries(SHAPES))('%s territory keeps every playable step visible and safely anchored', (_name, rings) => {
    const claimPoint = { x: 195, y: 335 };
    const anchorModel = buildTerritoryAnchorModel({ rings, bounds: BOUNDS, insets: SAFE, preferred: claimPoint });
    [0, 1, 3].forEach((defenderCount) => {
      expect(defenderCount).toBeLessThanOrEqual(3); // encounter cap; FX layout is deliberately defender-independent
      CAPTURE_STYLES.forEach((style) => {
        style.sequence.filter((step) => !step.action).forEach((step, index) => {
          const id = effectIdForCaptureStep(step);
          const spec = id ? getEffect(id) : null;
          if (!spec) {
            expect(step.optional).toBe(true);
            return;
          }
          const anchor = resolveEffectAnchor(step.anchor, {
            bounds: BOUNDS,
            safeInsets: SAFE,
            claimPoint,
            territoryCenter: claimPoint,
            territoryRings: rings,
            anchorModel,
          }, `${style.id}:${index}`);
          if (step.anchor === 'territoryVisualCenter') expect(pointInTerritory(anchor, rings)).toBe(true);
          const extent = (spec.visualScale || 1) + 2 * Math.max(
            Math.abs(spec.visualOffsetX || 0), Math.abs(spec.visualOffsetY || 0)
          );
          const fitted = fitEffectInBounds(anchor, step.size, BOUNDS, SAFE, extent);
          const half = (fitted.size * extent) / 2;
          expect(fitted.anchor.x - half).toBeGreaterThanOrEqual(SAFE.left - 0.001);
          expect(fitted.anchor.x + half).toBeLessThanOrEqual(BOUNDS.width - SAFE.right + 0.001);
          expect(fitted.anchor.y - half).toBeGreaterThanOrEqual(SAFE.top - 0.001);
          expect(fitted.anchor.y + half).toBeLessThanOrEqual(BOUNDS.height - SAFE.bottom + 0.001);
        });
      });
    });
  });

  test('misleading geometric centroid is replaced by an interior visual center', () => {
    const rings = SHAPES.misleadingCentroid;
    const geometricBoxCenter = { x: 195, y: 349 };
    expect(pointInTerritory(geometricBoxCenter, rings)).toBe(false);
    const visual = resolveEffectAnchor('territoryVisualCenter', {
      bounds: BOUNDS,
      safeInsets: SAFE,
      claimPoint: geometricBoxCenter,
      territoryRings: rings,
    });
    expect(pointInTerritory(visual, rings)).toBe(true);
    expect(visual).not.toEqual(geometricBoxCenter);
  });

  test('reduced motion contains no sprite, shake, or decorative loop and remains informative', () => {
    CAPTURE_STYLES.forEach((style) => {
      const plan = buildCapturePlan(style, true);
      expect(plan.duration).toBe(220);
      expect(plan.sequence.some((step) => step.action === 'territoryReveal')).toBe(true);
      expect(plan.sequence.filter((step) => step.action === 'haptic')).toHaveLength(1);
      expect(plan.sequence.every((step) => !!step.action)).toBe(true);
      expect(plan.sequence.some((step) => step.action === 'screenShake')).toBe(false);
    });
  });

  test('invalid anchors fall back to a finite safe screen anchor', () => {
    expect(resolveEffectAnchor('not-real', { bounds: BOUNDS, safeInsets: SAFE })).toEqual({ x: 195, y: 310 });
  });
});

describe('which capture animation a claim gets', () => {
  test('the same claim always plays the same style', () => {
    // Reopening a result from the feed and seeing a different animation than
    // the one you watched would read as a bug, so the choice is a function of
    // the claim rather than of the moment it is asked for.
    const first = pickCaptureStyle('territory-abc-123');
    for (let i = 0; i < 20; i += 1) {
      expect(pickCaptureStyle('territory-abc-123')).toBe(first);
    }
  });

  test('different claims spread across the pool', () => {
    // The regression this guards is the one that shipped: every claim in the
    // app's history played Thunderstrike, because the id it selected on was
    // never sent and the fallback was a constant. A seeded pick that still
    // lands on one style would be the same bug wearing a hash.
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(pickCaptureStyle(`territory-${i}`));
    expect(seen.size).toBe(PLAYABLE_CAPTURE_STYLES.length);
  });

  test('only release-approved styles are ever picked', () => {
    const approved = new Set(PLAYABLE_CAPTURE_STYLES.map((style) => style.id));
    expect(approved.size).toBe(CAPTURE_STYLES.length);
    for (let i = 0; i < 200; i += 1) {
      expect(approved.has(pickCaptureStyle(`seed-${i}`))).toBe(true);
    }
  });

  test('no seed means variety, for a dev replay with no claim behind it', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i += 1) seen.add(pickCaptureStyle(null));
    expect(seen.size).toBeGreaterThan(1);
  });

  test('every pick resolves to a real, playable style', () => {
    for (let i = 0; i < 50; i += 1) {
      const style = getCaptureStyle(pickCaptureStyle(`run-${i}`));
      expect(style).toBeTruthy();
      expect(validateCaptureStyle(style)).toEqual([]);
    }
  });
});
