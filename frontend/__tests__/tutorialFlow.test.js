/**
 * The tutorial's state machine, driven the way the app drives it.
 *
 * The provider is mounted for real against a fake profile store, a fake
 * recording flag and a fake navigator, and pushed through the whole core
 * tutorial and the ways it goes wrong: a double tap, Back out of the demo,
 * the app killed and reopened, a target that has not laid out yet, a skip
 * half way through, a replay by a veteran.
 *
 * What is being protected is the promise that THE RUNNER DRIVES IT. Nothing
 * here presses a tutorial-only button to move the tutorial on (apart from the
 * explicit card buttons: SHOW ME, GOT IT, START EXPLORING); every other
 * transition is a real signal from a screen or a real change of route. And
 * the tutorial itself never navigates except as the direct result of one of
 * those buttons.
 */

import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

// --- the world the provider reads ------------------------------------------

let mockProfile;
let mockRecording;
let mockRunCount;

jest.mock('../src/state/profile', () => ({
  useProfile: () => mockProfile,
}));
jest.mock('../src/state/recording', () => ({
  useRecording: () => ({ isRecording: mockRecording, setRecording: jest.fn() }),
}));
jest.mock('../src/pro/ProProvider', () => ({
  __esModule: true,
  default: ({ children }) => children,
  useProEntitlement: () => ({ runCount: mockRunCount }),
}));
jest.spyOn(console, 'log').mockImplementation(() => {});

import { TutorialProvider, useTutorial, useTutorialState } from '../src/tutorial/TutorialContext';
import { PHASE } from '../src/tutorial/phases';
import { CORE, TIP, TUTORIAL_VERSION } from '../src/tutorial/progress';
import { SIGNAL } from '../src/tutorial/signals';
import { TARGET } from '../src/tutorial/targets';
import { EVENTS, clearRecentEvents, recentEvents } from '../src/analytics';

// --- a fake navigator -------------------------------------------------------

function makeNav(initialRoute = 'HomeMain') {
  let route = initialRoute;
  const listeners = new Set();
  return {
    isReady: () => true,
    getCurrentRoute: () => ({ name: route }),
    getRootState: () => ({ key: 'root-key' }),
    addListener: (_type, fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    navigate: jest.fn(),
    dispatch: jest.fn(),
    go(next) {
      route = next;
      listeners.forEach((fn) => fn());
    },
  };
}

// --- a probe ----------------------------------------------------------------

let api = null;
let state = null;

function Probe() {
  api = useTutorial();
  state = useTutorialState();
  return <Text>{state.phase}</Text>;
}

function mount(nav) {
  let tree;
  act(() => {
    tree = renderer.create(
      <TutorialProvider navigationRef={nav}>
        <Probe />
      </TutorialProvider>
    );
  });
  return tree;
}

function setProfile(patch = {}) {
  const stored = { ...(mockProfile?.profile || {}) };
  mockProfile = {
    profile: { introDone: true, tutorialPending: false, tutorial: null, ...stored, ...patch },
    loading: false,
    saveTutorial: (tutorial) => {
      act(() => {
        mockProfile = { ...mockProfile, profile: { ...mockProfile.profile, tutorial } };
      });
    },
    completeTutorial: () => {
      act(() => {
        mockProfile = { ...mockProfile, profile: { ...mockProfile.profile, tutorialPending: false } };
      });
    },
  };
}

// Re-render to a fixed point: one write can cause another (a doneWhen that is
// already true, a demo step found without its screen).
function sync(tree) {
  for (let i = 0; i < 8; i += 1) {
    const before = mockProfile.profile.tutorial;
    act(() => {
      tree.update(
        <TutorialProvider navigationRef={tree.navRef}>
          <Probe />
        </TutorialProvider>
      );
    });
    if (mockProfile.profile.tutorial === before) return;
  }
  throw new Error('tutorial state never settled');
}

function boot({ tutorialPending = false, introDone = true, runCount = 0, tutorial = null, route = 'HomeMain' } = {}) {
  mockProfile = null;
  setProfile({ tutorialPending, introDone, tutorial });
  mockRecording = false;
  mockRunCount = runCount;
  const nav = makeNav(route);
  const tree = mount(nav);
  tree.navRef = nav;
  mounted.push(tree);
  sync(tree);
  return { tree, nav };
}

const at = (phase) => ({ version: TUTORIAL_VERSION, core: CORE.RUNNING, phase, tips: {} });

const phase = () => state.phase;
const stepPhase = () => state.step?.phase ?? null;

const signal = (tree, name) => {
  act(() => api.signal(name));
  sync(tree);
};
const facts = (tree, patch) => {
  act(() => api.setFacts(patch));
  sync(tree);
};
const press = (tree) => {
  act(() => api.advance());
  sync(tree);
};
const goRoute = (tree, nav, route) => {
  act(() => nav.go(route));
  sync(tree);
};
const recording = (tree, on) => {
  act(() => {
    mockRecording = on;
  });
  sync(tree);
};

// A real control, as a screen registers it: a node that can be measured.
function mountTarget(tree, id, rect = { x: 16, y: 300, width: 340, height: 120 }) {
  act(() =>
    api.registerTarget(id, {
      measureInWindow: (cb) => cb(rect.x, rect.y, rect.width, rect.height),
    })
  );
  sync(tree);
}
function unmountTarget(tree, id) {
  act(() => api.registerTarget(id, null));
  sync(tree);
}

const eventNames = () => recentEvents().map((e) => e.name);

const mounted = [];

beforeEach(() => {
  clearRecentEvents();
});

// A waiting step keeps measuring for its target. Unmounting is what stops it,
// exactly as leaving the screen does in the app.
afterEach(() => {
  while (mounted.length) {
    const tree = mounted.pop();
    act(() => tree.unmount());
  }
});

// Getting INTO the demo the only way the app can: from LET'S RUN, through the
// real events. Booting a record that is already mid demo is a cold start, and
// a cold start mid demo correctly rewinds to LET'S RUN (see the resume tests).
function driveTo(target) {
  const booted = boot({ tutorial: at(PHASE.START_RUN) });
  const { tree, nav } = booted;
  const order = [
    PHASE.RUN_START,
    PHASE.DEMO_RUN,
    PHASE.FINISH_DEMO,
    PHASE.CLAIM_POSITION,
    PHASE.CLAIM_NEXT,
    PHASE.CLAIM_ROTATE,
    PHASE.CLAIM_CONFIRM,
  ];
  for (const p of order) {
    if (p === PHASE.RUN_START) goRoute(tree, nav, 'Record');
    if (p === PHASE.DEMO_RUN) {
      signal(tree, SIGNAL.RUN_STARTED);
      recording(tree, true);
    }
    if (p === PHASE.FINISH_DEMO) signal(tree, SIGNAL.DEMO_ROUTE_DONE);
    if (p === PHASE.CLAIM_POSITION) {
      recording(tree, false);
      goRoute(tree, nav, 'Result');
      signal(tree, SIGNAL.RUN_FINISHED);
      facts(tree, { claimReady: true, claimStep: 'place', demoClaimM2: 375000 });
    }
    if (p === PHASE.CLAIM_NEXT) signal(tree, SIGNAL.CLAIM_POSITION_CHANGED);
    if (p === PHASE.CLAIM_ROTATE) facts(tree, { claimStep: 'rotate' });
    if (p === PHASE.CLAIM_CONFIRM) signal(tree, SIGNAL.CLAIM_ROTATION_CHANGED);
    expect(phase()).toBe(p);
    if (p === target) break;
  }
  nav.navigate.mockClear();
  return booted;
}

// ---------------------------------------------------------------------------

describe('arming', () => {
  it('puts a brand new account at the welcome card, on Home', () => {
    const { nav } = boot({ tutorialPending: true, runCount: 0 });
    expect(phase()).toBe(PHASE.WELCOME);
    expect(state.core).toBe(CORE.RUNNING);
    expect(stepPhase()).toBe(PHASE.WELCOME);
    expect(state.host).toBe('root');
    // Arriving moves nothing.
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('clears the intro flag once it has taken it over', () => {
    boot({ tutorialPending: true, runCount: 0 });
    expect(mockProfile.profile.tutorialPending).toBe(false);
    expect(mockProfile.profile.tutorial.core).toBe(CORE.RUNNING);
    // Marked as a first onboarding: what lets the tips show later.
    expect(mockProfile.profile.tutorial.firstOnboarding).toBe(true);
  });

  it('LEAVES AN EXISTING RUNNER COMPLETELY ALONE', () => {
    boot({ tutorialPending: false, runCount: 120 });
    expect(state.core).toBe(CORE.IDLE);
    expect(state.step).toBeNull();
    expect(mockProfile.profile.tutorial?.firstOnboarding).toBeFalsy();
  });

  it('does not drop somebody half way through the OLD tutorial into the new one', () => {
    boot({ tutorial: { version: 1, core: CORE.RUNNING, phase: 'training-rival', tips: {} }, runCount: 0 });
    expect(state.core).toBe(CORE.DONE);
    expect(state.step).toBeNull();
  });

  it('shows nothing at all while the run count is still unknown', () => {
    const { tree } = boot({ tutorialPending: false, runCount: null });
    expect(state.step).toBeNull();
    act(() => {
      mockRunCount = 0;
    });
    sync(tree);
    expect(state.core).toBe(CORE.RUNNING);
  });

  it('reports that it started', () => {
    boot({ tutorialPending: true, runCount: 0 });
    expect(eventNames()).toContain(EVENTS.TUTORIAL_STARTED);
  });
});

describe('route and target awareness', () => {
  it('never draws the welcome card over another screen', () => {
    boot({ tutorialPending: true, route: 'MapMain' });
    expect(phase()).toBe(PHASE.WELCOME);
    expect(state.step).toBeNull();
  });

  it('draws nothing for an action step until its REAL control is measured', () => {
    const { tree } = boot({ tutorial: at(PHASE.START_RUN) });
    expect(phase()).toBe(PHASE.START_RUN);
    expect(state.step).toBeNull();
    mountTarget(tree, TARGET.HOME_START_RUN);
    expect(stepPhase()).toBe(PHASE.START_RUN);
    expect(state.rect).toMatchObject({ x: 16, y: 300, width: 340, height: 120 });
  });

  it('waits, rather than guessing, when the target is slow to lay out', () => {
    jest.useFakeTimers();
    try {
      const { tree } = boot({ tutorial: at(PHASE.START_RUN) });
      let ready = false;
      act(() =>
        api.registerTarget(TARGET.HOME_START_RUN, {
          measureInWindow: (cb) => (ready ? cb(10, 200, 300, 100) : cb(0, 0, 0, 0)),
        })
      );
      sync(tree);
      expect(state.step).toBeNull();
      // Well past the old give up and centre point.
      act(() => jest.advanceTimersByTime(5000));
      sync(tree);
      expect(state.step).toBeNull();
      ready = true;
      act(() => jest.advanceTimersByTime(600));
      sync(tree);
      expect(stepPhase()).toBe(PHASE.START_RUN);
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for a control scrolled off screen instead of blocking everything', () => {
    const { tree } = boot({ tutorial: at(PHASE.START_RUN) });
    mountTarget(tree, TARGET.HOME_START_RUN, { x: 16, y: 5000, width: 340, height: 52 });
    expect(state.step).toBeNull();
    // The runner scrolls it into view; the screen re-registers on layout.
    mountTarget(tree, TARGET.HOME_START_RUN, { x: 16, y: 600, width: 340, height: 52 });
    expect(stepPhase()).toBe(PHASE.START_RUN);
  });

  it('takes the card away the moment its target unmounts', () => {
    const { tree } = boot({ tutorial: at(PHASE.START_RUN) });
    mountTarget(tree, TARGET.HOME_START_RUN);
    expect(stepPhase()).toBe(PHASE.START_RUN);
    unmountTarget(tree, TARGET.HOME_START_RUN);
    // The stale rect belongs to a target that is gone.
    act(() => api.remeasure());
    sync(tree);
    expect(phase()).toBe(PHASE.START_RUN);
  });

  it('never uses a rect measured for one step to place the next', () => {
    const { tree, nav } = boot({ tutorial: at(PHASE.START_RUN) });
    mountTarget(tree, TARGET.HOME_START_RUN);
    goRoute(tree, nav, 'Record');
    expect(phase()).toBe(PHASE.RUN_START);
    // The run screen's Start is not registered yet.
    expect(state.step).toBeNull();
    expect(state.rect).toBeNull();
  });
});

describe('the core tutorial, driven by the runner', () => {
  it('plays from welcome to done without the tutorial ever navigating on its own', () => {
    const { tree, nav } = boot({ tutorialPending: true, runCount: 0 });

    // WELCOME → SHOW ME. Home stays put.
    press(tree);
    expect(phase()).toBe(PHASE.START_RUN);
    mountTarget(tree, TARGET.HOME_START_RUN);
    expect(stepPhase()).toBe(PHASE.START_RUN);
    expect(state.step.interactive).toBe(true);

    // The runner taps LET'S RUN; the hero's own onPress opens the run screen.
    goRoute(tree, nav, 'Record');
    expect(phase()).toBe(PHASE.RUN_START);
    mountTarget(tree, TARGET.RUN_START, { x: 16, y: 700, width: 340, height: 56 });
    expect(stepPhase()).toBe(PHASE.RUN_START);
    expect(state.host).toBe('record');

    // The runner presses Start: the demo begins.
    signal(tree, SIGNAL.RUN_STARTED);
    expect(phase()).toBe(PHASE.DEMO_RUN);
    expect(state.step).toBeNull(); // countdown: nothing over it
    recording(tree, true);
    expect(stepPhase()).toBe(PHASE.DEMO_RUN);
    expect(state.step.kind).toBe('banner');

    // The route has drawn itself: Finish appears and WAITS.
    signal(tree, SIGNAL.DEMO_ROUTE_DONE);
    expect(phase()).toBe(PHASE.FINISH_DEMO);
    mountTarget(tree, TARGET.FINISH_RUN, { x: 16, y: 700, width: 340, height: 56 });
    expect(stepPhase()).toBe(PHASE.FINISH_DEMO);

    // The runner presses Finish demo run.
    recording(tree, false);
    goRoute(tree, nav, 'Result');
    signal(tree, SIGNAL.RUN_FINISHED);
    expect(phase()).toBe(PHASE.CLAIM_POSITION);
    expect(state.step).toBeNull(); // chooser not up yet
    facts(tree, { claimReady: true, claimStep: 'place', demoClaimM2: 375000 });
    mountTarget(tree, TARGET.CLAIM_POSITION, { x: 16, y: 520, width: 340, height: 90 });
    expect(stepPhase()).toBe(PHASE.CLAIM_POSITION);

    // Slides the claim.
    signal(tree, SIGNAL.CLAIM_POSITION_CHANGED);
    expect(phase()).toBe(PHASE.CLAIM_NEXT);
    mountTarget(tree, TARGET.CLAIM_NEXT, { x: 16, y: 640, width: 340, height: 48 });
    expect(stepPhase()).toBe(PHASE.CLAIM_NEXT);
    // Action-first: one title, one instruction, no ack line.
    expect(state.step.copy(state.facts).action).toMatch(/CHOOSE ANGLE/);

    // Taps CHOOSE ANGLE: the chooser really moves to its second step.
    facts(tree, { claimStep: 'rotate' });
    expect(phase()).toBe(PHASE.CLAIM_ROTATE);
    mountTarget(tree, TARGET.CLAIM_ROTATION, { x: 16, y: 480, width: 340, height: 180 });
    expect(stepPhase()).toBe(PHASE.CLAIM_ROTATE);

    // Turns it.
    signal(tree, SIGNAL.CLAIM_ROTATION_CHANGED);
    expect(phase()).toBe(PHASE.CLAIM_CONFIRM);
    mountTarget(tree, TARGET.CLAIM_BUTTON, { x: 16, y: 720, width: 340, height: 52 });
    expect(stepPhase()).toBe(PHASE.CLAIM_CONFIRM);

    // Taps CLAIM.
    signal(tree, SIGNAL.CLAIM_PLACED);
    expect(stepPhase()).toBe(PHASE.CLAIM_SUCCESS);
    expect(state.host).toBe('record');
    expect(state.step.copy(state.facts).lines[0]).toContain('0.38 km²');

    // GOT IT, GOT IT, GOT IT.
    press(tree);
    expect(stepPhase()).toBe(PHASE.DEFEND);
    press(tree);
    expect(stepPhase()).toBe(PHASE.RANK);
    press(tree);
    expect(stepPhase()).toBe(PHASE.READY);

    // Nothing so far has been the tutorial navigating.
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(nav.dispatch).not.toHaveBeenCalled();

    // START EXPLORING: done, and the demo's modal closes back to Home because
    // the runner pressed a button that says so.
    press(tree);
    expect(state.core).toBe(CORE.DONE);
    expect(state.step).toBeNull();
    expect(nav.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Home', params: { screen: 'HomeMain' } });

    const names = eventNames();
    [
      EVENTS.TUTORIAL_STEP_START_RUN_COMPLETED,
      EVENTS.TUTORIAL_STEP_RUN_COMPLETED,
      EVENTS.TUTORIAL_STEP_POSITION_COMPLETED,
      EVENTS.TUTORIAL_STEP_ROTATION_COMPLETED,
      EVENTS.TUTORIAL_STEP_CLAIM_COMPLETED,
      EVENTS.TUTORIAL_COMPLETED,
    ].forEach((name) => expect(names).toContain(name));
  });

  it('NEVER moves on by itself, however long the runner looks at a step', () => {
    jest.useFakeTimers();
    try {
      [PHASE.WELCOME, PHASE.START_RUN, PHASE.CLAIM_POSITION, PHASE.DEFEND, PHASE.RANK, PHASE.READY].forEach(
        (p) => {
          const { tree, nav } = p === PHASE.CLAIM_POSITION ? driveTo(p) : boot({ tutorial: at(p) });
          act(() => jest.advanceTimersByTime(120000));
          sync(tree);
          expect(phase()).toBe(p);
          expect(nav.navigate).not.toHaveBeenCalled();
        }
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('has no tap anywhere: the card button is the only way past a card, and an action step ignores it', () => {
    const { tree } = boot({ tutorial: at(PHASE.START_RUN) });
    mountTarget(tree, TARGET.HOME_START_RUN);
    press(tree);
    expect(phase()).toBe(PHASE.START_RUN);
  });

  it('a double tap on a card button moves ONE card', () => {
    const { tree } = boot({ tutorial: at(PHASE.DEFEND) });
    act(() => {
      api.advance();
      api.advance();
    });
    sync(tree);
    expect(phase()).toBe(PHASE.RANK);
  });

  it('a double report of the same event moves ONE step', () => {
    const { tree } = driveTo(PHASE.CLAIM_POSITION);
    act(() => {
      api.signal(SIGNAL.CLAIM_POSITION_CHANGED);
      api.signal(SIGNAL.CLAIM_POSITION_CHANGED);
    });
    sync(tree);
    expect(phase()).toBe(PHASE.CLAIM_NEXT);
  });

  it('ignores an event that belongs to another step', () => {
    const { tree } = driveTo(PHASE.CLAIM_POSITION);
    signal(tree, SIGNAL.CLAIM_ROTATION_CHANGED);
    signal(tree, SIGNAL.CLAIM_PLACED);
    expect(phase()).toBe(PHASE.CLAIM_POSITION);
  });

  it('a real run finishing never moves the tutorial', () => {
    const { tree } = boot({ tutorial: at(PHASE.WELCOME) });
    signal(tree, SIGNAL.RUN_FINISHED);
    expect(phase()).toBe(PHASE.WELCOME);
  });

  it('"Take a real run" finishes and opens a FRESH run screen in place of the demo', () => {
    const { tree, nav } = boot({ tutorial: at(PHASE.READY), route: 'Result' });
    act(() => api.secondary());
    sync(tree);
    expect(state.core).toBe(CORE.DONE);
    expect(nav.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REPLACE', target: 'root-key', payload: expect.objectContaining({ name: 'Record' }) })
    );
  });
});

describe('back, close and interruptions', () => {
  it('closing the demo run rewinds to LET\'S RUN, never pointing at a screen that is gone', () => {
    const { tree, nav } = driveTo(PHASE.DEMO_RUN);
    expect(stepPhase()).toBe(PHASE.DEMO_RUN);
    recording(tree, false);
    goRoute(tree, nav, 'HomeMain');
    expect(phase()).toBe(PHASE.START_RUN);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('Back from the claim to the run screen goes back to Start, which plays a new demo', () => {
    const { tree, nav } = driveTo(PHASE.CLAIM_ROTATE);
    goRoute(tree, nav, 'Record');
    expect(phase()).toBe(PHASE.RUN_START);
  });

  it('killed mid demo, it resumes at LET\'S RUN', () => {
    boot({ tutorial: at(PHASE.CLAIM_CONFIRM) });
    expect(phase()).toBe(PHASE.START_RUN);
    expect(eventNames()).toContain(EVENTS.TUTORIAL_RESUMED);
  });

  it('killed after the demo claim landed, it resumes at the defend card', () => {
    boot({ tutorial: at(PHASE.CLAIM_SUCCESS) });
    expect(phase()).toBe(PHASE.DEFEND);
    expect(stepPhase()).toBe(PHASE.DEFEND);
    expect(state.host).toBe('root');
  });

  it('backgrounded and resumed on a card that needs no screen, it stays put', () => {
    boot({ tutorial: at(PHASE.RANK) });
    expect(stepPhase()).toBe(PHASE.RANK);
  });
});

describe('getting out', () => {
  it('skip stops everything without pretending it was completed', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    act(() => api.skip());
    sync(tree);
    expect(state.core).toBe(CORE.SKIPPED);
    expect(state.step).toBeNull();
    expect(eventNames()).toContain(EVENTS.TUTORIAL_SKIPPED);
    // Already on Home: nothing to close.
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('skip half way through the demo closes it: no demo run or claim survives', () => {
    const { tree, nav } = driveTo(PHASE.CLAIM_ROTATE);
    act(() => api.skip());
    sync(tree);
    expect(state.core).toBe(CORE.SKIPPED);
    expect(state.facts.claimReady).toBe(false);
    expect(state.facts.demoClaimM2).toBe(0);
    expect(nav.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Home', params: { screen: 'HomeMain' } });
  });

  it('a skipped tutorial stays skipped across a relaunch', () => {
    const { tree } = boot({ tutorialPending: true });
    act(() => api.skip());
    sync(tree);
    const saved = mockProfile.profile.tutorial;
    boot({ tutorialPending: false, tutorial: saved, runCount: 0 });
    expect(state.core).toBe(CORE.SKIPPED);
    expect(state.step).toBeNull();
  });
});

describe('replay', () => {
  it('re arms the NEW core tutorial, clears the tips and starts on Home', () => {
    const { tree, nav } = boot({
      tutorial: { version: TUTORIAL_VERSION, core: CORE.DONE, phase: PHASE.COMPLETE, tips: { club: true } },
      runCount: 200,
      route: 'Settings',
    });
    act(() => {
      expect(api.replay()).toBe(true);
    });
    sync(tree);
    expect(state.core).toBe(CORE.RUNNING);
    expect(phase()).toBe(PHASE.WELCOME);
    expect(mockProfile.profile.tutorial.tips).toEqual({});
    expect(nav.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Home', params: { screen: 'HomeMain' } });
    // Not drawn over Settings; it waits for Home.
    expect(state.step).toBeNull();
    goRoute(tree, nav, 'HomeMain');
    expect(stepPhase()).toBe(PHASE.WELCOME);
  });

  it('does not touch anything else in the profile', () => {
    const { tree } = boot({
      tutorial: { version: TUTORIAL_VERSION, core: CORE.DONE, phase: PHASE.COMPLETE, tips: {} },
      runCount: 200,
    });
    act(() => {
      mockProfile.profile.firstName = 'Robin';
      mockProfile.profile.birthday = '1990-01-01';
    });
    act(() => api.replay());
    sync(tree);
    expect(mockProfile.profile.firstName).toBe('Robin');
    expect(mockProfile.profile.birthday).toBe('1990-01-01');
  });

  it('refuses while a real run is recording', () => {
    const { tree } = boot({
      tutorial: { version: TUTORIAL_VERSION, core: CORE.DONE, phase: PHASE.COMPLETE, tips: {} },
      runCount: 200,
    });
    recording(tree, true);
    let ok;
    act(() => {
      ok = api.replay();
    });
    sync(tree);
    expect(ok).toBe(false);
    expect(state.core).toBe(CORE.DONE);
  });
});

describe('contextual tips', () => {
  // A new player who has finished the core tutorial: tips are part of their
  // first onboarding.
  function done(route = 'HomeMain') {
    return boot({
      tutorial: { version: TUTORIAL_VERSION, core: CORE.DONE, phase: PHASE.COMPLETE, tips: {}, firstOnboarding: true },
      runCount: 12,
      route,
    });
  }

  // Teaching is for a first onboarding only. A veteran (never armed: a
  // reinstall, a new phone, an update that added the tip) and a record that
  // was migrated from the old tour are never shown one.
  it.each([
    ['an existing account', { version: TUTORIAL_VERSION, core: CORE.IDLE, phase: PHASE.IDLE, reason: 'existing_account', tips: {} }],
    ['a record migrated from the old tour', { version: 1, core: CORE.DONE, phase: 'complete', tips: {} }],
  ])('shows no tip to %s', (_, tutorial) => {
    const { tree } = boot({ tutorial, runCount: 40 });
    act(() => api.requestTip(TIP.MISSIONS));
    sync(tree);
    expect(state.tip).toBeNull();
  });

  it('keeps an account armed as new eligible, even from before the flag existed', () => {
    const { tree } = boot({
      tutorial: { version: TUTORIAL_VERSION, core: CORE.DONE, phase: PHASE.COMPLETE, reason: 'intro_just_finished', tips: {} },
      runCount: 3,
    });
    act(() => api.requestTip(TIP.MISSIONS));
    sync(tree);
    expect(state.tip.key).toBe(TIP.MISSIONS);
  });

  it('shows a tip once and remembers it', () => {
    const { tree } = done();
    act(() => api.requestTip(TIP.MISSIONS));
    sync(tree);
    expect(state.tip.key).toBe(TIP.MISSIONS);
    act(() => api.dismissTip());
    sync(tree);
    expect(state.tip).toBeNull();
    expect(mockProfile.profile.tutorial.tips[TIP.MISSIONS]).toBe(true);
    act(() => api.requestTip(TIP.MISSIONS));
    sync(tree);
    expect(state.tip).toBeNull();
  });

  it('a yes calls what the screen asked for; a not now does not', () => {
    const { tree } = done('Result');
    const onAccept = jest.fn();
    act(() => api.requestTip(TIP.SHARE, { onAccept }));
    sync(tree);
    expect(state.tip.key).toBe(TIP.SHARE);
    expect(state.host).toBe('record');
    act(() => api.dismissTip(true));
    sync(tree);
    expect(onAccept).toHaveBeenCalledTimes(1);

    const again = done('Result');
    const never = jest.fn();
    act(() => api.requestTip(TIP.SHARE, { onAccept: never }));
    sync(again.tree);
    act(() => api.dismissTip(false));
    sync(again.tree);
    expect(never).not.toHaveBeenCalled();
  });

  it('a tip with a target waits for that target', () => {
    const { tree } = done();
    act(() => api.requestTip(TIP.CLUB));
    sync(tree);
    expect(state.tip).toBeNull();
    mountTarget(tree, TARGET.CLUB_MAIN);
    expect(state.tip.key).toBe(TIP.CLUB);
  });

  it('goes away with the screen it belonged to', () => {
    const { tree, nav } = done('MapMain');
    act(() => api.requestTip(TIP.MAP));
    sync(tree);
    expect(state.tip.key).toBe(TIP.MAP);
    goRoute(tree, nav, 'HomeMain');
    expect(state.tip).toBeNull();
  });

  it('NEVER interrupts the core tutorial', () => {
    const { tree } = boot({ tutorialPending: true, runCount: 0 });
    act(() => api.requestTip(TIP.SHOP));
    sync(tree);
    expect(state.tip).toBeNull();
    expect(stepPhase()).toBe(PHASE.WELCOME);
  });

  it('shows one at a time', () => {
    const { tree } = done();
    act(() => {
      api.requestTip(TIP.MISSIONS);
      api.requestTip(TIP.SHOP);
    });
    sync(tree);
    expect(state.tip.key).toBe(TIP.MISSIONS);
  });

  it('reports the impression', () => {
    const { tree } = done();
    act(() => api.requestTip(TIP.DEFENSE));
    sync(tree);
    expect(eventNames()).toContain(EVENTS.TUTORIAL_TIP_VIEWED);
  });
});
