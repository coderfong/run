// Filling the step record where the live pedometer was not listening.
//
// The live subscription only reports while the app runs. In a pocket, iOS
// suspends it; after a crash it is gone. But CMPedometer keeps seven days of
// history, so every hole in the live samples can be filled after the fact by
// asking it how many steps were taken in each minute of the hole. That is
// what lets a run that spent an hour in the background still be judged on
// cadence, and what stops a crashed run's missing stretch from reading as
// "no steps" (a vehicle signature) when the runner was in fact running.
//
// Two kinds of hole:
//   * inside one subscription (backgrounded): the live total already
//     includes the hole's steps, so history only says how they were spread,
//     and is scaled to match the known total.
//   * across a new subscription (crash, reboot, a user pause): the live total
//     restarted from its saved base and never saw the hole, so history adds
//     the hole's steps and every later sample moves up by that many.

import { RUN_SESSION } from './config';

/**
 * @param samples [{ t, total }] live cumulative samples, sorted
 * @param epochs  [{ t }] times a live subscription started
 * @param from,to the run's span
 * @param query   async (fromMs, toMs) => steps | null
 * @returns new samples array (sorted, monotonic)
 */
export async function fillStepGaps({ samples, epochs = [], from, to, query, cfg = RUN_SESSION }) {
  if (typeof query !== 'function' || !(to > from)) return samples;
  const gapMs = cfg.STEP_SAMPLE_MAX_AGE_MS / 3;
  const live = samples.slice().sort((a, b) => a.t - b.t);
  const holes = [];
  let prevT = from;
  let prevIdx = -1;
  for (let i = 0; i <= live.length; i += 1) {
    const t = i < live.length ? live[i].t : to;
    if (t - prevT > gapMs) holes.push({ a: prevT, b: t, before: prevIdx, after: i < live.length ? i : -1 });
    prevT = t;
    prevIdx = i;
  }
  if (!holes.length) return live;

  let budget = cfg.STEP_HISTORY_MAX_QUERIES;
  const out = [];
  let shift = 0;
  let cursor = 0;
  for (const h of holes) {
    while (cursor < live.length && live[cursor].t <= h.a) {
      out.push({ t: live[cursor].t, total: live[cursor].total + shift });
      cursor += 1;
    }
    const windows = [];
    for (let s = h.a; s < h.b && budget > 0; s += cfg.STEP_HISTORY_WINDOW_MS) {
      const e = Math.min(h.b, s + cfg.STEP_HISTORY_WINDOW_MS);
      // eslint-disable-next-line no-await-in-loop
      const n = await query(s, e);
      budget -= 1;
      windows.push({ e, n: Number.isFinite(n) && n >= 0 ? n : null });
    }
    if (!windows.length || windows.some((w) => w.n == null)) continue;
    const histSum = windows.reduce((sum, w) => sum + w.n, 0);
    const base = (h.before >= 0 ? live[h.before].total : 0) + shift;
    const restarted = epochs.some((ep) => ep.t > h.a && ep.t <= h.b) || h.before < 0;
    const known = !restarted && h.after >= 0 ? live[h.after].total + shift - base : null;
    const scale = known != null && histSum > 0 ? known / histSum : 1;
    let acc = 0;
    for (const w of windows) {
      acc += w.n * scale;
      if (w.e < h.b || h.after < 0) out.push({ t: w.e, total: Math.round(base + acc) });
    }
    // The live counter never saw these steps: everything after moves up.
    if (known == null && h.after >= 0) shift += Math.round(acc);
  }
  while (cursor < live.length) {
    out.push({ t: live[cursor].t, total: live[cursor].total + shift });
    cursor += 1;
  }
  out.sort((a, b) => a.t - b.t);
  for (let i = 1; i < out.length; i += 1) if (out[i].total < out[i - 1].total) out[i].total = out[i - 1].total;
  return out;
}
