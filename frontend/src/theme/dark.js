// Dark "night run" theme — INDIGO NIGHT. Three surface steps, one hue:
//   base   #1A1542  (screen)
//   raised #272061  (cards, panels)
//   high   #342B7A  (nested / pressed)
//
// These were three neutral greys (#0B0D10 / #15181D / #1D2127), and in a
// neo-brutalist app that read as the style switched off. Every other surface in
// the system is a FLAT SATURATED FILL, and the page, the biggest surface of
// all, was the one thing with no colour in it: the deck accents, the teal drop
// and the cream strokes had nothing to push against, so dark looked like the
// light scheme with the lights out rather than a design of its own.
//
// Indigo because it is the brand's own purple taken down to night, so the page
// belongs to PASER rather than to a stock dark mode, and because every deck
// colour, the teal drop and the cream stroke stand clear of it. White type
// still clears 14:1 on a card. Both are asserted in __tests__/nb.test.js, along
// with the rule that the page stays a colour and never drifts back to grey.
//
// `grid` is the other half: the page's DOT GRID, drawn by
// components/ui/PageTexture behind every Screen. A flat page of any colour is
// still a flat page, and a dot grid is the ground the reference boards stand
// their boxes on. It is the cream stroke at 16%, which keeps it a texture and
// not a line: it has to sit well below any stroke (also asserted), or it starts
// competing with the boxes it exists to set off. The light palette sets it to
// null, so paper stays plain.
//
// The old rule here was "no shadows on dark — depth comes from surface color".
// That still holds for the SOFT shadows it was written about, which do nothing
// on a dark page. It does NOT hold for the neo-brutalist hard drop: that
// shadow is a solid offset block in a saturated accent, so it is not trying to
// fake light falling on a surface and it does not need a light background to
// be visible. See `nbDrop` in nb.js.

export const SURFACE = {
  base: '#1a1542',
  raised: '#272061',
  high: '#342b7a',
};

export const darkColors = {
  bg: SURFACE.base,
  bgElevated: SURFACE.raised,
  card: SURFACE.raised,
  cardAlt: SURFACE.high,
  border: 'rgba(255,255,255,0.10)',

  // The neo-brutalist stroke: warm cream, matching the paper the frames are
  // drawn on. Deliberately not `text` (#ffffff) — a 3pt pure-white outline
  // buzzes against a dark page, and it would make every framed box and every
  // stroked box read as two different whites sitting side by side.
  ink: '#f5f1e6',

  // The page's dot grid: `ink` at 16%. See the header, and PageTexture.
  grid: 'rgba(245,241,230,0.16)',

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
