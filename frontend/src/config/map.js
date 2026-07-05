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

// True once a real token is present. Screens can show a graceful placeholder
// in dev builds where no token is configured yet.
export const MAP_READY = MAPBOX_PUBLIC_TOKEN.startsWith('pk.');
