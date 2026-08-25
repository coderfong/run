// Shared jest setup.
//
// These are the native modules that have no JS implementation to fall back on,
// so anything importing them (directly or four levels down) explodes at
// require time rather than at use. Mocking them here rather than in each test
// keeps the tests about behaviour instead of about plumbing.

// Ships with the package; the documented way to use it under jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mapbox is native-only. Screens that draw a map are tested for what they
// compute, not for what the map renders.
jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {},
  setAccessToken: jest.fn(),
  MapView: 'MapView',
  Camera: 'Camera',
  ShapeSource: 'ShapeSource',
  FillLayer: 'FillLayer',
  LineLayer: 'LineLayer',
  MarkerView: 'MarkerView',
}));

// Apple Health. The real module is a Nitro hybrid object that only exists in
// an iOS build and throws at require time anywhere else — src/health.js
// catches that, but then there is nothing left to assert against, so the fake
// stands in. Defaults are the happy path: available and already authorized.
jest.mock('@kingstinct/react-native-healthkit', () => ({
  isHealthDataAvailable: jest.fn(() => true),
  requestAuthorization: jest.fn(async () => true),
  authorizationStatusFor: jest.fn(() => 2),
  saveWorkoutSample: jest.fn(async () => ({})),
  AuthorizationStatus: { notDetermined: 0, sharingDenied: 1, sharingAuthorized: 2 },
  WorkoutActivityType: { running: 37 },
}));

// Every one of these must return a PROMISE, not undefined: the haptics helper
// chains `.catch()` on the result so a device without a taptic engine fails
// silently, and a bare jest.fn() turns that into a crash at mount.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 1.36, longitude: 103.82, accuracy: 5 },
  })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  Accuracy: { High: 4, BestForNavigation: 6 },
}));

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  // A push ARRIVING and a push being TAPPED are two listeners. Both are
  // registered together (components/CrossroadsAlert.js), inside one try/catch
  // — so a missing mock here does not fail a test, it silently drops the half
  // that was left out of it.
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
}));

// Reanimated ships its own mock; without it every animated style throws.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Safe-area insets come from a native provider. Written out rather than using
// the package's own jest mock, which in v5 does not export the hooks — a
// component calling `useSafeAreaInsets` gets "is not a function" instead of
// insets. Fixed values are exactly what a layout test wants anyway.
jest.mock('react-native-safe-area-context', () => {
  const React2 = require('react');
  const insets = { top: 44, right: 0, bottom: 34, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const passthrough = ({ children }) => React2.createElement(React2.Fragment, null, children);
  return {
    __esModule: true,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    SafeAreaProvider: passthrough,
    SafeAreaView: passthrough,
    SafeAreaInsetsContext: React2.createContext(insets),
    SafeAreaFrameContext: React2.createContext(frame),
    initialWindowMetrics: { insets, frame },
  };
});
