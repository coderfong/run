// Optional, WRITE-ONLY Apple Health sync. With the switch on in You →
// Settings, finishing a real run writes that workout — activity, start, end,
// distance — into Apple Health.
//
// PASER never READS health data. Authorization is asked for on the write
// ("share") side only, so the Health sheet the runner sees lists what PASER
// will write and offers nothing to read.
//
// Deliberately NOT written: the calorie number the run screen shows. That is a
// 70 kg estimate, and an estimate belongs on a stat card, not in the health
// record other apps read as measurement.
//
// The native half of the module exists only in an iOS build, so it is required
// lazily inside a guard: Android, web and the test runner must get a quiet
// no-op rather than a bundle-time explosion.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { HEALTH_SYNC_ENABLED } from './config/releaseFeatures';

const KEY = 'tr.healthSync';

// The only two identifiers PASER ever asks for, both write-side.
const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';
const DISTANCE_TYPE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';
const SHARE_TYPES = [WORKOUT_TYPE, DISTANCE_TYPE];

// undefined = not looked yet; null = no Health on this platform or device.
let cached;

function health() {
  if (cached !== undefined) return cached;
  cached = null;
  if (HEALTH_SYNC_ENABLED && Platform.OS === 'ios') {
    try {
      const mod = require('@kingstinct/react-native-healthkit');
      // False on any device without a health store (iPad, some simulators).
      if (mod.isHealthDataAvailable()) cached = mod;
    } catch (err) {
      cached = null;
    }
  }
  return cached;
}

// True when this build can write to Apple Health at all. The settings toggle
// hides itself when this is false: a switch that cannot do anything is worse
// than no switch.
export function healthSyncSupported() {
  return !!health();
}

function isAuthorized(hk, type) {
  try {
    return hk.authorizationStatusFor(type) === hk.AuthorizationStatus.sharingAuthorized;
  } catch (err) {
    return false;
  }
}

export async function getHealthEnabled() {
  if (!health()) return false;
  return (await AsyncStorage.getItem(KEY)) === '1';
}

export async function setHealthEnabled(on) {
  await AsyncStorage.setItem(KEY, on ? '1' : '0');
}

// Ask for write access. Resolves true only once Health itself reports the
// workout type as authorized, so a runner who taps Don't Allow is not left
// with a switch sitting on and writing nothing.
export async function requestHealthPermission() {
  const hk = health();
  if (!hk) return false;
  try {
    await hk.requestAuthorization({ toShare: SHARE_TYPES });
  } catch (err) {
    return false;
  }
  return isAuthorized(hk, WORKOUT_TYPE);
}

// Write one finished run as a running workout. Every failure path returns
// false rather than throwing: a health write is the least important thing
// happening at the end of a run and must never cost the runner the run.
export async function writeWorkout({ startMs, endMs, distanceM }) {
  const hk = health();
  if (!hk) return false;
  if (!(await getHealthEnabled())) return false;
  // HealthKit treats a write to an unauthorized type as a programming error
  // and raises, so the status is checked rather than the save being attempted.
  if (!isAuthorized(hk, WORKOUT_TYPE)) return false;

  const start = new Date(startMs);
  const end = new Date(endMs);
  if (!(end > start)) return false;

  const meters = Math.max(0, Math.round(distanceM || 0));
  // The workout's own total needs only the workout permission. The separate
  // distance sample — the one that reaches the Fitness app's daily totals —
  // needs its own, which the runner can withhold on the permission sheet.
  const samples =
    meters > 0 && isAuthorized(hk, DISTANCE_TYPE)
      ? [{ startDate: start, endDate: end, quantityType: DISTANCE_TYPE, quantity: meters, unit: 'm' }]
      : [];

  try {
    await hk.saveWorkoutSample(
      hk.WorkoutActivityType.running,
      samples,
      start,
      end,
      meters > 0 ? { distance: meters } : undefined
    );
    return true;
  } catch (err) {
    return false;
  }
}
