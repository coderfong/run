// Dark "night run" theme. Three surface elevation steps:
//   base  #0B0D10  (screen)
//   raised #15181D (cards, panels)
//   high  #1D2127  (nested / pressed)
//
// The old rule here was "no shadows on dark — depth comes from surface color".
// That still holds for the SOFT shadows it was written about, which do nothing
// on a near-black page. It does NOT hold for the neo-brutalist hard drop: that
// shadow is a solid offset block in a saturated accent, so it is not trying to
// fake light falling on a surface and it does not need a light background to
// be visible. See `nbDrop` in nb.js.

export const SURFACE = {
  base: '#0b0d10',
  raised: '#15181d',
  high: '#1d2127',
};

export const darkColors = {
  bg: SURFACE.base,
  bgElevated: SURFACE.raised,
  card: SURFACE.raised,
  cardAlt: SURFACE.high,
  border: 'rgba(255,255,255,0.10)',

  // The neo-brutalist stroke: warm cream, matching the paper the frames are
  // drawn on. Deliberately not `text` (#ffffff) — a 3pt pure-white outline
  // buzzes against a near-black page, and it would make every framed box and
  // every stroked box read as two different whites sitting side by side.
  ink: '#f5f1e6',

  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.66)',
  textDim: 'rgba(255,255,255,0.42)',

  primary: '#ffffff',
  primaryInk: '#0b0d10',

  ok: '#3faf74',
  warn: '#c7913e',
  danger: '#d16560',
  dangerSoft: 'rgba(209,101,96,0.16)',
};
