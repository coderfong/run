// The tutorial's brain: one state machine, one target registry, one place
// where progress is written down.
//
// TWO CONTEXTS, DELIBERATELY.
//
//   TutorialApi    stable callbacks only: register a target, report a signal,
//                  publish a fact, skip, replay. Built once and never rebuilt,
//                  so the screens that offer a target or report an event never
//                  re-render because the tutorial moved.
//   TutorialState  the live phase, the measured rect, the active tip. Read by
//                  the overlay and a handful of small consumers.
//
// WHAT IT NEVER DOES. It never navigates, scrolls, switches a tab or moves a
// map to teach something, and it never advances on a timer. Every transition
// is one of:
//
//   * a SIGNAL from the screen that owns the state (the runner pressed Start,
//     moved the claim, turned it, claimed it);
//   * a FACT becoming true (the run screen is up, the chooser is on its angle
//     step), checked by the step's `doneWhen`;
//   * the runner pressing the explicit button on a card.
//
// The only navigation in this file happens INSIDE a handler for a button the
// runner pressed: Skip (leave the demo), START EXPLORING (back to Home), Take
// a real run, and Replay tutorial (Home, where it starts). Each one is the
// direct result of that press, which is exactly what the runner expects.
//
// ROUTE AWARE. A step names the screens it belongs to and the real control it
// points at. It draws only when that route is up AND that control has been
// registered and measured; otherwise it draws nothing and waits. A demo step
// whose screen has gone away (closed, Back, the app killed) rewinds to the one
// step that can start a fresh demo, instead of pointing at a screen that is
// not there.

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
import { StackActions } from '@react-navigation/native';

import { EVENTS, track } from '../analytics';
import { useProfile } from '../state/profile';
import { useRecording } from '../state/recording';
import { useProEntitlement } from '../pro/ProProvider';
import { haptic } from '../theme/haptics';
import { DEMO_PHASES, PHASE, nextPhase, resumePhase } from './phases';
import {
  CORE,
  TIP,
  advanced,
  armed,
  coreActive,
  decideCoreState,
  hasSeenTip,
  inFirstOnboarding,
  normalise,
  skipped,
  tipSeen,
} from './progress';
import { SIGNAL } from './signals';
import { resolveHost, stepFor } from './steps';
import { tipFor } from './tips';

// Routes that mean "the run/claim modal is up". A native fullScreenModal is
// presented above the React root, so these are also the routes whose cards
// belong to the inner overlay host rather than the root one.
export const RUN_ROUTES = new Set(['Record', 'Result', 'PlanAttack', 'RankProgression', 'RankLadder']);

// Measuring a target that has not finished laying out yet. Quick attempts
// first (a modal presenting, a first paint), then a slow poll for as long as
// the step is waiting. A target that never measures means the step never
// draws: better an invisible step than a card pointing at nothing.
const MEASURE_FAST_MS = 120;
const MEASURE_FAST_ATTEMPTS = 12;
const MEASURE_SLOW_MS = 500;

// Which analytics event each real action reports.
const ACTION_EVENTS = {
  [PHASE.START_RUN]: EVENTS.TUTORIAL_STEP_START_RUN_COMPLETED,
  [PHASE.FINISH_DEMO]: EVENTS.TUTORIAL_STEP_RUN_COMPLETED,
  [PHASE.CLAIM_POSITION]: EVENTS.TUTORIAL_STEP_POSITION_COMPLETED,
  [PHASE.CLAIM_ROTATE]: EVENTS.TUTORIAL_STEP_ROTATION_COMPLETED,
  [PHASE.CLAIM_CONFIRM]: EVENTS.TUTORIAL_STEP_CLAIM_COMPLETED,
};

const TutorialApiContext = createContext(null);
const TutorialStateContext = createContext(null);

const EMPTY_FACTS = {
  // Derived here, not reported: the route the navigator is on, and whether a
  // run is recording.
  route: null,
  running: false,
  // Published by the claim screen.
  claimReady: false,
  claimStep: null,
  demoClaimM2: 0,
};

export function TutorialProvider({ children, navigationRef }) {
  const { profile, loading: profileLoading, saveTutorial, completeTutorial } = useProfile();
  const { isRecording } = useRecording();
  const { runCount } = useProEntitlement();
  const screen = useWindowDimensions();

  // The persisted record, normalised. `null` until the profile has hydrated:
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
  // id → the host component's node. Refs, not state: registering a target
  // must not render anything.
  const targets = useRef(new Map());
  const bumpMeasure = useCallback(() => setMeasureTick((n) => n + 1), []);

  const registerTarget = useCallback(
    (id, node) => {
      if (!id) return;
      if (node) targets.current.set(id, node);
      else targets.current.delete(id);
      // TEMP DEBUG (remove once the Start Run tap is confirmed working on
      // device): the first link in the chain — did the real component even
      // register itself as this target's node.
      if (__DEV__) console.log('[tutorial] registerTarget', id, node ? 'mounted' : 'unmounted');
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
    // `runs_unknown` is not an answer yet: /me/stats is still in flight, and
    // this effect runs again when it lands.
    if (decision.reason === 'runs_unknown') return;
    seededRef.current = true;
    if (decision.core === CORE.RUNNING) {
      // Armed on evidence of a NEW account, so this is its first onboarding:
      // the flag that later lets tips and explainers show (progress.js).
      write({ ...armed(record, { reason: decision.reason }), firstOnboarding: true });
      track(EVENTS.TUTORIAL_STARTED, { reason: decision.reason });
      // The pending flag has been HANDED OVER. From here the versioned record
      // is the only thing that decides whether anything is shown.
      if (profile.tutorialPending) completeTutorial?.();
    } else {
      write({ ...record, core: CORE.IDLE, reason: decision.reason });
    }
  }, [record, profile.tutorialPending, profile.introDone, runCount, write, completeTutorial]);

  const phase = record?.phase || PHASE.IDLE;
  const active = coreActive(record);
  const step = active ? stepFor(phase) : null;

  const goTo = useCallback(
    (to) => {
      if (!record) return;
      if (to === PHASE.COMPLETE) {
        track(EVENTS.TUTORIAL_COMPLETED, {});
        haptic.success();
      }
      write(advanced(record, to));
    },
    [record, write]
  );

  // --- the navigator ------------------------------------------------------
  const navRef = useRef(null);
  navRef.current = navigationRef?.current || navigationRef;

  // The current route, kept in facts so steps can gate on it declaratively.
  useEffect(() => {
    const nav = navigationRef?.current || navigationRef;
    if (!nav?.addListener) return undefined;
    const sync = () => {
      const name = nav.isReady?.() ? nav.getCurrentRoute?.()?.name || null : null;
      // TEMP DEBUG: the navigator's own state listener. If tapping the hero
      // never logs a change to 'Record' here, the tap isn't reaching
      // navigation.navigate at all — that's the actual real-world proof that
      // the touch reached the real Pressable, upstream of anything this file
      // does with it.
      if (__DEV__) console.log('[tutorial] route sync ->', name);
      setFactsState((prev) => (prev.route === name ? prev : { ...prev, route: name }));
    };
    sync();
    const off = nav.addListener('state', sync);
    return () => {
      if (typeof off === 'function') off();
      else off?.remove?.();
    };
  }, [navigationRef]);

  // Recording is derived, never reported.
  useEffect(() => {
    setFactsState((prev) => (prev.running === isRecording ? prev : { ...prev, running: isRecording }));
  }, [isRecording]);

  // Leaving the demo is only ever the answer to a button the runner pressed:
  // Skip, START EXPLORING. Navigating to the root Tabs route from inside the
  // Record modal pops the modal, which unmounts the demo run and its claim.
  const leaveDemo = useCallback(() => {
    const nav = navRef.current;
    if (!nav?.isReady?.()) return;
    const route = nav.getCurrentRoute?.()?.name;
    if (!RUN_ROUTES.has(route)) return;
    nav.navigate('Tabs', { screen: 'Home', params: { screen: 'HomeMain' } });
  }, []);

  // "Take a real run": a FRESH run screen. From inside the demo's modal the
  // modal itself is replaced (so the demo does not wait underneath); from
  // anywhere else the run screen is simply opened.
  const openRealRun = useCallback(() => {
    const nav = navRef.current;
    if (!nav?.isReady?.()) return;
    const route = nav.getCurrentRoute?.()?.name;
    const rootKey = nav.getRootState?.()?.key;
    if (RUN_ROUTES.has(route) && rootKey && nav.dispatch) {
      nav.dispatch({ ...StackActions.replace('Record'), target: rootKey });
      return;
    }
    nav.navigate('Record');
  }, []);

  // --- facts --------------------------------------------------------------
  // Shallow merge that BAILS when nothing changed.
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
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const activeRef = useRef(active);
  activeRef.current = active;
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const signal = useCallback((name) => {
    // TEMP DEBUG: every real screen reports here on a real press (the run
    // screen's Start, the claim's rotate/confirm, ...). If this never logs
    // for SIGNAL.RUN_STARTED after tapping the run screen's Start button,
    // that specific screen's own onPress isn't reaching tutorialSignal.
    if (__DEV__) console.log('[tutorial] signal', name, 'active=', activeRef.current, 'phase=', phaseRef.current);
    if (!activeRef.current) return;
    const from = phaseRef.current;
    const current = stepFor(from);
    const to = current?.on?.[name];
    if (!to || to === from) return;
    // Latch the move before the write lands, so a double report (a double
    // tap, a retry) cannot carry the tutorial two steps.
    phaseRef.current = to;
    if (ACTION_EVENTS[from]) track(ACTION_EVENTS[from], {});
    track(EVENTS.TUTORIAL_STEP_COMPLETED, { step: from });
    goToRef.current(to);
  }, []);

  // --- ending a step on a fact -------------------------------------------
  // START_RUN ends when the run screen is really up; CLAIM_NEXT when the
  // chooser has really moved to its angle step. Both are the runner's own tap
  // on the real control, observed rather than reported.
  useEffect(() => {
    if (!step?.doneWhen || !step.doneWhen(facts)) return;
    // TEMP DEBUG: the third link for a `doneWhen` step (START_RUN, CLAIM_NEXT)
    // — this only logs once the fact it's waiting on (facts.route ===
    // 'Record', for Start Run) has actually become true. If you tap the real
    // hero and this NEVER logs, the hero's onPress isn't running at all, or
    // navigation.navigate('Record') isn't reaching the navigator this
    // provider is watching.
    if (__DEV__) console.log('[tutorial] doneWhen fired for', step.phase, facts);
    if (ACTION_EVENTS[step.phase]) track(ACTION_EVENTS[step.phase], {});
    track(EVENTS.TUTORIAL_STEP_COMPLETED, { step: step.phase });
    goTo(nextPhase(step.phase));
  }, [step, facts, goTo]);

  // --- keeping the demo honest ---------------------------------------------
  // The demo run and its claim exist only inside the run screen. If the
  // runner leaves that screen (the close button, Back, a notification) the
  // demo is gone, so the tutorial goes back to "tap Start a run" rather than
  // pointing at a screen that is no longer there. A claim step found on the
  // run screen (Back from the claim) goes back to Start, which plays a new
  // demo. Nothing here navigates.
  useEffect(() => {
    if (!active || !DEMO_PHASES.has(phase) || !facts.route) return;
    if (!RUN_ROUTES.has(facts.route)) {
      goTo(PHASE.START_RUN);
      setFacts({ claimReady: false, claimStep: null });
      return;
    }
    const want = stepFor(phase)?.route;
    if (want && !want.includes(facts.route) && facts.route === 'Record') {
      goTo(PHASE.RUN_START);
      setFacts({ claimReady: false, claimStep: null });
    }
  }, [active, phase, facts.route, goTo, setFacts]);

  // Picked up again after the app was closed. A demo phase has lost its demo
  // and goes back to Start a run; the payoff moves on to the defend card. Once
  // per launch, the first time the record is readable.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!record || resumedRef.current) return;
    resumedRef.current = true;
    if (!coreActive(record)) return;
    const to = resumePhase(record.phase);
    if (to !== record.phase) {
      track(EVENTS.TUTORIAL_RESUMED, { from: record.phase, to });
      goTo(to);
    } else if (record.phase !== PHASE.WELCOME) {
      track(EVENTS.TUTORIAL_RESUMED, { from: record.phase, to });
    }
  }, [record, goTo]);

  // --- what is on screen --------------------------------------------------
  const routeOk = !!step && (!step.route || step.route.includes(facts.route));
  const gatePassed = routeOk && (!step.gate || step.gate(facts));
  const tip = activeTip ? tipFor(activeTip) : null;
  const targetId = gatePassed ? step.target : !step && tip ? tip.target : null;

  // Measure, and keep trying for as long as the step is waiting. Each rect is
  // tagged with the target it belongs to, so a rect measured for the previous
  // step can never be used to place this one.
  useEffect(() => {
    if (!targetId) return undefined;
    let alive = true;
    let attempts = 0;
    let timer = null;

    const retry = () => {
      attempts += 1;
      timer = setTimeout(attempt, attempts < MEASURE_FAST_ATTEMPTS ? MEASURE_FAST_MS : MEASURE_SLOW_MS);
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
        // ON SCREEN, not merely laid out. A control scrolled below the fold
        // (the Claim button on a small phone) measures fine but cannot be
        // lit or pressed; the step waits until the runner scrolls it into
        // view themselves (the claim sheet re-measures on scroll). Nothing is
        // ever scrolled for them.
        const visibleH = Math.min(y + height, screen.height) - Math.max(y, 0);
        const onScreen = visibleH >= Math.min(height, 24) && x < screen.width && x + width > 0;
        if (width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y) && !onScreen) {
          setRect((prev) => (prev && prev.id === targetId ? null : prev));
          retry();
          return;
        }
        if (width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y)) {
          // TEMP DEBUG: the second link — this is the exact rect the hole and
          // its blocker slabs get drawn around. If this never logs for
          // home.startRun, the step never draws (no highlight at all). If it
          // logs coordinates that don't match where the card visually sits,
          // the hole is in the wrong place and IS blocking the real button.
          if (__DEV__) console.log('[tutorial] measured', targetId, { x, y, width, height });
          setRect((prev) =>
            prev &&
            prev.id === targetId &&
            prev.x === x &&
            prev.y === y &&
            prev.width === width &&
            prev.height === height
              ? prev
              : { id: targetId, x, y, width, height }
          );
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

  // Re-measure on demand, for a target inside a ScrollView.
  const remeasure = useCallback(() => bumpMeasure(), [bumpMeasure]);

  const targetRect = targetId && rect && rect.id === targetId ? rect : null;
  // A step with a target draws only once that target is really measured.
  const stepVisible = gatePassed && (!step.target || !!targetRect);
  const tipVisible = !step && !!tip && (!tip.target || !!targetRect);

  // The impression and the haptic belong to the runner SEEING the card.
  const seenRef = useRef(null);
  useEffect(() => {
    if (!stepVisible) {
      seenRef.current = null;
      return;
    }
    if (seenRef.current === step.phase) return;
    seenRef.current = step.phase;
    track(EVENTS.TUTORIAL_STEP_VIEWED, { step: step.phase });
    if (step.enterHaptic) haptic[step.enterHaptic]?.();
  }, [stepVisible, step]);

  // The card's own button. Only a `cta` step ends this way; an action step
  // waits for the real control, and there is no tap anywhere to continue.
  const ctaLatch = useRef(null);
  const advance = useCallback(() => {
    if (!step || step.dismiss !== 'cta') return;
    // One press per step, however fast the thumb.
    if (ctaLatch.current === step.phase) return;
    ctaLatch.current = step.phase;
    track(EVENTS.TUTORIAL_STEP_COMPLETED, { step: step.phase });
    if (step.ctaAction === 'finish') {
      goTo(PHASE.COMPLETE);
      leaveDemo();
      return;
    }
    goTo(nextPhase(step.phase));
  }, [step, goTo, leaveDemo]);

  // A new step may be pressed again.
  useEffect(() => {
    if (ctaLatch.current && ctaLatch.current !== phase) ctaLatch.current = null;
  }, [phase]);

  const secondary = useCallback(() => {
    if (!step?.secondary) return;
    if (step.secondary.action === 'realRun') {
      track(EVENTS.TUTORIAL_STEP_COMPLETED, { step: step.phase, choice: 'real_run' });
      goTo(PHASE.COMPLETE);
      openRealRun();
    }
  }, [step, goTo, openRealRun]);

  const skip = useCallback(() => {
    if (!record) return;
    haptic.light();
    track(EVENTS.TUTORIAL_SKIPPED, { step: phase });
    write(skipped(record));
    setFacts({ claimReady: false, claimStep: null, demoClaimM2: 0 });
    // Nothing of the demo may outlive the tutorial. Closing its modal is what
    // unmounts the demo run and its claim; outside the modal this does nothing.
    leaveDemo();
  }, [record, phase, write, setFacts, leaveDemo]);

  // --- contextual tips ----------------------------------------------------
  const recordRef = useRef(record);
  recordRef.current = record;
  // What "yes" does, for the one or two tips that offer a choice. Kept by the
  // screen that asked; the tip never navigates on its own.
  const tipAccept = useRef(new Map());

  const requestTip = useCallback((key, opts) => {
    const current = recordRef.current;
    if (!current) return false;
    // Only for an account going through its first onboarding, never during
    // the core tutorial itself, and never twice.
    if (!inFirstOnboarding(current)) return false;
    if (coreActive(current) || hasSeenTip(current, key)) return false;
    if (opts?.onAccept) tipAccept.current.set(key, opts.onAccept);
    setActiveTip((prev) => prev || key);
    return true;
  }, []);

  const activeTipRef = useRef(activeTip);
  activeTipRef.current = activeTip;
  const dismissTip = useCallback(
    (accepted = false) => {
      const key = activeTipRef.current;
      if (!key) return;
      activeTipRef.current = null;
      const current = recordRef.current;
      if (current) write(tipSeen(current, key));
      const onAccept = tipAccept.current.get(key);
      tipAccept.current.delete(key);
      setActiveTip(null);
      if (accepted && onAccept) onAccept();
    },
    [write]
  );

  useEffect(() => {
    if (!activeTip) return;
    track(EVENTS.TUTORIAL_TIP_VIEWED, { tip: activeTip });
  }, [activeTip]);

  // A tip that belonged to a screen that has closed goes with it.
  const tipRouteRef = useRef(null);
  useEffect(() => {
    if (!activeTip) {
      tipRouteRef.current = null;
      return;
    }
    if (tipRouteRef.current == null) {
      tipRouteRef.current = facts.route;
      return;
    }
    if (facts.route && facts.route !== tipRouteRef.current) {
      tipAccept.current.delete(activeTip);
      setActiveTip(null);
    }
  }, [activeTip, facts.route]);

  // --- replay -------------------------------------------------------------
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  // From Settings. Re-arms the core tutorial and brings the tips back; writes
  // one key in the local profile and nothing else. Home is where it starts,
  // so the runner is taken there: they asked for it, from a button.
  const replay = useCallback(() => {
    if (isRecordingRef.current) return false;
    const current = recordRef.current || normalise(null);
    tipAccept.current.clear();
    setActiveTip(null);
    setFacts({ claimReady: false, claimStep: null, demoClaimM2: 0 });
    write({ ...armed(current, { reason: 'replay' }), tips: {} });
    track(EVENTS.TUTORIAL_STARTED, { reason: 'replay' });
    const nav = navRef.current;
    if (nav?.isReady?.()) nav.navigate('Tabs', { screen: 'Home', params: { screen: 'HomeMain' } });
    return true;
  }, [write, setFacts]);

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
      secondary,
      skip,
      replay,
    }),
    [registerTarget, remeasure, setFacts, signal, requestTip, dismissTip, advance, secondary, skip, replay]
  );

  const state = useMemo(
    () => ({
      loading: !record,
      core: record?.core || CORE.IDLE,
      active,
      phase,
      // The step, only once it may really draw: right route, gate open,
      // target measured.
      step: stepVisible ? step : null,
      host: stepVisible
        ? resolveHost(step, facts.route, RUN_ROUTES)
        : tipVisible
          ? resolveHost(tip, facts.route, RUN_ROUTES)
          : null,
      tip: tipVisible ? tip : null,
      rect: targetRect,
      facts,
    }),
    [record, active, phase, stepVisible, step, tipVisible, tip, targetRect, facts]
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
  requestTip: () => false,
  dismissTip: () => {},
  advance: () => {},
  secondary: () => {},
  skip: () => {},
  replay: () => false,
};

const NOOP_STATE = {
  loading: true,
  core: CORE.IDLE,
  active: false,
  phase: PHASE.IDLE,
  step: null,
  host: null,
  tip: null,
  rect: null,
  facts: EMPTY_FACTS,
};

/** Stable callbacks. Safe to use anywhere; never causes a re-render. */
export function useTutorial() {
  return useContext(TutorialApiContext) || NOOP_API;
}

/** The live state. Re-renders when the tutorial moves. */
export function useTutorialState() {
  return useContext(TutorialStateContext) || NOOP_STATE;
}

/** True while the core tutorial is running. Dev tools hide on this. */
export function useTutorialActive() {
  return useTutorialState().active;
}

export { TIP, SIGNAL };
