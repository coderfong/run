// Background run tracking. The foreground GPS watcher dies the moment iOS
// backgrounds the app (screen off / app switch), which used to leave a gap
// that rendered as a straight line across the map. This module keeps a
// background location task running for the duration of a run and buffers
// its points; RunningScreen drains the buffer into the trail whenever the
// app returns to the foreground (and before finishing the run).
//
// IMPORTANT: expo-task-manager's native module only exists in builds made
// after it was added to package.json. Every entry point here feature-guards,
// so on older binaries the app quietly stays foreground-only.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export const RUN_LOCATION_TASK = 'pacer-run-location';
const BUFFER_KEY = 'tr.bgRunPoints';

let TaskManager = null;
try {
  // eslint-disable-next-line global-require
  TaskManager = require('expo-task-manager');
} catch {
  TaskManager = null;
}

function available() {
  // defineTask works from JS, but starting updates needs the native module.
  return !!TaskManager && !!Location.startLocationUpdatesAsync;
}

// Task body — appends fixes to an AsyncStorage buffer. Runs while the app is
// backgrounded (and can even relaunch the app if iOS killed it mid-run).
if (TaskManager) {
  try {
    TaskManager.defineTask(RUN_LOCATION_TASK, async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      const pts = data.locations.map((l) => ({
        latitude: l.coords.latitude,
        longitude: l.coords.longitude,
        timestamp: l.timestamp || Date.now(),
        mocked: l.mocked ?? false,
        accuracyM: l.coords.accuracy ?? null,
        speedMps: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
      }));
      try {
        const raw = await AsyncStorage.getItem(BUFFER_KEY);
        const buf = raw ? JSON.parse(raw) : [];
        buf.push(...pts);
        // Hard cap so a forgotten task can't grow unbounded (~6h at 5s/fix).
        await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buf.slice(-4500)));
      } catch {}
    });
  } catch {
    // defineTask throws if called twice with a different body — safe to ignore.
  }
}

// Start background updates for the active run. Best-effort: requests the
// "Always" upgrade (iOS keeps recording with When-In-Use + the location
// background mode, but Always survives longer); any failure leaves the run
// on the foreground watcher only.
export async function startBackgroundTrack() {
  if (!available()) return false;
  try {
    await AsyncStorage.removeItem(BUFFER_KEY);
    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {}
    await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 4000,
      distanceInterval: 8,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      foregroundService: {
        notificationTitle: 'PACER is recording your run',
        notificationBody: 'Distance keeps converting to territory while the screen is off.',
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundTrack() {
  if (!available()) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
    }
  } catch {}
}

// Pull everything the background task recorded since the last drain.
// Returns points sorted by timestamp (possibly empty).
export async function drainBackgroundPoints() {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    if (!raw) return [];
    await AsyncStorage.removeItem(BUFFER_KEY);
    const pts = JSON.parse(raw);
    return Array.isArray(pts) ? pts.sort((a, b) => a.timestamp - b.timestamp) : [];
  } catch {
    return [];
  }
}
