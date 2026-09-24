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
  // Attacker mid-dash — committed. (Was 'joy' until that face was deleted.)
  attack: 'determined',
  // Chomp variant: mischievous rather than graphic — a grin, not a snarl.
  cheeky: 'beam',
  sly: 'smirk',
  // Attacker, having won.
  victory: 'beam',
  celebrate: 'beam',
  // Defenders: a small shock for noticing, a bigger one for being hit.
  startled: 'uneasy',
  gasp: 'worried',
  glum: 'glum',
  sad: 'exhausted',
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

/**
 * The face an ACTION implies, so a cutscene gets expressions for free.
 *
 * Every style would otherwise have to hand-author a face on every beat, which
 * is thirty styles of bookkeeping for something the action already tells you:
 * somebody being blown off their feet is not smiling, and somebody who has just
 * won is. A style can still override by putting `face` on the step.
 *
 * Unknown actions return null, which leaves the character wearing whatever
 * face their own cosmetics have on — the correct neutral.
 */
const ACTION_FACE = {
  // The runner, causing it.
  pointSky: 'smug',
  raiseArms: 'smug',
  cast: 'smug',
  charge: 'smug',
  throw: 'attack',
  stomp: 'attack',
  slam: 'attack',
  jumpSlam: 'attack',
  punch: 'attack',
  dashForward: 'attack',
  plant: 'smug',
  celebrate: 'celebrate',
  moveTo: 'victory',
  // Anybody, reacting.
  lookUp: 'startled',
  notice: 'startled',
  surprised: 'gasp',
  duck: 'gasp',
  dodgeLeft: 'startled',
  dodgeRight: 'startled',
  hopBack: 'startled',
  brace: 'startled',
  stumbleLeft: 'glum',
  stumbleRight: 'glum',
  shockwaveKnockback: 'gasp',
  knockback: 'gasp',
  fallAndRecover: 'glum',
  slideToward: 'gasp',
  resistPull: 'gasp',
  wince: 'glum',
  shakeOff: 'glum',
  fleeFrom: 'gasp',
  runLeft: 'gasp',
  runRight: 'gasp',
  portalExit: 'sad',
  glitchJump: 'startled',
  bounceReaction: 'startled',
};

export function faceForAction(action) {
  return ACTION_FACE[action] || null;
}

export { FACE };
