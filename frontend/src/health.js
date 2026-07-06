// Optional, WRITE-ONLY health sync. On run finish (if enabled in You →
// Settings) we write the workout to Apple Health / Google Health Connect.
// We never READ health data.
//
// SDK-54 note: Expo has no first-party health module, and the community
// modules (`react-native-health` on iOS, `react-native-health-connect` on
// Android) require a config plugin + entitlements + a native build. They are
// NOT installed here, so this file keeps the toggle, purpose strings, and
// write hook wired but the native write itself is a no-op until you activate
// it (see ACTIVATION below). Metro rejects requiring an uninstalled module,
// so there is intentionally no import of those packages in committed code.
//
// ACTIVATION (after `npx expo install react-native-health` /
// `react-native-health-connect` and adding their config plugins):
//   1. import the module at the top of this file.
//   2. fill in requestHealthPermission() and the write in writeWorkout()
//      (a reference implementation is in the block comment below).

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tr.healthSync';

export async function getHealthEnabled() {
  return (await AsyncStorage.getItem(KEY)) === '1';
}

export async function setHealthEnabled(on) {
  await AsyncStorage.setItem(KEY, on ? '1' : '0');
}

export function requestHealthPermission() {
  // no-op until a native health module is installed (see ACTIVATION above).
}

// Write a completed running workout. No-op unless enabled AND a native module
// has been wired in.
export async function writeWorkout({ startMs, endMs, distanceM, energyKcal = 0 }) {
  if (!(await getHealthEnabled())) return;
  // ACTIVATION reference implementation:
  //
  //   import AppleHealthKit from 'react-native-health';           // iOS
  //   import { insertRecords } from 'react-native-health-connect'; // Android
  //
  //   if (Platform.OS === 'ios') {
  //     AppleHealthKit.saveWorkout({
  //       type: 'Running',
  //       startDate: new Date(startMs).toISOString(),
  //       endDate: new Date(endMs).toISOString(),
  //       distance: distanceM,
  //       energyBurned: energyKcal,
  //     }, () => {});
  //   } else {
  //     await insertRecords([{
  //       recordType: 'ExerciseSession', exerciseType: 56,
  //       startTime: new Date(startMs).toISOString(),
  //       endTime: new Date(endMs).toISOString(),
  //     }]);
  //   }
  //
  // Until then, the toggle simply records intent; nothing is written.
  void startMs; void endMs; void distanceM; void energyKcal;
}
