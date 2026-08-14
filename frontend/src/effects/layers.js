// Screen-space claim overlays share one explicit stacking contract. Mapbox
// content is below these values; ResultScreen UI is always above them.
export const CAPTURE_LAYER = Object.freeze({
  TERRITORY_REVEAL: 20,
  // Things that happen ON the ground: a shadow cast onto it, fissures, slabs
  // lifting, a scanline crossing it. Above the reveal so they are visible over
  // claimed colour, below the cast so people stand on top of them.
  //
  // NOTE: this is the INTENT, but `EnvironmentLayer`'s ground instance is
  // rendered inside CaptureStylePlayer, whose own outer container carries
  // FOREGROUND_FX (40) so ITS air-level primitives (flash, dust) can cover
  // the cast — which means the WHOLE subtree, ground primitives included,
  // actually paints above CHARACTER regardless of this value. Small,
  // translucent ground shapes (a shadow ellipse, thin cracks) get away with
  // it visually; nothing that size-and-opacity-sensitive has been fixed
  // properly (extracting the ground layer to a true sibling, the way
  // CaptureCast already was) because nothing needed it enough to justify the
  // refactor — until CUTSCENE_BACKDROP below, which is why THAT is a
  // standalone component instead of another environment primitive.
  ENVIRONMENT_GROUND: 22,
  // A solid black stage behind the character cutscene specifically — see
  // components/claim/CutsceneBackdrop.js. A real sibling of CaptureCast
  // (rendered directly by ResultScreen, not inside CaptureStylePlayer), so
  // this value is compared against CHARACTER (30) for real and the
  // FOREGROUND_FX problem above does not apply to it.
  CUTSCENE_BACKDROP: 24,
  CHARACTER: 30,
  FOREGROUND_FX: 40,
  // Things that happen in the AIR or over the whole scene: a flash, a dust
  // veil, wind, a shadow passing overhead. These pass in front of everyone.
  ENVIRONMENT_AIR: 45,
  VICTORY: 50,
  UI: 100,
});
