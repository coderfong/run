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

// Clan colors are now server-owned (backend/app/clans_meta.py) and delivered
// per-entity on the API; there is no client-side team/clan palette here.

export const tokens = {
  fonts,
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
