// The frame drawn around the BOARD, one per rank tier.
//
// Installed by scripts/install-map-frames.py — re-run that rather than
// hand-editing anything here. Keys are BORDER_TIERS keys; `none` has no art on
// purpose and falls back to the plain NB stroke, because the tier below wood is
// the state before the first run has landed and should not be dressed up as a
// rank. (The pack these replaced was cut off a contact sheet by
// cut-rank-frames.py, which is kept for the next sheet that arrives that way.)
//
// THIN, AND CROPPED TO THE INK. The board wears these on the screen's own
// edges, so every pixel of margin baked into a file is a pixel of map covered
// for nothing — the installer crops each to its alpha bounding box for exactly
// that reason. The art itself spends 5.6-8.5% of its width on the band, against
// the 10-13% the previous pack drew, which is most of what the map got back.
//
// These are drawn at roughly 0.56 and the board they sit on runs from 0.50 to
// 0.53, so they are STRETCHED to fit rather than nine-sliced. That is
// deliberate: every one of these tiers hangs an ornament off the middle of a
// rail — a gem, a star, a finial — and a nine slice stretches exactly that
// span. A frame carries a few percent of aspect error invisibly; it does not
// survive having its centrepiece smeared sideways.

export const MAP_FRAME_ART = {
  wood: require('../../assets/borders/map/wood.png'),
  bronze: require('../../assets/borders/map/bronze.png'),
  silver: require('../../assets/borders/map/silver.png'),
  gold: require('../../assets/borders/map/gold.png'),
  platinum: require('../../assets/borders/map/platinum.png'),
  diamond: require('../../assets/borders/map/diamond.png'),
  onyx: require('../../assets/borders/map/onyx.png'),
  ember: require('../../assets/borders/map/ember.png'),
  prismatic: require('../../assets/borders/map/prismatic.png'),
  mythic: require('../../assets/borders/map/mythic.png'),
};

// How far down its own art a frame's TOP RAIL starts, as a share of the art's
// height. Zero for every tier but one: mythic hangs a flame crest above its
// rail, so its alpha box (what the installer crops to) is taller than the
// frame, and stretched into the board the rail landed about 4% down the
// screen with bare map above it. The board lifts that art by this much, so the
// rail meets the top edge and the crest runs up off the glass. Measured on
// mythic.png: the rail's first opaque row is 62 of 1570. Re-measure if
// install-map-frames.py replaces the file.
export const MAP_FRAME_CREST = {
  mythic: 62 / 1570,
};

// The backing every one of these colours is drawn on: the name chip in the
// map's view selector, and the scrim over a locked board. Both are a constant
// near-black on purpose, so there is exactly one thing to be legible against.
const ON = '#0B0B0F';
// Large bold type. WCAG puts that at 3:1; a little over gives the palest tier
// somewhere to sit without letting a genuinely dark stop through.
const MIN_CONTRAST = 3.5;

/**
 * A tier's `ring` is a colour or a gradient (an array of stops). Anywhere the
 * rank has to be said in ONE colour, this picks which stop that is.
 *
 * The FIRST stop that is legible on the dark backing wins, because the first
 * stop is the tier's identity — prismatic is the pink one, and answering with
 * its teal because teal happens to be brighter says the wrong rank. Only when
 * no stop clears the bar does the brightest win outright.
 *
 * The tier this exists for is onyx: its ring runs ['#3a3a44', '#8a8aa0'] and
 * #3a3a44 on near-black is invisible, so it correctly falls through to the
 * pale end. Every other tier keeps the colour it leads with.
 */
export function rankColor(tier) {
  const ring = tier?.ring;
  if (!Array.isArray(ring)) return ring;
  const legible = ring.find((stop) => contrast(stop, ON) >= MIN_CONTRAST);
  if (legible) return legible;
  return ring.reduce((best, stop) => (relLuma(stop) > relLuma(best) ? stop : best), ring[0]);
}

function channels(hex) {
  const s = String(hex).replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG relative luminance: sRGB channels linearised, then weighted.
function relLuma(hex) {
  const rgb = channels(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relLuma(a);
  const lb = relLuma(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export default MAP_FRAME_ART;
