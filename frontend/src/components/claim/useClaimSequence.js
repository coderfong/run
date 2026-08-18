// The one controller for everything that happens after "Claim here".
//
// Components ask this hook what to show rather than each keeping their own
// visibility flag, so there is a single answer to "where are we" — `phase`.
// The map half is delegated to useClaimReveal; this hook owns the ordering,
// the timing and the handoffs between beats.
//
//   focus → the style's own cutscene → reveal → handoff
//         → victory → payoff → leaderboard transition → leaderboard
//
// The middle of that used to be a fixed collision this hook drove: attacker
// slides in, knocks the rivals over, style plays afterwards. It is now the
// STYLE's cutscene from the first frame, cast with whoever the claim returned,
// and this hook's only job between the camera landing and the ground turning
// over is to wait for the style to cue it. A clash is a beat some styles ask
// for (`onContact`), not a stage every claim passes through.
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
import {
  DEFAULT_CAPTURE_STYLE_ID,
  pickCaptureStyle,
  resolveCaptureStyle,
} from '../../effects/captureStyles';

// How long the controller is willing to wait for a style to cue the reveal.
//
// This used to be a flat 500-700ms, which was correct when every style put its
// reveal within the first half second of a sprite stack. A choreography earns
// its reveal: Warm Detonation throws a charge, waits for it to land, waits
// again for the fuse, and only then turns the ground over at 1460ms. A fixed
// deadline would fire first every time and the styles would silently lose
// their own climax — the exact failure mode that made `capture_style` a dead
// field for a year.
//
// So the deadline is derived from the style that is actually playing, plus
// slack. It exists only to rescue a player that never mounts or never calls
// back; it is not a schedule.
const REVEAL_CUE_SLACK = 600;

function revealCueDeadline(styleId, reduced, fallback) {
  if (reduced) return fallback;
  const captureStyle = resolveCaptureStyle(styleId);
  const cue = captureStyle?.sequence?.find((step) => step.action === 'territoryReveal');
  if (!cue) return fallback;
  return Math.max(fallback, cue.start + REVEAL_CUE_SLACK);
}

export const CAPTURE_VARIANTS = ['grin-knock', 'bonk', 'chomp'];

// The collision used to be hard-coded to grin-knock by ResultScreen, so the
// large capture-style library still opened with the same knock every time.
// Pick the encounter from the final territory id: stable when a replay is
// viewed again, varied between claims, and random only for a synthetic dev
// replay that has no persisted identity.
export function pickCaptureVariant(seed) {
  if (seed == null) {
    return CAPTURE_VARIANTS[Math.floor(Math.random() * CAPTURE_VARIANTS.length)];
  }
  let hash = 0x811c9dc5;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return CAPTURE_VARIANTS[hash % CAPTURE_VARIANTS.length];
}

// Who the attacker actually took ground from. Only runners who LOST land are
// defenders — if everyone held, there is nobody in the scene and the style's
// empty-ground choreography is the honest thing to play.
//
// This list is now the ONLY thing that decides whether rivals appear. It used
// to be gated behind `encounterMode === DUEL`, so a claim against three people
// could play out with none of them on screen; the style says what they DO, it
// does not get a vote on whether they exist.
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

// The ground the reveal turns over.
//
// NOT `claim.territory`, which is the runner's merged holding: a claim that
// lands on land they already own is unioned into it, so revealing the
// territory means flying out to frame every block they have ever taken around
// there and lighting the lot up as though this run had just won it.
//
// `gained_rings` is the part of the claim that was not already theirs — the
// ground that genuinely changed hands, and the only ground worth a cutscene.
// `claim_rings` (the whole footprint) is the fallback for a claim that gained
// nothing at all: a pure reinforcement still has to show WHERE it landed, and
// an empty reveal would read as a failed claim. The territory is the last
// resort, for a backend that sends neither.
export function revealGround(claim) {
  const rings = claim?.gained_rings?.length
    ? claim.gained_rings
    : claim?.claim_rings?.length
      ? claim.claim_rings
      : null;
  return rings ? { rings } : claim?.territory;
}

export default function useClaimSequence({ mapRef, userId }) {
  const revealApi = useClaimReveal(mapRef);
  const systemReduced = revealApi.reduced;

  const [phase, setPhase] = useState(CLAIM_PHASE.IDLE);
  const [projection, setProjection] = useState(null);
  // The style's territory cue: which transition, and the anchor NAME the wipe
  // should start from. The screen resolves that name to a point with the same
  // resolver the effects use, so the ground opens exactly where the strike
  // that caused it landed.
  const [revealSpec, setRevealSpec] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [playToken, setPlayToken] = useState(0);
  // Direct character contact, and only when a style asked for it. This used to
  // be "the encounter", mounted before EVERY style, which is how a meteor came
  // to open with a shoulder-check. Now it is a beat inside two styles whose
  // fantasy is a clash, started by the style at the moment the style chose.
  const [encounterLive, setEncounterLive] = useState(false);
  const [contactStep, setContactStep] = useState(null);
  // Who is actually in this encounter, and how. Resolved once per run so the
  // component renders exactly what the controller timed the beats for.
  const [cast, setCast] = useState({
    defenders: [],
    variant: 'grin-knock',
    captureStyle: DEFAULT_CAPTURE_STYLE_ID,
    seed: '',
  });
  // How far along the route the 3D replay has flown, 0..1. The screen draws
  // the trail up to here, so it unrolls behind the camera instead of the whole
  // run being on the map before it has been flown. 1 by default — this is 0
  // only while a flyover is actually mid-flight (set in `run`, below) — so the
  // placement screen, which reads this same value before `run` has ever been
  // called, draws the WHOLE route rather than truncating it to its first two
  // points (`Math.max(2, Math.ceil(path.length * 0))`). ResultScreen's
  // `replayTrail` already assumes this contract in its own comment; this used
  // to just not honour it.
  const [replayProgress, setReplayProgress] = useState(1);

  // The last claim played, kept so dev replay can re-run it without spending
  // another claim (or another API call).
  const lastRun = useRef({ claim: null, center: null, options: {} });
  const [options, setOptions] = useState({
    variant: 'grin-knock', reducedOverride: null, timeScale: 1, tintOverride: null,
  });

  const reducedMotion = options.reducedOverride == null ? systemReduced : options.reducedOverride;
  // Dev only, 1 in every real claim. Slows the whole post-claim schedule — this
  // hook's waits AND the capture player's step scheduling — so a beat can be
  // named while it is on screen. See components/claim/DevSequenceControls.js.
  const timeScale = Number.isFinite(options.timeScale) && options.timeScale > 0
    ? options.timeScale
    : 1;

  const runToken = useRef(0);
  const timers = useRef(new Set());
  const revealCueResolver = useRef(null);

  const clearTimers = useCallback(() => {
    const active = [...timers.current];
    timers.current.clear();
    active.forEach((timer) => timer.cancel());
  }, []);

  const waitRaw = useCallback((ms) => {
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

  // Every beat in the sequence goes through here, so slow motion is one
  // multiplication rather than a flag threaded into a dozen awaits.
  const scaleRef = useRef(1);
  scaleRef.current = timeScale;
  const wait = useCallback((ms) => waitRaw(ms * scaleRef.current), [waitRaw]);

  // Nothing awaits contact any more.
  //
  // The old controller could not start a style until a collision had reported
  // its impact, which is why every style needed one and why `impactTimeout`
  // existed to rescue the sequence when it did not arrive. The ground is now
  // driven by the style's own reveal cue, so a clash is a beat inside a scene
  // rather than a gate in front of it — and a style that never has one is not
  // waiting on anything.
  const handleImpact = useCallback(() => {
    // Contact landed. The phase still moves so anything reading "have we
    // passed the collision" stays true.
    setPhase((current) => (
      current === CLAIM_PHASE.ENCOUNTER_ATTACK ? CLAIM_PHASE.ENCOUNTER_EXIT : current
    ));
  }, []);

  // The style asking for a clash. Only a duel can emit this step at all —
  // `validateChoreography` rejects it anywhere else — so an environmental
  // style physically cannot start a collision.
  const handleContact = useCallback((step) => {
    setContactStep(step || {});
    setEncounterLive(true);
    setPhase((current) => (
      current === CLAIM_PHASE.ENCOUNTER_INTRO ? CLAIM_PHASE.ENCOUNTER_ATTACK : current
    ));
  }, []);

  // Resolves WITH the style's cue — the transition and origin it asked for —
  // or with null when the deadline rescued a player that never called back.
  const waitForRevealCue = useCallback((timeoutMs) => {
    return new Promise((resolve) => {
      let settled = false;
      const timer = { id: null, cancel: null };
      const done = (spec) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer.id);
        timers.current.delete(timer);
        if (revealCueResolver.current === done) revealCueResolver.current = null;
        resolve(spec || null);
      };
      revealCueResolver.current = done;
      timer.cancel = () => done(null);
      timer.id = setTimeout(() => done(null), Math.max(0, timeoutMs));
      timers.current.add(timer);
    });
  }, []);

  const handleCaptureRevealCue = useCallback((spec) => {
    revealCueResolver.current?.(spec);
  }, []);

  const handleEncounterComplete = useCallback(() => setEncounterLive(false), []);

  useEffect(() => () => {
    // Unmount: kill timers and orphan any in-flight run. Nothing here locks
    // gestures, so there is nothing to unlock.
    runToken.current += 1;
    clearTimers();
    revealCueResolver.current = null;
  }, [clearTimers]);

  const reset = useCallback(() => {
    runToken.current += 1;
    clearTimers();
    revealCueResolver.current = null;
    revealApi.reset();
    setProjection(null);
    setRevealSpec(null);
    setEncounterLive(false);
    setContactStep(null);
    levelCamera(mapRef, 0);
    // Back to IDLE, where the placement screen reads this value BEFORE any
    // flyover has run — 1 (whole route), same as the mount default, not 0
    // (which truncates the trail to its first two points; see the note there).
    setReplayProgress(1);
    setPhase(CLAIM_PHASE.IDLE);
  }, [clearTimers, mapRef, revealApi]);

  // The whole sequence up to the payoff. `claim` is the ClaimOut response.
  const run = useCallback(
    async (claim, center, opts = {}, { refetchLeaderboard = true } = {}) => {
      const token = (runToken.current += 1);
      const alive = () => token === runToken.current;

      clearTimers();
      revealCueResolver.current = null;
      revealApi.reset();
      setProjection(null);
      setRevealSpec(null);
      setEncounterLive(false);
      setContactStep(null);
      setPlayToken((t) => t + 1);

      const variant = opts.variant || pickCaptureVariant(claim?.territory?.id);
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
      // The territory's id is the seed for everything the scene decides per
      // person: which of a pool each rival reacts with, where they stand. Null
      // for a dev replay with no claim behind it, which reads as "no identity
      // to be stable about".
      const seed = String(claim?.territory?.id ?? opts.seed ?? '');
      setCast({ defenders, variant, captureStyle, seed });
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

      const proj = await revealApi.focus(revealGround(claim), center);
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

      // --- the cutscene ----------------------------------------------------
      //
      // Every style with a cast starts here. There is no longer a collision in
      // front of it: a style that wants contact emits a `contact` step and
      // gets it at the moment it asked for, and a style that does not never
      // sees one. The controller's only job between here and the reveal is to
      // wait for the style to cue the ground.
      //
      // UNLESS there is nobody in it. Empty ground has no rivals to notice,
      // react to or be displaced by anything, so playing the full choreography
      // anyway was theatre over nothing — a meteor falling on a field nobody
      // was standing in. `showCaptureStyle`/`showCast` below don't mount the
      // player or the cast at all when `cast.defenders` is empty, so waiting
      // for THAT style's own reveal cue (tuned for its full multi-second
      // scene) would just be a dead pause with nothing on screen to fill it.
      // A short fixed settle instead, then straight to the reveal.
      setPhase(CLAIM_PHASE.ENCOUNTER_INTRO);
      setEncounterLive(false);
      setContactStep(null);

      let cue = null;
      if (defenders.length > 0) {
        cue = await waitForRevealCue(
          revealCueDeadline(captureStyle, reduced, reduced ? 80 : 700)
          * scaleRef.current
        );
        if (!alive()) return;
      } else {
        await wait(reduced ? 0 : 260);
        if (!alive()) return;
      }

      // How the ground turns over, and from where. The style decides; a
      // timeout that beat the style to it falls back to the plain radial wipe
      // this component has always played.
      setRevealSpec(cue || null);
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
    [clearTimers, mapRef, revealApi, systemReduced, userId, wait, waitForRevealCue]
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
    revealCueResolver.current = null;
    setEncounterLive(false);
    setContactStep(null);
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
    revealCueResolver.current = null;
    setEncounterLive(false);
    setContactStep(null);
    setPhase(CLAIM_PHASE.COMPLETE);
  }, [clearTimers]);

  const index = phaseIndex(phase);
  const captureStyleMeta = resolveCaptureStyle(cast.captureStyle);

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
      // A clash, only while a style that asked for one is having it.
      showEncounter: encounterLive && !!projection,
      // The cutscene runs from the first frame of the encounter phase to the
      // handoff. It is no longer gated on a collision finishing, because there
      // is no collision in front of it to finish. Also gated on there being a
      // cast at all — empty ground skips the cutscene entirely (see the note
      // in `run`), so there is nothing for the player or the characters to
      // show even while the phase machine passes through this range.
      showCaptureStyle:
        !!projection &&
        cast.defenders.length > 0 &&
        index >= phaseIndex(CLAIM_PHASE.ENCOUNTER_INTRO) &&
        index <= phaseIndex(CLAIM_PHASE.TERRITORY_HANDOFF),
      // The cast is on screen for exactly as long as the cutscene is. Who
      // leaves and when is the style's business, not the controller's.
      showCast: !!projection && cast.defenders.length > 0
        && index >= phaseIndex(CLAIM_PHASE.ENCOUNTER_INTRO)
        && index <= phaseIndex(CLAIM_PHASE.TERRITORY_HANDOFF),
      showReveal: !!revealApi.reveal,
      showPermanentTerritory: revealApi.finalVisible,
      showVictory: phase === CLAIM_PHASE.VICTORY,
      showPayoff: phase === CLAIM_PHASE.PAYOFF,
      showLeaderboard:
        phase === CLAIM_PHASE.LEADERBOARD_TRANSITION || phase === CLAIM_PHASE.LEADERBOARD,
      isRunning: phase !== CLAIM_PHASE.IDLE && phase !== CLAIM_PHASE.COMPLETE,
    }),
    [cast.defenders, encounterLive, index, phase, projection, revealApi.finalVisible, revealApi.reveal]
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
    defenderCount: cast.defenders.length,
    variant: contactStep?.variant || cast.variant,
    contactStep,
    captureStyle: cast.captureStyle,
    captureStyleMeta,
    // Everything seeded off the claim reads from here, so a replay of the same
    // claim gives the same people the same reactions.
    castSeed: cast.seed,
    // 0..1 along the route while the 3D replay flies; 1 once it is done, so a
    // screen can draw `path.slice(0, n * progress)` and get the whole trail
    // for free everywhere else in the sequence.
    replayProgress,
    projection,
    reveal: revealApi.reveal,
    revealSpec,
    leaderboard,
    playToken,
    reducedMotion,
    timeScale,
    options,
    setOptions,

    // Wiring for the cutscene.
    onImpact: handleImpact,
    onContact: handleContact,
    onCaptureRevealCue: handleCaptureRevealCue,
    onEncounterComplete: handleEncounterComplete,
  };
}
