// A paused run covers no ground, but the background location task can keep
// recording through a pause: it does whenever PASER is on a paired watch,
// because the task is what keeps a pocketed phone awake enough to resume the
// run from the wrist (see pauseRun in RunningScreen). Its fixes are buffered
// and drained into the trail later, so the trail has to be told which
// stretches of time do not count.
//
// A window is { from, to } in epoch ms, `to` null while the pause is still on.
// A point is paused when from <= timestamp < to.

export function inPause(timestamp, windows) {
  if (!windows?.length) return false;
  return windows.some((w) => timestamp >= w.from && (w.to == null || timestamp < w.to));
}

export function withoutPausedPoints(points, windows) {
  if (!windows?.length || !points?.length) return points;
  return points.filter((p) => !inPause(p.timestamp, windows));
}
