// Mirrors a standalone Apple Watch workout's live metrics onto the phone,
// for RunningScreen — see the file header there for how it is used. This
// hook only ever DISPLAYS: it never starts, stops, or computes its own
// distance from phone GPS while a watch run owns the workout (that is the
// whole point — see the architecture note in the room this was designed in:
// one canonical run owner, never two independent trackers of the same run).
//
// Recovers from every disconnect case on its own:
//   * app opened mid watch-run  → seeded from watchWorkoutStatus() below,
//     which reads the durable application-context the watch always keeps
//     current, even for a phone that was not running to receive the live
//     stream when it was sent.
//   * WatchConnectivity drops   → the last live state is kept (`active`
//     stays true) until STALE_MS passes with nothing new, at which point
//     this reports `stale: true` rather than silently zeroing the numbers —
//     RunningScreen's job, not this hook's, to decide what that looks like.
//   * a delayed/out-of-order message → isNewerLiveState rejects it.

import { useEffect, useRef, useState } from 'react';

import { addWatchRunStateListener, watchWorkoutStatus } from './watchLink';
import { isNewerLiveState, parseLiveState, WATCH_RUN_STATE } from './watchRunState';

// No live message in this long: connectivity is presumed lost, not the run.
const STALE_MS = 15000;
// How fresh watchWorkoutStatus()'s durable report has to be to seed from —
// mirrors RUN_SESSION.WATCH_WORKOUT_STALE_MS, the same number
// canStartPhoneRun uses to decide a watch workout is still actually live.
const SEED_MAX_AGE_MS = 2 * 60 * 1000;

export default function useWatchLiveMirror() {
  const [state, setState] = useState(null);
  const stateRef = useRef(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Seed: a workout already in progress when this screen opens. Numbers
    // stay at zero until the first live message lands, but `active` is
    // already true, so the mirror UI is on screen immediately rather than
    // waiting up to a second for silence to prove itself meaningful.
    const seed = watchWorkoutStatus();
    if (
      seed &&
      (seed.phase === 'running' || seed.phase === 'paused') &&
      Number.isFinite(seed.at) &&
      Date.now() - seed.at < SEED_MAX_AGE_MS
    ) {
      const initial = {
        kind: 'live',
        runId: seed.runId || 'unknown',
        state: seed.phase,
        seq: -1, // any real message, seq >= 0, is free to replace this
        sentAtMs: seed.at,
        startedAtMs: seed.at,
        elapsedS: 0,
        distanceM: 0,
        paceSPerKm: null,
        lat: null,
        lon: null,
      };
      stateRef.current = initial;
      setState(initial);
    }

    const sub = addWatchRunStateListener((raw) => {
      const parsed = parseLiveState(raw);
      if (!parsed || parsed.kind !== 'live') return;
      if (!isNewerLiveState(parsed, stateRef.current)) return;
      stateRef.current = parsed;
      setState(parsed);
    });
    return () => sub.remove();
  }, []);

  // Staleness ticker. Cheap and coarse on purpose — this only ever flips a
  // boolean a runner might glance at, not anything the claim flow prices.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return { active: false, paused: false, stale: false, distanceM: 0, elapsedS: 0, paceSPerKm: null, lat: null, lon: null };
  }
  // `tick` is read only to force this to re-evaluate on the staleness
  // timer; the value itself means nothing.
  void tick;
  const stale = Date.now() - state.sentAtMs > STALE_MS;
  const finished = state.state === WATCH_RUN_STATE.FINISHED;

  return {
    active: !finished && !stale,
    paused: state.state === WATCH_RUN_STATE.PAUSED,
    stale: !finished && stale,
    distanceM: state.distanceM,
    elapsedS: state.elapsedS,
    paceSPerKm: state.paceSPerKm,
    lat: state.lat,
    lon: state.lon,
  };
}
