// Optional, WRITE-ONLY health sync. On run finish (if the user enabled it in
// You → Settings) we write the workout to Apple Health / Google Health
// Connect. We never READ health data.
//
// SDK-54 note: Expo has no first-party health module. The maintained options
// are `react-native-health` (HealthKit) and `react-native-health-connect`
// (Android), both needing a config plugin + entitlements and therefore a
// dev/native build. To keep the JS bundle installable without those native
// modules, we dynamically require them and no-op if absent — install them
// (see RELEASE.md) to activate the write. The toggle, purpose strings, and
// write hook below are all wired.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = 'tr.healthSync';

export async function getHealthEnabled() {
  return (await AsyncStorage.getItem(KEY)) === '1';
}
export async function setHealthEnabled(on) {
  await AsyncStorage.setItem(KEY, on ? '1' : '0');
}

function loadModule() {
  // Variable specifier so Metro treats this as a dynamic require and never
  // fails the bundle when the native module isn't installed.
  const name = Platform.OS === 'ios' ? 'react-native-health' : 'react-native-health-connect';
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(name);
  } catch {
    return null;
  }
}

export function requestHealthPermission() {
  const mod = loadModule();
  if (!mod) return; // native module not installed yet
  try {
    if (Platform.OS === 'ios' && mod.default?.initHealthKit) {
      const perms = { permissions: { read: [], write: [mod.default.Constants?.Permissions?.Workout] } };
      mod.default.initHealthKit(perms, () => {});
    }
  } catch {}
}

// Write a completed running workout. Best-effort; silent on failure.
export async function writeWorkout({ startMs, endMs, distanceM, energyKcal = 0 }) {
  if (!(await getHealthEnabled())) return;
  const mod = loadModule();
  if (!mod) return;
  try {
    if (Platform.OS === 'ios' && mod.default?.saveWorkout) {
      mod.default.saveWorkout(
        {
          type: 'Running',
          startDate: new Date(startMs).toISOString(),
          endDate: new Date(endMs).toISOString(),
          distance: distanceM,
          energyBurned: energyKcal,
        },
        () => {}
      );
    } else if (mod.insertRecords) {
      await mod.insertRecords([
        {
          recordType: 'ExerciseSession',
          exerciseType: 56, // running
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
        },
      ]);
    }
  } catch {}
}
