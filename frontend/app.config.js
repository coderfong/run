// Dynamic Expo config. Keeps the static, readable base in app.json and layers
// on the Mapbox secrets/URLs from the environment so nothing sensitive is
// committed. See SETUP_MAPBOX.md for how to provide these.
//
//   MAPBOX_DOWNLOAD_TOKEN   sk.* secret — build-time only (SDK download)
//   EXPO_PUBLIC_MAPBOX_TOKEN pk.* public — runtime (Mapbox.setAccessToken)
//   EXPO_PUBLIC_MAP_STYLE_LIGHT / _DARK  custom Studio style URLs (optional)

const DOWNLOAD_TOKEN = process.env.MAPBOX_DOWNLOAD_TOKEN || '';

// Google sign-in (iOS only for now). A client ID is a PUBLIC identifier, not a
// secret, so it lives here rather than .env — .env is gitignored and never
// reaches an EAS build, which would silently break sign-in. Env still overrides.
const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  '521599593970-0smiffv2iuiau31ba98ioqptm5t2ortr.apps.googleusercontent.com';

// Google's iOS OAuth returns to the app via the REVERSED client id as a URL
// scheme. Derived from the id above so the two can never drift apart.
const googleReversedScheme =
  'com.googleusercontent.apps.' +
  GOOGLE_IOS_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, '');

module.exports = ({ config: base }) => {
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
    ios: {
      ...base.ios,
      infoPlist: {
        ...(base.ios?.infoPlist || {}),
        // Registering the reversed client id lets the Google sign-in popup hand
        // control back to the app. Without it the flow hangs on the web view.
        CFBundleURLTypes: [
          ...(base.ios?.infoPlist?.CFBundleURLTypes || []),
          { CFBundleURLSchemes: [googleReversedScheme] },
        ],
      },
    },
    extra: {
      ...base.extra,
      mapboxPublicToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '',
      mapStyleLight: process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT || '',
      mapStyleDark: process.env.EXPO_PUBLIC_MAP_STYLE_DARK || '',
      // Google sign-in. The backend must list this SAME id in GOOGLE_CLIENT_IDS
      // or /auth/google rejects the token. Android/Web unused (iOS-only app).
      googleIosClientId: GOOGLE_IOS_CLIENT_ID,
      googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
    },
  };
};
