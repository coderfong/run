// Local notifications for an open run: the forgotten-run nudge, the
// forgotten-pause nudge, and the long-run checkpoints.
//
// A DEAD MAN'S SWITCH, NOT A TIMER. JavaScript timers do not run while the
// phone is in a pocket, so nothing here waits and then fires. Instead the
// "Still running?" notification is SCHEDULED for (last movement + 15 min) and
// pushed back every time movement is seen again — by the Run screen in the
// foreground and by the background location task in the pocket. A runner who
// keeps moving never sees it; one who stops and forgets gets exactly one.
//
// Everything is best effort: no notification permission, no module in this
// build, or a failure in the OS scheduler, and the run simply carries on.

import { RUN_SESSION } from './config';

let Notifications = null;
try {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

const ID_STILL = 'paser-run-still-running';
const ID_PAUSED = 'paser-run-paused';
const checkpointId = (h) => `paser-run-checkpoint-${h}`;
// Routed by src/notifications/route.js: 'record' opens the Run screen.
const DATA = { screen: 'record', category: 'run_session' };

async function allowed() {
  if (!Notifications?.scheduleNotificationAsync) return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    return !!perm?.granted || perm?.status === 'granted';
  } catch {
    return false;
  }
}

async function scheduleAt(identifier, atMs, title, body) {
  if (!(await allowed())) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    const seconds = Math.round((atMs - Date.now()) / 1000);
    if (seconds < 5) return false;
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, data: DATA, sound: 'default' },
      trigger: { type: 'timeInterval', seconds, repeats: false },
    });
    return true;
  } catch {
    return false;
  }
}

async function cancel(identifier) {
  try {
    await Notifications?.cancelScheduledNotificationAsync?.(identifier);
  } catch {}
}

/** "Still running?" at `lastMovementAt` + FORGOTTEN_RUN_NOTIFICATION_S. */
export function armStillRunning(lastMovementAt, cfg = RUN_SESSION) {
  return scheduleAt(
    ID_STILL,
    lastMovementAt + cfg.FORGOTTEN_RUN_NOTIFICATION_S * 1000,
    'Still running?',
    "PASER hasn't seen you running for a while. Open PASER to finish or keep going."
  );
}

export function cancelStillRunning() {
  return cancel(ID_STILL);
}

/** "Your run is paused" when a user pause has been left alone. */
export function armPausedReminder(pausedAt, cfg = RUN_SESSION) {
  return scheduleAt(
    ID_PAUSED,
    pausedAt + cfg.FORGOTTEN_PAUSE_NOTIFICATION_S * 1000,
    'Your run is paused',
    'Open PASER to resume or finish it.'
  );
}

export function cancelPausedReminder() {
  return cancel(ID_PAUSED);
}

/** Non-blocking "still recording" checkpoints for long runs. */
export async function scheduleCheckpoints(startedAt, cfg = RUN_SESSION) {
  for (const h of cfg.LONG_RUN_CHECKPOINTS_H) {
    // eslint-disable-next-line no-await-in-loop
    await scheduleAt(
      checkpointId(h),
      startedAt + h * 3600 * 1000,
      `PASER is still recording · ${h}h`,
      'No need to stop. This is just a check that the run is still yours.'
    );
  }
}

export async function cancelAllRunReminders(cfg = RUN_SESSION) {
  await cancel(ID_STILL);
  await cancel(ID_PAUSED);
  for (const h of cfg.LONG_RUN_CHECKPOINTS_H) {
    // eslint-disable-next-line no-await-in-loop
    await cancel(checkpointId(h));
  }
}
