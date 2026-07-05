// Dynamic Expo config. Keeps the static, readable base in app.json and layers
// on the Mapbox secrets/URLs from the environment so nothing sensitive is
// committed. See SETUP_MAPBOX.md for how to provide these.
//
//   MAPBOX_DOWNLOAD_TOKEN   sk.* secret — build-time only (SDK download)
//   EXPO_PUBLIC_MAPBOX_TOKEN pk.* public — runtime (Mapbox.setAccessToken)
//   EXPO_PUBLIC_MAP_STYLE_LIGHT / _DARK  custom Studio style URLs (optional)

const base = require('./app.json').expo;

const DOWNLOAD_TOKEN = process.env.MAPBOX_DOWNLOAD_TOKEN || '';

module.exports = () => {
  // Replace the bare "@rnmapbox/maps" plugin string with a config tuple that
  // carries the download token (leave any other plugins untouched).
  const plugins = (base.plugins || []).map((p) =>
    p === '@rnmapbox/maps'
      ? ['@rnmapbox/maps', { RNMapboxMapsDownloadToken: DOWNLOAD_TOKEN }]
      : p
  );

  return {
    ...base,
    plugins,
    extra: {
      ...base.extra,
      mapboxPublicToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '',
      mapStyleLight: process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT || '',
      mapStyleDark: process.env.EXPO_PUBLIC_MAP_STYLE_DARK || '',
    },
  };
};
