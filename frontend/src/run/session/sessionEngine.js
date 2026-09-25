// The run session: evidence in, decisions out.
//
// RECORDING, VALIDATION AND ANTI-CHEAT ARE THREE DIFFERENT THINGS.
//   * Recording keeps every piece of evidence (fixes, step samples, Core
//     Motion readings, user pauses), whatever state the session is in.
//     Nothing is thrown away because it looked wrong at the time.
//   * Validation (this file) walks that evidence in 5 s steps and decides what
//     each stretch was: running, stopped, cycling, in a vehicle, paused by the
//     runner, or unknown. Only running (and unknown-but-plausible) stretches
//     become distance, moving time, territory and rewards.
//   * Anti-cheat stays on the server (backend/app/anticheat.py). This file
//     sends it a summary; it never accuses anyone.
//
// ONE ALGORITHM, TWO USES. The live Run screen advances the engine once a
// second for its HUD; finishing a run replays the very same steps over the
// complete evidence (background fixes, step history and motion history
// included). Late evidence — a background batch drained on return to the
// foreground — marks the engine dirty and the next advance replays from the
// start, so the live view can never drift from what finishing would decide.
//
// STATE MACHINE (per step):
//
//   ACTIVE_RUNNING ──stationary 45s──▶ POSSIBLY_STATIONARY ──90s──▶ AUTO_PAUSED
//        ▲   ▲                              │ movement                   │
//        │   └──────────────────────────────┘                            │
//        └──────── on-foot movement confirmed for 10s (backdated) ───────┘
//   ACTIVE_RUNNING ──cycling 120s / vehicle 60s──▶ SUSPICIOUS_MOTION ──30s on foot──▶ ACTIVE
//   any ──user pause──▶ USER_PAUSED ──user resume only──▶ ACTIVE
//
// RECOVERY_REQUIRED is not a step state: it is what status(now) reports when
// there has been no running evidence for STALE_RUN_S (or a user pause has
// been left for STALE_USER_PAUSE_S) and the runner has not said to carry on.
// It needs the runner: finish at the last movement, keep recording, or
// discard. Nothing is ever ended automatically.

import { COUNTING_STATES, LABEL, RUN_SESSION, SEGMENT, SESSION_STATE } from './config';
import { changePoint, classifyWindow, haversineM, lowerBound, windowStats } from './activityClassifier';

const S = SESSION_STATE;

function insertSorted(arr, items) {
  if (!items.length) return false;
  const last = arr.length ? arr[arr.length - 1].t : -Infinity;
  const inOrder = items.every((x, i) => x.t > (i ? items[i - 1].t : last));
  if (inOrder) {
    arr.push(...items);
    return false;
  }
  arr.push(...items);
  arr.sort((a, b) => a.t - b.t);
  // Drop exact duplicates (a background fix also seen by the live watcher).
  let w = 0;
  for (let r = 0; r < arr.length; r += 1) {
    if (w && arr[w - 1].t === arr[r].t) continue;
    arr[w] = arr[r];
    w += 1;
  }
  arr.length = w;
  return true;
}

export function createSessionEngine({ startedAt, cfg = RUN_SESSION, evidence } = {}) {
  const ev = {
    startedAt: evidence?.startedAt ?? startedAt,
    fixes: evidence?.fixes ? [...evidence.fixes] : [],
    steps: evidence?.steps ? [...evidence.steps] : [],
    motion: evidence?.motion ? [...evidence.motion] : [],
    // [{ from, to }] — the runner's own pauses. `to` null while open.
    userPauses: evidence?.userPauses ? evidence.userPauses.map((p) => ({ ...p })) : [],
    // When the runner last said "keep recording" to a recovery prompt.
    acknowledgedAt: evidence?.acknowledgedAt ?? null,
  };

  let m; // machine state, rebuilt by reset()
  let dirtyFrom = null; // earliest time late evidence landed at

  function reset() {
    m = {
      t: ev.startedAt, // the last evaluated step's end
      state: S.ACTIVE_RUNNING,
      reason: 'start',
      segments: [],
      open: { kind: SEGMENT.RUNNING, from: ev.startedAt },
      lastActiveAt: ev.startedAt,
      stationaryStart: null,
      cyclingStart: null,
      vehicleStart: null,
      movingStart: null,
      pauseAnchor: null,
      transitions: [],
      labelMs: { running: 0, stationary: 0, cycling: 0, vehicle: 0, unknown: 0 },
      uncertainM: 0,
      samples: [], // coarse per-minute diagnostics
      lastSampleAt: 0,
    };
  }
  reset();

  function cut(kind, at, state, reason) {
    const at2 = Math.max(at, m.open.from);
    if (at2 > m.open.from) m.segments.push({ ...m.open, to: at2 });
    m.open = { kind, from: at2 };
    m.transitions.push({ t: at2, at: m.t, from: m.state, to: state, reason });
    m.state = state;
    m.reason = reason;
  }

  function resetStreaks() {
    m.stationaryStart = null;
    m.cyclingStart = null;
    m.vehicleStart = null;
    m.movingStart = null;
  }

  function lastFixBefore(t) {
    const i = lowerBound(ev.fixes, t + 1) - 1;
    return i >= 0 ? ev.fixes[i] : null;
  }

  // User pauses are exact events, applied at their own timestamps rather
  // than rounded to a step.
  function applyUserPauses(from, to) {
    for (const p of ev.userPauses) {
      if (p.from > from && p.from <= to && m.state !== S.USER_PAUSED) {
        cut(SEGMENT.USER_PAUSED, p.from, S.USER_PAUSED, 'user_pause');
        resetStreaks();
      }
      if (p.to != null && p.to > from && p.to <= to && m.state === S.USER_PAUSED) {
        cut(SEGMENT.RUNNING, p.to, S.ACTIVE_RUNNING, 'user_resume');
        m.lastActiveAt = Math.max(m.lastActiveAt, p.to);
        resetStreaks();
      }
    }
  }

  function step(t) {
    const from = m.t;
    applyUserPauses(from, t);
    m.t = t;
    if (m.state === S.USER_PAUSED) return;

    const win = classifyWindow(ev, t - cfg.LOOKBACK_MS, t, cfg);
    const st = win.stats;
    const driftR = Math.max(cfg.DRIFT_RADIUS_M, 1.5 * (st.meanAcc ?? 20));
    const moving = st.netM > driftR;
    let label = win.label;
    // A GPS-only runner (no pedometer, no motion) often scores below the
    // label bar. Plausible foot-speed movement is running until something
    // says otherwise: uncertainty is not evidence against the run.
    if (label === LABEL.UNKNOWN && moving && (st.medianSpeed ?? 0) <= cfg.RUNNING_SPEED_SOFT_MAX_MPS) {
      label = LABEL.RUNNING;
      if (COUNTING_STATES.has(m.state)) {
        const stepStats = windowStats(ev, t - cfg.STEP_MS, t, cfg);
        m.uncertainM += stepStats.pathM;
      }
    }
    m.labelMs[win.label] = (m.labelMs[win.label] || 0) + cfg.STEP_MS;

    if (t - m.lastSampleAt >= 60000) {
      m.lastSampleAt = t;
      m.samples.push({
        t,
        label: win.label,
        confidence: Number(win.confidence.toFixed(2)),
        cadenceSpm: st.cadenceSpm == null ? null : Math.round(st.cadenceSpm),
        speedMps: st.medianSpeed == null ? null : Number(st.medianSpeed.toFixed(2)),
        strideM: st.strideM == null ? null : Number(st.strideM.toFixed(2)),
        motion: st.motion,
        reasons: win.reasons,
      });
    }

    if (COUNTING_STATES.has(m.state)) {
      if (label === LABEL.RUNNING) {
        m.lastActiveAt = Math.max(m.lastActiveAt, Math.min(t, st.lastEvidenceAt ?? t));
        resetStreaks();
        if (m.state === S.POSSIBLY_STATIONARY) {
          m.transitions.push({ t, at: t, from: m.state, to: S.ACTIVE_RUNNING, reason: 'moving' });
          m.state = S.ACTIVE_RUNNING;
        }
        return;
      }
      if (label === LABEL.STATIONARY) {
        m.cyclingStart = null;
        m.vehicleStart = null;
        if (m.stationaryStart == null) m.stationaryStart = Math.max(st.stillSince ?? t - cfg.STEP_MS, m.lastActiveAt, m.open.from);
        const still = (t - m.stationaryStart) / 1000;
        if (still >= cfg.AUTO_PAUSE_S) {
          m.pauseAnchor = lastFixBefore(t);
          cut(SEGMENT.STATIONARY, m.stationaryStart, S.AUTO_PAUSED, 'stationary');
          m.movingStart = null;
        } else if (still >= cfg.STATIONARY_CANDIDATE_S && m.state === S.ACTIVE_RUNNING) {
          m.transitions.push({ t, at: t, from: m.state, to: S.POSSIBLY_STATIONARY, reason: 'stationary_candidate' });
          m.state = S.POSSIBLY_STATIONARY;
        }
        return;
      }
      if (label === LABEL.CYCLING || label === LABEL.VEHICLE) {
        const isVehicle = label === LABEL.VEHICLE;
        const threshold = isVehicle ? cfg.VEHICLE_CONFIDENCE_THRESHOLD : cfg.CYCLING_CONFIDENCE_THRESHOLD;
        if (win.confidence < threshold) return;
        m.stationaryStart = null;
        const key = isVehicle ? 'vehicleStart' : 'cyclingStart';
        // Backdated to where the change really happened: the last stepping,
        // or the first faster-than-foot fix. Only with neither signal is the
        // boundary the midpoint of the window that first said so.
        if (m[key] == null) {
          const cp = changePoint(ev, t - 2 * cfg.LOOKBACK_MS, t, cfg);
          m[key] = Math.max(cp ?? t - cfg.LOOKBACK_MS / 2, m.lastActiveAt - cfg.STEP_MS, m.open.from);
        }
        const held = (t - m[key]) / 1000;
        if (held >= (isVehicle ? cfg.VEHICLE_CONFIRM_S : cfg.CYCLING_CONFIRM_S)) {
          m.pauseAnchor = lastFixBefore(t);
          cut(isVehicle ? SEGMENT.VEHICLE : SEGMENT.CYCLING, m[key], S.SUSPICIOUS_MOTION, label);
          m.movingStart = null;
        }
        return;
      }
      // UNKNOWN and not moving: neither evidence of stopping nor of running.
      return;
    }

    // --- Paused by evidence: AUTO_PAUSED or SUSPICIOUS_MOTION -------------
    const short = classifyWindow(ev, t - cfg.RESUME_LOOKBACK_MS, t, cfg);
    const here = lastFixBefore(t);
    const away = m.pauseAnchor && here ? haversineM(m.pauseAnchor, here) : 0;
    const suspicious = m.state === S.SUSPICIOUS_MOTION;
    const footSpeed = (short.stats.medianSpeed ?? 0) <= cfg.RUNNING_SPEED_SOFT_MAX_MPS;
    const onFoot = short.label === LABEL.RUNNING
      || (!suspicious && short.label === LABEL.UNKNOWN && away > cfg.RESUME_DISPLACEMENT_M && footSpeed
        && short.stats.medianSpeed != null && short.stats.medianSpeed >= 1);
    // Cadence alone (a runner jogging on the spot at a light) is not a
    // resume: they have to have left the drift circle too.
    const left = away > cfg.RESUME_DISPLACEMENT_M || short.stats.netM > cfg.RESUME_DISPLACEMENT_M;
    if (onFoot && left) {
      if (m.movingStart == null) m.movingStart = Math.max(t - cfg.STEP_MS, m.open.from);
      const confirm = suspicious ? cfg.SUSPICIOUS_RESUME_CONFIRM_S : cfg.AUTO_RESUME_CONFIRM_S;
      if ((t - m.movingStart) / 1000 >= confirm) {
        cut(SEGMENT.RUNNING, m.movingStart, S.ACTIVE_RUNNING, 'auto_resume');
        m.lastActiveAt = Math.max(m.lastActiveAt, Math.min(t, short.stats.lastEvidenceAt ?? t));
        resetStreaks();
      }
    } else {
      m.movingStart = null;
      // A vehicle that has since parked stays a pause, but reads as the stop
      // it now is, for the diagnostics.
    }
  }

  function advance(now, { final = false } = {}) {
    if (dirtyFrom != null) {
      dirtyFrom = null;
      reset();
    }
    const upTo = final ? now : now - cfg.EVAL_LAG_MS;
    while (m.t + cfg.STEP_MS <= upTo) step(m.t + cfg.STEP_MS);
    if (final && m.t < upTo) step(upTo);
    return status(now);
  }

  function markDirty(t) {
    if (t < m.t) dirtyFrom = dirtyFrom == null ? t : Math.min(dirtyFrom, t);
  }

  /** What the session is doing now, including the derived recovery state. */
  function status(now) {
    const since = Math.max(m.lastActiveAt, ev.acknowledgedAt ?? 0);
    const openUserPause = ev.userPauses.find((p) => p.to == null);
    let state = m.state;
    let reason = m.reason;
    if (openUserPause && now - Math.max(openUserPause.from, ev.acknowledgedAt ?? 0) >= cfg.STALE_USER_PAUSE_S * 1000) {
      state = S.RECOVERY_REQUIRED;
      reason = 'stale_user_pause';
    } else if (!openUserPause && now - since >= cfg.STALE_RUN_S * 1000) {
      state = S.RECOVERY_REQUIRED;
      reason = 'stale';
    }
    return {
      state,
      reason,
      stepState: m.state,
      lastActiveAt: m.lastActiveAt,
      pausedFrom: COUNTING_STATES.has(m.state) ? null : m.open.from,
      counting: COUNTING_STATES.has(m.state) && state !== S.RECOVERY_REQUIRED,
    };
  }

  function segmentsAt(endAt) {
    const segs = m.segments.map((s) => ({ ...s }));
    if (endAt > m.open.from) segs.push({ ...m.open, to: endAt });
    return segs;
  }

  /** Moving time so far: running segments only. */
  function movingMs(now) {
    let ms = 0;
    for (const s of segmentsAt(now)) if (s.kind === SEGMENT.RUNNING) ms += s.to - s.from;
    return ms;
  }

  /**
   * The running intervals that count, for the trail and for submission.
   * `endAt` trims a trailing stretch with no running evidence (a forgotten
   * run ends where the running did, not where the phone was picked up).
   */
  function runningIntervals(endAt) {
    const trimTo = Math.min(endAt, trailingEnd(endAt));
    return segmentsAt(trimTo).filter((s) => s.kind === SEGMENT.RUNNING && s.to > s.from);
  }

  // Where the activity really ended: now, if running is still in evidence;
  // otherwise the last confirmed movement.
  function trailingEnd(endAt) {
    if (!COUNTING_STATES.has(m.state)) return Math.min(endAt, m.open.from);
    if (endAt - m.lastActiveAt >= cfg.AUTO_PAUSE_S * 1000) return m.lastActiveAt;
    return endAt;
  }

  return {
    get evidence() {
      return ev;
    },
    get state() {
      return m.state;
    },
    get lastActiveAt() {
      return m.lastActiveAt;
    },
    get transitions() {
      return m.transitions;
    },

    addFixes(fixes) {
      const clean = fixes.filter((f) => f && f.lat != null && f.lon != null && f.t != null && !f.mocked);
      if (!clean.length) return;
      const earliest = Math.min(...clean.map((f) => f.t));
      if (insertSorted(ev.fixes, clean) || earliest < m.t) markDirty(earliest);
    },
    addSteps(samples) {
      const clean = samples.filter((s) => s && s.t != null && s.total != null);
      if (!clean.length) return;
      const earliest = Math.min(...clean.map((s) => s.t));
      if (insertSorted(ev.steps, clean) || earliest < m.t) markDirty(earliest);
    },
    addMotion(samples) {
      const clean = samples.filter((s) => s && s.t != null && s.kind);
      if (!clean.length) return;
      const earliest = Math.min(...clean.map((s) => s.t));
      if (insertSorted(ev.motion, clean) || earliest < m.t) markDirty(earliest);
    },
    userPause(t) {
      if (ev.userPauses.some((p) => p.to == null)) return false;
      ev.userPauses.push({ from: t, to: null });
      markDirty(t);
      return true;
    },
    userResume(t) {
      const open = ev.userPauses.find((p) => p.to == null);
      if (!open) return false;
      open.to = Math.max(t, open.from);
      markDirty(open.to);
      return true;
    },
    /** The runner answered a recovery prompt with "keep recording". */
    acknowledge(t) {
      ev.acknowledgedAt = t;
    },

    advance,
    status,
    movingMs,
    runningIntervals,
    trailingEnd,
    segmentsAt,
    /** Diagnostics collected by the step walk (dev only). */
    diagnostics() {
      return {
        transitions: m.transitions.slice(),
        labelMs: { ...m.labelMs },
        uncertainM: m.uncertainM,
        samples: m.samples.slice(),
      };
    },
  };
}
