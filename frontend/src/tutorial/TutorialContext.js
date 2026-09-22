// The tutorial's brain: one state machine, one target registry, one place
// where progress is written down.
//
// TWO CONTEXTS, DELIBERATELY.
//
//   TutorialApi    stable callbacks only — register a target, report a signal,
//                  publish a fact, skip, replay. Built once and never rebuilt,
//                  so the dozen screens that offer a target or report an event
//                  subscribe to something that never changes and therefore
//                  never re-render because of the tutorial.
//   TutorialState  the live phase, the measured rect, the active tip. Read by
//                  the overlay and by nothing else.
//
// That split is not tidiness. This provider sits above the whole signed-in
// app, and a single context carrying `phase` would re-render every screen in
// PASER each time a coach mark moved. (`children` arrives as a prop, so the
// app below is reconciled and skipped when this component re-renders — only
// consumers of the context that actually changed pay anything.)
//
// WHAT IT NEVER DOES: drive gameplay. It reads the recording flag, it watches
// which route is up, it is told when a run finished and when a claim landed.
// The run and claim state machines do not know it exists beyond a handful of
// one-line reports.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWindowDimensions } from 'react-native';

import { EVENTS, track } from '../analytics';
import { useProfile } from '../state/profile';
import { useRecording } from '../state/recording';
import { useProEntitlement } from '../pro/ProProvider';
import { haptic } from '../theme/haptics';
import { PHASE, RECORD_PHASES, nextPhase, resumePhase } from './phases';
import {
  CORE,
  TIP,
  advanced,
  armed,
  coreActive,
  decideCoreState,
  hasSeenTip,
  normalise,
  skipped,
  tipSeen,
} from './progress';
import { SIGNAL } from './signals';
import { stepFor } from './steps';
import { tipFor } from './tips';

// Routes that mean "the run/claim modal is up". A native fullScreenModal is
// presented above the React root, so these are also the routes whose steps
// belong to the inner overlay host rather than the root one.
const RUN_ROUTES = new Set(['Record', 'Result', 'PlanAttack']);

// Measuring a target that has not finished laying out yet. Twelve attempts at
// 120ms covers a tab change, a modal presentation and a slow first paint;
// past that the step gives up and shows its card centred with no spotlight,
// which is a readable tutorial rather than a stuck one.
const MEASURE_RETRY_MS = 120;
const MEASURE_ATTEMPTS = 12;

// How long a run phase may wait for the run screen to open before the lesson
// gives up on it and rewinds. Covers a modal presentation on a slow phone.
const RUN_ROUTE_GRACE_MS = 5000;

const TutorialApiContext = createContext(null);
const TutorialStateContext = createContext(null);

const EMPTY_FACTS = {
  // Derived here, not reported: the route the navigator is on, and whether a
  // run is recording.
  route: null,
  running: false,
  // Published by the screens that know them.
  playerLocated: null,
  ownsLand: false,
  runClaimable: false,
  claimReady: false,
  claimCelebrated: false,
  // True once the tutorial's own run/claim segment has started — see
  // RunningScreen's startTutorialSimRun.
  simulatedRun: false,
};

export function TutorialProvider({ children, navigationRef }) {
  const { profile, loading: profileLoading, saveTutorial, completeTutorial } = useProfile();
  const { isRecording } = useRecording();
  const { runCount } = useProEntitlement();
  const screen = useWindowDimensions();

  // The persisted record, normalised. `null` until the profile has hydrated —
  // nothing may be decided before then, or a not-yet-loaded `false` flashes
  // the welcome card at somebody who finished the tutorial months ago.
  const record = useMemo(
    () => (profileLoading ? null : normalise(profile.tutorial)),
    [profileLoading, profile.tutorial]
  );

  const [facts, setFactsState] = useState(EMPTY_FACTS);
  const [activeTip, setActiveTip] = useState(null);
  const [rect, setRect] = useState(null);
  const [measureTick, setMeasureTick] = useState(0);

  // --- target registry ----------------------------------------------------
  // A Map of id → the host component's node. Refs, not state: registering a
  // target must not render anything, and a screen mounting is not news until
  // a step actually asks where that target is.
  const targets = useRef(new Map());
  const bumpMeasure = useCallback(() => setMeasureTick((n) => n + 1), []);

  const registerTarget = useCallback(
    (id, node) => {
      if (!id) return;
      if (node) targets.current.set(id, node);
      else targets.current.delete(id);
      // Cheap: this only ever fires on mount, unmount and re-layout of a
      // registered target, of which there are ten in the whole app.
      bumpMeasure();
    },
    [bumpMeasure]
  );

  // --- progress -----------------------------------------------------------
  const writeRef = useRef(null);
  writeRef.current = saveTutorial;
  const write = useCallback((next) => {
    writeRef.current?.(next);
  }, []);

  // Seed once, from positive evidence only. See decideCoreState: an account we
  // cannot prove is new is left alone.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!record || seededRef.current) return;
    if (record.core !== CORE.IDLE || record.reason === 'existing_account') {
      seededRef.current = true;
      return;
    }
    const decision = decideCoreState({
      record,
      tutorialPending: profile.tutorialPending,
      introDone: profile.introDone,
      runCount,
    });
    // `runs_unknown` is not an answer yet — /me/stats is still in flight, and
    // this effect runs again when it lands.
    if (decision.reason === 'runs_unknown') return;
    seededRef.current = true;
    if (decision.core === CORE.RUNNING) {
      write(armed(record, { reason: decision.reason }));
      track(EVENTS.TUTORIAL_STARTED, { reason: decision.reason });
      // The pending flag has been HANDED OVER. Clearing it here is what stops
      // it arming a second tutorial later: from this point the versioned
      // record is the only thing that decides whether anything is shown.
      if (profile.tutorialPending) completeTutorial?.();
    } else {
      write({ ...record, core: CORE.IDLE, reason: decision.reason });
    }
  }, [record, profile.tutorialPending, profile.introDone, runCount, write, completeTutorial]);

  const phase = record?.phase || PHASE.IDLE;
  const enteringRunRef = useRef(false);
  const active = coreActive(record);
  const step = active ? stepFor(phase) : null;

  const goTo = useCallback(
    (to) => {
      if (!record) return;
      if (to === PHASE.COMPLETE) {
        track(EVENTS.TUTORIAL_COMPLETED, {});
        haptic.success();
      }
      // Entering the run branch from the tour, as against waking up in it:
      // only the first may wait for the run screen to open (see the rewind
      // effect below).
      enteringRunRef.current = RECORD_PHASES.has(to);
      write(advanced(record, to));
    },
    [record, write]
  );

  // --- navigation ---------------------------------------------------------
  const navigate = useMemo(
    () => ({
      goToMap() {
        const nav = navigationRef?.current || navigationRef;
        if (!nav?.isReady?.()) return;
        nav.navigate('Tabs', { screen: 'Map', params: { screen: 'MapMain' } });
      },
      // The practice run's way in: the same route the tab bar's run button
      // opens, so the practice plays on the screen a real run uses.
      goToRecord() {
        const nav = navigationRef?.current || navigationRef;
        if (!nav?.isReady?.()) return;
        nav.navigate('Record');
      },
    }),
    [navigationRef]
  );

  // The current route, kept in facts so steps can gate on it declaratively.
  useEffect(() => {
    const nav = navigationRef?.current || navigationRef;
    if (!nav?.addListener) return undefined;
    const sync = () => {
      const name = nav.isReady?.() ? nav.getCurrentRoute?.()?.name || null : null;
      setFactsState((prev) => (prev.route === name ? prev : { ...prev, route: name }));
    };
    sync();
    const off = nav.addListener('state', sync);
    return () => {
      if (typeof off === 'function') off();
      else off?.remove?.();
    };
  }, [navigationRef]);

  // Recording is derived, never reported: a run started from the watch, from
  // Home or from the tab bar all arrive here the same way.
  useEffect(() => {
    setFactsState((prev) => (prev.running === isRecording ? prev : { ...prev, running: isRecording }));
  }, [isRecording]);

  // --- facts --------------------------------------------------------------
  // Shallow merge that BAILS when nothing changed. Screens publish from
  // effects whose dependencies re-evaluate on every render of a busy screen
  // (the running one recomputes distance several times a second), so a naive
  // setState here would be a render loop with extra steps.
  const setFacts = useCallback((patch) => {
    setFactsState((prev) => {
      let changed = false;
      for (const key of Object.keys(patch)) {
        if (prev[key] !== patch[key]) {
          changed = true;
          break;
        }
      }
      return changed ? { ...prev, ...patch } : prev;
    });
  }, []);

  // --- signals ------------------------------------------------------------
  // Read the live phase from a ref so `signal` can be built once and still be
  // correct. Screens hold on to it for the life of a run.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const activeRef = useRef(active);
  activeRef.current = active;
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const signal = useCallback((name) => {
    if (!activeRef.current) return;
    const current = stepFor(phaseRef.current);
    const to = current?.on?.[name];
    if (!to || to === phaseRef.current) return;

    if (name === SIGNAL.RUN_FINISHED) {
      track(EVENTS.TUTORIAL_FINISH_RUN_COMPLETED, { step: phaseRef.current });
    } else if (name === SIGNAL.CLAIM_ADJUSTED) {
      track(EVENTS.TUTORIAL_CLAIM_SELECTED, { step: phaseRef.current });
    } else if (name === SIGNAL.CLAIM_PLACED) {
      track(EVENTS.TUTORIAL_FIRST_CLAIM_COMPLETED, { step: phaseRef.current });
    }
    goToRef.current(to);
  }, []);

  // --- the run branch, and getting out of it ------------------------------
  // "Tap here to start your run" ends when the run screen is REALLY open.
  // Derived from the navigator rather than reported by the button, because
  // there are four ways in — the tab bar, Home's hero card, a notification and
  // the watch — and the tutorial has no business knowing which one was used.
  useEffect(() => {
    if (!active || phase !== PHASE.START_RUN) return;
    // Only the recorder starts a run. Result and PlanAttack are also modal
    // routes, but can still be mounted briefly after an unavailable claim
    // rewinds the lesson; treating either as a fresh run skips the button and
    // bounces straight back to ACTIVE_RUN.
    if (facts.route !== 'Record') return;
    track(EVENTS.TUTORIAL_START_RUN_COMPLETED, {});
    track(EVENTS.TUTORIAL_STEP_COMPLETED, { step: PHASE.START_RUN });
    goTo(nextPhase(PHASE.START_RUN));
  }, [active, phase, facts.route, goTo]);


  // Leaving the record modal without finishing rewinds to "start a run". The
  // run this lesson was attached to is gone: a discarded run, a refused
  // permission, a crash on the way back in. Nothing about the world needs
  // re-teaching, so it never rewinds further than this.
  //
  // ONLY ONCE THE RUN SCREEN HAS BEEN REACHED. The practice card now ENTERS a
  // record phase from the map and navigates on the way in (ACTIVE_RUN's
  // onEnter), so for a moment the phase is a run phase while the route is
  // still the map — rewinding on that would bounce the practice straight back
  // to its own card. A run screen that never arrives still rewinds, just
  // after a grace period rather than instantly.
  const reachedRunRef = useRef(false);
  useEffect(() => {
    if (!active || !RECORD_PHASES.has(phase)) {
      reachedRunRef.current = false;
      return undefined;
    }
    if (RUN_ROUTES.has(facts.route)) {
      reachedRunRef.current = true;
      enteringRunRef.current = false;
      return undefined;
    }
    if (!facts.route) return undefined;
    const rewind = () => {
      goTo(resumePhase(phase));
      setFacts({ runClaimable: false, claimReady: false, claimCelebrated: false });
    };
    // Left the run screen, or woke up in a run phase with no run screen at
    // all (the app was killed mid practice): nothing to wait for.
    if (reachedRunRef.current || !enteringRunRef.current) {
      rewind();
      return undefined;
    }
    const timer = setTimeout(rewind, RUN_ROUTE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [active, phase, facts.route, goTo, setFacts]);

  // A step that has decided it does not apply — PLAYER with location refused —
  // steps aside rather than waiting for a fact that will never arrive.
  useEffect(() => {
    if (!step?.skipWhen) return;
    if (step.skipWhen(facts)) goTo(nextPhase(step.phase));
  }, [step, facts, goTo]);

  // --- what is on screen --------------------------------------------------
  const gatePassed = !step?.gate || step.gate(facts);
  const stepVisible = !!step && gatePassed;
  const targetId = stepVisible ? step.target : activeTip ? tipFor(activeTip)?.target : null;

  // Measure, and keep trying for a little while. A target inside a screen that
  // is still transitioning measures as nothing; one inside a modal that has
  // not been presented yet is not registered at all.
  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return undefined;
    }
    let alive = true;
    let attempts = 0;
    let timer = null;

    const retry = () => {
      attempts += 1;
      if (attempts >= MEASURE_ATTEMPTS) {
        // Give up VISIBLY rather than silently: the card still shows, centred,
        // with no spotlight and nothing blocked. See TutorialOverlay.
        if (alive) setRect(null);
        return;
      }
      timer = setTimeout(attempt, MEASURE_RETRY_MS);
    };

    const attempt = () => {
      if (!alive) return;
      const node = targets.current.get(targetId);
      if (!node?.measureInWindow) {
        retry();
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!alive) return;
        if (width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y)) {
          setRect({ x, y, width, height });
        } else {
          retry();
        }
      });
    };

    attempt();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [targetId, measureTick, screen.width, screen.height]);

  // Re-measure on demand. A target inside a ScrollView (the claim button) does
  // not fire onLayout when the list scrolls under it, so the one screen that
  // has one calls this from onScroll.
  const remeasure = useCallback(() => bumpMeasure(), [bumpMeasure]);

  // --- step lifecycle -----------------------------------------------------
  //
  // TWO MOMENTS, NOT ONE. A step is ENTERED when the tour reaches it, and SEEN
  // when it actually draws. For a gated step those are different moments: the
  // map lesson is entered while the runner is still on Home, and seen once the
  // map is up.
  //
  // `onEnter` is how a step GETS to where it belongs, so it has to run on the
  // first of the two. It used to run on the second, which made it unreachable
  // for the one step that needed it: PHASE.MAP asks to be taken to the map,
  // but its own gate is already "am I on the map", so its `onEnter` could only
  // ever fire once the answer was yes. Dead code, in other words, and the tour
  // leaned on the WELCOME card navigating instead.
  //
  // WELCOME enters the moment the tutorial arms, which is the single worst
  // moment to jump tabs: App.js mounts the tabs lazily and does not start
  // preloading the other three until the app has been idle for ~1.5s, so the
  // Map tab does not exist yet. The tab index moved and the pager did not —
  // the tab bar lit Map, `getCurrentRoute()` reported MapMain, every map step
  // unlocked, and the whole map lesson played over the Home screen with its
  // spotlight on whatever Home happened to have in that spot.
  //
  // Entered here, the jump happens when the tour reaches the map step, which
  // is after the runner has read the welcome card and pressed SHOW ME — which
  // is what the comment on that step claimed all along.
  const enteredRef = useRef(null);
  useEffect(() => {
    if (!step || enteredRef.current === step.phase) return;
    enteredRef.current = step.phase;
    step.onEnter?.(navigate);
  }, [step, navigate]);

  // The impression and the haptic stay on the second moment. They belong to
  // the runner seeing the card, not to the tour reaching it — counting a step
  // as viewed while it is still waiting behind its gate would report a lesson
  // nobody was shown.
  const seenRef = useRef(null);
  useEffect(() => {
    if (!stepVisible || seenRef.current === step.phase) return;
    seenRef.current = step.phase;
    track(EVENTS.TUTORIAL_STEP_VIEWED, { step: step.phase });
    if (step.enterHaptic) haptic[step.enterHaptic]?.();
  }, [stepVisible, step]);

  // Reset the "already seen" mark when the step changes, so a rewound phase
  // announces itself again the second time around.
  useEffect(() => {
    if (!stepVisible) seenRef.current = null;
  }, [stepVisible]);

  // A tap, a CTA, or an auto-dismissing card timing out. Never the way an
  // ACTION step ends — those wait for the app to report the real thing.
  const advance = useCallback(() => {
    if (!step) return;
    track(EVENTS.TUTORIAL_STEP_COMPLETED, { step: step.phase });
    goTo(nextPhase(step.phase));
  }, [step, goTo]);

  const skip = useCallback(() => {
    if (!record) return;
    haptic.light();
    track(EVENTS.TUTORIAL_SKIPPED, { step: phase });
    write(skipped(record));
  }, [record, phase, write]);

  // Auto-dismissing steps (the one shown mid run). A timer, cleaned up, keyed
  // on the step being visible — not a chain of timeouts firing into a screen
  // that may already be gone.
  useEffect(() => {
    if (!stepVisible || step.dismiss !== 'auto') return undefined;
    const timer = setTimeout(advance, step.autoMs || 3500);
    return () => clearTimeout(timer);
  }, [stepVisible, step, advance]);

  // --- contextual tips ----------------------------------------------------
  const recordRef = useRef(record);
  recordRef.current = record;

  const requestTip = useCallback(
    (key) => {
      const current = recordRef.current;
      if (!current) return;
      // Never during the core tutorial, and never twice.
      if (coreActive(current) || hasSeenTip(current, key)) return;
      setActiveTip((prev) => prev || key);
    },
    []
  );

  const dismissTip = useCallback(() => {
    setActiveTip((prev) => {
      if (!prev) return null;
      const current = recordRef.current;
      if (current) write(tipSeen(current, prev));
      return null;
    });
  }, [write]);

  useEffect(() => {
    if (!activeTip) return;
    track(EVENTS.TUTORIAL_TIP_VIEWED, { tip: activeTip });
  }, [activeTip]);

  // --- replay -------------------------------------------------------------
  const replay = useCallback(() => {
    const current = recordRef.current || normalise(null);
    // Tips come back too: "replay the tutorial" meaning only half of the
    // teaching is a surprise nobody wants. Account data, runs, territory and
    // progression are untouched — this writes one key in the local profile.
    write({ ...armed(current, { reason: 'replay' }), tips: {} });
    track(EVENTS.TUTORIAL_STARTED, { reason: 'replay' });
  }, [write]);

  // --- the two contexts ---------------------------------------------------
  const api = useMemo(
    () => ({
      registerTarget,
      remeasure,
      setFacts,
      signal,
      requestTip,
      dismissTip,
      advance,
      skip,
      replay,
    }),
    [registerTarget, remeasure, setFacts, signal, requestTip, dismissTip, advance, skip, replay]
  );

  const state = useMemo(
    () => ({
      loading: !record,
      core: record?.core || CORE.IDLE,
      phase,
      step: stepVisible ? step : null,
      tip: activeTip ? tipFor(activeTip) : null,
      rect,
      facts,
    }),
    [record, phase, stepVisible, step, activeTip, rect, facts]
  );

  return (
    <TutorialApiContext.Provider value={api}>
      <TutorialStateContext.Provider value={state}>{children}</TutorialStateContext.Provider>
    </TutorialApiContext.Provider>
  );
}

// A no-op API, so a screen rendered outside the provider (a unit test, the
// share preview harness) neither crashes nor has to guard every call.
const NOOP_API = {
  registerTarget: () => {},
  remeasure: () => {},
  setFacts: () => {},
  signal: () => {},
  requestTip: () => {},
  dismissTip: () => {},
  advance: () => {},
  skip: () => {},
  replay: () => {},
};

const NOOP_STATE = {
  loading: true,
  core: CORE.IDLE,
  phase: PHASE.IDLE,
  step: null,
  tip: null,
  rect: null,
  facts: EMPTY_FACTS,
};

/** Stable callbacks. Safe to use anywhere; never causes a re-render. */
export function useTutorial() {
  return useContext(TutorialApiContext) || NOOP_API;
}

/** The live state. Read by the overlay; re-renders when the tutorial moves. */
export function useTutorialState() {
  return useContext(TutorialStateContext) || NOOP_STATE;
}

export { TIP };
