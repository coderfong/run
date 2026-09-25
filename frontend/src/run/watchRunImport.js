// Turning a completed Apple Watch workout into a normal, submitted PASER run.
//
// This is the ONE place that calls /start-run and /end-run for a watch
// import — RunningScreen never does, because a watch run is not necessarily
// heard about while that screen is even open (see watch/useWatchRunSync.js,
// the root-mounted caller). Kept separate from RunningScreen's own
// commitRun on purpose: that path writes the finished run to Apple Health,
// which a watch run must never do a second time — the workout it came from
// is already there, written by WorkoutManager.swift itself.
//
// IDEMPOTENT BY DESIGN. A watch run can be submitted more than once — the
// app crashes between /start-run and /end-run, or the runner backgrounds it
// mid-submission — and none of those may mint a second server run for the
// same workout. The watch's own runId is mapped to whichever server run_id
// /start-run returned for it, in AsyncStorage, BEFORE /end-run is attempted;
// a retry reads that mapping back and reuses the same run_id rather than
// starting again. The pending route file itself is the other half of that
// safety: it is only ever discarded (consumePendingWatchRun) after /end-run
// has actually answered, never merely because a submission was attempted.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../api/client';
import { invalidateAfterRun } from '../api/cache';
import { pathDistanceM, toApiPoints } from './gpsFilter';

const MAP_KEY_PREFIX = 'tr.watchRunServerId.';

async function getServerRunId(watchRunId) {
  try {
    return await AsyncStorage.getItem(MAP_KEY_PREFIX + watchRunId);
  } catch {
    return null;
  }
}

async function setServerRunId(watchRunId, serverId) {
  try {
    await AsyncStorage.setItem(MAP_KEY_PREFIX + watchRunId, serverId);
  } catch {
    // Worst case a retry calls /start-run again; the server's own overlap
    // check (backend/app/anticheat.py _overlaps_another_run) is the backstop
    // for exactly that, at the cost of a shadow-flagged duplicate rather
    // than a crash.
  }
}

async function clearServerRunId(watchRunId) {
  try {
    await AsyncStorage.removeItem(MAP_KEY_PREFIX + watchRunId);
  } catch {}
}

/**
 * Submit a validated pending watch run (see watch/watchRunState.js
 * `validatePendingRun`) through the ordinary run pipeline, exactly as a
 * phone-recorded run goes through it — real anti-cheat, real economy, real
 * territory. Returns `{ result, path }`, the same shape RunningScreen hands
 * to the Result screen, or throws on a genuine failure (network, server
 * refusal) so the caller can decide whether to retry.
 *
 * DELIBERATELY DOES NOT CLEAR THE SERVER-ID MAPPING ITSELF. The caller
 * (watch/useWatchRunSync.js) only does that — via `clearWatchRunMapping`,
 * below — once it has ALSO removed the native pending-run file. If this
 * function cleared the mapping the moment /end-run answered and the very
 * next step (consuming the pending file) then failed, a later retry would
 * find no mapping, call /start-run again, and mint a second server run for
 * a workout that already has one. Leaving the mapping in place until the
 * WHOLE cleanup succeeds is what makes a retry from any failure point safe:
 * /end-run on an already-finished run_id replays the stored answer rather
 * than paying twice (see the `run.ended_at is not None` branch in
 * backend/app/routes/runs.py end_run).
 */
export async function submitWatchRun(run) {
  const { runId, startedAtMs, endedAtMs, points } = run;

  let serverRunId = await getServerRunId(runId);
  if (!serverRunId) {
    const created = await api.startRun(startedAtMs, { source: 'watch' });
    serverRunId = created.run_id || created.id;
    await setServerRunId(runId, serverRunId);
  }

  const apiPoints = toApiPoints(points);
  // No step count: a watch workout has its own pedometer story inside
  // HealthKit, not the phone's CMPedometer session /end-run otherwise reads.
  const result = await api.endRun(serverRunId, apiPoints, null, false);

  invalidateAfterRun();

  return {
    result,
    path: points,
    distanceM: pathDistanceM(points),
    durationS: Math.max(0, (endedAtMs - startedAtMs) / 1000),
  };
}

/**
 * Forget a watch run's server-id mapping. Two callers, one function:
 *   * useWatchRunSync, after it has ALSO removed the native pending-run
 *     file — the submission is fully done, on both sides, and nothing will
 *     ever need to resume it from where it left off again.
 *   * a runner explicitly discarding a pending run without submitting it.
 * Either way this alone does not touch the native pending-run file; the
 * caller owns that half.
 */
export async function clearWatchRunMapping(runId) {
  await clearServerRunId(runId);
}
