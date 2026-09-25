// Every threshold the run-session validity system uses, in one place.
//
// THE PRINCIPLE. PASER records evidence first (every fix, step sample and
// motion reading, persisted as it arrives) and decides what counts from that
// evidence, in windows, with hysteresis. No single number here can end, void
// or cap a run on its own:
//
//   * duration is NEVER a verdict. A 24 hour run with running evidence
//     throughout is a 24 hour run. Long runs get checkpoints, not limits.
//   * speed is NEVER a verdict. A fast fix is one input to the classifier,
//     weighed against cadence, motion activity and stride.
//   * uncertainty is a state (UNKNOWN), not an accusation. Unknown stretches
//     keep their evidence and count as running unless something contradicts it.
//
// Values are starting points for tester calibration (see the field-test
// matrix in docs/RUN_SESSION.md), chosen from what the signals can physically
// resolve rather than from data we do not have yet. Change them here only.

export const RUN_SESSION = Object.freeze({
  // --- Evaluation windows ---------------------------------------------------

  // The classifier is evaluated every STEP_MS over the trailing LOOKBACK_MS.
  // 5 s steps keep auto-resume responsive; 60 s of lookback is the "medium"
  // window the brief asks for: long enough that one bad fix or one missing
  // pedometer burst cannot flip the label, short enough to see a stop.
  STEP_MS: 5000,
  LOOKBACK_MS: 60000,
  // While paused, movement is judged over this shorter window, so a runner
  // setting off again is noticed within seconds rather than a minute.
  RESUME_LOOKBACK_MS: 20000,
  // Windows are only evaluated once they are this far in the past, so a fix
  // still in flight from the OS (or a background batch) lands before judging.
  EVAL_LAG_MS: 4000,

  // --- Stationary / auto-pause ----------------------------------------------

  // GPS wanders 5–30 m around a phone that is not moving. Displacement inside
  // this radius (or 1.5x the fixes' own stated accuracy, whichever is larger)
  // is drift, never distance.
  DRIFT_RADIUS_M: 25,
  // Below this median speed a window with no other movement evidence is still.
  STILL_SPEED_MPS: 0.6,
  // Stationary this long becomes a CANDIDATE (UI unchanged). 45 s clears every
  // ordinary traffic light and crossing without a flicker.
  STATIONARY_CANDIDATE_S: 45,
  // Stationary this long AUTO-PAUSES, backdated to when the stop began, so the
  // moving clock excludes the whole stop. 90 s: longer than a long light,
  // shorter than a coffee.
  AUTO_PAUSE_S: 90,
  // Movement must hold this long (in agreeing 5 s steps) before an auto-pause
  // resumes, backdated to the first moving step so no distance is lost.
  AUTO_RESUME_CONFIRM_S: 10,
  // To resume, the runner must also leave the drift circle by this much.
  RESUME_DISPLACEMENT_M: 30,

  // --- Forgotten / stale runs -----------------------------------------------

  // Auto-paused (no running evidence) this long: one "Still running?" local
  // notification. 15 min: nobody's coffee stop needs nagging sooner.
  FORGOTTEN_RUN_NOTIFICATION_S: 15 * 60,
  // A USER pause this long: one "Your run is paused" reminder.
  FORGOTTEN_PAUSE_NOTIFICATION_S: 20 * 60,
  // No running evidence for this long (from the last confirmed movement): the
  // run is STALE and needs the runner to decide (finish / resume / discard).
  // 45 min tolerates a long lunch in an ultra without silently counting it.
  STALE_RUN_S: 45 * 60,
  // The same for a run the runner paused themselves and walked away from.
  STALE_USER_PAUSE_S: 60 * 60,
  // Reopened after process death with this big a hole since the last save,
  // and no background evidence of movement: recovery is required.
  RECOVERY_GAP_S: 120,
  // Non-blocking "still recording" checkpoints, in hours from the start.
  // Protects forgotten sessions without penalising ultras.
  LONG_RUN_CHECKPOINTS_H: [4, 8, 12, 16, 20, 24],

  // --- Running speed (evidence only, never a verdict) -----------------------

  // Above this a burst is fast for ordinary running (2:34/km). Evidence that
  // weighs toward cycling ONLY when cadence and motion do not say running.
  RUNNING_SPEED_SOFT_MAX_MPS: 6.5,
  // Faster than any human over a sustained window (≈ 43 km/h). Sustained
  // (not one fix) at this speed is strong vehicle evidence.
  RUNNING_SPEED_HARD_IMPOSSIBLE_MPS: 12,
  // Median speed this high over a window is car/bus territory (30 km/h).
  VEHICLE_SPEED_MPS: 8.5,
  // Fixes worse than this never feed the classifier's distance or speed.
  CLASSIFIER_MAX_ACCURACY_M: 50,

  // --- Steps / cadence -------------------------------------------------------

  // Steps per minute. Running cadence is ~150–200; brisk walking ~100–130.
  RUNNING_CADENCE_SPM: 120,
  WALKING_CADENCE_SPM: 60,
  // Below this cadence while covering ground is "no stepping" evidence.
  NO_STEPS_CADENCE_SPM: 20,
  // Stride plausibility band (metres per step). Deliberately BROAD: stride
  // varies hugely between people and paces. Only strides far outside it,
  // sustained over a window, are evidence of wheels.
  STRIDE_MIN_M: 0.3,
  STRIDE_MAX_M: 2.6,
  // Stride beyond this over a window with real distance is wheel evidence.
  STRIDE_WHEELS_M: 3.2,
  // A window must cover at least this much ground before steps-vs-distance
  // says anything (150 m with 0 steps can be pedometer delay).
  STRIDE_MIN_WINDOW_M: 120,
  // Pedometer samples older than this are not evidence for the current window.
  STEP_SAMPLE_MAX_AGE_MS: 90000,
  // Step history (CMPedometer) is queried in windows of this size to fill
  // periods the live pedometer did not see (app in background).
  STEP_HISTORY_WINDOW_MS: 60000,
  STEP_HISTORY_MAX_QUERIES: 1600,

  // --- Classification --------------------------------------------------------

  // A label needs a score of at least this to beat UNKNOWN.
  LABEL_MIN_SCORE: 1.5,
  // Sustained evidence needed before cycling / vehicle pauses the run
  // (backdated to the first suspect step). Cycling needs longer because it
  // overlaps running speeds; vehicle evidence is usually unambiguous.
  CYCLING_CONFIDENCE_THRESHOLD: 0.6,
  CYCLING_CONFIRM_S: 120,
  VEHICLE_CONFIDENCE_THRESHOLD: 0.6,
  VEHICLE_CONFIRM_S: 60,
  // Leaving a cycling / vehicle suspicion back into running needs longer
  // agreement than leaving an ordinary auto-pause.
  SUSPICIOUS_RESUME_CONFIRM_S: 30,
  // Core Motion readings below this confidence (0 low, 1 medium, 2 high) are
  // ignored.
  MOTION_MIN_CONFIDENCE: 1,
  // Core Motion reports changes, not a stream. A reading older than this
  // with nothing after it stops counting.
  MOTION_MAX_SPAN_MS: 30 * 60 * 1000,

  // --- GPS gaps / teleports --------------------------------------------------

  // A gap between consecutive fixes this long is GPS_UNCERTAIN, not a pause.
  GPS_GAP_UNCERTAIN_S: 20,
  // Bridging a gap longer than this, or implying more than the soft max
  // speed, needs step evidence to credit the straight line; otherwise the
  // route segment breaks there and the jump is not distance.
  GPS_GAP_BREAK_S: 60,
  GPS_GAP_BREAK_M: 300,

  // --- Reporting --------------------------------------------------------------

  // Excluded distance at least this large (or this share of the recorded
  // distance) is told to the runner after the run. Smaller corrections are
  // silent: one bad fix is not news.
  EXCLUSION_NOTICE_M: 300,
  EXCLUSION_NOTICE_SHARE: 0.1,

  // --- Watch / phone ------------------------------------------------------------

  // A watch workout heartbeat older than this no longer blocks a phone run.
  WATCH_WORKOUT_STALE_MS: 2 * 60 * 1000,
});

// What each 5 s step of evidence is judged to be.
export const LABEL = Object.freeze({
  RUNNING: 'running', // on foot: running, jogging, walking, hiking
  STATIONARY: 'stationary',
  CYCLING: 'cycling',
  VEHICLE: 'vehicle',
  UNKNOWN: 'unknown',
});

// What a stretch of the session was, once decided.
export const SEGMENT = Object.freeze({
  RUNNING: 'running',
  STATIONARY: 'stationary', // auto-paused
  USER_PAUSED: 'user_paused',
  CYCLING: 'cycling',
  VEHICLE: 'vehicle',
  UNKNOWN: 'unknown', // no evidence at all (app dead, no GPS, no steps)
});

// Why recording is (or is not) currently counting.
export const SESSION_STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  ACTIVE_RUNNING: 'active_running',
  POSSIBLY_STATIONARY: 'possibly_stationary',
  AUTO_PAUSED: 'auto_paused',
  USER_PAUSED: 'user_paused',
  SUSPICIOUS_MOTION: 'suspicious_motion',
  RECOVERY_REQUIRED: 'recovery_required',
  ENDING: 'ending',
  COMPLETED: 'completed',
});

// States in which distance and moving time accrue.
export const COUNTING_STATES = new Set([
  SESSION_STATE.ACTIVE_RUNNING,
  SESSION_STATE.POSSIBLY_STATIONARY,
]);
