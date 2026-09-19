// GPS conditioning for a live run.
//
// The raw fix stream is not a path. Consumer GPS reports a position with a
// stated accuracy that swings between ~4 m in the open and ~50 m under trees,
// in a doorway, or between tall buildings, and the error wanders several
// metres at a time even while the phone sits perfectly still. The trail used
// to append every fix that landed more than a fixed 2 m from the previous
// one, which turned that error straight into distance: waiting at a crossing
// grew the total, one coarse fix on a corner added a phantom sprint, and
// because pace is distance over time, every one of those jumps showed up as a
// pace swing a second later.
//
// This module sits between the OS watcher and the trail:
//
//   1. Hard-rejects fixes too coarse to mean anything (accuracy gate). A
//      50 m fix carries no information about a runner moving 3 m/s.
//   2. Smooths what survives with a 1-D Kalman filter whose measurement
//      variance is the fix's own reported accuracy, so a coarse fix barely
//      moves the estimate while a sharp one snaps to it.
//   3. Accumulates distance only once the estimate has moved further than
//      that fix's noise floor FROM THE LAST ACCEPTED POINT. Measuring the
//      step from the last accepted point (rather than the last fix) is what
//      makes the gate lossless: a rejected fix defers distance into the next
//      accepted step instead of discarding it, so a filtered run is shorter
//      than an unfiltered one only by the noise that was never run.
//   4. Keeps a trailing window of (time, distance) samples so pace can be
//      read over the last stretch of running and smoothed, instead of being
//      recomputed from scratch against a total that just jumped.
//
// Everything here is pure JS over plain objects so it can be unit tested
// without a device; RunningScreen owns all of the React state.

export const GPS_DEFAULTS = {
  // Fixes worse than this tell us nothing useful and never enter the trail.
  // Increased from 35m to 50m to accept more points and better match Apple Watch
  maxAccuracyM: 50,
  // Platforms that report no accuracy at all are treated as this good.
  assumedAccuracyM: 20,
  // Floor on the step gate, so a perfect fix still needs real movement.
  // Reduced from 2.5m to 1.5m to capture smaller movements
  minStepM: 1.5,
  // Step gate as a fraction of the fix's accuracy: a 10 m fix has to move
  // 5 m before we believe it.
  // Reduced from 0.5 to 0.3 to be less aggressive about filtering noise
  noiseFactor: 0.3,
  // Nobody runs faster than this; a step implying more is a GPS glitch.
  maxSpeedMps: 8,
  // ...but a glitch that persists is not a glitch. After this many rejections
  // in a row the position really has moved (a tunnel, a lift, a phone that
  // lost the constellation and refound it elsewhere) and the estimate
  // resyncs there. The ground in between is never credited. Kept above
  // runTuning.vehicleFastPoints on purpose: a caller counting refusals to
  // spot a bus has to reach its own verdict before the filter quietly
  // forgives the streak.
  teleportResyncFixes: 6,
  // Kalman process noise: how far the true position is expected to move
  // between fixes, as a speed. This is the tracking-versus-smoothing dial.
  // Too low and the estimate lags a moving runner, which costs real distance
  // at the start of every stretch; a runner's own pace is the honest value.
  processNoiseMps: 3,
  // Pace is read over the last this-many ms of running...
  // Increased from 30s to 60s for more stable pace readings that match Apple Watch
  paceWindowMs: 60000,
  // ...widening backwards until it spans at least this much ground, so the
  // reading degrades smoothly into the run average instead of flickering
  // between two different meanings.
  // Reduced from 60m to 30m to allow pace to show earlier in the run
  paceMinDistanceM: 30,
  // Time constant of the smoothing applied to the window reading. Expressed
  // as a time rather than a per-call weight so the number a caller sees does
  // not depend on how often they ask for it.
  // Increased from 5s to 8s for smoother pace transitions
  paceSmoothingTauMs: 8000,
  // No accepted movement for this long means stopped, not slow.
  paceStallMs: 60000,
};

const EARTH_R = 6371000;

function toRad(value) {
  return (value * Math.PI) / 180;
}

export function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return EARTH_R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function pathDistanceM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
}

// Reasons a fix did not extend the trail. Returned rather than logged so the
// caller can decide what to surface (today: nothing, the GPS dot already
// tells the runner when the signal is poor).
export const DROP = {
  ACCURACY: 'accuracy',
  STALE: 'stale',
  TELEPORT: 'teleport',
  NOISE: 'noise',
};

export function createGpsFilter(options = {}) {
  const cfg = { ...GPS_DEFAULTS, ...options };

  // Kalman state, in degrees with a variance carried in square metres.
  let estLat = null;
  let estLon = null;
  let variance = -1;
  let lastFixAt = 0;

  // Last point that actually entered the trail, and the running total.
  let anchor = null;
  let distanceM = 0;

  // Consecutive fixes refused for implying an impossible speed.
  let teleports = 0;

  // Trailing (t, cumulative distance) samples for pace.
  let samples = [];
  let smoothedPace = null;
  let smoothedPaceAt = 0;

  function reset() {
    estLat = null;
    estLon = null;
    variance = -1;
    lastFixAt = 0;
    anchor = null;
    distanceM = 0;
    teleports = 0;
    samples = [];
    smoothedPace = null;
    smoothedPaceAt = 0;
  }

  // After a pause (or a spell in the background) the clock gap would make the
  // filter think the runner teleported and would poison the pace window.
  // Resuming keeps the total but starts the estimate fresh.
  function resume() {
    estLat = null;
    estLon = null;
    variance = -1;
    lastFixAt = 0;
    teleports = 0;
    samples = [];
    smoothedPace = null;
    smoothedPaceAt = 0;
  }

  // Adopt an externally rebuilt path (crash restore, background merge). The
  // pace window is rebuilt from the tail of that path rather than thrown
  // away, so coming back to the foreground does not blank the pace readout
  // for the next half minute.
  function seed(points, totalM) {
    distanceM = typeof totalM === 'number' ? totalM : pathDistanceM(points);
    anchor = points.length ? points[points.length - 1] : null;
    teleports = 0;
    samples = [];
    if (!anchor) {
      resume();
      return;
    }

    estLat = anchor.latitude;
    estLon = anchor.longitude;
    const acc = anchor.accuracyM || cfg.assumedAccuracyM;
    variance = acc * acc;
    lastFixAt = anchor.timestamp || 0;

    const newestT = anchor.timestamp || Date.now();
    const tail = [{ t: newestT, d: distanceM }];
    let running = distanceM;
    for (let i = points.length - 1; i > 0; i--) {
      running -= haversineM(points[i - 1], points[i]);
      tail.push({ t: points[i - 1].timestamp, d: running });
      // Twice the window is enough history for the widening walk to land on.
      if (newestT - points[i - 1].timestamp > cfg.paceWindowMs * 2) break;
    }
    samples = tail.reverse();
  }

  // fix: { latitude, longitude, timestamp, accuracyM, speedMps, altitude, mocked }
  // Returns { ok, advanced, reason, point, stepM, speedMps, distanceM }.
  function accept(fix) {
    const drop = (reason) => ({
      ok: false,
      advanced: false,
      reason,
      point: null,
      stepM: 0,
      speedMps: null,
      distanceM,
    });

    if (!fix || fix.latitude == null || fix.longitude == null) return drop(DROP.STALE);

    const accuracyM = fix.accuracyM == null ? cfg.assumedAccuracyM : fix.accuracyM;
    if (!(accuracyM > 0) || accuracyM > cfg.maxAccuracyM) return drop(DROP.ACCURACY);

    const t = fix.timestamp || Date.now();
    if (lastFixAt && t <= lastFixAt) return drop(DROP.STALE);

    // --- Kalman update -----------------------------------------------------
    // Snapshotted first, because a fix that turns out to be a glitch has to
    // leave no trace: letting a 400 m outlier drag the estimate and then only
    // refusing the step still bends the trail either side of it, which is
    // distance the runner never covered.
    const before = { estLat, estLon, variance, lastFixAt };

    if (variance < 0) {
      estLat = fix.latitude;
      estLon = fix.longitude;
      variance = accuracyM * accuracyM;
    } else {
      const dt = Math.max((t - lastFixAt) / 1000, 0);
      variance += dt * cfg.processNoiseMps * cfg.processNoiseMps;
      const k = variance / (variance + accuracyM * accuracyM);
      estLat += k * (fix.latitude - estLat);
      estLon += k * (fix.longitude - estLon);
      variance *= 1 - k;
    }
    lastFixAt = t;

    const point = {
      latitude: estLat,
      longitude: estLon,
      timestamp: t,
      mocked: fix.mocked ?? false,
      accuracyM: fix.accuracyM ?? null,
      speedMps: fix.speedMps ?? null,
      altitude: fix.altitude ?? null,
      // Marks a point as already conditioned, so a later pass over a rebuilt
      // path (see filterPoints) does not smooth it a second time and quietly
      // shave metres off the total.
      smoothed: true,
    };

    if (!anchor) {
      anchor = point;
      teleports = 0;
      samples = [{ t, d: distanceM }];
      return { ok: true, advanced: true, reason: null, point, stepM: 0, speedMps: null, distanceM };
    }

    // Both ends of this step are estimates, so they lag a moving runner by
    // the same amount and the speed between them is the runner's, not the
    // filter's. Measuring a raw fix against a smoothed anchor would read as a
    // sprint on every stretch.
    const stepM = haversineM(anchor, point);
    const gapS = Math.max((t - anchor.timestamp) / 1000, 0.001);
    const speedMps = stepM / gapS;

    if (speedMps > cfg.maxSpeedMps) {
      teleports += 1;
      if (teleports < cfg.teleportResyncFixes) {
        estLat = before.estLat;
        estLon = before.estLon;
        variance = before.variance;
        lastFixAt = before.lastFixAt;
        return drop(DROP.TELEPORT);
      }
      // It has held long enough to be real. Pick the run up from here, with
      // the unexplained ground left uncredited.
      estLat = fix.latitude;
      estLon = fix.longitude;
      variance = accuracyM * accuracyM;
      teleports = 0;
      anchor = { ...point, latitude: estLat, longitude: estLon };
      samples.push({ t, d: distanceM });
      return { ok: true, advanced: true, reason: null, point: anchor, stepM: 0, speedMps, distanceM };
    }
    teleports = 0;

    // The noise floor is set by the fix we are about to trust, not by the one
    // behind us: it is this fix's error that could be inventing the step.
    const floorM = Math.max(cfg.minStepM, cfg.noiseFactor * accuracyM);
    if (stepM < floorM) {
      return { ok: true, advanced: false, reason: DROP.NOISE, point, stepM, speedMps, distanceM };
    }

    distanceM += stepM;
    anchor = point;
    samples.push({ t, d: distanceM });
    // 10 minutes of samples is far more than any pace window needs.
    if (samples.length > 600) samples = samples.slice(-600);

    return { ok: true, advanced: true, reason: null, point, stepM, speedMps, distanceM };
  }

  // Seconds per kilometre over the trailing window, smoothed; null when there
  // is nothing honest to show (run too short, or the runner has stopped).
  function paceSPerKm(nowMs = Date.now()) {
    if (samples.length < 2) return null;
    const newest = samples[samples.length - 1];
    if (nowMs - newest.t > cfg.paceStallMs) {
      smoothedPace = null;
      smoothedPaceAt = 0;
      return null;
    }

    // Walk back to the window edge, then keep walking until the window spans
    // enough ground to measure. Falling back to the whole run this way means
    // the number always has the same meaning: pace over the last stretch,
    // where the stretch is as short as the data allows.
    let i = samples.length - 1;
    while (i > 0) {
      const spansWindow = newest.t - samples[i].t >= cfg.paceWindowMs;
      const spansDistance = newest.d - samples[i].d >= cfg.paceMinDistanceM;
      if (spansWindow && spansDistance) break;
      i -= 1;
    }
    const oldest = samples[i];
    const dd = newest.d - oldest.d;
    const dt = (newest.t - oldest.t) / 1000;
    if (dd < cfg.paceMinDistanceM || dt <= 0) return smoothedPace;

    const raw = dt / (dd / 1000);
    if (smoothedPace == null) {
      smoothedPace = raw;
    } else {
      // Weight by how long it has been since the last reading, so polling
      // once a second and polling once a minute both settle at the same rate.
      const alpha = 1 - Math.exp(-Math.max(nowMs - smoothedPaceAt, 0) / cfg.paceSmoothingTauMs);
      smoothedPace += (raw - smoothedPace) * alpha;
    }
    smoothedPaceAt = nowMs;
    return smoothedPace;
  }

  return {
    accept,
    reset,
    resume,
    seed,
    paceSPerKm,
    get distanceM() {
      return distanceM;
    },
    get anchor() {
      return anchor;
    },
  };
}

// Stateless pass over an array of fixes, used when a path is rebuilt from
// somewhere other than the live watcher (background buffer drain, crash
// restore). Points already carrying `smoothed` skip the Kalman so a repeated
// pass cannot shrink a total that was already conditioned.
export function filterPoints(points, options = {}) {
  const cfg = { ...GPS_DEFAULTS, ...options };
  const out = [];
  let distance = 0;

  const raw = createGpsFilter(cfg);
  for (const p of points) {
    if (p.mocked) continue;

    if (!p.smoothed) {
      const res = raw.accept(p);
      if (!res.advanced) continue;
      const prev = out[out.length - 1];
      if (prev) distance += haversineM(prev, res.point);
      out.push(res.point);
      continue;
    }

    // Already conditioned: gate it against what we have kept, nothing more.
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(p);
      continue;
    }
    if (p.timestamp <= prev.timestamp) continue;
    const stepM = haversineM(prev, p);
    const gapS = Math.max((p.timestamp - prev.timestamp) / 1000, 0.001);
    if (stepM / gapS > cfg.maxSpeedMps) continue;
    const accuracyM = p.accuracyM == null ? cfg.assumedAccuracyM : p.accuracyM;
    if (stepM < Math.max(cfg.minStepM, cfg.noiseFactor * accuracyM)) continue;
    distance += stepM;
    out.push(p);
  }

  return { points: out, distanceM: distance };
}
