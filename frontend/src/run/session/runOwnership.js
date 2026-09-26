// One active PASER run per person, whichever device is recording it.
//
// The phone and the watch can each record. Before either starts, it asks
// whether the other already is: a watch workout with a fresh heartbeat blocks
// a phone run (and the phone says where the run is), and a phone run the
// watch can see blocks the watch's own recorder (targets/watch mirrors it
// instead). The server backs this up by flagging a run whose time overlaps
// another finished run of the same account (backend/app/anticheat.py).

import { RUN_SESSION } from './config';

const LIVE_WATCH_PHASES = new Set(['countdown', 'running', 'paused']);

/**
 * @param watchWorkout { phase, at, runId } last heard from the watch, or null
 * @returns { allowed, reason }
 */
export function canStartPhoneRun({ watchWorkout, now, cfg = RUN_SESSION }) {
  if (watchWorkout && LIVE_WATCH_PHASES.has(watchWorkout.phase)
    && now - (watchWorkout.at || 0) < cfg.WATCH_WORKOUT_STALE_MS) {
    return { allowed: false, reason: 'watch_run_in_progress' };
  }
  return { allowed: true, reason: null };
}

/**
 * A stable id for one logical run on this device, minted before the server
 * run exists so every chunk of evidence can be filed under it from the start.
 */
export function newClientRunId(now = Date.now()) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `r_${now.toString(36)}_${rand}`;
}
