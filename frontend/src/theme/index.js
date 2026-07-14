// PACER design tokens — single entry point.
//
// DARK-FIRST: the app ships dark everywhere (per the PACER design). The
// palette every screen imports as `colors` IS the dark palette; the old
// light palette remains exported as `lightColors` for share cards or future
// light surfaces. `darkColors` stays for code that asks for dark explicitly.
//
//   tokens.js  — fonts, radius, spacing, elevation, type, run tuning
//   light.js   — legacy light surfaces (kept for reference/exports)
//   dark.js    — the shipped palette (3 surface elevation steps)
//   motion.js  — spring/timing presets
//   haptics.js — restrained haptic wrappers

export * from './tokens';
export * from './dark';
export * from './motion';
export { haptic } from './haptics';
export { colors as lightColors } from './light';
export { ThemeProvider, useTheme, useThemedStyles, useThemedType } from './ThemeContext';

import { darkColors } from './dark';
import { fonts, radius, space, shadow, type, runTuning, withAlpha } from './tokens';

// Dark-first: `colors` (what all screens import) is the dark palette.
export const colors = darkColors;

// ---------------------------------------------------------------------------
// Brand — PACER. The pink→purple gradient is the brand CTA; clan colors
// remain each user's accent for territory/trails/stats.
// ---------------------------------------------------------------------------

export const brand = {
  name: 'PASER',
  tagline: 'RUN. CLAIM. REPEAT.',
  pink: '#ec4899',
  purple: '#8b5cf6',
  teal: '#2dd4bf',
  // The CTA fill. Flat PASER pink (both stops equal) — the old pink→purple
  // gradient is retired. Kept as a 2-stop array so every LinearGradient CTA
  // (Button, Result share, etc.) picks up the change with no call-site edits.
  gradient: ['#ec4899', '#ec4899'],
  gradientTeal: ['#8b5cf6', '#2dd4bf'],
};

export const tokens = {
  fonts,
  colors,
  darkColors,
  brand,
  radius,
  space,
  shadow,
  type,
  runTuning,
  withAlpha,
};

export default tokens;
