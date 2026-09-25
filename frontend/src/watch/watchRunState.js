// The watch → phone half of the standalone-workout protocol. Pure and
// native-free on purpose, same spirit as watchState.js: every rule about what
// counts as a valid message, a newer message, or a submittable route is
// testable without a watch or a phone link. The native senders are
// WorkoutManager.swift (build) and PhoneLink.swift (transport); the native
// receiver is PhoneWatchSession.swift, which forwards exactly what it got
// without interpreting it — interpretation lives here.
//
// TWO PAYLOAD SHAPES, one file, because they travel two different ways and
// answer two different questions:
//
//   live state   "what is the watch doing right now" — sendMessage, ~1 Hz,
//                best-effort, superseded by the next one. Dropped when the
//                watch is unreachable; the phone keeps the last one it had.
//   pending run  "here is the finished route" — a file transfer, durable,
//                arrives once (or, rarely, is retried whole).
//
// Neither is trusted blindly: a live state with a smaller seq than the one
// already on screen is discarded (isNewerLiveState), and a pending run with
// fewer than MIN_POINTS points, or points that don't sort into a real span
// of time, is not a route worth submitting (validatePendingRun).

export const WATCH_RUN_STATE = Object.freeze({
  RUNNING: 'running',
  PAUSED: 'paused',
  FINISHED: 'finished',
  ROUTE_READY: 'route_ready',
});

const LIVE_STATES = new Set([WATCH_RUN_STATE.RUNNING, WATCH_RUN_STATE.PAUSED, WATCH_RUN_STATE.FINISHED]);

// `Number(null)` is `0`, not NaN — so a plain `Number.isFinite` check reads a
// missing field as a real zero. A point with no latitude is not a point at
// the equator; it is not a point.
function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate and normalise one `onWatchRunState` event from the native side.
 * Returns null for anything that is not a message this protocol version
 * understands — a malformed or half-delivered message is not news, it is
 * nothing, and the caller should behave exactly as if it never arrived.
 */
export function parseLiveState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'watchRunState') return null;
  const runId = typeof raw.runId === 'string' && raw.runId ? raw.runId : null;
  const state = typeof raw.state === 'string' ? raw.state : null;
  if (!runId || !state) return null;
  if (state === WATCH_RUN_STATE.ROUTE_READY) {
    return { kind: 'routeReady', runId };
  }
  if (!LIVE_STATES.has(state)) return null;
  const seq = finiteOrNull(raw.seq) ?? 0;
  const startedAtMs = finiteOrNull(raw.startedAt);
  if (startedAtMs == null) return null;
  return {
    kind: 'live',
    runId,
    state,
    seq,
    sentAtMs: finiteOrNull(raw.sentAt) ?? Date.now(),
    startedAtMs,
    elapsedS: Math.max(0, finiteOrNull(raw.elapsedS) ?? 0),
    distanceM: Math.max(0, finiteOrNull(raw.distanceM) ?? 0),
    paceSPerKm: finiteOrNull(raw.paceSPerKm),
    lat: finiteOrNull(raw.lat),
    lon: finiteOrNull(raw.lon),
  };
}

/**
 * Whether `next` should replace `prev` on screen. A different runId is
 * always newer (a fresh workout started); the same runId only advances by
 * sequence, so a message delayed by a WatchConnectivity retry can never
 * rewind the numbers a runner is watching.
 */
export function isNewerLiveState(next, prev) {
  if (!next) return false;
  if (!prev) return true;
  if (next.runId !== prev.runId) return true;
  return next.seq >= prev.seq;
}

// A route with fewer fixes than this is not a run worth submitting — well
// under the server's own claim-distance floor even at the loosest plausible
// spacing, and cheap to catch here rather than round-tripping it first.
const MIN_POINTS = 2;

/**
 * Validate a pending-run payload as it comes back from
 * `getPendingWatchRuns()` / the `route_ready` file transfer. Returns
 * `{ ok: true, run }` with points sorted by time, or `{ ok: false, reason }`
 * for a payload this app cannot submit at all — never throws, because a
 * malformed file on disk must read as "nothing to sync", not crash the
 * screen that asks.
 */
export function validatePendingRun(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'empty' };
  const runId = typeof raw.runId === 'string' && raw.runId ? raw.runId : null;
  if (!runId) return { ok: false, reason: 'no_run_id' };
  const startedAtMs = finiteOrNull(raw.startedAt);
  const endedAtMs = finiteOrNull(raw.endedAt);
  if (startedAtMs == null || endedAtMs == null || endedAtMs < startedAtMs) {
    return { ok: false, reason: 'bad_time_range' };
  }
  const points = pointsFromWatchPayload(raw.points);
  if (points.length < MIN_POINTS) return { ok: false, reason: 'too_few_points' };
  return {
    ok: true,
    run: {
      runId,
      source: 'watch',
      startedAtMs,
      endedAtMs,
      points,
    },
  };
}

/**
 * Watch fixes → PASER's canonical API point shape (RunningScreen's own
 * `toApiPoints`), sorted by time. The ONE place this conversion happens —
 * every consumer (the pending-run submitter, a future debug view) reads
 * this shape and none of them re-derives it from the native payload.
 */
export function pointsFromWatchPayload(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const latitude = finiteOrNull(p?.latitude);
      const longitude = finiteOrNull(p?.longitude);
      const timestamp = finiteOrNull(p?.timestamp);
      if (latitude == null || longitude == null || timestamp == null) return null;
      return {
        latitude,
        longitude,
        timestamp,
        altitude: finiteOrNull(p?.altitude),
        accuracyM: finiteOrNull(p?.accuracyM),
        speedMps: finiteOrNull(p?.speedMps),
        mocked: !!p?.mocked,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}
