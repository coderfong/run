// Faces for the capture encounter.
//
// PASER avatars are composited at runtime by CharacterRig, so an "expression"
// is not a separate sprite — it's the same equipped set with the `face` slot
// swapped. That means the attacker keeps their hair, hat, glasses and colours
// through every beat; nothing can jump between poses.
//
// The ids below are real entries in the `face` catalogue (config/cosmetics.js).
// Keep them that way: an unknown id would fall through to the default face and
// the beat would silently lose its expression.

const FACE = {
  // Attacker, sizing up the ground before the hit.
  smug: 'smirk',
  // Attacker mid-dash — teeth-out, committed.
  attack: 'joy',
  // Chomp variant: mischievous rather than graphic.
  cheeky: 'tongueout',
  sly: 'sly',
  // Attacker, having won.
  victory: 'beam',
  celebrate: 'laugh',
  // Defenders.
  startled: 'whoa',
  gasp: 'gasp',
  glum: 'glum',
  sad: 'sad',
};

// Swap one slot, keep everything else the runner is wearing. Returns a new
// object so it can be memoised safely by callers.
export function withFace(equipped, key) {
  const face = FACE[key];
  if (!face) return equipped || {};
  return { ...(equipped || {}), face };
}

// The attacker's face for a given variant at a given beat.
export function attackerFace(variant, beat) {
  if (beat === 'intro') return 'smug';
  if (beat === 'victory') return 'victory';
  if (beat === 'attack') {
    if (variant === 'chomp') return 'cheeky';
    if (variant === 'bonk') return 'attack';
    return 'attack';
  }
  return 'smug';
}

// Defenders start neutral (their own equipped face) and only react on impact,
// so the hit reads as the thing that changed their expression.
export function defenderFace(variant, beat) {
  if (beat !== 'impact') return null;
  return variant === 'chomp' ? 'gasp' : 'startled';
}

export { FACE };
