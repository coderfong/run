// Screen-space claim overlays share one explicit stacking contract. Mapbox
// content is below these values; ResultScreen UI is always above them.
export const CAPTURE_LAYER = Object.freeze({
  TERRITORY_REVEAL: 20,
  CHARACTER: 30,
  FOREGROUND_FX: 40,
  VICTORY: 50,
  UI: 100,
});
