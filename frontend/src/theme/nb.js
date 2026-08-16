// Neo-brutalist surface tokens.
//
// The style is three decisions, not a mood: a HEAVY STROKE on every functional
// box, a HARD OFFSET SHADOW with zero blur behind it, and FLAT SATURATED FILLS
// with no gradient anywhere. Everything else (limited radii, huge headings,
// visible focus) falls out of those three.
//
// THE DARK PROBLEM, and why this file exists separately from `toon.js`:
//
// A pitch-black stroke and a pitch-black shadow are the canonical recipe, and
// both are invisible on a dark page. The old `toonSurface()` handled that by
// giving up on dark — 1pt of 10% white and no shadow at all — which is why the
// app only ever looked neo-brutalist in light mode. It is not a lost cause,
// it just needs the device INVERTED rather than dropped:
//
//   light   near-black stroke, near-black shadow. The reference recipe.
//   dark    warm cream stroke, and the shadow moves to a SATURATED ACCENT.
//
// The accent shadow is the important half. On dark, black-on-black reads as
// nothing, and a grey shadow reads as a rendering mistake; a solid block of
// teal or magenta offset four points down-right reads as intentional, keeps
// the hard-edged geometry, and is the one place the palette gets to shout.

import { readableInk, shadow } from './tokens';

// ---------------------------------------------------------------------------
// The three constants everything else is derived from.
// ---------------------------------------------------------------------------

export const NB = {
  // Stroke width IN POINTS. `stroke` is the default for cards, buttons and
  // headers; `strokeThin` is for controls small enough that 3pt would eat
  // them (chips, segmented tracks, badges).
  stroke: 3,
  strokeThin: 2,

  // Hard shadow displacement. X AND Y, always equal, always the same direction
  // (down-right) so the whole page looks lit from one corner. Zero blur, full
  // opacity: see `hardShadow`.
  offset: 4,
  offsetSm: 3,

  // The strokes. Neither is pure: pure black goes muddy against saturated
  // fills, and pure white on dark buzzes against the cream paper the frames
  // are drawn on.
  ink: '#0c0c10',
  inkLight: '#f5f1e6',

  // The light scheme's page colour. Warm, because the hand-drawn frames were
  // drawn on paper and a cool grey page makes them read as photocopies.
  paper: '#f5f1e6',
};

// ---------------------------------------------------------------------------
// Accents.
//
// PASER already owns pink, purple and teal, so these are the brand colours
// promoted to flat blocks rather than a new palette bolted on beside them.
// Yellow is the one genuine addition: neo-brutalism leans on it constantly and
// the app had no warm accent at all.
//
// NOTE — this collides with a standing rule (clan colours are the only
// saturated hues on screen). That rule and this style cannot both be true.
// These are scoped to CHROME (shadows, chips, the active tab, empty states);
// territory, trails and stats stay clan-coloured, so the two only meet at the
// edges. If a clan colour and an accent shadow ever fight, the clan wins.
// ---------------------------------------------------------------------------

export const nbAccents = {
  teal: '#2dd4bf',
  magenta: '#ec4899',
  purple: '#8b5cf6',
  yellow: '#ffd54a',
  coral: '#ff6b4a',
};

// The default shadow colour on dark, when a caller has not chosen one. Teal
// because it is the coolest of the five and so argues least with the pink the
// brand CTA already puts on most screens.
export const NB_DROP_DARK = nbAccents.teal;

// ---------------------------------------------------------------------------
// Radii. The reference system sheet says 0 / 12 / 24 and nothing between, and
// the "limited radii" rule is doing real work: a scale with six steps in it
// reads as softness no matter how heavy the strokes are.
// ---------------------------------------------------------------------------

export const nbRadius = { none: 0, sm: 12, lg: 24, pill: 999 };

// The iOS shadow props for a zero-blur offset drop. The recipe itself lives in
// tokens.js as `shadow.hard` (this file already imports from there, so defining
// it here too would close an import cycle); this is the neo-brutalist default
// offset applied to it, which is what call sites actually want.
export function hardShadow(color, offset = NB.offset) {
  return shadow.hard(color, offset);
}

/**
 * The stroke colour a neo-brutalist box should actually draw with.
 *
 * Same contract as the frames' `frameInkFor`, and for the same reason: a box
 * is not always on the page background. A chip on a magenta panel, a card on
 * the pixel meadow, a button on a clan colour — each needs the stroke judged
 * against what it is really sitting on, or it disappears on exactly the
 * surfaces that matter most.
 *
 * `on` is that surface. With none supplied the scheme decides, which is right
 * for the ordinary case of a box sitting on the page.
 */
export function nbInk(scheme, on) {
  const prefer = scheme === 'dark' ? NB.inkLight : NB.ink;
  if (!on) return prefer;
  return readableInk(on, { prefer, dark: NB.ink, light: NB.inkLight });
}

/**
 * The shadow colour to drop behind a box on `surface`.
 *
 * Light is the reference recipe and needs no thought: black. Dark takes the
 * caller's accent, and falls back to teal. The one case worth handling is a
 * LIGHT box on the dark page — a cream card, a yellow chip — where black is
 * once again the right answer, because the shadow is read against the box it
 * falls from as much as against the page.
 */
export function nbDrop(scheme, { on, accent } = {}) {
  if (scheme !== 'dark') return NB.ink;
  if (on) {
    const ink = readableInk(on, { prefer: NB.inkLight, dark: NB.ink, light: NB.inkLight });
    if (ink === NB.ink) return NB.ink;
  }
  return accent || NB_DROP_DARK;
}
