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

import { contrastRatio, readableInk, shadow } from './tokens';

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
  magenta: '#ec4899',
  purple: '#8b5cf6',
  teal: '#2dd4bf',
  yellow: '#ffd54a',
  blue: '#4d96ff',
  coral: '#ff6b4a',
  green: '#3ddc84',
  lilac: '#c4b5fd',
};

// THE DECK — the six colours that get dealt out to repeated elements.
//
// Neo-brutalism is not one accent used consistently; the reference boards run
// six or seven flat colours at once and let adjacency do the work. A row of
// chips in a single hue reads as a form, the same row in six reads as the
// style. Ordered so neighbours contrast: pink then purple then teal, rather
// than the three warm ones together.
//
// Six, not eight. `green` is reserved for success and `lilac` is the muted
// step for disabled or inactive states, and dealing either one out at random
// would make a chip look like a status.
export const NB_DECK = [
  nbAccents.magenta,
  nbAccents.purple,
  nbAccents.teal,
  nbAccents.yellow,
  nbAccents.blue,
  nbAccents.coral,
];

// Same hash as `seedHash` in ui/frameRegistry, and deliberately the same idiom:
// this app already deals every repeated element a frame and a pose off a seed
// string, and colour is the third thing dealt from the same hat. Kept local
// rather than imported so the theme layer does not depend on the frame layer.
function seedHash(seed) {
  const key = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/**
 * Deal a colour from the deck, the same way every time for the same `seed`.
 *
 * Deterministic for exactly the reason `frameVariant` is: a list that re-rolled
 * its colours on every render would strobe as it re-renders, and one that
 * re-rolled on scroll would do it while you watch. Seed it with whatever
 * identifies the element — an id, a label, a route name.
 *
 * `shift` deals a different colour for the same seed, so two things belonging to
 * one row (a chip and the icon bubble beside it) can differ without inventing a
 * second seed.
 */
export function nbAccentFor(seed, shift = 0) {
  return NB_DECK[(seedHash(seed) + shift) % NB_DECK.length];
}

/**
 * A text colour that is actually READABLE on `fill`.
 *
 * Not `nbInk`, and the difference matters as colour spreads: `nbInk` picks a
 * LINE colour and holds it to 2.4:1, which is the right bar for a stroke and
 * far too low for type. Every colour in the deck is mid-to-light, so ink wins
 * on almost all of them — but coral and magenta are close enough to the line
 * that guessing gets it wrong, and a label is the thing you cannot afford to
 * lose.
 */
export function nbTextOn(fill) {
  const onInk = contrastRatio(NB.ink, fill);
  if (onInk == null) return NB.ink;
  return onInk >= 4.5 ? NB.ink : '#ffffff';
}

// The default shadow colour on dark, when a caller has not chosen one. Teal
// because it is the coolest of the five and so argues least with the pink the
// brand CTA already puts on most screens.
export const NB_DROP_DARK = nbAccents.teal;

// FOCUS ALWAYS VISIBLE — a usage rule on the reference system sheet, printed
// twice on it, and the one rule of the five that this app had no answer to at
// all: a focused field looked exactly like an unfocused one.
//
// Yellow because the sheet already spends it that way. It is the ring on the
// secondary buttons and the fill on a toggle that is ON, which makes it the
// system's "this one is live" colour rather than a sixth accent chosen here.
// It also survives both schemes without a branch, which matters for a state
// that has to be unmistakable: there is nothing in either palette it can be
// confused with.
//
// Chrome only, and no exception to the clan-colour rule: focus is transient and
// belongs to the control, never to a run, a territory or a stat.
export const NB_FOCUS = nbAccents.yellow;

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
 * The box style for a TEXT FIELD.
 *
 * Inputs are the one surface that was left reading as a web form: a 1pt
 * `colors.border` hairline round a `card` fill, repeated by hand in nine
 * different screens because there has never been an Input component. Beside a
 * button carrying a 3pt stroke and a hard drop, that hairline read as disabled.
 *
 * A field takes the STROKE AND NOT THE DROP, which is the one place this style
 * distinguishes between two kinds of box. A button is a block sitting on top of
 * the page and the drop is what says you can push it down. A field is a hole
 * you type into: it belongs flush with the page, and an offset block behind it
 * would say the opposite of what it is.
 *
 * `on`     the field's own fill, so the stroke is judged against what it is
 *          actually drawn on rather than off the scheme.
 * `error`  the invalid state's colour, which replaces the ink outright — a
 *          field that failed validation is the one time the edge should stop
 *          being neutral chrome and start being the message.
 */
export function nbField(scheme, { on, error, stroke = NB.stroke } = {}) {
  return {
    borderWidth: stroke,
    borderColor: error || nbInk(scheme, on),
    borderRadius: nbRadius.sm,
  };
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
