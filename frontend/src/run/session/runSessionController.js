// The Run screen's one handle on the session: evidence in, decisions out,
// everything persisted as it arrives.
//
// RunningScreen owns the map, the HUD and the buttons. This owns the rest of
// the lifecycle — the session engine, the durable evidence store, the
// pedometer subscription and its epochs, Core Motion polling, the reminders
// and the dev diagnostics — so the screen never has to know why a stretch
// stopped counting, only THAT it did.
//
// Nothing here renders and nothing here navigates; it is plain JS the screen
// keeps in a ref.

import { Pedometer } from 'expo-sensors';

import { filterPoints } from '../gpsFilter';
import { queryMotion } from '../motionActivity';
import { lowerBound } from './activityClassifier';
import { RUN_SESSION, SESSION_STATE } from './config';
import { finalizeSession } from './finalizeSession';
import { decideRecovery, resumeGapPause } from './recovery';
import {
  armPausedReminder, armStillRunning, cancelAllRunReminders, cancelPausedReminder, scheduleCheckpoints,
} from './runReminders';
import { createSessionEngine } from './sessionEngine';
import { createSessionStore, loadSession } from './sessionStore';
import { fillStepGaps } from './stepHistory';

const FLUSH_EVERY_MS = 15000;
const MOTION_POLL_MS = 30000;
const STEP_HEARTBEAT_MS = 5000;

// The events the screen reacts to. Only transitions the runner should hear
// about become events; the step-by-step bookkeeping stays inside.
export const SESSION_EVENT = Object.freeze({
  AUTO_PAUSED: 'auto_paused',
  AUTO_RESUMED: 'auto_resumed',
  VEHICLE: 'vehicle',
  CYCLING: 'cycling',
  RECOVERY_REQUIRED: 'recovery_required',
});

function toFix(p) {
  return {
    t: p.timestamp,
    lat: p.latitude,
    lon: p.longitude,
    acc: p.accuracyM ?? null,
    spd: p.speedMps ?? null,
    alt: p.altitude ?? null,
    mocked: !!p.mocked,
  };
}

function toGpsPoint(f) {
  return {
    latitude: f.lat, longitude: f.lon, timestamp: f.t,
    accuracyM: f.acc ?? null, speedMps: f.spd ?? null, altitude: f.alt ?? null, mocked: false,
  };
}

export function createRunSessionController({ cfg = RUN_SESSION, now = () => Date.now() } = {}) {
  const store = createSessionStore();
  let engine = null;
  let meta = null; // { runId, startedAt, stepEpochs, ... }
  let seenTransitions = 0;
  let lastFlushAt = 0;
  let lastMotionPollAt = 0;
  let lastStepSampleAt = 0;
  let stillArmedFor = 0;

  // Pedometer: cumulative steps across every subscription of this run.
  let pedSub = null;
  let pedOk = false;
  let epochBase = 0;
  let epochSteps = 0;
  let lastTotal = 0;

  function stepTotal() {
    return epochBase + epochSteps;
  }

  async function startSteps() {
    stopSteps();
    try {
      const perm = await Pedometer.requestPermissionsAsync?.();
      if (perm && !perm.granted) return;
      if (!(await Pedometer.isAvailableAsync())) return;
      pedOk = true;
      epochBase = lastTotal;
      epochSteps = 0;
      meta.stepEpochs = [...(meta.stepEpochs || []), { t: now(), base: epochBase }];
      pedSub = Pedometer.watchStepCount((r) => {
        epochSteps = r.steps || 0;
      });
    } catch {
      pedOk = false;
    }
  }

  function stopSteps() {
    try {
      pedSub?.remove?.();
    } catch {}
    pedSub = null;
    lastTotal = Math.max(lastTotal, stepTotal());
  }

  function recordStepSample(t) {
    if (!pedOk || !pedSub) return;
    lastTotal = Math.max(lastTotal, stepTotal());
    const sample = { t, total: lastTotal };
    engine.addSteps([sample]);
    store.append('steps', [sample]);
  }

  async function pollMotion(t, spanMs) {
    const rows = await queryMotion(t - spanMs, t);
    const ev = engine.evidence.motion;
    const fresh = rows.filter((r) => {
      const i = lowerBound(ev, r.t);
      return !(ev[i] && ev[i].t === r.t);
    });
    if (fresh.length) {
      engine.addMotion(fresh);
      store.append('motion', fresh);
    }
  }

  function metaFor(t) {
    return {
      ...meta,
      userPauses: engine.evidence.userPauses,
      acknowledgedAt: engine.evidence.acknowledgedAt,
      lastActiveAt: engine.lastActiveAt,
      lastTotal,
      savedAtClient: t,
    };
  }

  function flush(t = now()) {
    if (!engine) return Promise.resolve();
    lastFlushAt = t;
    return store.flush(metaFor(t));
  }

  function rearmReminders(status) {
    if (status.stepState === SESSION_STATE.USER_PAUSED) return;
    const since = Math.max(status.lastActiveAt, engine.evidence.acknowledgedAt ?? 0);
    if (Math.abs(since - stillArmedFor) < 60000) return;
    stillArmedFor = since;
    armStillRunning(since, cfg);
  }

  function eventsSince(status) {
    const out = [];
    const tr = engine.transitions;
    // A replay rebuilds the transition list; only ones beyond what the screen
    // already heard about are news.
    if (tr.length < seenTransitions) seenTransitions = tr.length;
    for (let i = seenTransitions; i < tr.length; i += 1) {
      const x = tr[i];
      if (x.to === SESSION_STATE.AUTO_PAUSED) out.push({ type: SESSION_EVENT.AUTO_PAUSED, at: x.t });
      else if (x.to === SESSION_STATE.SUSPICIOUS_MOTION) {
        out.push({ type: x.reason === 'vehicle' ? SESSION_EVENT.VEHICLE : SESSION_EVENT.CYCLING, at: x.t });
      } else if (x.reason === 'auto_resume') out.push({ type: SESSION_EVENT.AUTO_RESUMED, at: x.t });
    }
    seenTransitions = tr.length;
    if (status.state === SESSION_STATE.RECOVERY_REQUIRED) out.push({ type: SESSION_EVENT.RECOVERY_REQUIRED, at: status.lastActiveAt });
    return out;
  }

  const api = {
    get active() {
      return !!engine;
    },
    get runId() {
      return meta?.runId ?? null;
    },
    get startedAt() {
      return meta?.startedAt ?? null;
    },
    get pedometerOk() {
      return pedOk;
    },

    /** A brand new run. */
    async begin({ runId, startedAt }) {
      await store.clear();
      meta = { runId, startedAt, stepEpochs: [] };
      engine = createSessionEngine({ startedAt, cfg });
      seenTransitions = 0;
      stillArmedFor = 0;
      lastTotal = 0;
      await startSteps();
      await flush(startedAt);
      scheduleCheckpoints(startedAt, cfg);
      armStillRunning(startedAt, cfg);
    },

    /**
     * The open run left by a previous process, if any, replayed over
     * everything recorded (including background fixes and step and motion
     * history the live view never saw). Returns null, or
     * { runId, startedAt, status, decision, distanceM }.
     */
    async restore({ backgroundFixes = [] } = {}) {
      const saved = await loadSession();
      if (!saved?.meta?.runId) return null;
      meta = {
        runId: saved.meta.runId,
        startedAt: saved.meta.startedAt,
        stepEpochs: saved.meta.stepEpochs || [],
      };
      lastTotal = saved.meta.lastTotal || 0;
      store.reset(saved.meta.chunks || { fixes: 0, steps: 0, motion: 0 }, saved.tails);
      engine = createSessionEngine({
        cfg,
        evidence: {
          startedAt: meta.startedAt,
          fixes: saved.evidence.fixes,
          steps: saved.evidence.steps,
          motion: saved.evidence.motion,
          userPauses: saved.meta.userPauses || [],
          acknowledgedAt: saved.meta.acknowledgedAt ?? null,
        },
      });
      seenTransitions = 0;
      api.addBackgroundFixes(backgroundFixes);
      const t = now();
      await api.fillHistory(t);
      const status = engine.advance(t);
      seenTransitions = engine.transitions.length;
      const decision = decideRecovery({
        meta: { savedAt: saved.meta.savedAtClient ?? saved.meta.savedAt, startedAt: meta.startedAt },
        status,
        now: t,
        cfg,
      });
      return { runId: meta.runId, startedAt: meta.startedAt, status, decision, trail: api.trail(t) };
    },

    /** Carry on recording a restored run (after the runner chose RESUME, or silently). */
    async continueRecording({ gapFrom } = {}) {
      const t = now();
      if (gapFrom != null) {
        const gap = resumeGapPause({ lastActiveAt: gapFrom, now: t });
        if (gap.to - gap.from > cfg.STEP_MS) {
          engine.userPause(gap.from);
          engine.userResume(gap.to);
        }
        engine.acknowledge(t);
      }
      await startSteps();
      stillArmedFor = 0;
      rearmReminders(engine.advance(t));
      scheduleCheckpoints(meta.startedAt, cfg);
      await flush(t);
    },

    /** A fix from the live watcher, recorded whatever state the run is in. */
    recordFix(point) {
      if (!engine || point?.mocked) return;
      const f = toFix(point);
      engine.addFixes([f]);
      store.append('fixes', [f]);
    },

    /** Fixes the background task buffered while the app was away. */
    addBackgroundFixes(points) {
      if (!engine || !points?.length) return;
      const fixes = points.filter((p) => !p.mocked).map(toFix);
      engine.addFixes(fixes);
      store.append('fixes', fixes);
    },

    userPause(t = now()) {
      if (!engine?.userPause(t)) return;
      stopSteps();
      armPausedReminder(t, cfg);
      flush(t);
    },

    async userResume(t = now()) {
      if (!engine?.userResume(t)) return;
      cancelPausedReminder();
      await startSteps();
      stillArmedFor = 0;
      flush(t);
    },

    /**
     * The runner pressed Resume while PASER had paused the run itself (a stop
     * it judged too long, or motion it took for a bike). Their call wins: the
     * automatic pause is recorded as theirs, ended now, and the run counts
     * again from here. The server still judges whatever follows.
     */
    forceResume(t = now()) {
      if (!engine) return false;
      const st = engine.advance(t);
      if (st.counting || st.pausedFrom == null) return false;
      if (!engine.userPause(Math.min(st.pausedFrom, t))) return false;
      engine.userResume(t);
      engine.acknowledge(t);
      stillArmedFor = 0;
      flush(t);
      return true;
    },

    /** Write everything pending now (the app is going to the background). */
    persist() {
      return flush(now());
    },

    /**
     * Once a second from the Run screen. Returns { status, events }.
     * Cheap when nothing is late: only the new 5 s steps are evaluated.
     */
    tick(t = now()) {
      if (!engine) return null;
      if (t - lastStepSampleAt >= STEP_HEARTBEAT_MS) {
        lastStepSampleAt = t;
        recordStepSample(t);
      }
      if (t - lastMotionPollAt >= MOTION_POLL_MS) {
        lastMotionPollAt = t;
        pollMotion(t, 3 * MOTION_POLL_MS).catch(() => {});
      }
      const status = engine.advance(t);
      const events = eventsSince(status);
      rearmReminders(status);
      if (events.length || t - lastFlushAt >= FLUSH_EVERY_MS) flush(t);
      return { status, events };
    },

    status(t = now()) {
      return engine ? engine.status(t) : null;
    },

    movingMs(t = now()) {
      return engine ? engine.movingMs(t) : 0;
    },

    /**
     * The trail as the runner should see it: accepted running stretches only,
     * each run through the live GPS filter, never bridged. Rebuilt after any
     * backdated decision (a stop, a resume, a vehicle cut) or a late merge.
     */
    trail(t = now()) {
      if (!engine) return { points: [], distanceM: 0 };
      const ev = engine.evidence;
      const points = [];
      let distanceM = 0;
      for (const iv of engine.runningIntervals(t)) {
        const lo = lowerBound(ev.fixes, iv.from);
        const hi = lowerBound(ev.fixes, iv.to + 1);
        const { points: pts, distanceM: d } = filterPoints(
          ev.fixes.slice(lo, hi).map(toGpsPoint),
          { maxSpeedMps: cfg.RUNNING_SPEED_HARD_IMPOSSIBLE_MPS }
        );
        points.push(...pts);
        distanceM += d;
      }
      return { points, distanceM };
    },

    /** Step and motion history for everything the live view missed. */
    async fillHistory(t = now()) {
      if (!engine) return;
      const ev = engine.evidence;
      try {
        const available = await Pedometer.isAvailableAsync();
        if (available && Pedometer.getStepCountAsync) {
          const filled = await fillStepGaps({
            samples: ev.steps,
            epochs: meta.stepEpochs || [],
            from: meta.startedAt,
            to: t,
            query: async (a, b) => {
              try {
                const r = await Pedometer.getStepCountAsync(new Date(a), new Date(b));
                return r?.steps ?? null;
              } catch {
                return null;
              }
            },
            cfg,
          });
          // Not persisted: history can always be asked again, and the live
          // samples on disk stay exactly what the live counter reported.
          ev.steps.length = 0;
          engine.addSteps(filled);
          lastTotal = Math.max(lastTotal, filled.length ? filled[filled.length - 1].total : 0);
        }
      } catch {}
      await pollMotion(t, t - meta.startedAt + 60000).catch(() => {});
    },

    /**
     * End the run at `endAt` (or at the last running movement, if the runner
     * had stopped). Returns finalizeSession's result plus the step count
     * inside the accepted running stretches, which is what the server's
     * stride check should see.
     */
    async finalize(endAt = now()) {
      if (!engine) return null;
      stopSteps();
      await api.fillHistory(endAt);
      const result = finalizeSession(engine, endAt, {
        cfg,
        filterOptions: { maxSpeedMps: cfg.RUNNING_SPEED_HARD_IMPOSSIBLE_MPS },
      });
      const steps = engine.evidence.steps;
      let stepsInRunning = null;
      if (pedOk || steps.length) {
        stepsInRunning = 0;
        const at = (x) => {
          const i = Math.min(lowerBound(steps, x), steps.length - 1);
          return i >= 0 ? steps[i].total : 0;
        };
        for (const iv of engine.runningIntervals(endAt)) stepsInRunning += Math.max(0, at(iv.to) - at(iv.from));
        if (!steps.length) stepsInRunning = null;
      }
      await flush(endAt);
      return { ...result, stepsInRunning };
    },

    /** The run is saved (or thrown away): forget it here. */
    async close() {
      stopSteps();
      await cancelAllRunReminders(cfg);
      await store.clear();
      engine = null;
      meta = null;
      pedOk = false;
    },

    /** Stop listening without forgetting (screen unmounting mid-run). */
    detach() {
      stopSteps();
      flush();
    },

    diagnostics() {
      return engine ? engine.diagnostics() : null;
    },
  };
  return api;
}
