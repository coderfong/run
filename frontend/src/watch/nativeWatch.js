// The PaserWatch native module (modules/paser-watch), or null.
//
// It exists only in iOS builds made after it was added, so it is looked up
// lazily and optionally: Android, web, jest and every older binary get null
// and the whole watch link quietly does nothing (see watchLink.js). Tests
// replace this file with a fake.

import { Platform } from 'react-native';

// undefined = not looked yet; null = no watch module in this build.
let cached;

export default function nativeWatch() {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'ios') return cached;
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core');
    cached = requireOptionalNativeModule('PaserWatch') || null;
  } catch (err) {
    cached = null;
  }
  return cached;
}
