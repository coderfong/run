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

// A bounded iOS execution grant for saving after GPS has stopped. Older
// binaries and other platforms still save normally without this extra time.
export async function beginRunSave() {
  try { return !!(await nativeWatch()?.beginRunSave?.()); } catch { return false; }
}

export async function endRunSave() {
  try { await nativeWatch()?.endRunSave?.(); } catch {}
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
