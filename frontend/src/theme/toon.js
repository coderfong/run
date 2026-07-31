// "Toon" tokens — the playful, game-like surface layered over the PASER
// design system: chunky outlined display type, glossy pill CTAs, ink-outlined
// cards with a hard offset shadow.
//
// IMPORTANT — this look is fundamentally a LIGHT UI. A hard black outline and
// a hard drop shadow are invisible on a dark surface, so `toonSurface()`
// swaps them for a soft light rim + no shadow when the dark scheme is active
// (dark stays on the constitution's "depth comes from surface steps" rule).
// If you want the reference look everywhere, ship light as the default.

import { fonts } from './tokens';

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

export const toonRadius = { panel: 26, sheet: 28, card: 22, cell: 16, pill: 999 };

// Scheme-aware chrome for outlined surfaces. Spread `outline` onto a View to
// get the border, and `shadow` for the hard offset drop.
export function toonSurface(colors, scheme) {
  const dark = scheme === 'dark';
  return {
    dark,
    ink: dark ? '#04050A' : toon.ink,
    outline: dark
      ? { borderWidth: 1, borderColor: colors.border }
      : { borderWidth: 2.5, borderColor: toon.ink },
    shadow: dark
      ? {}
      : {
          shadowColor: toon.ink,
          shadowOpacity: 0.22,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        },
  };
}
