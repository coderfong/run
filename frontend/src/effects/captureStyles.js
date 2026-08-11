const at = (effect, start, options = {}) => ({
  effect,
  start,
  anchor: 'territoryVisualCenter',
  size: 220,
  ...options,
});
const reveal = (start, style = 'radial') => ({ action: 'territoryReveal', style, start });
const haptic = (start, style = 'medium') => ({ action: 'haptic', style, start });
const shake = (start, intensity = 1) => ({ action: 'screenShake', intensity, start });

export const CAPTURE_STYLES = Object.freeze([
  {
    id: 'thunderstrike', name: 'Thunderstrike', duration: 1400,
    description: 'A violet charge snaps into a blue electric impact and aftershock.',
    sequence: [
      at('electric_burst_01', 0, { size: 210, speed: 1.25 }),
      at('electric_impact_01', 280, { size: 280, speed: 1.2 }),
      haptic(280, 'medium'), shake(300, 1), reveal(340),
      at('solar_shrapnel_01', 500, { size: 230, opacity: 0.9 }),
    ],
  },
  {
    id: 'arcane_portal', name: 'Arcane Portal', duration: 1800,
    description: 'A red vortex stabilises, blooms spectrally, then folds into the claim.',
    sequence: [
      at('vortex_red_01', 0, { size: 270, speed: 1.55 }),
      at('spectral_bloom_01', 340, { size: 240, speed: 1.15 }),
      haptic(520, 'light'), reveal(560, 'radial'),
      at('void_implosion_01', 650, { size: 250 }),
    ],
  },
  {
    id: 'warm_detonation', name: 'Warm Detonation', duration: 1300,
    description: 'A compact fuse burst expands into a warm blast and ember trail.',
    sequence: [
      at('bomb_blast_01', 0, { size: 180, speed: 1.25 }),
      at('warm_explosion_01', 240, { size: 280 }),
      haptic(240, 'medium'), shake(260, 1.15), reveal(320),
      at('ember_jet_01', 420, { size: 230, speed: 1.2 }),
    ],
  },
  {
    id: 'frostbite', name: 'Frostbite', duration: 2200,
    description: 'A contained frost nova flowers into a long crystalline freeze.',
    sequence: [
      at('frost_nova_01', 0, { size: 230 }),
      reveal(260), haptic(280, 'light'),
      at('freezing_bloom_01', 220, { size: 300, speed: 1.7 }),
      at('magic_bubbles_01', 650, { size: 220, speed: 1.7, opacity: 0.72 }),
    ],
  },
  {
    id: 'inferno', name: 'Inferno', duration: 1700,
    description: 'A ring of fire winds up before a rising flame and hot centre impact.',
    sequence: [
      at('fire_spin_01', 0, { size: 280, speed: 1.7 }),
      at('fire_column_01', 180, { size: 270, speed: 1.6 }),
      at('warm_explosion_01', 420, { size: 250 }),
      haptic(420, 'medium'), shake(440, 0.8), reveal(480),
    ],
  },
  {
    id: 'void_collapse', name: 'Void Collapse', duration: 1900,
    description: 'A red vortex compresses into a violet singularity and sharp collapse.',
    sequence: [
      at('vortex_red_01', 0, { size: 280, speed: 1.55 }),
      at('magic_infinity_01', 220, { size: 230, speed: 1.4, opacity: 0.82 }),
      at('void_implosion_01', 620, { size: 270 }),
      haptic(620, 'medium'), shake(640, 0.7), reveal(660, 'radial'),
    ],
  },
  {
    id: 'radiant_claim', name: 'Radiant Claim', duration: 1400,
    description: 'A clean gold pillar marks the ground and opens into a bright solar ring.',
    sequence: [
      at('radiant_heal_01', 0, { size: 240 }),
      at('sunburn_ring_01', 200, { size: 290, speed: 1.6 }),
      haptic(340, 'success'), reveal(360),
      at('spectral_bloom_01', 450, { size: 220, speed: 1.15, opacity: 0.75 }),
    ],
  },
  {
    id: 'earthshaker', name: 'Earthshaker', duration: 1400,
    description: 'The ground splits, hits hard, and seals beneath a warm impact.',
    sequence: [
      at('earth_rupture_01', 0, { size: 290, speed: 1.1 }),
      at('impact_shock_01', 330, { size: 300, speed: 1.25 }),
      haptic(330, 'medium'), shake(330, 1.3), reveal(400),
      at('warm_explosion_01', 480, { size: 210, opacity: 0.8 }),
    ],
  },
  {
    id: 'spellbound', name: 'Spellbound', duration: 1900,
    description: 'A long-form spell charge is cut by an arcane parry and released as an orb.',
    sequence: [
      at('magic_spell_01', 0, { size: 280, speed: 1.65 }),
      at('arcane_parry_01', 400, { size: 220 }),
      at('magical_projectile_01', 650, { size: 210, speed: 1.4 }),
      haptic(680, 'light'), reveal(720),
    ],
  },
  {
    id: 'cosmic_bloom', name: 'Cosmic Bloom', duration: 2100,
    description: 'A blue nebula opens around a spectral core with an infinity afterimage.',
    sequence: [
      at('nebula_burst_01', 0, { size: 300, speed: 1.55 }),
      at('spectral_bloom_01', 340, { size: 250 }),
      reveal(500), haptic(520, 'success'),
      at('magic_infinity_01', 600, { size: 210, speed: 1.5, opacity: 0.75 }),
    ],
  },
  {
    id: 'blue_nova', name: 'Blue Nova', duration: 1600,
    description: 'Blue fire coils around a frost core before an electric finish.',
    sequence: [
      at('blue_fire_01', 0, { size: 270, speed: 1.55 }),
      at('frost_nova_01', 300, { size: 230 }),
      at('electric_burst_01', 520, { size: 250, speed: 1.3 }),
      haptic(520, 'medium'), reveal(570),
    ],
  },
  {
    id: 'solar_shatter', name: 'Solar Shatter', duration: 1500,
    description: 'A solar ring tightens and breaks into a crisp shrapnel star.',
    sequence: [
      at('sunburn_ring_01', 0, { size: 270, speed: 1.7 }),
      at('solar_shrapnel_01', 320, { anchor: 'territoryTop', size: 250 }),
      at('solar_shrapnel_01', 440, { anchor: 'randomTerritoryPoint', size: 190, speed: 1.25 }),
      haptic(360, 'medium'), shake(380, 0.85), reveal(440),
      at('radiant_heal_01', 600, { size: 190, opacity: 0.72 }),
    ],
  },
  {
    id: 'acid_rain', name: 'Acid Rain', duration: 1800,
    description: 'A magical droplet breaks into an acid pool with bubbling residue.',
    sequence: [
      at('magical_projectile_01', 0, { anchor: 'territoryTop', size: 170, speed: 1.2 }),
      at('acid_splash_01', 300, { size: 270 }),
      haptic(310, 'light'), reveal(380),
      at('magic_bubbles_01', 520, { size: 240, speed: 1.8, opacity: 0.8 }),
    ],
  },
  {
    id: 'glitch_takeover', name: 'Glitch Takeover', duration: 2000, releaseApproved: false,
    description: 'A hot digital portal corrupts into an infinity glyph and electric burst.',
    sequence: [
      at('glitch_portal_01', 0, { size: 290, speed: 1.8, optional: true }),
      at('magic_infinity_01', 420, { size: 230, speed: 1.55 }),
      at('electric_burst_01', 680, { size: 260, speed: 1.3 }),
      haptic(680, 'medium'), shake(700, 0.7), reveal(740, 'glitch'),
    ],
  },
  {
    id: 'flower_power', name: 'Flower Power', duration: 1800,
    description: 'A radiant seed blossoms into a spectral bloom and soft nebula.',
    sequence: [
      at('radiant_heal_01', 0, { anchor: 'territoryTop', size: 210 }),
      at('spectral_bloom_01', 180, { size: 250 }),
      at('nebula_burst_01', 360, { size: 280, speed: 1.65, opacity: 0.8 }),
      haptic(380, 'success'), reveal(430),
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

export function resolveCaptureStyle(id) {
  const requested = getCaptureStyle(id);
  if (requested && (__DEV__ || isReleaseApprovedCaptureStyle(requested))) return requested;
  return getCaptureStyle(DEFAULT_CAPTURE_STYLE_ID);
}
