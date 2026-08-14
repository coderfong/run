export const EFFECT_TYPE = Object.freeze({
  SPRITE: 'sprite',
  LOTTIE: 'lottie',
  ANIMATED_IMAGE: 'animated-image',
  STATIC: 'static',
});

export const CAPTURE_ACTION = Object.freeze({
  TERRITORY_REVEAL: 'territoryReveal',
  SCREEN_SHAKE: 'screenShake',
  HAPTIC: 'haptic',
  CHARACTER: 'character',
  SOUND: 'sound',
});

export const EFFECT_ANCHOR = Object.freeze({
  SCREEN_CENTER: 'screenCenter',
  TERRITORY_CENTER: 'territoryCenter',
  TERRITORY_VISUAL_CENTER: 'territoryVisualCenter',
  TERRITORY_TOP: 'territoryTop',
  TERRITORY_BOTTOM: 'territoryBottom',
  CHARACTER_HEAD: 'characterHead',
  CHARACTER_FEET: 'characterFeet',
  CHARACTER_CENTER: 'characterCenter',
  MAP_CENTER: 'mapCenter',
  RANDOM_TERRITORY_POINT: 'randomTerritoryPoint',
  SCREEN_TOP: 'screenTop',
  SCREEN_BOTTOM: 'screenBottom',
  // The rivals. Individual bodies are addressed positionally as
  // `defender[0].head` / `.center` / `.feet` (parsed rather than enumerated,
  // since the cast size is only known at play time), and these three name the
  // group. Without them a style can only aim art at the ground, which is why
  // every event used to land in the middle of the claim regardless of where
  // the people it was happening to were standing.
  DEFENDER_GROUP_CENTER: 'defenderGroupCenter',
  NEAREST_DEFENDER: 'nearestDefender',
  FURTHEST_DEFENDER: 'furthestDefender',
});

/** `defender[2].head` → { index: 2, part: 'head' }, or null for anything else. */
export function parseDefenderAnchor(name) {
  const match = /^defender\[(\d+)\]\.(head|center|feet)$/.exec(String(name || ''));
  return match ? { index: Number(match[1]), part: match[2] } : null;
}

/** The name for a body part of one defender, so styles never build strings. */
export const defenderAnchor = (index, part = 'center') => `defender[${index}].${part}`;
