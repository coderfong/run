// Finds a finished Apple Watch run and gets it into PASER, wherever the
// runner happens to be in the app.
//
// Mounted ONCE at the app root (App.js), not inside RunningScreen — the
// route can finish transferring, and the "ready" notification can be
// tapped, while the runner is on Club, on You, or with the app not running
// at all. src/notifications/route.js already sends a watch notification to
// Home rather than into the Record modal for exactly this reason, so the
// submission itself cannot depend on that modal ever being open.
//
// RunningScreen keeps a SEPARATE concern: mirroring a watch run's LIVE
// metrics while it is still going (useWatchLiveMirror.js). This hook only
// ever touches a run once the watch has said it is finished.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import {
  addWatchRunStateListener,
  consumePendingWatchRun,
  getPendingWatchRuns,
} from './watchLink';
import { parseLiveState, validatePendingRun } from './watchRunState';
import { clearWatchRunMapping, submitWatchRun } from '../run/watchRunImport';
import { useRecording } from '../state/recording';
import { toast } from '../ui/toast';

export default function useWatchRunSync({ navigationRef }) {
  const { isRecording } = useRecording();
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  // Which watch runIds are mid-submission right now, so a live event and a
  // foreground check landing in the same second cannot both call /end-run
  // for the same run.
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    let alive = true;

    const submitOne = async (pending) => {
      const validated = validatePendingRun(pending);
      if (!validated.ok) return;
      const { runId } = validated.run;
      if (inFlightRef.current.has(runId)) return;
      // One PASER workout at a time, same rule runOwnership.js enforces the
      // other way: never let a watch import race a phone run that is
      // somehow live right now.
      if (isRecordingRef.current) return;
      inFlightRef.current.add(runId);
      try {
        const { result, path } = await submitWatchRun(validated.run);
        // Only now — server AND local cleanup, in that order — is this watch
        // run truly finished with. See submitWatchRun's own note on why
        // clearing the mapping any earlier would risk a duplicate server run
        // if this next line failed.
        await consumePendingWatchRun(runId);
        await clearWatchRunMapping(runId);
        if (!alive) return;
        const nav = navigationRef?.current || navigationRef;
        if (nav?.isReady?.()) {
          nav.navigate('Record', {
            screen: 'Result',
            params: { result, run: result, path },
          });
        }
      } catch (err) {
        // Left pending on disk and in the server-id mapping: the next
        // foreground check, or the next `route_ready` event, tries again.
        // A submission failure must never look like the run is gone.
        toast.error(err?.message || 'Could not sync your Apple Watch run. It is still on your watch — PASER will try again.');
      } finally {
        inFlightRef.current.delete(runId);
      }
    };

    const checkPending = async () => {
      const runs = await getPendingWatchRuns();
      if (!alive || !runs.length) return;
      // Oldest first (already sorted by the native side): if more than one
      // is somehow waiting, submit in the order they actually happened.
      for (const run of runs) {
        // eslint-disable-next-line no-await-in-loop
        await submitOne(run);
      }
    };

    checkPending();

    const stateSub = addWatchRunStateListener((raw) => {
      const parsed = parseLiveState(raw);
      if (parsed?.kind === 'routeReady') checkPending();
    });

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPending();
    });

    return () => {
      alive = false;
      stateSub.remove();
      appSub?.remove?.();
    };
  }, [navigationRef]);
}
