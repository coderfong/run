// A finished session, reduced to what the run IS.
//
// DISTANCE, TERRITORY AND REWARDS COME FROM THE SAME POINTS. The server
// computes all three from the points this returns, and those points are only
// the ones inside accepted running segments. Cycling, vehicle, auto-paused
// and user-paused stretches are not sent as route at all, so they cannot be
// distance on the result screen, land on the map, or kilometres towards a
// mission — there is one list, not three that have to agree.
//
// Every point carries `seg`. The server measures each segment separately and
// never draws a straight line between two of them, so a gap (a drive in the
// middle of a run, a tunnel with no step evidence) is a break, not distance.
//
// POLICY FOR APPLE / WATCH DISTANCE. HealthKit's distance for a workout is
// the metric authority when PASER has no reason to doubt it; when this
// finalize excludes a substantial stretch (see `notice`), PASER's segmented
// distance is what counts and the difference is told to the runner rather
// than silently reconciled. See docs/RUN_SESSION.md.

import { filterPoints } from '../gpsFilter';
import { haversineM, lowerBound, windowStats } from './activityClassifier';
import { RUN_SESSION, SEGMENT } from './config';

export const CLASSIFIER_VERSION = 1;

function toGpsPoint(f) {
  return {
    latitude: f.lat,
    longitude: f.lon,
    timestamp: f.t,
    accuracyM: f.acc ?? null,
    speedMps: f.spd ?? null,
    altitude: f.alt ?? null,
    mocked: false,
  };
}

function stepsBetween(steps, a, b) {
  if (!steps?.length) return null;
  const at = (t) => {
    const i = lowerBound(steps, t);
    const s = steps[Math.min(i, steps.length - 1)];
    return s && Math.abs(s.t - t) <= 120000 ? s.total : null;
  };
  const x = at(a);
  const y = at(b);
  return x == null || y == null ? null : Math.max(0, y - x);
}

/**
 * Split one running interval's fixes wherever the GPS went away and came back
 * somewhere the runner could not have run to (unless steps say they did).
 */
function piecesOf(fixes, steps, cfg) {
  const pieces = [];
  let cur = [];
  for (let i = 0; i < fixes.length; i += 1) {
    const f = fixes[i];
    const prev = cur[cur.length - 1];
    if (prev) {
      const gapS = (f.t - prev.t) / 1000;
      const jumpM = haversineM(prev, f);
      const tooFast = gapS > cfg.GPS_GAP_UNCERTAIN_S && jumpM / gapS > cfg.RUNNING_SPEED_SOFT_MAX_MPS;
      const tooFar = gapS > cfg.GPS_GAP_UNCERTAIN_S && jumpM > cfg.GPS_GAP_BREAK_M;
      const tooLong = gapS > cfg.GPS_GAP_BREAK_S && jumpM > cfg.DRIFT_RADIUS_M;
      if (tooFast || tooFar || tooLong) {
        const stepped = stepsBetween(steps, prev.t, f.t);
        const supported = stepped != null && stepped * cfg.STRIDE_MAX_M >= jumpM && !tooFast;
        if (!supported) {
          pieces.push(cur);
          cur = [];
        }
      }
    }
    cur.push(f);
  }
  if (cur.length) pieces.push(cur);
  return pieces.filter((p) => p.length >= 2);
}

/**
 * Close the session at `endAt` and decide what the run was.
 *
 * Returns {
 *   points      [{ latitude, longitude, timestamp, accuracyM, speedMps, seg }]
 *   distanceM   accepted running distance (sum of segments, no bridges)
 *   startedAt, endedAt   endedAt is the last running evidence, not `endAt`
 *   movingMs, segments, summary (server payload), notice (or null),
 *   diagnostics (dev)
 * }
 */
export function finalizeSession(engine, endAt, { cfg = RUN_SESSION, filterOptions } = {}) {
  engine.advance(endAt, { final: true });
  const ev = engine.evidence;
  const intervals = engine.runningIntervals(endAt);
  const endedAt = intervals.length ? intervals[intervals.length - 1].to : ev.startedAt;

  const points = [];
  let distanceM = 0;
  let seg = 0;
  for (const iv of intervals) {
    const lo = lowerBound(ev.fixes, iv.from);
    const hi = lowerBound(ev.fixes, iv.to + 1);
    const raw = ev.fixes.slice(lo, hi);
    for (const piece of piecesOf(raw, ev.steps, cfg)) {
      const { points: pts, distanceM: d } = filterPoints(piece.map(toGpsPoint), filterOptions);
      if (pts.length < 2) continue;
      for (const p of pts) points.push({ ...p, seg });
      distanceM += d;
      seg += 1;
    }
  }

  // Time and distance by what each stretch was. A counting stretch after the
  // last running evidence (the forgotten tail) is reported as stationary.
  const segs = engine.segmentsAt(endAt);
  const ms = { running: 0, stationary: 0, user_paused: 0, cycling: 0, vehicle: 0, unknown: 0 };
  const excluded = { stationary: 0, cycling: 0, vehicle: 0, user_paused: 0 };
  for (const s of segs) {
    let from = s.from;
    let to = s.to;
    let kind = s.kind;
    if (kind === SEGMENT.RUNNING && to > endedAt) {
      if (from < endedAt) {
        ms.running += endedAt - from;
        from = endedAt;
      }
      kind = SEGMENT.STATIONARY;
    }
    ms[kind] = (ms[kind] || 0) + (to - from);
    if (kind !== SEGMENT.RUNNING && excluded[kind] != null) {
      excluded[kind] += windowStats(ev, from, to, cfg).pathM;
    }
  }
  const movingMs = intervals.reduce((sum, iv) => sum + (iv.to - iv.from), 0);
  const diag = engine.diagnostics();
  const recordedMs = Math.max(0, endAt - ev.startedAt);
  const excludedMotionM = excluded.cycling + excluded.vehicle;

  let notice = null;
  if (excludedMotionM >= cfg.EXCLUSION_NOTICE_M
    || (distanceM + excludedMotionM > 0 && excludedMotionM / (distanceM + excludedMotionM) >= cfg.EXCLUSION_NOTICE_SHARE && excludedMotionM >= 100)) {
    const kind = excluded.vehicle >= excluded.cycling ? 'vehicle' : 'cycling';
    notice = {
      kind,
      excludedM: Math.round(excludedMotionM),
      distanceM: Math.round(distanceM),
      message: kind === 'vehicle'
        ? 'PASER detected a drive during your run and excluded it.'
        : 'PASER detected cycling during your run and excluded it.',
    };
  } else if (endAt - endedAt >= cfg.FORGOTTEN_RUN_NOTIFICATION_S * 1000 && movingMs > 0) {
    notice = {
      kind: 'ended_at_last_movement',
      excludedM: 0,
      distanceM: Math.round(distanceM),
      message: 'Your run ended at your last movement, not when the app was closed.',
    };
  }

  const s = (x) => Math.round(x / 1000);
  const summary = {
    classifier_version: CLASSIFIER_VERSION,
    recorded_s: s(recordedMs),
    active_running_s: s(movingMs),
    stationary_s: s(ms.stationary),
    auto_paused_s: s(ms.stationary),
    user_paused_s: s(ms.user_paused),
    cycling_suspect_s: s(ms.cycling),
    vehicle_suspect_s: s(ms.vehicle),
    unknown_s: s(diag.labelMs.unknown || 0),
    running_distance_m: Math.round(distanceM),
    excluded_cycling_m: Math.round(excluded.cycling),
    excluded_vehicle_m: Math.round(excluded.vehicle),
    excluded_stationary_m: Math.round(excluded.stationary),
    uncertain_distance_m: Math.round(diag.uncertainM),
    segments: seg,
    transitions: diag.transitions.length,
    activity_end_ms: endedAt,
  };

  const speeds = ev.fixes.map((f) => f.spd).filter((v) => v != null && v >= 0).sort((a, b) => a - b);
  const pct = (p) => (speeds.length ? Number(speeds[Math.floor(p * (speeds.length - 1))].toFixed(2)) : null);

  return {
    points,
    distanceM,
    startedAt: ev.startedAt,
    endedAt,
    movingMs,
    segments: segs,
    summary,
    notice,
    diagnostics: {
      ...diag,
      timeMs: ms,
      lastConfirmedActiveAt: engine.lastActiveAt,
      speedPercentiles: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99) },
      evidence: { fixes: ev.fixes.length, steps: ev.steps.length, motion: ev.motion.length },
    },
  };
}
