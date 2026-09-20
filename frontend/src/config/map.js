// Mapbox runtime configuration: the PUBLIC access token (pk.*) and the two
// custom style URLs, all resolved from env / app config with safe fallbacks.
//
// The DOWNLOAD token (sk.*) is a build-time secret consumed by the
// @rnmapbox/maps config plugin (see app.config.js) — it is NOT read here.
//
// Until the hand-designed Studio styles exist, we fall back to Mapbox's
// public monochrome styles so the app boots and the board is legible.

import Constants from 'expo-constants';

const extra = Constants?.expoConfig?.extra ?? {};

export const MAPBOX_PUBLIC_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN || extra.mapboxPublicToken || '';

// Public monochrome fallbacks — replace via env once the custom styles ship.
const FALLBACK_LIGHT = 'mapbox://styles/mapbox/light-v11';
const FALLBACK_DARK = 'mapbox://styles/mapbox/dark-v11';

export const MAP_STYLE_LIGHT =
  process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT || extra.mapStyleLight || FALLBACK_LIGHT;

export const MAP_STYLE_DARK =
  process.env.EXPO_PUBLIC_MAP_STYLE_DARK || extra.mapStyleDark || FALLBACK_DARK;

export function styleForTheme(theme) {
  return theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

// Roughly the land colour each style paints, for anything drawn ON a map that
// has to decide its own ink before the picture arrives (see RouteThumb). An
// approximation on purpose: a basemap is streets and parks and water, not one
// flat colour, and what a caller needs from this is only "is the ground I am
// drawing on light or dark". Worth re-sampling when the hand-designed Studio
// styles replace the fallbacks above.
export const MAP_SURFACE = {
  light: '#F0ECE6',
  dark: '#1A1B1D',
};

export function mapSurfaceFor(theme) {
  return theme === 'dark' ? MAP_SURFACE.dark : MAP_SURFACE.light;
}

// True once a real token is present. Screens can show a graceful placeholder
// in dev builds where no token is configured yet.
export const MAP_READY = MAPBOX_PUBLIC_TOKEN.startsWith('pk.');
