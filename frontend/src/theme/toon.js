// "Toon" tokens — the playful, game-like surface layered over the PASER
// design system: chunky outlined display type, glossy pill CTAs, ink-outlined
// cards with a hard offset shadow.
//
// This used to be a LIGHT-ONLY look, because a black outline and a black drop
// shadow are invisible on a dark surface and `toonSurface()` responded by
// switching both off. It is now a real two-scheme device: cream stroke and a
// saturated accent shadow on dark, near-black stroke and near-black shadow on
// light. The tokens behind that live in theme/nb.js.

import { fonts } from './tokens';
import { NB, hardShadow, nbDrop, nbInk } from './nb';

const PINK = '#ec4899';
const TEAL = '#2dd4bf';

export const toon = {
  // Ink = the outline colour on every toon element (text, buttons, panels).
  ink: '#0C0C10',
  inkSoft: 'rgba(12,12,16,0.45)',

  // The night stage the onboarding character stands on (top → bottom).
  stage: ['#0B1020', '#10243F', '#0F3B46'],
  ground: '#123A46',
  groundLine: 'rgba(255,255,255,0.10)',

  // The docked picker sheet + its cells.
  sheet: '#2A2B35',
  sheetHeader: '#31323D',
  cell: '#191A21',
  cellOn: '#FFFFFF',

  // Story cards (the tutorial coach marks) sit on a near-white panel.
  card: '#F7F5F2',
  cardInk: '#141418',
};

// The glossy CTA fills. A sheen is painted over the top half at render time.
export const ctaFills = {
  primary: { colors: ['#F97CBB', PINK, '#B4256F'], border: '#0C0C10' },
  gold: { colors: ['#FFD98A', '#F0A93C', '#A8631A'], border: '#0C0C10' },
  teal: { colors: ['#7FF0DE', TEAL, '#128476'], border: '#0C0C10' },
  neutral: { colors: ['#FFFFFF', '#EDEDF2', '#C9C9D2'], border: '#0C0C10' },
};

// Display type: the app's heading font WITHOUT the uppercase transform, so
// headlines read friendly rather than athletic.
export const toonType = {
  hero: { fontFamily: fonts.hero, fontSize: 30, lineHeight: 38, letterSpacing: 0.2, textAlign: 'center' },
  headline: { fontFamily: fonts.hero, fontSize: 25, lineHeight: 33, letterSpacing: 0.2, textAlign: 'center' },
  sub: { fontFamily: fonts.hero, fontSize: 17, lineHeight: 24, letterSpacing: 0.2, textAlign: 'center' },
  title: { fontFamily: fonts.hero, fontSize: 22, lineHeight: 29, letterSpacing: 0.2 },
  button: { fontFamily: fonts.hero, fontSize: 18, letterSpacing: 0.4 },
  body: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.4 },
};

// Snapped to the limited 0/12/24 scale (see `radius` in tokens.js). These were
// 26/28/22/16 — four near-identical roundings that read as one indecisive one.
export const toonRadius = { panel: 24, sheet: 24, card: 12, cell: 12, pill: 999 };

/**
 * Scheme-aware chrome for outlined surfaces. Spread `outline` onto a View to
 * get the stroke, and `shadow` for the hard offset drop.
 *
 * THIS USED TO GIVE UP ON DARK. The old version returned a 1pt 10%-white rim
 * and no shadow at all, on the reasoning that a black outline and a black drop
 * are invisible on a near-black page — which is true, and is why the app only
 * ever looked neo-brutalist in light mode. The fix is to invert the device
 * rather than drop it: a cream stroke, and a shadow in a saturated accent.
 * See the header of theme/nb.js for why the accent shadow is the load-bearing
 * half of that.
 *
 * `on`      what the box is sitting on, when that is not its own fill. A chip
 *           on a magenta panel needs its stroke judged against the panel.
 * `accent`  the dark scheme's shadow colour. Defaults to teal.
 * `stroke`  width in points. `NB.strokeThin` for controls too small for 3pt.
 * `offset`  hard shadow displacement, both axes.
 */
export function toonSurface(colors, scheme, options = {}) {
  const dark = scheme === 'dark';
  const {
    on,
    accent,
    stroke = NB.stroke,
    offset = NB.offset,
  } = options;

  const ink = nbInk(scheme, on);
  return {
    dark,
    ink,
    offset,
    outline: { borderWidth: stroke, borderColor: ink },
    // Note this is the iOS-only form. Components that need the shadow on
    // Android too wrap themselves in `HardShadow` (components/ui) instead of
    // spreading this. See tokens.js `shadow.hard`.
    shadow: hardShadow(nbDrop(scheme, { on, accent }), offset),
  };
}
