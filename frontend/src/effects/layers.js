// Screen-space claim overlays share one explicit stacking contract. Mapbox
// content is below these values; ResultScreen UI is always above them.
//
// The order below IS the reading order of a capture: the map is the stage, the
// scrim pushes it back without removing it, the ground changes hands on top of
// the map, world primitives sit on that ground, people stand on all of it, and
// only air-level events (a flash, a dust veil) are allowed in front of people.
export const CAPTURE_LAYER = Object.freeze({
  // The contested map, pushed back but never removed.
  //
  // This sits BELOW the territory reveal on purpose, and that is the whole
  // reason it replaced the old solid-black CutsceneBackdrop. That one lived at
  // 24 — ABOVE the reveal at 20 — and was opaque, so the single most important
  // beat in the sequence, the ground actually changing hands, was painted
  // underneath a black curtain and could not be seen until the curtain lifted
  // (which was gated on a defender exit, several hundred ms to two seconds
  // AFTER the wipe had already finished). A capture is supposed to look like it
  // caused the territory change. It cannot, if the change happens off camera.
  MAP_SCRIM: 18,
  TERRITORY_REVEAL: 20,
  // Things that happen ON the ground: a shadow cast onto it, fissures, slabs
  // lifting, a scanline crossing it. Above the reveal so they are visible over
  // claimed colour, below the cast so people stand on top of them.
  //
  // This value is now honoured for real. It used to be a lie: EnvironmentLayer's
  // ground instance was rendered INSIDE CaptureStylePlayer, whose own outer
  // container carries FOREGROUND_FX (40) so its AIR primitives can cover the
  // cast — which meant the whole subtree, ground primitives included, painted
  // above CHARACTER (30). A shadow meant to be cast onto the dirt under
  // somebody was drawn over their face instead, which is a large part of why
  // the scenes read as "coloured shapes around the characters". ResultScreen
  // now mounts the ground instance as a real sibling of CaptureCast, so a
  // shadow is genuinely under the people standing in it.
  ENVIRONMENT_GROUND: 22,
  CHARACTER: 30,
  FOREGROUND_FX: 40,
  // Things that happen in the AIR or over the whole scene: a flash, a dust
  // veil, wind, a shadow passing overhead. These pass in front of everyone.
  ENVIRONMENT_AIR: 45,
  VICTORY: 50,
  UI: 100,
});
