// The fifteen ways a claim can be taken.
//
// A style is now an ARCHETYPE plus PAINT. The archetype is the animation — who
// moves, when, what travels where, how the ground turns over, where the
// silences are (see choreography.js). The paint is only which sprite sheets
// dress it.
//
// That split is the whole point of this file. Before it, every style was a
// stack of sheets on the territory's centre with a rattle and a radial wipe,
// and the differences between them were anchors and art. Fifteen recolours of
// one event. Now Earthshaker is
//
//     jump → hang → fall → PUNCH the ground → shockwave → cracks
//
// and Thunderstrike is
//
//     brace → the sky charges → a bolt travels down → STRIKE → recoil → spread
//
// which stay different animations even if you swapped every sprite between
// them. `choreographySignature` is the test that they stayed different, and it
// cannot see the paint.
//
// One-to-one: fifteen styles, fifteen archetypes, no archetype used twice.

import { ARCHETYPES, choreographyProfile, choreographySignature } from './choreography';

const style = (id, name, archetype, description, paint, tune) => {
  const built = ARCHETYPES[archetype](paint, tune);
  return { id, name, archetype, description, duration: built.duration, sequence: built.sequence };
};

export const CAPTURE_STYLES = Object.freeze([
  style(
    'thunderstrike', 'Thunderstrike', 'skyStrike',
    'The runner braces, the sky charges, and a bolt falls the whole way down onto the claim.',
    { charge: 'electric_burst_01', bolt: 'magical_projectile_01', impact: 'electric_impact_01', residue: 'solar_shrapnel_01' },
    { charge: 260, travel: 220 }
  ),

  style(
    'earthshaker', 'Earthshaker', 'jumpSlam',
    'A jump, a held beat at the top, then both fists into the ground and the claim splits open.',
    { impact: 'impact_shock_01', debris: 'earth_rupture_01' },
    { hang: 280 }
  ),

  style(
    'warm_detonation', 'Warm Detonation', 'projectileThrow',
    'A charge is lobbed onto the ground, sits there for a moment, and goes off.',
    // `explosion_orange_01` is a 32x32 sheet and this archetype draws its blast
    // at 320pt — a tenfold enlargement, which is a blur rather than an
    // explosion. `warm_explosion_01` is the same beat at 96x96. The rule is
    // enforced by "playable capture openings never enlarge thumbnail-sized
    // artwork" in effects.test.js.
    { charge: 'bomb_blast_01', blast: 'warm_explosion_01', smoke: 'ember_jet_01' },
    { flight: 400, fuse: 300 }
  ),

  style(
    'frostbite', 'Frostbite', 'channelSpread',
    'The runner holds a cast and ice creeps out from their feet until the whole claim is frozen.',
    { source: 'frost_nova_01', spread: 'freezing_bloom_01', crust: 'magic_bubbles_01' },
    { spread: 1000 }
  ),

  style(
    'inferno', 'Inferno', 'perimeterSweep',
    'A stomp sends fire running the whole border, and the inside lights up when the ring closes.',
    { spark: 'fire_spin_01', ring: 'fire_column_01', flood: 'warm_explosion_01' },
    { lap: 860 }
  ),

  style(
    'void_collapse', 'Void Collapse', 'implosion',
    'Everything is dragged towards one point, holds still for a moment, then swallows itself.',
    { well: 'vortex_red_01', debris: 'magic_infinity_01', collapse: 'void_implosion_01' },
    { pull: 720, silence: 340 }
  ),

  style(
    'arcane_portal', 'Arcane Portal', 'portalDelivery',
    'A door opens under the claim, hands the ground over, and folds itself away.',
    { portal: 'vortex_red_01', through: 'spectral_bloom_01', fold: 'void_implosion_01' },
    { open: 440, close: 540 }
  ),

  style(
    'radiant_claim', 'Radiant Claim', 'beamDown',
    'A beam comes down onto the runner and the ground lights up outward from where they stand.',
    { beam: 'magical_projectile_01', land: 'radiant_heal_01', rings: 'sunburn_ring_01', halo: 'spectral_bloom_01' },
    { arrive: 360 }
  ),

  style(
    'spellbound', 'Spellbound', 'magicCast',
    'Two glyphs are cast to opposite edges, a line connects them, and the rune between fires.',
    { glyph: 'magic_spell_01', link: 'magical_projectile_01', rune: 'arcane_parry_01' },
    { beat: 340 }
  ),

  style(
    'cosmic_bloom', 'Cosmic Bloom', 'witnessGrowth',
    'A star lands, the runner just watches, and a nebula opens across the claim on its own.',
    { seed: 'magical_projectile_01', sprout: 'spectral_bloom_01', grow: 'nebula_burst_01', settle: 'magic_infinity_01' },
    { land: 320, grow: 1200 }
  ),

  style(
    'blue_nova', 'Blue Nova', 'chargeRelease',
    'Cold fire is gathered between the hands, grows, and is driven into the ground.',
    { gather: 'blue_fire_01', orb: 'magic_infinity_01', nova: 'frost_nova_01', wake: 'electric_burst_01' },
    { wind: 800 }
  ),

  style(
    'solar_shatter', 'Solar Shatter', 'fallingObjects',
    'A sun forms overhead, cracks, and rains fragments before the last one lands.',
    { form: 'sunburn_ring_01', crack: 'solar_shrapnel_01', shard: 'solar_shrapnel_01', strike: 'warm_explosion_01' },
    { form: 440, stagger: 150 }
  ),

  style(
    'acid_rain', 'Acid Rain', 'rainBarrage',
    'A cloud is thrown up and the rain gets heavier until the ground gives way under it.',
    { cloud: 'magic_bubbles_01', drop: 'magical_projectile_01', pool: 'acid_splash_01' },
    { drops: 6, spacing: 140 }
  ),

  style(
    'flower_power', 'Flower Power', 'plantGrowth',
    'A seed is planted underfoot and growth races outward, popping open as it goes.',
    { sprout: 'radiant_heal_01', vines: 'spectral_bloom_01', pop: 'magic_bubbles_01', bloom: 'nebula_burst_01' },
    { run: 950 }
  ),

  {
    // Release-blocked: `glitch_portal_01` has no licence file, so the importer
    // never emitted it (see scripts/animations/animation-selection.json). The
    // step is `optional`, so this plays without it — but the opening beat is
    // the corruption arriving from off-screen, and without that art it is a
    // lesser animation. Ships when the licence clears.
    ...style(
      'glitch_takeover', 'Glitch Takeover', 'corruption',
      'The claim corrupts in from the bottom of the screen and snaps into place.',
      { corrupt: 'glitch_portal_01', spread: 'magic_infinity_01', snap: 'electric_burst_01' },
      { creep: 640 }
    ),
    releaseApproved: false,
  },
]);

// The style used when there is nothing to pick from — a dev replay with no
// claim behind it, or a seed that somehow resolves to nothing. Real claims go
// through `pickCaptureStyle` below and should never land here.
export const DEFAULT_CAPTURE_STYLE_ID = 'thunderstrike';

export function getCaptureStyle(id) {
  return CAPTURE_STYLES.find((item) => item.id === id) || null;
}

export function isReleaseApprovedCaptureStyle(item) {
  return !!item && item.releaseApproved !== false;
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

export function resolveCaptureStyle(id) {
  const requested = getCaptureStyle(id);
  if (requested && (__DEV__ || isReleaseApprovedCaptureStyle(requested))) return requested;
  return getCaptureStyle(DEFAULT_CAPTURE_STYLE_ID);
}

// Re-exported so callers that only care about "are these two the same
// animation" do not have to know the vocabulary module exists.
export { choreographySignature, choreographyProfile };
