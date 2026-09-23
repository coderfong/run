import {
  CAPTURE_STYLES,
  DEFAULT_CAPTURE_STYLE_ID,
  DEV_CAPTURE_STYLES,
  PLAYABLE_CAPTURE_STYLES,
  getCaptureStyle,
  pickCaptureStyle,
  resolveCaptureStyle,
} from '../src/effects/captureStyles';
import { DRAMA_SCALE, expandCast } from '../src/effects/choreography';
import {
  REDUCED_BEATS,
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
// The Seedance-generated animated images (DEV prototypes -- portal-shockwave,
// party-burst, paser-stamp, meteor-fall, meteor-impact, lightning-charge,
// lightning-strike, ground-smash, brawl-clash; see
// docs/SEEDANCE_CAPTURE_ASSET_SPEC*.md), hand-added the same way the
// Lotties are and for the same reason: the importer's manifest only knows
// about the sprite-sheet package it curated.
const BUILTIN_ANIMATED_IMAGE_COUNT = 10;
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
    expect(effects).toHaveLength(manifest.selectedAssets + BUILTIN_LOTTIE_COUNT + BUILTIN_ANIMATED_IMAGE_COUNT);
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
  // Widened from "the opening" to EVERY sprite in every scene. A capture
  // renders art at 150-330 points; a 32px sheet is a blur at any of those, and
  // it was only the opening being checked because the pool was small enough
  // that nothing else was reachable.
  test('capture styles never enlarge thumbnail-sized artwork', () => {
    PLAYABLE_CAPTURE_STYLES.forEach((style) => {
      style.sequence
        .filter((step) => step.track === 'effect' && !step.optional)
        .forEach((step) => {
          const spec = getEffect(effectIdForCaptureStep(step));
          if (spec.type === 'sprite') {
            expect(Math.max(spec.frameWidth, spec.frameHeight)).toBeGreaterThanOrEqual(64);
            expect(spec.densityScales).toEqual([1, 2, 3]);
          } else {
            expect(spec.type).toBe('animated-image');
            expect(spec.frameCount).toBeGreaterThan(0);
            expect(spec.fps).toBeGreaterThan(0);
          }
        });
    });
  });

  test('all 38 have bounded duration, metadata, one reveal, one primary haptic, and valid required effects', () => {
    expect(CAPTURE_STYLES).toHaveLength(38);
    CAPTURE_STYLES.forEach((style) => {
      expect(getCaptureStyle(style.id)).toBe(style);
      expect(validateCaptureStyle(style)).toEqual([]);
      // A capture is a short directed cutscene, and "short" is a requirement
      // rather than a nice-to-have: setup, action, impact, takeover, reaction
      // and cleanup all fit inside about two and a half seconds. The ceiling is
      // also what the controller will keep the style mounted for, checked
      // against the reveal cue in validateChoreography. Both bounds carry
      // DRAMA_SCALE, same as every style's own timing.
      expect(style.duration).toBeGreaterThanOrEqual(Math.round(2000 * DRAMA_SCALE));
      expect(style.duration).toBeLessThanOrEqual(Math.round(3000 * DRAMA_SCALE));
      expect(style.sequence.filter((step) => step.action === 'territoryReveal')).toHaveLength(1);
      expect(style.sequence.filter((step) => step.action === 'haptic')).toHaveLength(1);
      expect(style.sequence.filter((step) => step.action === 'victory')).toHaveLength(1);
      expect(style.beats.length).toBeGreaterThanOrEqual(4);
      expect(typeof style.usesProjectile).toBe('boolean');
      expect(typeof style.usesContact).toBe('boolean');
      expect(typeof style.usesEnvironment).toBe('boolean');
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

  test('reduced motion drops the travel and keeps the whole story', () => {
    // Not "remove the defenders". The narrative has to survive: the runner
    // acts, the world does something, the rivals react, the ground changes
    // hands, the rivals leave, the runner wins — each as a short fade or
    // scale rather than a dash across the map.
    CAPTURE_STYLES.forEach((style) => {
      const plan = buildCapturePlan(style, true);
      expect(plan.duration).toBe(REDUCED_BEATS.duration);
      expect(plan.sequence.some((step) => step.action === 'territoryReveal')).toBe(true);
      expect(plan.sequence.filter((step) => step.action === 'haptic')).toHaveLength(1);
      expect(plan.sequence.every((step) => !!step.action)).toBe(true);
      expect(plan.sequence.some((step) => step.action === 'screenShake')).toBe(false);
      expect(plan.sequence.some((step) => step.action === 'projectile')).toBe(false);
      const defenderBeats = plan.sequence.filter((step) => step.action === 'actor' && step.role === 'defender');
      expect(defenderBeats.length).toBeGreaterThanOrEqual(2);
      expect(plan.sequence.some((step) => step.action === 'actor' && step.role === 'attacker')).toBe(true);
      expect(plan.sequence.some((step) => step.action === 'victory')).toBe(true);
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
    expect(approved.size).toBeGreaterThan(0);
    for (let i = 0; i < 200; i += 1) {
      expect(approved.has(pickCaptureStyle(`seed-${i}`))).toBe(true);
    }
  });

  test('the live pool contains only action-based Seedance captures', () => {
    expect(PLAYABLE_CAPTURE_STYLES.map((style) => style.id)).toEqual([
      'seedance_meteor_strike',
      'seedance_lightning_attack',
      'seedance_ground_smash',
      'seedance_comic_brawl',
    ]);
    PLAYABLE_CAPTURE_STYLES.forEach((style) => {
      style.sequence.forEach((step) => {
        const id = effectIdForCaptureStep(step);
        if (!id) return;
        const spec = getEffect(id);
        expect(spec).toBeTruthy();
        expect(spec.type).not.toBe('lottie');
        expect(spec.tags).toContain('seedance');
      });
    });
  });

  test('unknown ids resolve to the generated default while explicit lab ids remain available', () => {
    expect(resolveCaptureStyle('no-such-style').id).toBe(DEFAULT_CAPTURE_STYLE_ID);
    expect(resolveCaptureStyle('thunderstrike').id).toBe('lightning_conquest');
    expect(getCaptureStyle(DEFAULT_CAPTURE_STYLE_ID)).toBeTruthy();
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

describe('Seedance capture styles', () => {
  test('approved action sequences ship while experiments remain excluded', () => {
    DEV_CAPTURE_STYLES.forEach((style) => {
      expect(validateCaptureStyle(style)).toEqual([]);
    });
    const playableIds = new Set(PLAYABLE_CAPTURE_STYLES.map((style) => style.id));
    DEV_CAPTURE_STYLES.forEach((style) => {
      expect(playableIds.has(style.id)).toBe(style.releaseApproved === true);
    });
    for (let i = 0; i < 200; i += 1) expect(playableIds.has(pickCaptureStyle(`seed-${i}`))).toBe(true);
  });

  test('a dev style still resolves through getCaptureStyle, same as a production one', () => {
    DEV_CAPTURE_STYLES.forEach((style) => {
      expect(getCaptureStyle(style.id)).toBe(style);
    });
  });

  // Round 3 ACTION-BASED prototype: the production Meteor Claim spine with
  // Seedance PASER-doodle FX plates in place of the sprite-pack rock/burst.
  describe('seedance_meteor_strike', () => {
    const style = DEV_CAPTURE_STYLES.find((item) => item.id === 'seedance_meteor_strike');

    test('exists and matches the production Meteor Claim shape', () => {
      expect(style).toBeTruthy();
      expect(style.family).toBe('projectile');
      expect(style.usesProjectile).toBe(true);
      expect(style.usesContact).toBe(false);
      expect(style.usesVectorEnvironment).toBe(true);
      expect(style.duration).toBeGreaterThanOrEqual(2500);
      expect(style.duration).toBeLessThanOrEqual(3500);
    });

    test('both Seedance FX plates resolve to real, valid effect specs', () => {
      const projectileStep = style.sequence.find((step) => step.action === 'projectile');
      const impactStep = style.sequence.find((step) => (
        step.track === 'effect' && step.action !== 'projectile'
      ));
      expect(projectileStep.effect).toBe('seedance_meteor_fall');
      expect(impactStep.effect).toBe('seedance_meteor_impact');
      [projectileStep.effect, impactStep.effect].forEach((id) => {
        const spec = getEffect(id);
        expect(spec).toBeTruthy();
        expect(spec.releaseApproved).toBe(true);
        expect(spec.type).toBe('animated-image');
      });
    });

    // The user-facing "Capture Style Lab" (AnimationGalleryScreen) previews
    // exactly this: the same style expanded against 0, 1, 2 and 3 defenders,
    // from both the attacker's and a victim's perspective. `expandCast` is
    // the resolver step that preview (and the real player) both go through.
    [0, 1, 2, 3].forEach((defenderCount) => {
      test(`expands cleanly against ${defenderCount} defender(s)`, () => {
        const timeline = expandCast(style.sequence, { defenderCount, seed: `lab:${defenderCount}` });
        expect(timeline.length).toBeGreaterThan(0);
        const defenderSteps = timeline.filter((step) => step.action === 'actor' && step.role === 'defender');
        // The spine addresses defenders in three group beats -- notice,
        // shockwave-knockback, flee -- each expanded to one step per
        // defender by `expandCast`.
        expect(defenderSteps).toHaveLength(defenderCount * 3);
        defenderSteps.forEach((step) => expect(step.index).toBeLessThan(defenderCount));
        // Every step still resolves to a known action/effect once expanded.
        timeline.forEach((step) => {
          if (step.action === 'actor') expect(step.name || step.actions?.length).toBeTruthy();
        });
      });
    });
  });

  // Round 3, second style: the production Lightning Conquest spine (bolt
  // earths into the defender GROUP, not territory centre) with Seedance
  // PASER-doodle FX plates in place of the sprite-pack bolt/electric-impact.
  describe('seedance_lightning_attack', () => {
    const style = DEV_CAPTURE_STYLES.find((item) => item.id === 'seedance_lightning_attack');

    test('exists and matches the production Lightning Conquest shape', () => {
      expect(style).toBeTruthy();
      expect(style.family).toBe('projectile');
      expect(style.usesProjectile).toBe(true);
      expect(style.usesContact).toBe(false);
      expect(style.duration).toBeGreaterThanOrEqual(2500);
      expect(style.duration).toBeLessThanOrEqual(3500);
    });

    test('both Seedance FX plates resolve to real, valid effect specs', () => {
      const projectileStep = style.sequence.find((step) => step.action === 'projectile');
      const impactStep = style.sequence.find((step) => (
        step.track === 'effect' && step.action !== 'projectile'
      ));
      expect(projectileStep.effect).toBe('seedance_lightning_charge');
      expect(impactStep.effect).toBe('seedance_lightning_strike');
      [projectileStep.effect, impactStep.effect].forEach((id) => {
        const spec = getEffect(id);
        expect(spec).toBeTruthy();
        expect(spec.releaseApproved).toBe(true);
        expect(spec.type).toBe('animated-image');
      });
    });

    [0, 1, 2, 3].forEach((defenderCount) => {
      test(`expands cleanly against ${defenderCount} defender(s)`, () => {
        const timeline = expandCast(style.sequence, { defenderCount, seed: `lab:${defenderCount}` });
        expect(timeline.length).toBeGreaterThan(0);
        const defenderSteps = timeline.filter((step) => step.action === 'actor' && step.role === 'defender');
        // notice + shockwave-knockback (both default to target ALL since
        // this style's defenderSpec never sets `displace`) + flee (EACH).
        expect(defenderSteps).toHaveLength(defenderCount * 3);
        defenderSteps.forEach((step) => expect(step.index).toBeLessThan(defenderCount));
      });
    });
  });

  // Round 3, third style: the production Earth Crack spine with a Seedance
  // PASER-doodle burst in place of the sprite-pack `impact_shock_01`. Only
  // one FX plate -- no travel beat to cover, and the crack lines/rising
  // slabs are drawn free by the vector environment, same as production.
  describe('seedance_ground_smash', () => {
    const style = DEV_CAPTURE_STYLES.find((item) => item.id === 'seedance_ground_smash');

    test('exists and matches the production Earth Crack shape', () => {
      expect(style).toBeTruthy();
      expect(style.family).toBe('territory');
      expect(style.usesProjectile).toBe(false);
      expect(style.usesContact).toBe(false);
      expect(style.usesVectorEnvironment).toBe(true);
      expect(style.duration).toBeGreaterThanOrEqual(2500);
      expect(style.duration).toBeLessThanOrEqual(3500);
    });

    test('the Seedance FX plate resolves to a real, valid effect spec', () => {
      const impactStep = style.sequence.find((step) => step.track === 'effect');
      expect(impactStep.effect).toBe('seedance_ground_smash');
      const spec = getEffect(impactStep.effect);
      expect(spec).toBeTruthy();
      expect(spec.releaseApproved).toBe(true);
      expect(spec.type).toBe('animated-image');
    });

    [0, 1, 2, 3].forEach((defenderCount) => {
      test(`expands cleanly against ${defenderCount} defender(s)`, () => {
        const timeline = expandCast(style.sequence, { defenderCount, seed: `lab:${defenderCount}` });
        expect(timeline.length).toBeGreaterThan(0);
        const defenderSteps = timeline.filter((step) => step.action === 'actor' && step.role === 'defender');
        expect(defenderSteps).toHaveLength(defenderCount * 3);
        defenderSteps.forEach((step) => expect(step.index).toBeLessThan(defenderCount));
      });
    });
  });

  // Round 3, fourth style: the production Sword Slash spine -- the live
  // attacker DASH_FORWARDs toward 'nearestDefender' and a `duel()` contact
  // step is what makes the two characters actually touch -- with a Seedance
  // comic clash cloud standing in for the weapon-slash FX. No character art
  // is Seedance-generated; the plate only has to be large enough to cover
  // the clash point, which it can do for free (FOREGROUND_FX paints above
  // CHARACTER in layers.js).
  describe('seedance_comic_brawl', () => {
    const style = DEV_CAPTURE_STYLES.find((item) => item.id === 'seedance_comic_brawl');

    test('exists and matches the production Sword Slash shape', () => {
      expect(style).toBeTruthy();
      expect(style.family).toBe('duel');
      expect(style.encounterMode).toBe('duel');
      expect(style.usesProjectile).toBe(false);
      // Only a DUEL-family style may emit contact -- this is the one place
      // in Round 3 where that is expected to be true.
      expect(style.usesContact).toBe(true);
      expect(style.sequence.some((step) => step.action === 'contact')).toBe(true);
      expect(style.duration).toBeGreaterThanOrEqual(2500);
      expect(style.duration).toBeLessThanOrEqual(3500);
    });

    test('the attacker actually converges on the nearest defender before contact', () => {
      const strike = style.sequence.find((step) => (
        step.action === 'actor' && step.role === 'attacker' && step.name === 'dashForward'
      ));
      expect(strike).toBeTruthy();
      expect(strike.toward).toBe('nearestDefender');
    });

    test('the Seedance FX plate resolves to a real, valid effect spec', () => {
      const impactStep = style.sequence.find((step) => step.track === 'effect');
      expect(impactStep.effect).toBe('seedance_brawl_clash');
      const spec = getEffect(impactStep.effect);
      expect(spec).toBeTruthy();
      expect(spec.releaseApproved).toBe(true);
      expect(spec.type).toBe('animated-image');
    });

    [0, 1, 2, 3].forEach((defenderCount) => {
      test(`expands cleanly against ${defenderCount} defender(s)`, () => {
        const timeline = expandCast(style.sequence, { defenderCount, seed: `lab:${defenderCount}` });
        expect(timeline.length).toBeGreaterThan(0);
        const defenderSteps = timeline.filter((step) => step.action === 'actor' && step.role === 'defender');
        expect(defenderSteps).toHaveLength(defenderCount * 3);
        defenderSteps.forEach((step) => expect(step.index).toBeLessThan(defenderCount));
      });
    });
  });
});
