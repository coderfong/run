import { LOTTIE_ANIMATIONS } from '../config/lottieAnimations';
import { GENERATED_EFFECTS } from './generatedEffectRegistry';
import { EFFECT_TYPE } from './effectTypes';

// DEV-ONLY. Hand-added, not run through scripts/animations/import_assets.py
// (that pipeline curates and imports SPRITE sheets from an external source
// selection; this is a single Seedance-generated animated WebP converted by
// scripts/convert-scene-animations.py's `glow` mode — see
// docs/SEEDANCE_CAPTURE_ASSET_SPEC.md for the full provenance). Kept as its
// own small object, alongside BUILTIN_LOTTIES, rather than a new player: the
// existing ANIMATED_IMAGE type (AnimatedImageEffect.js) already renders an
// alpha WebP correctly, so this needs no new abstraction.
const BUILTIN_ANIMATED_IMAGES = {
  seedance_portal_shockwave: {
    id: 'seedance_portal_shockwave',
    name: 'Seedance Portal Shockwave (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-portal-shockwave.webp'),
    // Matches the converted asset's real frame count/fps (84 frames @ 24fps),
    // not the source clip's full 4.04s -- see the capture style's `hold`.
    duration: 3500,
    frameCount: 84,
    fps: 24,
    category: 'impact',
    tags: ['capture', 'impact', 'portal', 'seedance', 'dev'],
    // `releaseApproved` here means "cleared to ship in the bundle" (no
    // licensing block), the same as BUILTIN_LOTTIES below -- it is NOT the
    // "playable in a real capture" gate. This is our own generated asset, so
    // it is. What keeps it out of real captures is the DEV_CAPTURE_STYLES
    // style built around it never entering CAPTURE_STYLES (see
    // captureStyles.js) -- an unshipped effect asset would just be a broken
    // require() in the dev gallery, not a safer state.
    releaseApproved: true,
    loop: false,
  },
  // Second-round PASER-doodle-direction prototype. Converted with `black`
  // connectivity keying, not `glow` -- this content is a flat colour fill
  // with a THICK BLACK OUTLINE, and `glow` was verified (by compositing a
  // converted frame over a colour card) to corrupt the outline to grey.
  // `black` preserves it crisply. See docs/SEEDANCE_CAPTURE_ASSET_SPEC.md.
  seedance_party_burst: {
    id: 'seedance_party_burst',
    name: 'Seedance Party Burst (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-party-burst.webp'),
    duration: 2417,
    frameCount: 58,
    fps: 24,
    category: 'celebration',
    tags: ['capture', 'celebration', 'burst', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  seedance_paser_stamp: {
    id: 'seedance_paser_stamp',
    name: 'Seedance PASER Stamp (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-paser-stamp.webp'),
    // The converted 52-frame request encoded down to 49 unique frames
    // (libwebp merged a couple of near-duplicates) -- 2042ms, not the 2167ms
    // requested. The choreography's `hold` (2090ms) briefly holds the last
    // frame rather than cutting mid-motion; see the capture style's note.
    duration: 2042,
    frameCount: 49,
    fps: 24,
    category: 'impact',
    tags: ['capture', 'impact', 'stamp', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  // Round 3: ACTION-BASED direction. Stamp/Party Burst (above) proved
  // Seedance integration but were each a single isolated FX sprite doing the
  // whole scene by itself. These two are FX PLATES instead -- built to be
  // driven by the live choreography (`scene()`'s existing 'meteor_claim'
  // spine in captureStyles.js), not to carry the scene alone:
  //
  //   seedance_meteor_fall    a looping rock, moved/scaled/spun by the
  //                           engine's own `projectile()` travel wrapper
  //                           (TravellingEffect) -- the plate itself does not
  //                           travel, so it needs no measured fall timing.
  //   seedance_meteor_impact  a short burst plate, front-loaded (no
  //                           anticipation baked in -- the live camera
  //                           freeze/haptic/shake already sell "impact
  //                           happened" the instant it appears).
  //
  // Because neither plate is the WHOLE scene, neither needs frame-precise
  // measured timing the way the stamp/burst did: the player fits any natural
  // duration into the step's own `hold`/`duration` window (spriteSpeedForWindow,
  // 0.7x-2.4x), so trimming for content rather than for an exact impact
  // timestamp is enough. See docs/SEEDANCE_CAPTURE_ASSET_SPEC_V3.md.
  seedance_meteor_fall: {
    id: 'seedance_meteor_fall',
    name: 'Seedance Meteor Fall (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-meteor-fall.webp'),
    duration: 1000,
    frameCount: 24,
    fps: 24,
    category: 'energy',
    tags: ['capture', 'projectile', 'meteor', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  seedance_meteor_impact: {
    id: 'seedance_meteor_impact',
    name: 'Seedance Meteor Impact (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-meteor-impact.webp'),
    duration: 500,
    frameCount: 12,
    fps: 24,
    category: 'impact',
    tags: ['capture', 'impact', 'meteor', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  // Lightning Attack (Round 3, second style). `seedance_lightning_charge`
  // needed one correction pass: v1 rendered the bolt with a soft neon
  // glow/bloom halo bleeding outward from the outline (the model defaulted
  // to a "neon sign" read of "lightning bolt" despite the prompt's explicit
  // no-glow language) -- v2's prompt named the failure directly ("test: if
  // you covered the yellow shape, the black card around it must be
  // completely empty") and came back hard-edged. `seedance_lightning_strike`
  // needed no correction pass: approved on the first Seedance attempt,
  // matching the brief's exact colour spec (yellow/white core, black
  // zigzag outline, hot-pink secondary burst, teal ground ring).
  seedance_lightning_charge: {
    id: 'seedance_lightning_charge',
    name: 'Seedance Lightning Charge (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-lightning-charge.webp'),
    duration: 1000,
    frameCount: 24,
    fps: 24,
    category: 'lightning',
    tags: ['capture', 'projectile', 'lightning', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  seedance_lightning_strike: {
    id: 'seedance_lightning_strike',
    name: 'Seedance Lightning Strike (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-lightning-strike.webp'),
    duration: 500,
    frameCount: 12,
    fps: 24,
    category: 'impact',
    tags: ['capture', 'impact', 'lightning', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  // Ground Smash (Round 3, third style). v1's crack lines were dark
  // charcoal-grey (invisible against pure black, and outside the
  // black-connectivity keying tolerance so they'd have survived as muddy
  // grey rather than being swept as background) -- v2 corrected them to
  // bright mint-green, which is why they render mint here rather than
  // black like every other outline in the pack.
  seedance_ground_smash: {
    id: 'seedance_ground_smash',
    name: 'Seedance Ground Smash (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-ground-smash.webp'),
    duration: 500,
    frameCount: 12,
    fps: 24,
    category: 'impact',
    tags: ['capture', 'impact', 'ground', 'smash', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  // Comic Brawl (Round 3, fourth style). v1's starburst had essentially no
  // outline -- a single anti-aliased pixel between the cream fill and pure
  // black, not an actual ink line -- v2 corrected it to a genuine thick
  // black outline stroke, same as every other PASER shape.
  seedance_brawl_clash: {
    id: 'seedance_brawl_clash',
    name: 'Seedance Brawl Clash (DEV)',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-brawl-clash.webp'),
    duration: 500,
    frameCount: 12,
    fps: 24,
    category: 'impact',
    tags: ['capture', 'impact', 'brawl', 'clash', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
  seedance_defense_shield_counter: {
    id: 'seedance_defense_shield_counter',
    name: 'Seedance Defense Shield Counter',
    type: EFFECT_TYPE.ANIMATED_IMAGE,
    source: require('../../assets/animations/seedance-defense-shield-counter.webp'),
    duration: 2458,
    frameCount: 59,
    fps: 24,
    category: 'defense',
    tags: ['defense', 'shield', 'counter', 'seedance', 'dev', 'paser-doodle'],
    releaseApproved: true,
    loop: false,
  },
};

const BUILTIN_LOTTIES = {
  capture_impact_lottie: {
    id: 'capture_impact_lottie',
    name: 'Capture Impact (Lottie)',
    type: 'lottie',
    source: LOTTIE_ANIMATIONS.captureImpact.source,
    duration: LOTTIE_ANIMATIONS.captureImpact.duration,
    category: 'impact',
    tags: ['capture', 'impact', 'lottie', 'builtin'],
    releaseApproved: true,
    loop: false,
  },
  bomb_blast_lottie: {
    id: 'bomb_blast_lottie',
    name: 'Bomb Blast (Lottie)',
    type: 'lottie',
    source: LOTTIE_ANIMATIONS.bombBlast.source,
    duration: LOTTIE_ANIMATIONS.bombBlast.duration,
    category: 'explosion',
    tags: ['capture', 'bomb', 'explosion', 'lottie', 'builtin'],
    releaseApproved: true,
    loop: false,
  },
};

export const EFFECTS = Object.freeze({ ...GENERATED_EFFECTS, ...BUILTIN_LOTTIES, ...BUILTIN_ANIMATED_IMAGES });

export function getEffect(id) {
  return EFFECTS[id] || null;
}

export function getAllEffects() {
  return Object.values(EFFECTS);
}

export function getEffectsByCategory(category) {
  if (!category || category === 'all') return getAllEffects();
  if (category === 'capture') return getEffectsByTag('capture');
  return getAllEffects().filter((effect) => effect.category === category);
}

export function getEffectsByTag(tag) {
  return getAllEffects().filter((effect) => effect.tags?.includes(tag));
}

export function getEffectsByTags(tags, { match = 'all' } = {}) {
  const wanted = [...new Set(tags || [])];
  if (!wanted.length) return getAllEffects();
  return getAllEffects().filter((effect) => {
    const has = (tag) => effect.tags?.includes(tag);
    return match === 'any' ? wanted.some(has) : wanted.every(has);
  });
}

function randomFrom(list, random = Math.random) {
  return list.length ? list[Math.floor(random() * list.length)] : null;
}

export function getRandomEffect(category, random) {
  return randomFrom(getEffectsByCategory(category), random);
}

export function getRandomEffectByTags(tags, random) {
  return randomFrom(getEffectsByTags(tags), random);
}
