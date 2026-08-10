// Progression client config — the visual/data mirror of backend/app/progression.py.
// The backend owns the authoritative ladder (served by /me/progression); this
// file describes how each reward LOOKS (border tiers, FX, rarity colours) and
// the same level maths so the HUD can render without a round-trip.

export const MAX_LEVEL = 50;
const XP_BASE = 100;

export function levelFromXp(xp) {
  if (!xp || xp <= 0) return 0;
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(xp / XP_BASE)));
}
export function xpForLevel(level) {
  return XP_BASE * level * level;
}
export function energyMax(level) {
  return 100 + 5 * Math.floor(level / 10);
}

// Portrait border tiers — the always-visible "what level are you" ring. Keep in
// sync with BORDER_TIERS in progression.py. `ring` is a colour or a gradient
// (array); `glow` adds a soft outer halo for the premium tiers.
export const BORDER_TIERS = [
  { key: 'none', label: 'None', minLevel: 0, ring: 'rgba(255,255,255,0.25)', glow: false },
  { key: 'wood', label: 'Wood', minLevel: 1, ring: '#9c6b3f', glow: false },
  { key: 'bronze', label: 'Bronze', minLevel: 5, ring: '#cd7f32', glow: false },
  { key: 'silver', label: 'Silver', minLevel: 10, ring: '#c7ccd1', glow: false },
  { key: 'gold', label: 'Gold', minLevel: 15, ring: '#ffcf4a', glow: true },
  { key: 'platinum', label: 'Platinum', minLevel: 20, ring: '#d7e9f5', glow: true },
  { key: 'diamond', label: 'Diamond', minLevel: 25, ring: '#7ce7ff', glow: true },
  { key: 'onyx', label: 'Onyx', minLevel: 30, ring: ['#3a3a44', '#8a8aa0'], glow: true },
  { key: 'ember', label: 'Ember', minLevel: 36, ring: ['#ff8a3d', '#ff3d6a'], glow: true },
  { key: 'prismatic', label: 'Prismatic', minLevel: 43, ring: ['#ec4899', '#8b5cf6', '#2dd4bf'], glow: true },
  { key: 'mythic', label: 'Mythic', minLevel: 50, ring: ['#ffd76a', '#ff6ad5', '#6a9bff'], glow: true },
];

// ---------------------------------------------------------------------------
// Level bands — one SOLID colour per five levels
// ---------------------------------------------------------------------------
//
// The level badge used to be painted in the clan accent, which meant it said
// what club you were in rather than how far you had come, and two players
// forty levels apart wore the same chip. It steps every five levels now: five
// levels is roughly the span where the number itself stops looking new, and
// ten bands cover the whole 1..50 ladder.
//
// These are FILLS with white numerals on them, so every one is dark enough to
// clear 4.5:1 against white. Neighbouring bands are deliberately from
// different hue families — the point of the band is that a step is visible at
// a glance, and two adjacent teals would not be.
export const LEVEL_BANDS = [
  { min: 1, color: '#57534E' },   // stone
  { min: 5, color: '#0F766E' },   // teal
  { min: 10, color: '#B45309' },  // amber
  { min: 15, color: '#1D4ED8' },  // blue
  { min: 20, color: '#BE123C' },  // rose
  { min: 25, color: '#047857' },  // emerald
  { min: 30, color: '#6D28D9' },  // violet
  { min: 35, color: '#C2410C' },  // orange
  { min: 40, color: '#0369A1' },  // sky
  { min: 45, color: '#A16207' },  // gold — the last band, and it looks it
];

// Level 0 is nobody's badge colour: it is the state before the first run has
// landed, so it gets a neutral rather than the first band's stone.
const LEVEL_ZERO_COLOR = '#3F3F46';

export function levelBandColor(level) {
  let color = LEVEL_ZERO_COLOR;
  for (const band of LEVEL_BANDS) if (level >= band.min) color = band.color;
  return color;
}

export function borderForLevel(level) {
  let tier = BORDER_TIERS[0];
  for (const t of BORDER_TIERS) if (level >= t.minLevel) tier = t;
  return tier;
}
export function borderByKey(key) {
  return BORDER_TIERS.find((t) => t.key === key) || BORDER_TIERS[0];
}

// Claim shapes (circle/hexagon/star/heart/gem) used to live here. A claim is
// no longer a stamp you pick: it is the territory grown around the route you
// actually ran (backend/app/geospatial.route_claim_polygon_wgs).

export const RARITY_COLORS = {
  common: '#9aa0a6',
  rare: '#4aa3ff',
  epic: '#b06bff',
  legendary: '#ffb020',
};

// Icon/label for a ladder reward descriptor {kind,key,label}.
export const REWARD_KIND_LABEL = {
  border: 'Portrait border',
  lootbox: 'Lootbox',
  energy_cap: 'Energy cap',
  cosmetic: 'Collectible',
};

// A `level(n)` unlock predicate matching the cosmetics.js unlock shape, so new
// level-gated collectibles can be authored the same way as runs()/dist()/etc.
// (stat name matches MeStats.level.)
export const levelUnlock = (n, label) => ({ stat: 'level', value: n, label: label || `Reach level ${n}` });
