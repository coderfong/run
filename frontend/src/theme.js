// Territory Run — design tokens (v1 "night run" system).
//
// One rule drives the whole palette: there is NO global brand accent.
// A user's team colour IS their accent. `colors.primary` is neutral ink,
// used only on team-agnostic surfaces (Auth, onboarding, neutral CTAs).
//
// Type: Space Grotesk for display/stats (tabular numerals on anything that
// ticks), Inter for body/labels. Both loaded in App.js via expo-font.

// ---------------------------------------------------------------------------
// Font families (must match the keys passed to useFonts in App.js)
// ---------------------------------------------------------------------------

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

// ---------------------------------------------------------------------------
// Team palettes — fill (translucent, territory polygons), stroke (saturated,
// lines/chips/CTAs), glow (bright, dark-mode route glow + stat values),
// tint (solid pastel, light-mode chips/avatars), text (dark, on tint).
// Fills are tuned to ~20% alpha so overlapping rival territories stay legible.
// ---------------------------------------------------------------------------

export const teams = {
  north: {
    key: 'north', name: 'North',
    fill: 'rgba(147,51,234,0.20)', stroke: '#9333ea', glow: '#c084fc',
    tint: '#e9d5ff', text: '#581c87',
  },
  east: {
    // Stroke is green-700 (not 600 like the others): #16a34a only hits
    // 3.3:1 on white cards — 4.5:1 needed for AA text.
    key: 'east', name: 'East',
    fill: 'rgba(21,128,61,0.20)', stroke: '#15803d', glow: '#4ade80',
    tint: '#bbf7d0', text: '#14532d',
  },
  south: {
    key: 'south', name: 'South',
    fill: 'rgba(37,99,235,0.20)', stroke: '#2563eb', glow: '#60a5fa',
    tint: '#bfdbfe', text: '#1e3a8a',
  },
  west: {
    key: 'west', name: 'West',
    fill: 'rgba(220,38,38,0.20)', stroke: '#dc2626', glow: '#f87171',
    tint: '#fecaca', text: '#7f1d1d',
  },
};

// '#2563eb' + 0.32 -> 'rgba(37,99,235,0.32)'. For map fill/stroke colours.
export function withAlpha(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ---------------------------------------------------------------------------
// Light theme — cool off-white, white cards, soft shadows.
// ---------------------------------------------------------------------------

export const colors = {
  bg: '#f7f8fa',
  bgElevated: '#eef0f4',
  card: '#ffffff',
  cardAlt: '#eef0f4',
  border: '#e4e7ec',
  text: '#16181d',
  textMuted: '#6b7280',
  textDim: '#9aa1ab',

  primary: '#16181d', // brand ink — neutral CTA where there is no team yet
  primaryDark: '#000000',
  primaryInk: '#ffffff',

  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  warn: '#d97706',
  ok: '#16a34a',
};

// ---------------------------------------------------------------------------
// Dark "night run" theme — Running screen + Result-after-run. True dark,
// elevated surfaces, team colour used as glow.
// ---------------------------------------------------------------------------

export const darkColors = {
  bg: '#0b0d10',
  bgElevated: '#15181d',
  card: '#15181d',
  cardAlt: '#1c2027',
  border: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.66)',
  textDim: 'rgba(255,255,255,0.42)',

  primary: '#ffffff',
  primaryInk: '#0b0d10',

  danger: '#ef4444',
  dangerSoft: 'rgba(239,68,68,0.16)',
  warn: '#f59e0b',
  ok: '#22c55e',
};

// ---------------------------------------------------------------------------
// Radius + spacing scales
// ---------------------------------------------------------------------------

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// Soft shadows — never harsh. Use `card` for resting cards, `raised` for
// floating panels/sheets, `glow(color)` for the dark-mode team glow.
export const shadow = {
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
// Type scale. Every text style in the app comes from here — screens may
// override `color` only. All live-updating numbers use the `stat*` styles
// (tabular numerals so digits don't jitter as they tick).
// ---------------------------------------------------------------------------

const TABULAR = ['tabular-nums'];

export const type = {
  // Space Grotesk — display
  display: { fontFamily: fonts.display, fontSize: 34, letterSpacing: -0.5, color: colors.text },
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.3, color: colors.text },
  heading: { fontFamily: fonts.display, fontSize: 18, color: colors.text },

  // Space Grotesk — stats (tabular)
  statHero: { fontFamily: fonts.display, fontSize: 44, letterSpacing: -1, fontVariant: TABULAR, color: colors.text },
  stat: { fontFamily: fonts.displayMedium, fontSize: 28, fontVariant: TABULAR, color: colors.text },
  statMd: { fontFamily: fonts.displayMedium, fontSize: 22, fontVariant: TABULAR, color: colors.text },
  statSm: { fontFamily: fonts.displayMedium, fontSize: 17, fontVariant: TABULAR, color: colors.text },

  // Inter — body
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.text },
  bodyBold: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  bodySm: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text },
  bodySmBold: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },

  // Inter — labels/eyebrows (uppercase)
  label: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textMuted },
  labelSm: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },

  // Inter — captions
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  captionMedium: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.textMuted },

  // Inter — buttons
  button: { fontFamily: fonts.semibold, fontSize: 16, color: colors.primaryInk },
  buttonSm: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primaryInk },
};

// ---------------------------------------------------------------------------
// Run-recording tuning (frontend magic numbers live here by convention;
// backend thresholds live in backend/app/config.py).
// ---------------------------------------------------------------------------

export const runTuning = {
  // Loop detection (client-side preview; the server is authoritative).
  loopCloseDistanceM: 25,
  minPointsForLoop: 15,
  minDistanceForLoopM: 80,
  openPathM2PerM: 50, // 0.05 km² per km == a ~50m strip along the route

  // Jitter filter: drop points that moved less than this.
  minStepM: 2,

  // Adaptive GPS sampling. High while pace is changing or a closure is
  // near; relaxed during steady straight-line running (battery).
  gpsHigh: { timeIntervalMs: 1000, distanceIntervalM: 3 },
  gpsRelaxed: { timeIntervalMs: 3000, distanceIntervalM: 8 },
  closureNearM: 100, // within this of an earlier segment -> stay high
  paceChangeMps: 0.6, // speed delta vs recent average that counts as "changing"
  modeStablePoints: 4, // points a mode switch must persist before applying

  // GPS accuracy chip thresholds.
  gpsGoodM: 10,
  gpsOkM: 25,

  // Crash resilience: persist the in-progress run every N accepted points.
  persistEveryNPoints: 20,

  // Hold-to-finish.
  holdToFinishMs: 1200,
};

// ---------------------------------------------------------------------------
// Single tokens object — preferred import for new code.
// ---------------------------------------------------------------------------

export const tokens = {
  fonts,
  teams,
  colors,
  darkColors,
  radius,
  space,
  shadow,
  type,
  runTuning,
  withAlpha,
};

export default tokens;
