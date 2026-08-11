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
});
