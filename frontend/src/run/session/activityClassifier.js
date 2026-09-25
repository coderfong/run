// What was the runner doing over a window of time? A weighted-rules engine,
// not a model: every label is the sum of small pieces of evidence, each of
// which can be read and argued with.
//
// EVIDENCE (all optional; a missing signal contributes nothing, it never
// counts against the run):
//   fixes   [{ t, lat, lon, acc, spd }]           raw GPS, time-sorted
//   steps   [{ t, total }]                        cumulative step count, sorted
//   motion  [{ t, kind, conf }]                   Core Motion activity changes;
//           kind ∈ stationary|walking|running|cycling|automotive|unknown,
//           conf 0 low · 1 medium · 2 high. Each reading lasts until the next.
//
// NO SINGLE SIGNAL DECIDES. Speed on its own is worth at most a small nudge
// toward cycling, and running cadence outweighs it several times over, which
// is what keeps a 2:30/km interval from reading as a bike. Near-zero steps
// only speak once real distance has been covered (150 m with no steps can be
// pedometer lag). Core Motion is one vote among several: it is often right
// and sometimes confidently wrong.
//
// Pure functions over plain arrays; nothing here knows about React or time.

import { LABEL, RUN_SESSION } from './config';

const EARTH_R = 6371000;

export function haversineM(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** First index whose `t` is >= t (arrays are time-sorted). */
export function lowerBound(arr, t) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function medianPoint(fixes) {
  const med = (k) => fixes.map((f) => f[k]).sort((x, y) => x - y)[fixes.length >> 1];
  return { lat: med('lat'), lon: med('lon') };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/** The cumulative step count at `t`, interpolated, or null with no sample near. */
function stepsAt(steps, t, cfg) {
  if (!steps?.length) return null;
  const i = lowerBound(steps, t);
  const after = steps[i];
  const before = i > 0 ? steps[i - 1] : null;
  if (after && after.t === t) return { total: after.total, t };
  if (before && after) {
    if (after.t - before.t > cfg.STEP_SAMPLE_MAX_AGE_MS * 2) return null;
    const k = (t - before.t) / (after.t - before.t);
    return { total: before.total + k * (after.total - before.total), t };
  }
  const near = before || after;
  if (near && Math.abs(near.t - t) <= cfg.STEP_SAMPLE_MAX_AGE_MS / 3) return { total: near.total, t: near.t };
  return null;
}

/** Share of [from, to] each motion kind covers, at usable confidence. */
function motionShares(motion, from, to, cfg) {
  const shares = {};
  if (!motion?.length || to <= from) return shares;
  let i = Math.max(0, lowerBound(motion, from) - 1);
  for (; i < motion.length && motion[i].t < to; i += 1) {
    const m = motion[i];
    const start = Math.max(from, m.t);
    // A reading lasts until the next one, but not forever: Core Motion reports
    // changes, and a reading this old with nothing after it is not evidence.
    const end = Math.min(to, motion[i + 1] ? motion[i + 1].t : to, m.t + cfg.MOTION_MAX_SPAN_MS);
    if (end <= start || (m.conf ?? 0) < cfg.MOTION_MIN_CONFIDENCE) continue;
    shares[m.kind] = (shares[m.kind] || 0) + (end - start) / (to - from);
  }
  return shares;
}

/**
 * The measurable facts about [from, to]. Everything the scoring reads, and
 * everything the diagnostics log.
 */
export function windowStats(evidence, from, to, cfg = RUN_SESSION) {
  const fixes = evidence.fixes || [];
  const lo = lowerBound(fixes, from);
  const hi = lowerBound(fixes, to + 1);
  const good = [];
  for (let i = lo; i < hi; i += 1) {
    const f = fixes[i];
    if (f.acc == null || f.acc <= cfg.CLASSIFIER_MAX_ACCURACY_M) good.push(f);
  }

  let pathM = 0;
  let netM = 0;
  let maxGapS = 0;
  let meanAcc = null;
  const speeds = [];
  if (good.length) {
    let anchor = good[0];
    let accSum = good[0].acc ?? 20;
    for (let i = 1; i < good.length; i += 1) {
      const f = good[i];
      accSum += f.acc ?? 20;
      const gapS = (f.t - good[i - 1].t) / 1000;
      if (gapS > maxGapS) maxGapS = gapS;
      // Jitter floor: a step smaller than the fix's own noise is not ground.
      const step = haversineM(anchor, f);
      if (step >= Math.max(4, 0.6 * (f.acc ?? 20))) {
        pathM += step;
        anchor = f;
      }
      if (f.spd != null && f.spd >= 0) speeds.push(f.spd);
      else if (gapS > 0) speeds.push(haversineM(good[i - 1], f) / gapS);
    }
    if (good[0].spd != null && good[0].spd >= 0) speeds.push(good[0].spd);
    // Net displacement between the median positions of the first and last
    // thirds of the window, not first fix to last fix: one wild drift fix at
    // either end must not read as the runner having moved.
    netM = good.length >= 6
      ? haversineM(medianPoint(good.slice(0, Math.ceil(good.length / 3))), medianPoint(good.slice(-Math.ceil(good.length / 3))))
      : haversineM(good[0], good[good.length - 1]);
    meanAcc = accSum / good.length;
  }
  speeds.sort((a, b) => a - b);

  // When did the runner last stand somewhere else? The newest fix outside
  // the drift circle around where they are now. Used to backdate a stop.
  // Measured from the median of the newest fixes, and only ended by several
  // fixes in a row outside the circle: one wild drift fix is not movement.
  let stillSince = null;
  if (good.length) {
    const here = medianPoint(good.slice(-10));
    const radius = Math.max(cfg.DRIFT_RADIUS_M, 1.5 * (meanAcc ?? 20));
    stillSince = good[0].t;
    let outside = 0;
    for (let i = good.length - 1; i >= 0; i -= 1) {
      outside = haversineM(good[i], here) > radius ? outside + 1 : 0;
      if (outside >= 3) {
        stillSince = good[Math.min(good.length - 1, i + 3)].t;
        break;
      }
    }
  }

  const a = stepsAt(evidence.steps, from, cfg);
  const b = stepsAt(evidence.steps, to, cfg);
  let stepsDelta = null;
  let cadenceSpm = null;
  if (a && b && b.t - a.t >= 10000) {
    stepsDelta = Math.max(0, b.total - a.total);
    cadenceSpm = stepsDelta / ((b.t - a.t) / 60000);
  }

  // The newest moment the runner was seen MOVING: when they arrived where
  // they are now (stillSince — a few seconds ago for someone running, the
  // moment they stopped for someone standing), or the last time the step
  // count went up. Not the newest fix: fixes keep arriving from a phone on a
  // table, and dating activity by them would slide a stop forward forever.
  let lastEvidenceAt = stillSince;
  const st = evidence.steps || [];
  for (let j = lowerBound(st, to + 1) - 1; j > 0 && st[j].t >= from; j -= 1) {
    if (st[j].total > st[j - 1].total) {
      lastEvidenceAt = Math.max(lastEvidenceAt ?? 0, st[j].t);
      break;
    }
  }

  return {
    from,
    to,
    lastEvidenceAt,
    fixCount: good.length,
    rawFixCount: hi - lo,
    pathM,
    netM,
    maxGapS,
    meanAcc,
    medianSpeed: percentile(speeds, 0.5),
    p90Speed: percentile(speeds, 0.9),
    stillSince,
    stepsDelta,
    cadenceSpm,
    strideM: stepsDelta && stepsDelta > 0 ? pathM / stepsDelta : null,
    motion: motionShares(evidence.motion, from, to, cfg),
  };
}

/**
 * Score a window. Returns { label, confidence, scores, stats, reasons }.
 * `reasons` names every rule that fired, for the dev diagnostics.
 */
export function classifyWindow(evidence, from, to, cfg = RUN_SESSION) {
  const s = windowStats(evidence, from, to, cfg);
  const scores = { running: 0, stationary: 0, cycling: 0, vehicle: 0 };
  const reasons = [];
  const add = (label, v, why) => {
    scores[label] += v;
    reasons.push(`${label}${v >= 0 ? '+' : ''}${v}:${why}`);
  };

  const cadence = s.cadenceSpm;
  const hasSteps = cadence != null;
  const driftR = Math.max(cfg.DRIFT_RADIUS_M, 1.5 * (s.meanAcc ?? 20));
  // Core Motion only counts alongside fresh evidence of our own. A reading
  // carried into a stretch with no fixes and no step samples (the app was
  // dead) cannot vouch for that stretch on its own.
  const fresh = s.fixCount > 0 || hasSteps;
  const m = fresh ? s.motion : {};
  const onFootMotion = (m.running || 0) + (m.walking || 0);

  // --- Stationary ---
  if (s.fixCount >= 2 && s.netM <= driftR && (s.medianSpeed ?? 0) < cfg.STILL_SPEED_MPS) {
    add('stationary', 2, 'inside drift radius');
  } else if (s.fixCount >= 2 && s.netM <= driftR) {
    add('stationary', 1, 'little displacement');
  }
  if (s.fixCount === 0 && hasSteps && cadence < cfg.NO_STEPS_CADENCE_SPM) {
    // iOS stops delivering fixes to a phone that is not moving.
    add('stationary', 1.5, 'no fixes and no steps');
  }
  if (hasSteps && cadence < cfg.NO_STEPS_CADENCE_SPM && s.pathM < cfg.STRIDE_MIN_WINDOW_M) {
    add('stationary', 1.5, 'no stepping');
  }
  if ((m.stationary || 0) >= 0.5) add('stationary', 1.5, 'motion stationary');

  // --- Running / on foot ---
  if (hasSteps && cadence >= cfg.RUNNING_CADENCE_SPM) add('running', 2.5, 'running cadence');
  else if (hasSteps && cadence >= cfg.WALKING_CADENCE_SPM) add('running', 1.5, 'walking cadence');
  if (onFootMotion >= 0.5) add('running', 1.5, 'motion on foot');
  if (s.medianSpeed != null && s.medianSpeed >= 1 && s.medianSpeed <= cfg.RUNNING_SPEED_SOFT_MAX_MPS
    && s.netM > driftR) {
    add('running', 1, 'running speed');
  }
  if (s.strideM != null && s.pathM >= cfg.STRIDE_MIN_WINDOW_M
    && s.strideM >= cfg.STRIDE_MIN_M && s.strideM <= cfg.STRIDE_MAX_M) {
    add('running', 1, 'plausible stride');
  }
  // Moving with steps rules out stationary, whatever the GPS says.
  if (hasSteps && cadence >= cfg.WALKING_CADENCE_SPM) scores.stationary -= 2;
  if (onFootMotion >= 0.5) scores.stationary -= 1;

  // --- Cycling ---
  if ((m.cycling || 0) >= 0.5) add('cycling', 2.5, 'motion cycling');
  if (hasSteps && s.pathM >= cfg.STRIDE_MIN_WINDOW_M && cadence < cfg.NO_STEPS_CADENCE_SPM) {
    add('cycling', 2, 'distance without steps');
  }
  if (s.strideM != null && s.pathM >= cfg.STRIDE_MIN_WINDOW_M && s.strideM > cfg.STRIDE_WHEELS_M) {
    add('cycling', 1.5, 'stride too long for feet');
  }
  if (s.medianSpeed != null && s.medianSpeed > 4 && s.medianSpeed <= 12) {
    // Weak on purpose: 4–6.5 m/s is ordinary for fast runners.
    add('cycling', 0.5, 'bike-range speed');
  }
  if (onFootMotion >= 0.5) scores.cycling -= 2;
  if (hasSteps && cadence >= cfg.RUNNING_CADENCE_SPM) scores.cycling -= 3;

  // --- Vehicle ---
  if ((m.automotive || 0) >= 0.5) add('vehicle', 3, 'motion automotive');
  if (s.medianSpeed != null && s.medianSpeed > cfg.VEHICLE_SPEED_MPS) add('vehicle', 2.5, 'vehicle speed');
  if (s.p90Speed != null && s.p90Speed > cfg.RUNNING_SPEED_HARD_IMPOSSIBLE_MPS && s.fixCount >= 4) {
    add('vehicle', 1, 'sustained impossible speed');
  }
  if (hasSteps && s.pathM >= 300 && cadence < cfg.NO_STEPS_CADENCE_SPM) add('vehicle', 1.5, 'long distance without steps');
  if (hasSteps && cadence >= cfg.RUNNING_CADENCE_SPM) scores.vehicle -= 3;
  if (onFootMotion >= 0.5) scores.vehicle -= 2;
  // Cycling and vehicle share signals; speed decides which is likelier.
  if (s.medianSpeed != null && s.medianSpeed > cfg.VEHICLE_SPEED_MPS) scores.cycling -= 1;

  const positive = Object.values(scores).reduce((sum, v) => sum + Math.max(0, v), 0);
  let label = LABEL.UNKNOWN;
  let best = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (v > best) {
      best = v;
      label = k;
    }
  }
  if (best < cfg.LABEL_MIN_SCORE) label = LABEL.UNKNOWN;
  const confidence = positive > 0 ? Math.max(0, best) / positive : 0;

  return { label, confidence, scores, stats: s, reasons };
}

/**
 * Where did a stretch of cycling or driving actually begin? The newest moment
 * the runner was still stepping (from the step samples) or, without steps,
 * the start of the trailing run of faster-than-foot fixes. Null when neither
 * signal can say, and the caller falls back to the window's midpoint.
 */
export function changePoint(evidence, from, to, cfg = RUN_SESSION) {
  const steps = evidence.steps || [];
  if (steps.length >= 2) {
    const hi = lowerBound(steps, to + 1) - 1;
    for (let j = hi; j > 0 && steps[j].t >= from; j -= 1) {
      const a = steps[j - 1];
      const b = steps[j];
      const dtMin = (b.t - a.t) / 60000;
      if (dtMin > 0 && (b.total - a.total) / dtMin >= cfg.WALKING_CADENCE_SPM) return b.t;
    }
  }
  const fixes = evidence.fixes || [];
  let i = lowerBound(fixes, to + 1) - 1;
  let start = null;
  let misses = 0;
  for (; i > 0 && fixes[i].t >= from; i -= 1) {
    const f = fixes[i];
    const prev = fixes[i - 1];
    const dt = (f.t - prev.t) / 1000;
    const spd = f.spd != null && f.spd >= 0 ? f.spd : (dt > 0 ? haversineM(prev, f) / dt : 0);
    if (spd > cfg.RUNNING_SPEED_SOFT_MAX_MPS) {
      start = f.t;
      misses = 0;
    } else if (++misses > 1) break;
  }
  return start;
}
