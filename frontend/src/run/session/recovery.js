// What to do with a run that is still open when PASER comes back.
//
// A run is never resumed blind after the app was away, and never counted
// through a stretch nobody can vouch for. The rules:
//
//   * The process died (or the phone rebooted) and the last save is more than
//     RECOVERY_GAP_S old: recovery is required UNLESS background evidence
//     shows running right up to now (the location task kept recording).
//   * The engine says the run is stale (no running evidence for STALE_RUN_S,
//     or a user pause left for STALE_USER_PAUSE_S): recovery is required.
//   * Otherwise the run just carries on.
//
// "Finish" ends the run at the last confirmed running movement, not at the
// moment the runner reopened the app. "Resume" treats the unexplained gap as
// a pause, so the missing period is never counted.

import { RUN_SESSION, SESSION_STATE } from './config';

export const RECOVERY_ACTION = Object.freeze({
  FINISH: 'finish',
  RESUME: 'resume',
  DISCARD: 'discard',
});

/**
 * @param meta    { savedAt, lastActiveAt, startedAt } from the session store
 * @param status  engine.status(now) after replaying all evidence
 * @returns { required, reason, lastActiveAt, gapMs }
 */
export function decideRecovery({ meta, status, now, cfg = RUN_SESSION }) {
  const lastActiveAt = Math.max(status?.lastActiveAt ?? 0, 0) || meta?.lastActiveAt || meta?.startedAt || now;
  const savedAt = meta?.savedAt ?? lastActiveAt;
  const gapMs = Math.max(0, now - savedAt);
  const recentActivity = now - lastActiveAt < cfg.RECOVERY_GAP_S * 1000;

  if (status?.state === SESSION_STATE.RECOVERY_REQUIRED) {
    return { required: true, reason: status.reason, lastActiveAt, gapMs };
  }
  if (gapMs >= cfg.RECOVERY_GAP_S * 1000 && !recentActivity) {
    return { required: true, reason: 'process_gap', lastActiveAt, gapMs };
  }
  if (status?.stepState === SESSION_STATE.USER_PAUSED && gapMs >= cfg.RECOVERY_GAP_S * 1000) {
    return { required: true, reason: 'paused_while_away', lastActiveAt, gapMs };
  }
  return { required: false, reason: null, lastActiveAt, gapMs };
}

/**
 * The pause to record when the runner chooses RESUME: from the last running
 * evidence to now, so the gap is excluded from moving time and distance.
 */
export function resumeGapPause({ lastActiveAt, now }) {
  return { from: Math.min(lastActiveAt, now), to: now };
}
