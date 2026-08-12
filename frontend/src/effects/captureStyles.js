// A capture style is a CHOREOGRAPHY, not a playlist.
//
// These all used to be the same event wearing different sprites: three sheets
// blooming one after another on the territory's visual centre, a sideways
// rattle, a radial reveal. Fifteen styles, one movement — which is why a run of
// claims read as repetitive even though no two of them drew the same art.
//
// So the vocabulary below is about WHERE and HOW, and every style is built to a
// different shape:
//
//   * `at`      places a sheet on a named anchor. The anchors are the real
//               variety — a strike that comes down from the top of the claim is
//               a different event from one that erupts out of the bottom, and
//               from three that stutter across random points of it.
//   * `shake`   rattles the stage on an AXIS. Sideways is an impact from the
//               side; vertical is something landing; both is a detonation.
//   * `punch`   lunges the whole stage towards the viewer. The only cue here
//               that moves the scene in depth, so a style using it cannot be
//               confused with one that shakes.
//   * `reveal`  when the claimed ground actually appears. Its POSITION in the
//               sequence is a choice: before the impact, the land arrives and
//               is then struck; after it, the strike is what puts it there.
//
// `captureStyleShape` at the bottom is the check that they stayed distinct.
const at = (effect, start, options = {}) => ({
  effect,
  start,
  anchor: 'territoryVisualCenter',
  size: 220,
  ...options,
});
const reveal = (start, style = 'radial') => ({ action: 'territoryReveal', style, start });
const haptic = (start, style = 'medium') => ({ action: 'haptic', style, start });
const shake = (start, intensity = 1, axis = 'x') => ({ action: 'screenShake', intensity, axis, start });
const punch = (start, intensity = 1) => ({ action: 'cameraPunch', intensity, start });

export const CAPTURE_STYLES = Object.freeze([
  {
    id: 'thunderstrike', name: 'Thunderstrike', duration: 1400,
    description: 'A bolt falls from above the claim, cracks the middle sideways, and sprays off the far edge.',
    // TOP DOWN. Everything travels one way: charge overhead, hit the centre,
    // debris out of the bottom. The rattle is sideways because the hit is.
    sequence: [
      at('electric_burst_01', 0, { anchor: 'screenTop', size: 210, speed: 1.25 }),
      at('electric_impact_01', 280, { size: 280, speed: 1.2 }),
      haptic(280, 'medium'), shake(300, 1, 'x'), reveal(340),
      at('solar_shrapnel_01', 500, { anchor: 'territoryBottom', size: 230, opacity: 0.9 }),
    ],
  },
  {
    id: 'arcane_portal', name: 'Arcane Portal', duration: 1800,
    description: 'A portal opens on the ground, hands the claim over, then folds itself away.',
    // A DOOR, NOT A BLAST. Nothing shakes: the claim is delivered rather than
    // taken, so the only stage movement is the camera easing forward as the
    // portal closes.
    sequence: [
      at('vortex_red_01', 0, { anchor: 'territoryBottom', size: 270, speed: 1.55 }),
      at('spectral_bloom_01', 340, { size: 240, speed: 1.15 }),
      haptic(520, 'light'), reveal(560, 'radial'),
      at('void_implosion_01', 650, { size: 250 }), punch(660, 0.8),
    ],
  },
  {
    id: 'warm_detonation', name: 'Warm Detonation', duration: 1300,
    description: 'A charge is dropped, goes off underfoot, and throws embers up out of the crater.',
    // BOTTOM UP, and the one full detonation in the pack: it rattles on both
    // axes at once, which nothing else does.
    sequence: [
      at('bomb_blast_01', 0, { anchor: 'territoryBottom', size: 180, speed: 1.25 }),
      at('warm_explosion_01', 240, { size: 280 }),
      haptic(240, 'medium'), shake(260, 1.15, 'both'), punch(250, 1.1), reveal(320),
      at('ember_jet_01', 420, { anchor: 'territoryTop', size: 230, speed: 1.2 }),
    ],
  },
  {
    id: 'frostbite', name: 'Frostbite', duration: 2200,
    description: 'The ground is claimed first, then slowly freezes over from the middle outward.',
    // THE REVERSE ORDER, and deliberately: the land arrives and the effect
    // creeps over it afterwards. Slow, and completely still — a freeze that
    // shook would be a smash.
    sequence: [
      reveal(0),
      at('frost_nova_01', 120, { size: 230 }),
      haptic(280, 'light'),
      at('freezing_bloom_01', 300, { size: 300, speed: 1.7 }),
      at('magic_bubbles_01', 650, { anchor: 'randomTerritoryPoint', size: 220, speed: 1.7, opacity: 0.72 }),
    ],
  },
  {
    id: 'inferno', name: 'Inferno', duration: 1700,
    description: 'Fire winds up in a ring, climbs the claim, and blows the top off it.',
    // A CLIMB. Ring low, column through the middle, burst at the top — read
    // bottom to top, with a vertical rattle so the stage rises with it.
    sequence: [
      at('fire_spin_01', 0, { anchor: 'territoryBottom', size: 280, speed: 1.7 }),
      at('fire_column_01', 180, { size: 270, speed: 1.6 }),
      at('warm_explosion_01', 420, { anchor: 'territoryTop', size: 250 }),
      haptic(420, 'medium'), shake(440, 0.8, 'y'), reveal(480),
    ],
  },
  {
    id: 'void_collapse', name: 'Void Collapse', duration: 1900,
    description: 'Everything is pulled into one point, which then swallows itself.',
    // INWARD. Three sheets on the same spot, each smaller than the last, and a
    // camera punch on the collapse — the only cue that reads as the scene
    // being pulled rather than pushed.
    sequence: [
      at('vortex_red_01', 0, { size: 280, speed: 1.55 }),
      at('magic_infinity_01', 220, { size: 230, speed: 1.4, opacity: 0.82 }),
      at('void_implosion_01', 620, { size: 190 }),
      haptic(620, 'medium'), punch(630, 1.4), reveal(660, 'radial'),
    ],
  },
  {
    id: 'radiant_claim', name: 'Radiant Claim', duration: 1400,
    description: 'A pillar of light lands on the runner and opens out across the ground.',
    // ON THE RUNNER. The only style anchored to the character rather than to
    // the territory: the light arrives where they are standing and spreads
    // from there. Nothing shakes; this one is meant to feel earned, not won.
    sequence: [
      at('radiant_heal_01', 0, { anchor: 'characterFeet', size: 240 }),
      at('sunburn_ring_01', 200, { size: 290, speed: 1.6 }),
      haptic(340, 'success'), reveal(360),
      at('spectral_bloom_01', 450, { anchor: 'characterHead', size: 220, speed: 1.15, opacity: 0.75 }),
    ],
  },
  {
    id: 'earthshaker', name: 'Earthshaker', duration: 1400,
    description: 'The ground tears open along the claim and slams shut.',
    // THE HEAVIEST HIT in the pack: the widest sheets, the strongest rattle,
    // and it lands vertically. The reveal comes after the slam, so the ground
    // is what the impact leaves behind.
    sequence: [
      at('earth_rupture_01', 0, { size: 290, speed: 1.1 }),
      at('impact_shock_01', 330, { size: 300, speed: 1.25 }),
      haptic(330, 'medium'), shake(330, 1.3, 'y'), punch(340, 1.2), reveal(400),
      at('warm_explosion_01', 480, { anchor: 'randomTerritoryPoint', size: 210, opacity: 0.8 }),
    ],
  },
  {
    id: 'spellbound', name: 'Spellbound', duration: 1900,
    description: 'A long cast is parried overhead and released as a bolt into the ground.',
    // THREE PLACES, IN ORDER: cast on the runner, parry above them, land on
    // the claim. The only style whose sheets travel across the screen rather
    // than stacking on one point.
    sequence: [
      at('magic_spell_01', 0, { anchor: 'characterCenter', size: 280, speed: 1.65 }),
      at('arcane_parry_01', 400, { anchor: 'characterHead', size: 220 }),
      at('magical_projectile_01', 650, { size: 210, speed: 1.4 }),
      haptic(680, 'light'), reveal(720),
    ],
  },
  {
    id: 'cosmic_bloom', name: 'Cosmic Bloom', duration: 2100,
    description: 'A nebula opens quietly over the whole claim and leaves a glyph behind.',
    // THE SLOW ONE. No impact at all — no shake, no punch — and the reveal
    // sits in the middle of it rather than at a hit. Long, wide and calm.
    sequence: [
      at('nebula_burst_01', 0, { anchor: 'screenCenter', size: 300, speed: 1.55 }),
      at('spectral_bloom_01', 340, { size: 250 }),
      reveal(500), haptic(520, 'success'),
      at('magic_infinity_01', 600, { size: 210, speed: 1.5, opacity: 0.75 }),
    ],
  },
  {
    id: 'blue_nova', name: 'Blue Nova', duration: 1600,
    description: 'Cold fire gathers at the edges and detonates in the middle.',
    // EDGES IN. The first two sheets sit off-centre on opposite sides of the
    // claim and the third goes off between them.
    sequence: [
      at('blue_fire_01', 0, { anchor: 'territoryTop', size: 270, speed: 1.55 }),
      at('frost_nova_01', 300, { anchor: 'territoryBottom', size: 230 }),
      at('electric_burst_01', 520, { size: 250, speed: 1.3 }),
      haptic(520, 'medium'), shake(540, 0.9, 'x'), reveal(570),
    ],
  },
  {
    id: 'solar_shatter', name: 'Solar Shatter', duration: 1500,
    description: 'A solar ring tightens and breaks apart across three points of the claim.',
    // STACCATO. Four hits at four places in 600ms — the busiest sequence in
    // the pack, and the only one that fires the same sheet twice in different
    // spots.
    sequence: [
      at('sunburn_ring_01', 0, { size: 270, speed: 1.7 }),
      at('solar_shrapnel_01', 320, { anchor: 'territoryTop', size: 250 }),
      at('solar_shrapnel_01', 440, { anchor: 'randomTerritoryPoint', size: 190, speed: 1.25 }),
      haptic(360, 'medium'), shake(380, 0.85, 'x'), reveal(440),
      at('radiant_heal_01', 600, { anchor: 'territoryBottom', size: 190, opacity: 0.72 }),
    ],
  },
  {
    id: 'acid_rain', name: 'Acid Rain', duration: 1800,
    description: 'A droplet falls from off-screen, pools on the ground, and bubbles away.',
    // A FALL AND A SPREAD, with no impact cue at all: acid does not bang. The
    // residue lands on a random point so the pool never sits where the splash
    // did.
    sequence: [
      at('magical_projectile_01', 0, { anchor: 'screenTop', size: 170, speed: 1.2 }),
      at('acid_splash_01', 300, { anchor: 'territoryBottom', size: 270 }),
      haptic(310, 'light'), reveal(380),
      at('magic_bubbles_01', 520, { anchor: 'randomTerritoryPoint', size: 240, speed: 1.8, opacity: 0.8 }),
    ],
  },
  {
    id: 'glitch_takeover', name: 'Glitch Takeover', duration: 2000, releaseApproved: false,
    description: 'The claim corrupts in from the bottom of the screen and resolves with a snap.',
    // The only one whose reveal is `glitch` rather than radial, and the only
    // one that starts off the bottom of the screen entirely.
    sequence: [
      at('glitch_portal_01', 0, { anchor: 'screenBottom', size: 290, speed: 1.8, optional: true }),
      at('magic_infinity_01', 420, { size: 230, speed: 1.55 }),
      at('electric_burst_01', 680, { size: 260, speed: 1.3 }),
      haptic(680, 'medium'), shake(700, 0.7, 'both'), reveal(740, 'glitch'),
    ],
  },
  {
    id: 'flower_power', name: 'Flower Power', duration: 1800,
    description: 'A seed lands, opens, and spreads over the ground in three widening rings.',
    // GROWTH: each sheet is wider than the last and none of them overlaps the
    // one before. No impact, a soft camera settle instead of a shake.
    sequence: [
      at('radiant_heal_01', 0, { anchor: 'territoryBottom', size: 210 }),
      at('spectral_bloom_01', 180, { size: 250 }),
      at('nebula_burst_01', 360, { anchor: 'territoryTop', size: 280, speed: 1.65, opacity: 0.8 }),
      haptic(380, 'success'), punch(390, 0.5), reveal(430),
    ],
  },
]);

// The style used when there is nothing to pick from — a dev replay with no
// claim behind it, or a seed that somehow resolves to nothing. Real claims go
// through `pickCaptureStyle` below and should never land here.
export const DEFAULT_CAPTURE_STYLE_ID = 'thunderstrike';

export function getCaptureStyle(id) {
  return CAPTURE_STYLES.find((style) => style.id === id) || null;
}

export function isReleaseApprovedCaptureStyle(style) {
  return !!style && style.releaseApproved !== false;
}

/** Every style that may actually ship. The pool `pickCaptureStyle` draws from. */
export const PLAYABLE_CAPTURE_STYLES = Object.freeze(
  CAPTURE_STYLES.filter(isReleaseApprovedCaptureStyle)
);

// FNV-1a. Any stable string-to-number would do; the only requirement is that
// the same claim always lands on the same style.
function hashSeed(seed) {
  let hash = 0x811c9dc5;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Which capture animation a claim gets.
 *
 * There have always been a dozen of these and exactly one of them ever played:
 * the sequence asked the server for `claim.capture_style`, the server has
 * never sent such a field, and so every claim in the app's history fell
 * through to the default. Thunderstrike, forever.
 *
 * Picked from a SEED rather than at random, and the seed is the claim's own
 * id, so a given claim looks the same every time you open it — reopening a
 * result from the feed and getting a different animation than the one you
 * watched would read as a bug, and it would make the share card disagree with
 * the memory of it.
 *
 * Deliberately client side. This is decoration: it needs no column, no
 * migration, and no deploy to change, and a client that picks its own is one
 * fewer thing the claim endpoint has to be right about.
 */
export function pickCaptureStyle(seed) {
  const pool = PLAYABLE_CAPTURE_STYLES;
  if (!pool.length) return DEFAULT_CAPTURE_STYLE_ID;
  // No seed means no stable identity to hang a choice on — a dev replay, say.
  // Random is right there: replaying repeatedly should show variety.
  const index = seed == null
    ? Math.floor(Math.random() * pool.length)
    : hashSeed(seed) % pool.length;
  return pool[index].id;
}

/**
 * A style's MOVEMENT, with the art taken out of it.
 *
 * Two styles that play entirely different sheets in the same places, in the
 * same order, with the same rattle are the same celebration to anyone watching
 * — which is what the pack was before this pass. So the shape is the ordered
 * list of anchors and stage cues, and nothing else: no effect ids, no sizes, no
 * timings. Tests compare these, because "are they different animations" is a
 * question about this and not about which sprite sheet turned up.
 */
export function captureStyleShape(style) {
  return (style?.sequence || [])
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((step) => {
      if (step.action === 'screenShake') return `shake:${step.axis || 'x'}`;
      if (step.action === 'cameraPunch') return 'punch';
      if (step.action === 'territoryReveal') return `reveal:${step.style || 'radial'}`;
      if (step.action) return step.action;
      return `fx@${step.anchor || 'territoryVisualCenter'}`;
    })
    .join(' > ');
}

export function resolveCaptureStyle(id) {
  const requested = getCaptureStyle(id);
  if (requested && (__DEV__ || isReleaseApprovedCaptureStyle(requested))) return requested;
  return getCaptureStyle(DEFAULT_CAPTURE_STYLE_ID);
}
