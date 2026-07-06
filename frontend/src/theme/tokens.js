// Scale tokens: fonts, radius, spacing, elevation, type scale, and the
// run-recording tuning constants. Color-bearing type styles resolve their
// default color from the light palette (screens override `color` as needed).

import { colors } from './light';

// ---------------------------------------------------------------------------
// Fonts (keys must match the families passed to useFonts in App.js)
// ---------------------------------------------------------------------------

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

// '#2563eb' + 0.32 -> 'rgba(37,99,235,0.32)'. For map fill/stroke colours.
export function withAlpha(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ---------------------------------------------------------------------------
// Radius + spacing scales. Spacing is the ONLY source of padding/margin in
// screens (constitution). Gutter 20, card padding 16, section gap 24.
// ---------------------------------------------------------------------------

export const radius = {
  sm: 8,
  md: 14,
  card: 16,
  lg: 22,
  sheet: 24,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
  gutter: 20, // standard screen horizontal gutter
};

// ---------------------------------------------------------------------------
// Elevation — exactly three levels. Never combine border + shadow on one
// element. `glow(color)` is the ONE signature effect, reserved for the
// Record trail, the Result card, and territory rendering.
// ---------------------------------------------------------------------------

export const shadow = {
  flat: {},
  card: {
    shadowColor: '#16181d',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#16181d',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glow: (color) => ({
    shadowColor: color,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  }),
};

// ---------------------------------------------------------------------------
// Type scale. Every text style comes from here — screens override `color`
// only. Live-updating numbers use the stat* styles (tabular numerals).
// ---------------------------------------------------------------------------

const TABULAR = ['tabular-nums'];

export const type = {
  display: { fontFamily: fonts.display, fontSize: 34, letterSpacing: -0.5, color: colors.text },
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.3, color: colors.text },
  heading: { fontFamily: fonts.display, fontSize: 18, color: colors.text },

  statHero: { fontFamily: fonts.display, fontSize: 44, letterSpacing: -1, fontVariant: TABULAR, color: colors.text },
  stat: { fontFamily: fonts.displayMedium, fontSize: 28, fontVariant: TABULAR, color: colors.text },
  statMd: { fontFamily: fonts.displayMedium, fontSize: 22, fontVariant: TABULAR, color: colors.text },
  statSm: { fontFamily: fonts.displayMedium, fontSize: 17, fontVariant: TABULAR, color: colors.text },

  body: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.text },
  bodyBold: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  bodySm: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text },
  bodySmBold: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },

  // The only eyebrow style: uppercase Inter 12/600, letter-spaced.
  label: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textMuted },
  labelSm: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },

  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  captionMedium: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.textMuted },

  button: { fontFamily: fonts.semibold, fontSize: 16, color: colors.primaryInk },
  buttonSm: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primaryInk },
};

// ---------------------------------------------------------------------------
// Run-recording tuning (frontend magic numbers; backend thresholds live in
// backend/app/config.py).
// ---------------------------------------------------------------------------

export const runTuning = {
  loopCloseDistanceM: 25,
  minPointsForLoop: 15,
  minDistanceForLoopM: 80,
  openPathM2PerM: 50,

  minStepM: 2,

  gpsHigh: { timeIntervalMs: 1000, distanceIntervalM: 3 },
  gpsRelaxed: { timeIntervalMs: 3000, distanceIntervalM: 8 },
  closureNearM: 100,
  paceChangeMps: 0.6,
  modeStablePoints: 4,

  gpsGoodM: 10,
  gpsOkM: 25,

  persistEveryNPoints: 20,
  holdToFinishMs: 1200,
};
