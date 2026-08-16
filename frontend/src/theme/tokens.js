// Scale tokens: fonts, radius, spacing, elevation, type scale, and the
// run-recording tuning constants. DARK-FIRST: color-bearing type styles
// resolve their default color from the dark palette.

import { darkColors as colors } from './dark';

// ---------------------------------------------------------------------------
// Fonts (keys must match the families passed to useFonts in App.js)
// PASER: Poppins Black (900) is the heading font (wordmark + hero/display/
// title), Space Grotesk for stats (tabular figures), Inter for everything
// else.
// ---------------------------------------------------------------------------

export const fonts = {
  hero: 'Poppins_900Black',
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
// Contrast
// ---------------------------------------------------------------------------
//
// A drawn line has to be VISIBLE against whatever it is drawn on, and in this
// app that is not knowable from the theme alone: the hand-drawn frames sit on
// clan colours, on saturated shortcut tiles, on a pixel-art meadow and on both
// theme surfaces. A tint chosen once at the call site is right for exactly one
// of those and silently invisible on the rest — near-black ink on a dark
// surface, a pale clan colour on a white card.
//
// So the frames ask these instead of guessing. See `readableInk`.

/** rgb triplet from '#rgb', '#rrggbb', '#rrggbbaa' or 'rgb()/rgba()'. */
export function toRgb(color) {
  if (typeof color !== 'string') return null;
  const text = color.trim();
  const fn = text.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(',').map((p) => parseFloat(p));
    if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  let hex = text.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) return null;
  const n = parseInt(hex.slice(0, 6), 16);
  if (!Number.isFinite(n)) return null;
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color) {
  const rgb = toRgb(color);
  if (!rgb) return null;
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A LINE is not text. Text needs 4.5:1 to be readable; a border only has to be
// seen, and holding a drawn frame to a text ratio would rule out every mid-tone
// clan colour the app has. 2.4 is about where a 5pt stroke stops disappearing.
export const INK_MIN_CONTRAST = 2.4;

/**
 * An ink colour that will actually show up on `surface`.
 *
 * `prefer` is the caller's choice and is KEPT whenever it is legible — a clan
 * accent, a brand pink, a theme's muted line all survive on most surfaces, and
 * overriding them would flatten the app to two colours. It is only replaced
 * when it would be invisible, and then by whichever of `dark`/`light` the
 * surface can carry.
 *
 * A null/unparseable surface means "no idea what this is on", and the honest
 * answer there is to leave the caller's choice alone.
 */
export function readableInk(surface, {
  prefer,
  dark = '#0C0C10',
  light = '#F4F4F7',
  min = INK_MIN_CONTRAST,
} = {}) {
  const surfaceLuma = luminance(surface);
  if (surfaceLuma == null) return prefer || dark;
  const fallback = surfaceLuma > 0.42 ? dark : light;
  if (!prefer) return fallback;
  const ratio = contrastRatio(prefer, surface);
  if (ratio == null) return fallback;
  return ratio >= min ? prefer : fallback;
}

// ---------------------------------------------------------------------------
// Radius + spacing scales. Spacing is the ONLY source of padding/margin in
// screens (constitution). Gutter 20, card padding 16, section gap 24.
// ---------------------------------------------------------------------------

// LIMITED RADII (neo-brutalist): the scale is 0 / 12 / 24 and nothing between.
// The six-step scale this replaces (8/14/16/22/24) was the single biggest thing
// keeping the app soft — no amount of stroke weight reads as hard-edged when
// every box is rounded off by a slightly different amount. The keys are kept so
// no call site has to change; they just resolve to fewer distinct values now.
//
// `none` is here because it is the honest neo-brutalist default, and the boxes
// that most want it (tables, banners, the toast stack) are the ones that read
// worst with a radius on them.
export const radius = {
  none: 0,
  sm: 12,
  md: 12,
  card: 12,
  lg: 24,
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
// Elevation — dark theme uses SURFACE STEPS, not shadows (constitution).
// card/raised are intentionally empty; depth comes from surface color.
// `glow(color)` is the signature effect (trails, CTAs, territory).
// ---------------------------------------------------------------------------

export const shadow = {
  flat: {},
  card: {},
  raised: {},
  // The neo-brutalist drop: solid colour, ZERO blur, offset on both axes.
  //
  // iOS-ONLY. Android's `elevation` is always a blurred material shadow
  // pointing straight down and cannot express this, so `elevation: 0` is
  // deliberate: a soft grey blur under a hard-edged card reads as the style
  // failing rather than as a platform difference. For a hard shadow that
  // survives both platforms use the `HardShadow` component in components/ui,
  // which draws a real offset rectangle instead of asking the compositor.
  //
  // Defined HERE rather than in nb.js, which is where the rest of the
  // neo-brutalist tokens live, purely to keep the import graph one-way:
  // nb.js already reads `readableInk` from this file, and pointing this back
  // at nb.js would close the loop. `npm run check:tdz` exists because that
  // class of cycle has bitten this codebase before.
  hard: (color, offset = 4) => ({
    shadowColor: color,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: offset, height: offset },
    elevation: 0,
  }),
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
  // Anton hero styles — condensed athletic caps (PACER headlines/wordmark).
  // lineHeight ~1.3× the size — Poppins Black is tall and clips at tighter
  // leading (the onboarding headline was being cropped).
  hero: { fontFamily: fonts.hero, fontSize: 40, lineHeight: 52, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.text },
  display: { fontFamily: fonts.hero, fontSize: 30, lineHeight: 40, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.text },
  title: { fontFamily: fonts.hero, fontSize: 21, lineHeight: 28, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.text },
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

  // Calories estimate (until profile weight exists): kcal/kg/km × weight.
  defaultWeightKg: 70,

  // Vehicle / spoof gating (buses, trains, mock GPS):
  // a point faster than this is never on foot (6.5 m/s ≈ 2:34/km)…
  vehicleSpeedMps: 6.5,
  // …and this many consecutive fast fixes auto-pauses the run.
  vehicleFastPoints: 4,
  // Pedometer watchdog: covering this much ground with almost no steps
  // within one check window means wheels, not feet.
  vehicleCheckMs: 45000,
  vehicleMinStepsPerWindow: 15,
  vehicleWindowDistanceM: 250,
};
