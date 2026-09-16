/**
 * The vehicle gate's decision logic, with no timers, no UI and no side
 * effects — the same shape as gpsFilter.js and pauseWindows.js next door.
 *
 * WHAT IT DECIDES. Two independent signals say "this is not on foot":
 *
 *   (a) consecutive fixes faster than a runner can move, and
 *   (b) ground covered inside a window with (almost) no steps under it, which
 *       is what a bus looks like to a working pedometer.
 *
 * WHAT IT DOES ABOUT IT: says so, once. It does not pause, it does not block,
 * and it cannot speak twice in one run. That last part is the whole reason
 * this is a module rather than three refs in the run screen — "fires at most
 * once" is an invariant, and an invariant spread across two call sites and a
 * timer is one somebody will break by accident.
 *
 * IT IS NOT THE ENFORCEMENT. `_check_stride` in backend/app/anticheat.py
 * catches the same signature when the run is submitted and is a HARD_REASON,
 * so the server unverifies the run whatever this gate did or did not notice.
 * Everything here is a courtesy to the runner, which is exactly why it is
 * allowed to be quiet and is never allowed to be in the way.
 */

export function createVehicleGate({
  fastPointsNeeded,
  windowDistanceM,
  minStepsPerWindow,
}) {
  let fastPoints = 0;
  let flagged = false;
  let window = { distanceM: 0, steps: 0 };

  // The single place the one-shot rule lives. Every signal goes through it,
  // and it is the only thing that can return true.
  function raise() {
    if (flagged) return false;
    flagged = true;
    return true;
  }

  return {
    get flagged() {
      return flagged;
    },

    /** A new run. Nothing carries over from the last one. */
    reset() {
      fastPoints = 0;
      flagged = false;
      window = { distanceM: 0, steps: 0 };
    },

    /**
     * Open a measuring window at the current totals. Called when the watch
     * starts and again on resume, so a pause never reads as ground covered
     * without steps.
     */
    armWindow({ distanceM, steps }) {
      window = { distanceM, steps };
    },

    /** A fix the platform reported as faster than a runner. */
    onFastFix() {
      fastPoints += 1;
      if (fastPoints < fastPointsNeeded) return false;
      return raise();
    },

    /** A fix that was fine. Breaks the run of fast ones. */
    onGoodFix() {
      fastPoints = 0;
    },

    /**
     * The windowed distance-vs-steps check. `pedometerOk` is false when there
     * is no pedometer or permission was refused, and with no step count the
     * signal means nothing — silence is the only honest answer.
     */
    onWindow({ distanceM, steps, pedometerOk }) {
      const movedM = distanceM - window.distanceM;
      const tookSteps = steps - window.steps;
      window = { distanceM, steps };
      if (!pedometerOk) return false;
      if (movedM <= windowDistanceM) return false;
      if (tookSteps >= minStepsPerWindow) return false;
      return raise();
    },
  };
}
