// The phone's side of the Apple Watch link, over the PaserWatch native module
// (modules/paser-watch). Everything here is a no-op wherever that module is
// missing (Android, jest, and every build made before it existed), in the
// same spirit as src/health.js: the watch is an extra, and it must never be
// able to cost a runner the run. Nothing here throws.

import nativeWatch from './nativeWatch';
import { buildWatchState } from './watchState';

const NO_WATCH = Object.freeze({
  supported: false,
  paired: false,
  installed: false,
  reachable: false,
});

// Strictly increasing and seeded from the clock, so a state sent after the app
// restarts still outranks the last one the watch saw before it. The native
// side seeds its launch time idle state the same way.
let lastSeq = 0;
function nextSeq(nowMs) {
  lastSeq = Math.max(lastSeq + 1, Math.floor(Number(nowMs) || 0));
  return lastSeq;
}

export function watchStatus() {
  const mod = nativeWatch();
  if (!mod || typeof mod.getStatus !== 'function') return NO_WATCH;
  try {
    const s = mod.getStatus() || {};
    return {
      supported: !!s.supported,
      paired: !!s.paired,
      installed: !!s.installed,
      reachable: !!s.reachable,
    };
  } catch (err) {
    return NO_WATCH;
  }
}

// A paired watch with PASER on it. Decides whether a pause keeps the
// background location session open so the wrist can resume the run.
export function watchAppInstalled() {
  const s = watchStatus();
  return s.paired && s.installed;
}

// Hand the watch the runner's portrait: base64 PNG bytes plus the key that
// names the look (src/watch/watchAvatar.js). The native side writes it to a
// file and queues a WatchConnectivity file transfer, which the system
// delivers even when neither app is running, so this resolves as soon as the
// transfer is ACCEPTED rather than when the wrist has it.
//
// False wherever there is no watch link in this build, which is the signal to
// try again next time rather than to record the look as sent.
export async function syncAvatarToWatch(base64, key) {
  const mod = nativeWatch();
  if (!mod || typeof mod.updateAvatar !== 'function') return false;
  if (typeof base64 !== 'string' || !base64 || typeof key !== 'string' || !key) return false;
  try {
    return !!(await mod.updateAvatar(base64, key));
  } catch (err) {
    return false;
  }
}

// A bounded iOS execution grant for saving after GPS has stopped. Older
// binaries and other platforms still save normally without this extra time.
export async function beginRunSave() {
  try { return !!(await nativeWatch()?.beginRunSave?.()); } catch { return false; }
}

export async function endRunSave() {
  try { await nativeWatch()?.endRunSave?.(); } catch {}
}

// The watch's own standalone workout as it last reported it, or null:
// { phase: running | paused | ended, at: epoch ms, runId }. Read before the
// phone starts a run, so one person never records two PASER runs at once
// (run/session/runOwnership.js).
export function watchWorkoutStatus() {
  const mod = nativeWatch();
  if (!mod || typeof mod.getWatchWorkout !== 'function') return null;
  try {
    const w = mod.getWatchWorkout() || {};
    if (!w.phase) return null;
    return { phase: String(w.phase), at: Number(w.at) || 0, runId: w.runId || null };
  } catch (err) {
    return null;
  }
}

// Send the Run screen's state. Returns what was sent, or null when there is
// no watch link in this build.
export function publishToWatch(input, nowMs = Date.now()) {
  const mod = nativeWatch();
  if (!mod || typeof mod.updateState !== 'function') return null;
  const state = buildWatchState(input, { seq: nextSeq(nowMs), nowMs });
  try {
    mod.updateState(state);
  } catch (err) {
    return null;
  }
  return state;
}

// Listen for commands from the watch: { cmd, at }. Always returns something
// with a remove(), and a listener that throws is contained here rather than
// surfacing inside a native event callback.
export function addWatchCommandListener(handler) {
  const mod = nativeWatch();
  if (!mod || typeof mod.addListener !== 'function') return { remove() {} };
  let sub = null;
  try {
    sub = mod.addListener('onCommand', (event) => {
      try {
        handler(event);
      } catch (err) {
        // A bad command must not take the run screen down with it.
      }
    });
  } catch (err) {
    sub = null;
  }
  return {
    remove() {
      try {
        sub?.remove?.();
      } catch (err) {
        // Already gone.
      }
    },
  };
}

// Listen for a standalone workout's live metrics, and for the one-shot
// signal that its finished route has landed on disk (raw native shapes —
// see src/watch/watchRunState.js for the parsing/validation every caller
// should apply before trusting either). Same shape of contract as
// addWatchCommandListener: always a remove(), a bad handler contained here.
export function addWatchRunStateListener(handler) {
  const mod = nativeWatch();
  if (!mod || typeof mod.addListener !== 'function') return { remove() {} };
  let sub = null;
  try {
    sub = mod.addListener('onWatchRunState', (event) => {
      try {
        handler(event);
      } catch (err) {
        // Same reasoning as addWatchCommandListener: a bad frame must not
        // take down whatever is listening for the next one.
      }
    });
  } catch (err) {
    sub = null;
  }
  return {
    remove() {
      try {
        sub?.remove?.();
      } catch (err) {
        // Already gone.
      }
    },
  };
}

// Every completed watch run still waiting to be submitted, oldest first, as
// raw native payloads. `[]` wherever there is no watch link in this build —
// never throws, so a caller can check this on every launch without a guard.
export async function getPendingWatchRuns() {
  const mod = nativeWatch();
  if (!mod || typeof mod.getPendingWatchRuns !== 'function') return [];
  try {
    const runs = await mod.getPendingWatchRuns();
    return Array.isArray(runs) ? runs : [];
  } catch (err) {
    return [];
  }
}

// Discards a pending run. Call this ONLY after a run has been submitted
// successfully (or the runner explicitly discarded it) — it is the one way
// this data can be lost, and nothing here retries it for you.
export async function consumePendingWatchRun(runId) {
  const mod = nativeWatch();
  if (!mod || typeof mod.consumePendingWatchRun !== 'function' || !runId) return false;
  try {
    return !!(await mod.consumePendingWatchRun(runId));
  } catch (err) {
    return false;
  }
}
