// Progression client config — the visual/data mirror of backend/app/progression.py.
// The backend owns the authoritative ladder (served by /me/progression); this
// file describes how each reward LOOKS (border tiers, claim shapes, FX, rarity
// colours) and the same level maths so the HUD can render without a round-trip.

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

export function borderForLevel(level) {
  let tier = BORDER_TIERS[0];
  for (const t of BORDER_TIERS) if (level >= t.minLevel) tier = t;
  return tier;
}
export function borderByKey(key) {
  return BORDER_TIERS.find((t) => t.key === key) || BORDER_TIERS[0];
}

// Claim polygon shapes (the stamp a run leaves). `sides`/`type` drive the
// client preview; the server rebuilds the authoritative polygon.
export const SHAPES = {
  circle: { key: 'circle', label: 'Circle', type: 'circle' },
  hexagon: { key: 'hexagon', label: 'Hexagon', type: 'polygon', sides: 6 },
  star: { key: 'star', label: 'Star', type: 'star', points: 5 },
  heart: { key: 'heart', label: 'Heart', type: 'heart' },
  gem: { key: 'gem', label: 'Gem', type: 'polygon', sides: 8 },
};

// Claim-land explosion FX ids → the Lottie asset dropped in at that key.
// (Art TODO: assets/lottie/claim-<key>.json — component no-ops until present.)
export const CLAIM_FX = {
  burst: { key: 'burst', label: 'Burst' },
  shockwave: { key: 'shockwave', label: 'Shockwave' },
  fireworks: { key: 'fireworks', label: 'Fireworks' },
  supernova: { key: 'supernova', label: 'Supernova' },
};

export const RARITY_COLORS = {
  common: '#9aa0a6',
  rare: '#4aa3ff',
  epic: '#b06bff',
  legendary: '#ffb020',
};

// Icon/label for a ladder reward descriptor {kind,key,label}.
export const REWARD_KIND_LABEL = {
  border: 'Portrait border',
  shape: 'Claim shape',
  fx: 'Claim explosion',
  lootbox: 'Lootbox',
  energy_cap: 'Energy cap',
  cosmetic: 'Collectible',
};

// A `level(n)` unlock predicate matching the cosmetics.js unlock shape, so new
// level-gated collectibles can be authored the same way as runs()/dist()/etc.
// (stat name matches MeStats.level.)
export const levelUnlock = (n, label) => ({ stat: 'level', value: n, label: label || `Reach level ${n}` });
