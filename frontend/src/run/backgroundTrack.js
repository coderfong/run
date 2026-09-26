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

import { armStillRunning } from './session/runReminders';

export const RUN_LOCATION_TASK = 'pacer-run-location';
const BUFFER_KEY = 'tr.bgRunPoints';
// NO CAP. The buffer used to keep only the newest 4500 fixes (~6 h at 5 s),
// which silently dropped the start of any longer pocketed run. Now a full
// buffer is sealed into a numbered chunk and a fresh one begins, so a 24 h
// run in a pocket keeps every fix and no single write grows without bound.
const SEAL_AT = 500;
const CHUNKS_KEY = 'tr.bgRunPoints.chunks';
const chunkKey = (i) => `tr.bgRunPoints.c${i}`;
// The dead man's switch (see session/runReminders.js): where the runner was
// last seen moving, and when the "Still running?" nudge was last pushed back.
const ANCHOR_KEY = 'tr.bgRunAnchor';
const MOVED_M = 40;

function metresBetween(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Movement seen from the pocket pushes the forgotten-run nudge back. Only
// movement: a phone left on a table stops delivering fixes (or delivers
// drift inside the circle), and the nudge then fires on schedule.
async function pushBackReminder(newest) {
  try {
    const anchor = JSON.parse((await AsyncStorage.getItem(ANCHOR_KEY)) || 'null');
    if (anchor && metresBetween(anchor, newest) < MOVED_M) return;
    // Re-scheduling costs an OS call, so it happens at most once a minute
    // however often the runner clears the 40 m circle.
    const rearm = !anchor || newest.timestamp - (anchor.armedAt || 0) > 60000;
    await AsyncStorage.setItem(ANCHOR_KEY, JSON.stringify({
      latitude: newest.latitude,
      longitude: newest.longitude,
      armedAt: rearm ? newest.timestamp : anchor.armedAt,
    }));
    if (rearm) await armStillRunning(newest.timestamp);
  } catch {}
}

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
        if (buf.length >= SEAL_AT) {
          const n = Number(await AsyncStorage.getItem(CHUNKS_KEY)) || 0;
          await AsyncStorage.multiSet([
            [chunkKey(n), JSON.stringify(buf)],
            [CHUNKS_KEY, String(n + 1)],
            [BUFFER_KEY, '[]'],
          ]);
        } else {
          await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buf));
        }
      } catch {}
      await pushBackReminder(pts[pts.length - 1]);
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
    await clearBuffer();
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
        notificationTitle: 'PASER is recording your run',
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
    const n = Number(await AsyncStorage.getItem(CHUNKS_KEY)) || 0;
    const keys = [...Array.from({ length: n }, (_, i) => chunkKey(i)), BUFFER_KEY];
    const rows = await AsyncStorage.multiGet(keys);
    await AsyncStorage.multiRemove([...keys, CHUNKS_KEY]);
    const pts = [];
    for (const [, raw] of rows) {
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) pts.push(...arr);
    }
    return pts.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

async function clearBuffer() {
  try {
    const n = Number(await AsyncStorage.getItem(CHUNKS_KEY)) || 0;
    await AsyncStorage.multiRemove([
      BUFFER_KEY, CHUNKS_KEY, ANCHOR_KEY, ...Array.from({ length: n }, (_, i) => chunkKey(i)),
    ]);
  } catch {}
}
