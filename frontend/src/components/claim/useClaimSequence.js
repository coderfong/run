// The one controller for everything that happens after "Claim here".
//
// Components ask this hook what to show rather than each keeping their own
// visibility flag, so there is a single answer to "where are we" — `phase`.
// The map half is delegated to useClaimReveal; this hook owns the ordering,
// the timing and the handoffs between beats.
//
//   focus → encounter (intro / attack / exit) → reveal → handoff
//         → victory → payoff → leaderboard transition → leaderboard
//
// Cancellation is by token: every await re-checks that it still belongs to
// the current run, so a replay, a skip or an unmount stops the old sequence
// dead instead of letting it keep setting state.
//
// Every failure path lands in the same place — territory visible, payoff
// reachable, gestures free.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CLAIM_PHASE, phaseIndex } from './phases';
import { loadClaimLeaderboard } from './leaderboardData';
import { flyRun, levelCamera } from './runFlyover';
import { timingFor } from './timing';
import useClaimReveal from './useClaimReveal';
import { DEFAULT_CAPTURE_STYLE_ID, pickCaptureStyle } from '../../effects/captureStyles';

export const CAPTURE_VARIANTS = ['grin-knock', 'bonk', 'chomp'];

// Who the attacker actually ran into. Only runners who LOST land are
// defenders — if everyone held, there is nobody to knock over and the empty
// landing beat is the honest thing to play.
export function resolveDefenders(claim) {
  const victims = claim?.victims || [];
  return victims
    .filter((v) => !v.defended)
    .map((v) => ({
      id: v.user_id,
      user_id: v.user_id,
      username: v.username,
      avatar: v.avatar,
      clan_color: v.clan_color,
      rank_key: v.rank_key,
    }));
}

export default function useClaimSequence({ mapRef, userId }) {
  const revealApi = useClaimReveal(mapRef);
  const systemReduced = revealApi.reduced;

  const [phase, setPhase] = useState(CLAIM_PHASE.IDLE);
  const [projection, setProjection] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [playToken, setPlayToken] = useState(0);
  // Encounter mounts on intro and unmounts when it says it's finished — that
  // is what lets the defenders keep leaving over the top of the reveal.
  const [encounterLive, setEncounterLive] = useState(false);
  // Who is actually in this encounter, and how. Resolved once per run so the
  // component renders exactly what the controller timed the beats for.
  const [cast, setCast] = useState({
    defenders: [],
    variant: 'grin-knock',
    captureStyle: DEFAULT_CAPTURE_STYLE_ID,
  });
  // How far along the route the 3D replay has flown, 0..1. The screen draws
  // the trail up to here, so it unrolls behind the camera instead of the whole
  // run being on the map before it has been flown.
  const [replayProgress, setReplayProgress] = useState(0);

  // The last claim played, kept so dev replay can re-run it without spending
  // another claim (or another API call).
  const lastRun = useRef({ claim: null, center: null, options: {} });
  const [options, setOptions] = useState({ variant: 'grin-knock', reducedOverride: null });

  const reducedMotion = options.reducedOverride == null ? systemReduced : options.reducedOverride;

  const runToken = useRef(0);
  const timers = useRef(new Set());
  const impactResolver = useRef(null);
  const revealCueResolver = useRef(null);

  const clearTimers = useCallback(() => {
    const active = [...timers.current];
    timers.current.clear();
    active.forEach((timer) => timer.cancel());
  }, []);

  const wait = useCallback((ms) => {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const timer = { id: null, cancel: null };
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer.id);
        timers.current.delete(timer);
        resolve();
      };
      timer.cancel = finish;
      timer.id = setTimeout(finish, ms);
      timers.current.add(timer);
    });
  }, []);

  const schedule = useCallback((callback, ms) => {
    let active = true;
    const timer = { id: null, cancel: null };
    const finish = () => {
      if (!active) return;
      active = false;
      timers.current.delete(timer);
      callback();
    };
    timer.cancel = () => {
      if (!active) return;
      active = false;
      clearTimeout(timer.id);
      timers.current.delete(timer);
    };
    timer.id = setTimeout(finish, ms);
    timers.current.add(timer);
    return timer;
  }, []);

  // Resolves when the encounter reports contact — or when the fallback fires,
  // so a broken encounter can never strand the sequence before the reveal.
  const waitForImpact = useCallback((timeoutMs) => {
    return new Promise((resolve) => {
      let settled = false;
      const timer = { id: null, cancel: null };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer.id);
        timers.current.delete(timer);
        if (impactResolver.current === done) impactResolver.current = null;
        resolve();
      };
      impactResolver.current = done;
      timer.cancel = done;
      timer.id = setTimeout(done, timeoutMs);
      timers.current.add(timer);
    });
  }, []);

  const handleImpact = useCallback(() => {
    impactResolver.current?.();
  }, []);

  const waitForRevealCue = useCallback((timeoutMs) => {
    return new Promise((resolve) => {
      let settled = false;
      const timer = { id: null, cancel: null };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer.id);
        timers.current.delete(timer);
        if (revealCueResolver.current === done) revealCueResolver.current = null;
        resolve();
      };
      revealCueResolver.current = done;
      timer.cancel = done;
      timer.id = setTimeout(done, Math.max(0, timeoutMs));
      timers.current.add(timer);
    });
  }, []);

  const handleCaptureRevealCue = useCallback(() => {
    revealCueResolver.current?.();
  }, []);

  const handleEncounterComplete = useCallback(() => setEncounterLive(false), []);

  useEffect(() => () => {
    // Unmount: kill timers and orphan any in-flight run. Nothing here locks
    // gestures, so there is nothing to unlock.
    runToken.current += 1;
    clearTimers();
    impactResolver.current = null;
    revealCueResolver.current = null;
  }, [clearTimers]);

  const reset = useCallback(() => {
    runToken.current += 1;
    clearTimers();
    impactResolver.current = null;
    revealCueResolver.current = null;
    revealApi.reset();
    setProjection(null);
    setEncounterLive(false);
    levelCamera(mapRef, 0);
    setReplayProgress(0);
    setPhase(CLAIM_PHASE.IDLE);
  }, [clearTimers, mapRef, revealApi]);

  // The whole sequence up to the payoff. `claim` is the ClaimOut response.
  const run = useCallback(
    async (claim, center, opts = {}, { refetchLeaderboard = true } = {}) => {
      const token = (runToken.current += 1);
      const alive = () => token === runToken.current;

      clearTimers();
      impactResolver.current = null;
      revealCueResolver.current = null;
      revealApi.reset();
      setProjection(null);
      setEncounterLive(false);
      setPlayToken((t) => t + 1);

      const variant = opts.variant || 'grin-knock';
      // Seeded off the claim so a given claim always plays the same way, and
      // two different claims almost never play the same way. `capture_style`
      // is honoured if the server ever starts sending one; today it does not,
      // which is exactly why every claim used to look identical.
      const captureStyle = opts.captureStyle
        || claim?.capture_style
        // The territory's id is the only stable identity on a ClaimOut. Null
        // for a dev replay with no claim behind it, which `pickCaptureStyle`
        // reads as "no identity to be stable about" and answers at random.
        || pickCaptureStyle(claim?.territory?.id);
      // An explicit [] (dev "empty" scenario) must survive — only a missing
      // list falls back to the claim's real victims.
      const defenders = opts.defenders ?? resolveDefenders(claim);
      const reduced = opts.reducedOverride == null ? systemReduced : opts.reducedOverride;
      const T = timingFor(reduced);
      setCast({ defenders, variant, captureStyle });
      setReplayProgress(0);

      // Standings load while the animation plays, so Continue is instant.
      // A failure here is not allowed to affect the claim flow at all.
      // Started FIRST, before the flyover, so it has the whole replay to land
      // in rather than only the claim beats.
      if (refetchLeaderboard && userId) {
        loadClaimLeaderboard(userId)
          .then((data) => { if (alive()) setLeaderboard(data); })
          .catch(() => { if (alive()) setLeaderboard(null); });
      }

      // --- the run, replayed in 3D -----------------------------------------
      // Before anything is claimed: this is the part the runner actually did,
      // and the claim then lands on ground they have just been flown over.
      // Skipped entirely under Reduce Motion (T.runReplay is 0 there) and
      // whenever the caller has no route to fly.
      const replayPath = opts.path || [];
      if (T.runReplay > 0 && replayPath.length >= 2) {
        setPhase(CLAIM_PHASE.RUN_REPLAY);
        await flyRun(mapRef, replayPath, {
          totalMs: T.runReplay,
          pitch: T.runReplayPitch,
          zoom: T.runReplayZoom,
          onProgress: (p) => { if (alive()) setReplayProgress(p); },
          alive,
          wait,
        });
        if (!alive()) return;
        // Unwind the tilt BEFORE anything is projected — a projection taken at
        // a pitch is only true at the near edge of the scene. See levelCamera.
        levelCamera(mapRef, T.runReplayLevel);
        await wait(T.runReplayLevel);
        if (!alive()) return;
      }
      setReplayProgress(1);

      setPhase(CLAIM_PHASE.FOCUS);

      const proj = await revealApi.focus(claim?.territory, center);
      if (!alive()) return;
      setProjection(proj);

      // Projection failed (no native map, camera torn down). No overlay is
      // possible, so show the real fill and go straight to the payoff.
      if (!proj) {
        revealApi.showFinalTerritory();
        setPhase(CLAIM_PHASE.TERRITORY_HANDOFF);
        await wait(140);
        if (!alive()) return;
        setPhase(CLAIM_PHASE.PAYOFF);
        return;
      }

      // --- encounter (or the empty-ground landing) ------------------------
      setEncounterLive(true);
      setPhase(CLAIM_PHASE.ENCOUNTER_INTRO);

      if (defenders.length > 0) {
        const dashAt = T.encounterIntro + T.grinHold + T.attackAnticipation;
        schedule(() => {
          if (alive()) setPhase(CLAIM_PHASE.ENCOUNTER_ATTACK);
        }, dashAt);
      }

      await waitForImpact(T.impactTimeout);
      if (!alive()) return;

      // --- capture FX and reveal, overlapping the encounter exit ----------
      setPhase(CLAIM_PHASE.ENCOUNTER_EXIT);
      // CaptureStylePlayer owns the visual cue; this controller owns the
      // territory state transition. The tracked fallback preserves the old
      // safe path if an optional player never calls back.
      const revealFallback = reduced
        ? Math.max(40, T.defenderExitOverlap)
        : defenders.length
          ? Math.max(0, T.defenderExit - T.defenderExitOverlap)
          : 500;
      await waitForRevealCue(revealFallback);
      if (!alive()) return;

      revealApi.startReveal(proj);
      setPhase(CLAIM_PHASE.TERRITORY_REVEAL);
      await wait(T.reveal);
      if (!alive()) return;

      revealApi.showFinalTerritory();
      setPhase(CLAIM_PHASE.TERRITORY_HANDOFF);
      await wait(T.handoff);
      if (!alive()) return;
      revealApi.clearOverlay();

      // --- victory --------------------------------------------------------
      setPhase(CLAIM_PHASE.VICTORY);
      await wait(T.victoryBeat);
      if (!alive()) return;

      setPhase(CLAIM_PHASE.PAYOFF);
    },
    [clearTimers, mapRef, revealApi, schedule, systemReduced, userId, wait, waitForImpact, waitForRevealCue]
  );

  const start = useCallback(
    (claim, center, opts = {}) => {
      // A second start while one is running would race the first. The claim
      // API is guarded at the button; this guards the animation.
      if (phase !== CLAIM_PHASE.IDLE && phase !== CLAIM_PHASE.COMPLETE) return undefined;
      lastRun.current = { claim, center, options: opts };
      return run(claim, center, opts, { refetchLeaderboard: true });
    },
    [phase, run]
  );

  // Dev only: replay the last claim result with (optionally) new options and
  // no further API traffic.
  const replay = useCallback(
    (overrides = {}) => {
      const { claim, center, options: previous } = lastRun.current;
      if (!claim || !center) return undefined;
      const next = { ...previous, ...overrides };
      lastRun.current = { claim, center, options: next };
      setOptions((o) => ({ ...o, ...overrides }));
      return run(claim, center, next, { refetchLeaderboard: false });
    },
    [run]
  );

  // Bail out to the end state: ground visible, payoff up, nothing locked.
  const skip = useCallback(() => {
    runToken.current += 1;
    clearTimers();
    impactResolver.current = null;
    revealCueResolver.current = null;
    setEncounterLive(false);
    // Skipping mid-flyover leaves the camera tilted. Put it back on its back
    // instantly: the payoff and the permanent territory below it are both
    // drawn against a flat map, and a pitched one is a different picture.
    levelCamera(mapRef, 0);
    setReplayProgress(1);
    revealApi.clearOverlay();
    revealApi.showFinalTerritory();
    setPhase(CLAIM_PHASE.PAYOFF);
  }, [clearTimers, mapRef, revealApi]);

  // Payoff → standings, driven by the runner tapping Continue.
  const continueToLeaderboard = useCallback(async () => {
    const token = (runToken.current += 1);
    const alive = () => token === runToken.current;
    const T = timingFor(reducedMotion);
    setPhase(CLAIM_PHASE.LEADERBOARD_TRANSITION);
    await wait(T.leaderboardWipe + 160);
    if (!alive()) return;
    setPhase(CLAIM_PHASE.LEADERBOARD);
  }, [reducedMotion, wait]);

  const complete = useCallback(() => {
    runToken.current += 1;
    clearTimers();
    impactResolver.current = null;
    revealCueResolver.current = null;
    setEncounterLive(false);
    setPhase(CLAIM_PHASE.COMPLETE);
  }, [clearTimers]);

  const index = phaseIndex(phase);

  const derived = useMemo(
    () => ({
      // The map is frozen from the moment the sequence takes the camera to
      // the end of the victory beat. That now starts at the 3D replay, not at
      // the focus flight: a pan during the flyover fights the camera it is
      // driving, and a pinch mid-replay leaves the pitch somewhere the reveal
      // cannot project from. Never at the payoff, never at rest.
      mapLocked:
        index >= phaseIndex(CLAIM_PHASE.RUN_REPLAY) &&
        index <= phaseIndex(CLAIM_PHASE.VICTORY),
      // The run is being flown right now, so the trail should be unrolling
      // rather than sitting on the map complete.
      showRunReplay: phase === CLAIM_PHASE.RUN_REPLAY,
      showEncounter: encounterLive && !!projection,
      // FX are presentation-only. They start at contact and disappear before
      // victory; the independent SVG reveal below still owns territory state.
      showCaptureStyle:
        !!projection &&
        index >= phaseIndex(CLAIM_PHASE.ENCOUNTER_EXIT) &&
        index <= phaseIndex(CLAIM_PHASE.TERRITORY_HANDOFF),
      showReveal: !!revealApi.reveal,
      showPermanentTerritory: revealApi.finalVisible,
      showVictory: phase === CLAIM_PHASE.VICTORY,
      showPayoff: phase === CLAIM_PHASE.PAYOFF,
      showLeaderboard:
        phase === CLAIM_PHASE.LEADERBOARD_TRANSITION || phase === CLAIM_PHASE.LEADERBOARD,
      isRunning: phase !== CLAIM_PHASE.IDLE && phase !== CLAIM_PHASE.COMPLETE,
    }),
    [encounterLive, index, phase, projection, revealApi.finalVisible, revealApi.reveal]
  );

  return {
    phase,
    start,
    replay,
    skip,
    reset,
    continueToLeaderboard,
    complete,
    ...derived,

    // Data the beats need.
    defenders: cast.defenders,
    variant: cast.variant,
    captureStyle: cast.captureStyle,
    // 0..1 along the route while the 3D replay flies; 1 once it is done, so a
    // screen can draw `path.slice(0, n * progress)` and get the whole trail
    // for free everywhere else in the sequence.
    replayProgress,
    projection,
    reveal: revealApi.reveal,
    leaderboard,
    playToken,
    reducedMotion,
    options,
    setOptions,

    // Wiring for CaptureEncounter.
    onImpact: handleImpact,
    onCaptureRevealCue: handleCaptureRevealCue,
    onEncounterComplete: handleEncounterComplete,
  };
}
