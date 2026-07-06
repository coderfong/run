// Territory Run design tokens — single entry point. Everything re-exports
// through here, so `import { colors, space, type } from '../theme'` keeps
// working across the app. Structure:
//   tokens.js  — fonts, radius, spacing, elevation, type, run tuning
//   light.js   — light surfaces + desaturated semantics
//   dark.js    — dark "night run" surfaces (3 elevation steps)
//   motion.js  — spring/timing presets
//   haptics.js — restrained haptic wrappers

export * from './tokens';
export * from './light';
export * from './dark';
export * from './motion';
export { haptic } from './haptics';

import { colors } from './light';
import { darkColors } from './dark';
import { fonts, radius, space, shadow, type, runTuning, withAlpha } from './tokens';

// Clan/team palette triples — fill (translucent polygons), stroke (saturated
// lines/chips/CTAs), glow (bright, dark-mode trail + stats), tint (solid
// pastel light-mode chips), text (dark, on tint). Phase 5 sources these from
// the server's curated clan colors; v1's four teams still map here meanwhile.
export const teams = {
  north: { key: 'north', name: 'North', fill: 'rgba(147,51,234,0.20)', stroke: '#9333ea', glow: '#c084fc', tint: '#e9d5ff', text: '#581c87' },
  // East stroke is green-700 (#15803d) not 600 — AA contrast on white cards.
  east: { key: 'east', name: 'East', fill: 'rgba(21,128,61,0.20)', stroke: '#15803d', glow: '#4ade80', tint: '#bbf7d0', text: '#14532d' },
  south: { key: 'south', name: 'South', fill: 'rgba(37,99,235,0.20)', stroke: '#2563eb', glow: '#60a5fa', tint: '#bfdbfe', text: '#1e3a8a' },
  west: { key: 'west', name: 'West', fill: 'rgba(220,38,38,0.20)', stroke: '#dc2626', glow: '#f87171', tint: '#fecaca', text: '#7f1d1d' },
};

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
