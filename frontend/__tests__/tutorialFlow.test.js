/**
 * The tutorial's state machine, driven the way the app drives it.
 *
 * The provider is mounted for real against a fake profile store, a fake
 * recording flag and a fake navigator, and then pushed through the whole
 * sequence — including the ways it goes wrong: a run abandoned halfway, a
 * claim that never arrives, the app being killed and reopened.
 *
 * What is being protected here is the promise that the tutorial FOLLOWS the
 * app. Nothing in these tests calls a tutorial-only button to move the
 * tutorial on; every transition is either a real signal from a screen, a real
 * navigation, or a tap on the one card that legitimately has a button.
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
// Analytics is real but sinkless; silence its dev logging so the run is
// readable. The events it would have sent are asserted through the spy below.
jest.spyOn(console, 'log').mockImplementation(() => {});

import { TutorialProvider, useTutorial, useTutorialState } from '../src/tutorial/TutorialContext';
import { PHASE } from '../src/tutorial/phases';
import { CORE, TIP } from '../src/tutorial/progress';
import { SIGNAL } from '../src/tutorial/signals';
import { stepFor } from '../src/tutorial/steps';
import { EVENTS, clearRecentEvents, recentEvents } from '../src/analytics';

// --- a fake navigator -------------------------------------------------------

function makeNav(initialRoute = 'HomeMain') {
  let route = initialRoute;
  const listeners = new Set();
  return {
    isReady: () => true,
    getCurrentRoute: () => ({ name: route }),
    addListener: (_type, fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    navigate: jest.fn(),
    // What a screen transition looks like from out here.
    go(next) {
      route = next;
      listeners.forEach((fn) => fn());
    },
  };
}

// --- a probe that reports what the tutorial is doing ------------------------

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
      // Mirrors the real store: one key, written back whole, everything else
      // in the profile left exactly as it was.
      act(() => {
        mockProfile = {
          ...mockProfile,
          profile: { ...mockProfile.profile, tutorial },
        };
      });
    },
    completeTutorial: () => {
      act(() => {
        mockProfile = {
          ...mockProfile,
          profile: { ...mockProfile.profile, tutorialPending: false },
        };
      });
    },
  };
}

// The provider re-reads the profile from context, and our fake context object
// is swapped wholesale — so a re-render has to be forced after a write, the
// same way a real provider would re-render its consumers.
//
// It runs to a FIXED POINT, because one write can legitimately cause another:
// arriving at a step whose `skipWhen` is already true moves straight past it.
// Settling here is what the real provider gets for free from React re-running
// effects on its own state.
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

function boot({ tutorialPending = false, introDone = true, runCount = 0, tutorial = null } = {}) {
  mockProfile = null;
  setProfile({ tutorialPending, introDone, tutorial });
  mockRecording = false;
  mockRunCount = runCount;
  const nav = makeNav();
  const tree = mount(nav);
  tree.navRef = nav;
  sync(tree);
  return { tree, nav };
}

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
const advance = (tree) => {
  act(() => api.advance());
  sync(tree);
};
const goRoute = (tree, nav, route) => {
  act(() => nav.go(route));
  sync(tree);
};

beforeEach(() => {
  clearRecentEvents();
});

// ---------------------------------------------------------------------------

describe('arming', () => {
  it('puts a brand new account at the welcome card', () => {
    boot({ tutorialPending: true, runCount: 0 });
    expect(phase()).toBe(PHASE.WELCOME);
    expect(state.core).toBe(CORE.RUNNING);
    expect(stepPhase()).toBe(PHASE.WELCOME);
  });

  it('clears the intro flag once it has taken it over', () => {
    boot({ tutorialPending: true, runCount: 0 });
    expect(mockProfile.profile.tutorialPending).toBe(false);
    // ...and the versioned record is what holds the state now.
    expect(mockProfile.profile.tutorial.core).toBe(CORE.RUNNING);
  });

  it('LEAVES AN EXISTING RUNNER COMPLETELY ALONE', () => {
    boot({ tutorialPending: false, runCount: 120 });
    expect(state.core).toBe(CORE.IDLE);
    expect(state.step).toBeNull();
  });

  it('shows nothing at all while the run count is still unknown', () => {
    const { tree } = boot({ tutorialPending: false, runCount: null });
    expect(state.step).toBeNull();
    expect(state.core).toBe(CORE.IDLE);
    // And once it lands saying "no runs yet", the tutorial arms.
    act(() => {
      mockRunCount = 0;
    });
    sync(tree);
    expect(state.core).toBe(CORE.RUNNING);
  });

  it('reports that it started', () => {
    boot({ tutorialPending: true, runCount: 0 });
    expect(recentEvents().map((e) => e.name)).toContain(EVENTS.TUTORIAL_STARTED);
  });
});

describe('getting to the map', () => {
  // The welcome card is entered the instant the tutorial arms, and the Map tab
  // does not exist that early: App.js builds the tabs lazily and only starts
  // preloading the other three once the app has been idle. A jump from here
  // moved the tab INDEX onto a tab that had not been built, so the pager
  // stayed on Home while the route, the tab bar and every map gate believed
  // otherwise — and the whole map lesson played over the Home screen.
  it('does not jump tabs before the runner has pressed anything', () => {
    const { nav } = boot({ tutorialPending: true });

    expect(phase()).toBe(PHASE.WELCOME);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  // The step that teaches the map is the step that asks for it. This is the
  // one that has to keep working: it is gated on ALREADY being on the map, so
  // if entering and drawing were the same moment it could never fire.
  it('asks for the map when the tour reaches the map, from Home', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    // Anything the welcome card did is not what is under test, and it must not
    // be what satisfies this: the jump has to come from the map step itself.
    nav.navigate.mockClear();
    advance(tree); // SHOW ME

    expect(phase()).toBe(PHASE.MAP);
    expect(nav.navigate).toHaveBeenCalledWith('Tabs', {
      screen: 'Map',
      params: { screen: 'MapMain' },
    });
    // And it is still holding its card back until the map is really up.
    expect(stepPhase()).toBeNull();
  });

  // The bug this whole split exists to prevent: a step that is only allowed to
  // draw somewhere else must still be able to GET there.
  it('enters a gated step so it can navigate to what its gate waits for', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    nav.navigate.mockClear();
    advance(tree);

    // `state.step` is the step the overlay may DRAW, and this one is still
    // held back — which is exactly the condition under test.
    expect(stepPhase()).toBeNull();

    const gated = stepFor(PHASE.MAP);
    expect(gated.gate({ route: 'HomeMain' })).toBe(false);
    expect(gated.onEnter).toBeInstanceOf(Function);
    expect(nav.navigate).toHaveBeenCalled();
  });

  // An impression is the runner seeing a card. A step still waiting behind its
  // gate has not been seen by anybody.
  it('does not report a step as viewed while it is still waiting', () => {
    const { tree } = boot({ tutorialPending: true });
    advance(tree);

    const viewed = recentEvents()
      .filter((e) => e.name === EVENTS.TUTORIAL_STEP_VIEWED)
      .map((e) => e.props.step);
    expect(viewed).toContain(PHASE.WELCOME);
    expect(viewed).not.toContain(PHASE.MAP);
  });
});

describe('the tour', () => {
  it('waits for the map before teaching the map', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    advance(tree); // past the welcome card
    expect(phase()).toBe(PHASE.MAP);
    // Still on Home: the step exists but has nothing to point at yet, so it
    // shows nothing rather than lighting the wrong screen.
    expect(stepPhase()).toBeNull();

    goRoute(tree, nav, 'MapMain');
    expect(stepPhase()).toBe(PHASE.MAP);
  });

  it('skips "that is you" when location was refused', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    goRoute(tree, nav, 'MapMain');
    advance(tree); // welcome → map
    facts(tree, { playerLocated: false });
    advance(tree); // map → player
    // The player step steps aside on its own rather than waiting forever.
    expect(phase()).toBe(PHASE.TERRITORY);
  });

  it('shows "that is you" when there is a dot to point at', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    goRoute(tree, nav, 'MapMain');
    facts(tree, { playerLocated: true });
    advance(tree);
    advance(tree);
    expect(phase()).toBe(PHASE.PLAYER);
    expect(stepPhase()).toBe(PHASE.PLAYER);
  });

  it('reaches the start of the run and waits there', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    goRoute(tree, nav, 'MapMain');
    facts(tree, { playerLocated: true });
    advance(tree); // welcome
    advance(tree); // map
    advance(tree); // player
    advance(tree); // territory
    advance(tree); // core loop → training run
    expect(phase()).toBe(PHASE.TRAINING_RUN);
    [
      PHASE.TRAINING_CLAIM,
      PHASE.TRAINING_RIVAL,
      PHASE.TRAINING_CAPTURED,
      PHASE.TRAINING_CROSSROADS,
      PHASE.TRAINING_CUSTOMISE,
      PHASE.TRAINING_SHOP,
      PHASE.TRAINING_PROGRESS,
      PHASE.TRAINING_DEFEND,
      PHASE.START_RUN,
    ].forEach((expected) => {
      advance(tree);
      expect(phase()).toBe(expected);
    });
    expect(phase()).toBe(PHASE.START_RUN);
    // Nothing advances it but really opening the run screen.
    expect(state.step.interactive).toBe(true);
    expect(state.step.dismiss).toBe('action');
  });

  it('teaches the complete game through safe simulated scenes', () => {
    const expected = [
      [PHASE.TRAINING_RUN, 'run'],
      [PHASE.TRAINING_CLAIM, 'claim'],
      [PHASE.TRAINING_RIVAL, 'rival'],
      [PHASE.TRAINING_CAPTURED, 'captured'],
      [PHASE.TRAINING_CROSSROADS, 'crossroads'],
      [PHASE.TRAINING_CUSTOMISE, 'customise'],
      [PHASE.TRAINING_SHOP, 'shop'],
      [PHASE.TRAINING_PROGRESS, 'progress'],
      [PHASE.TRAINING_DEFEND, 'defend'],
    ];
    expected.forEach(([phaseName, scene]) => {
      const training = stepFor(phaseName);
      expect(training.kind).toBe('training');
      expect(training.scene).toBe(scene);
      expect(training.dismiss).toBe('cta');
      expect(training.interactive).toBe(false);
      expect(training.target).toBeNull();
    });
  });
});

describe('the run', () => {
  function atStartRun() {
    const booted = boot({
      tutorialPending: false,
      tutorial: { version: 1, core: CORE.RUNNING, phase: PHASE.START_RUN, tips: {} },
      runCount: 0,
    });
    return booted;
  }

  it('moves to the running coach mark when the run screen opens', () => {
    const { tree, nav } = atStartRun();
    expect(phase()).toBe(PHASE.START_RUN);
    goRoute(tree, nav, 'Record');
    expect(phase()).toBe(PHASE.ACTIVE_RUN);
  });

  it('holds the running coach mark back until GPS is actually recording', () => {
    const { tree, nav } = atStartRun();
    goRoute(tree, nav, 'Record');
    expect(stepPhase()).toBeNull();
    act(() => {
      mockRecording = true;
    });
    sync(tree);
    expect(stepPhase()).toBe(PHASE.ACTIVE_RUN);
  });

  it('holds "hold FINISH" back until the run has earned ground', () => {
    const { tree, nav } = atStartRun();
    goRoute(tree, nav, 'Record');
    act(() => {
      mockRecording = true;
    });
    sync(tree);
    advance(tree); // the running card takes itself away
    expect(phase()).toBe(PHASE.FINISH_RUN);
    expect(stepPhase()).toBeNull();

    facts(tree, { runClaimable: true });
    expect(stepPhase()).toBe(PHASE.FINISH_RUN);
  });

  it('follows a run finished straight from the running card', () => {
    const { tree, nav } = atStartRun();
    goRoute(tree, nav, 'Record');
    act(() => {
      mockRecording = true;
    });
    sync(tree);
    signal(tree, SIGNAL.RUN_FINISHED);
    expect(phase()).toBe(PHASE.CLAIM_SELECT);
  });

  it('REWINDS, BUT NOT TO THE BEGINNING, when a run is abandoned', () => {
    const { tree, nav } = atStartRun();
    goRoute(tree, nav, 'Record');
    act(() => {
      mockRecording = true;
    });
    sync(tree);
    advance(tree);
    expect(phase()).toBe(PHASE.FINISH_RUN);

    // Closed the run screen without finishing.
    act(() => {
      mockRecording = false;
    });
    goRoute(tree, nav, 'HomeMain');
    expect(phase()).toBe(PHASE.START_RUN);
    // The world is not taught again.
    expect(phase()).not.toBe(PHASE.WELCOME);
  });
});

describe('the claim', () => {
  // Walked into rather than booted into, because a stored claim phase is
  // deliberately un-resumable: the run it belonged to is gone by the time the
  // app is opened again (see `resumePhase`). This is the real path.
  function atClaim() {
    const booted = boot({
      tutorialPending: false,
      tutorial: { version: 1, core: CORE.RUNNING, phase: PHASE.START_RUN, tips: {} },
      runCount: 0,
    });
    goRoute(booted.tree, booted.nav, 'Record');
    act(() => {
      mockRecording = true;
    });
    sync(booted.tree);
    signal(booted.tree, SIGNAL.RUN_FINISHED);
    act(() => {
      mockRecording = false;
    });
    goRoute(booted.tree, booted.nav, 'Result');
    return booted;
  }

  it('waits for real options before teaching the chooser', () => {
    const { tree } = atClaim();
    expect(stepPhase()).toBeNull();
    facts(tree, { claimReady: true });
    expect(stepPhase()).toBe(PHASE.CLAIM_SELECT);
  });

  it('moves on when the runner really uses the dial', () => {
    const { tree } = atClaim();
    facts(tree, { claimReady: true });
    signal(tree, SIGNAL.CLAIM_ADJUSTED);
    expect(phase()).toBe(PHASE.CLAIM_CONFIRM);
    expect(recentEvents().map((e) => e.name)).toContain(EVENTS.TUTORIAL_CLAIM_SELECTED);
  });

  it('lets somebody claim without moving anything first', () => {
    const { tree } = atClaim();
    facts(tree, { claimReady: true });
    signal(tree, SIGNAL.CLAIM_PLACED);
    expect(phase()).toBe(PHASE.FIRST_CLAIM_SUCCESS);
  });

  it('holds the payoff until the whole celebration is over', () => {
    const { tree } = atClaim();
    facts(tree, { claimReady: true });
    signal(tree, SIGNAL.CLAIM_PLACED);
    expect(stepPhase()).toBeNull();
    facts(tree, { claimCelebrated: true });
    expect(stepPhase()).toBe(PHASE.FIRST_CLAIM_SUCCESS);
  });

  it('finishes, once, and reports it', () => {
    const { tree } = atClaim();
    facts(tree, { claimReady: true });
    signal(tree, SIGNAL.CLAIM_PLACED);
    facts(tree, { claimCelebrated: true });
    advance(tree);
    expect(state.core).toBe(CORE.DONE);
    expect(state.step).toBeNull();
    const names = recentEvents().map((e) => e.name);
    expect(names).toContain(EVENTS.TUTORIAL_FIRST_CLAIM_COMPLETED);
    expect(names).toContain(EVENTS.TUTORIAL_COMPLETED);
  });

  it('rewinds to the next run when this one has nothing to claim', () => {
    const { tree } = atClaim();
    signal(tree, SIGNAL.CLAIM_UNAVAILABLE);
    expect(phase()).toBe(PHASE.START_RUN);
    expect(state.core).toBe(CORE.RUNNING);
  });
});

describe('getting out', () => {
  it('skip stops everything without pretending it was completed', () => {
    const { tree } = boot({ tutorialPending: true });
    act(() => api.skip());
    sync(tree);
    expect(state.core).toBe(CORE.SKIPPED);
    expect(state.step).toBeNull();
    expect(recentEvents().map((e) => e.name)).toContain(EVENTS.TUTORIAL_SKIPPED);
  });

  it('a skipped tutorial stays skipped across a relaunch', () => {
    const { tree } = boot({ tutorialPending: true });
    act(() => api.skip());
    sync(tree);
    const saved = mockProfile.profile.tutorial;

    // Cold start, same account.
    boot({ tutorialPending: false, tutorial: saved, runCount: 0 });
    expect(state.core).toBe(CORE.SKIPPED);
    expect(state.step).toBeNull();
  });

  it('resumes mid tour after the app is killed', () => {
    const { tree, nav } = boot({ tutorialPending: true });
    goRoute(tree, nav, 'MapMain');
    advance(tree);
    advance(tree);
    const saved = mockProfile.profile.tutorial;
    expect(saved.phase).toBe(PHASE.PLAYER);

    const again = boot({ tutorialPending: false, tutorial: saved, runCount: 0 });
    goRoute(again.tree, again.nav, 'MapMain');
    expect(phase()).toBe(PHASE.PLAYER);
  });

  it('resumes at the run, not the beginning, after being killed mid claim', () => {
    const { tree } = boot({
      tutorialPending: false,
      tutorial: { version: 1, core: CORE.RUNNING, phase: PHASE.CLAIM_CONFIRM, tips: {} },
      runCount: 0,
    });
    expect(phase()).toBe(PHASE.START_RUN);
    expect(tree).toBeTruthy();
  });
});

describe('replay', () => {
  it('re arms the core tutorial and clears the tips', () => {
    const { tree } = boot({
      tutorialPending: false,
      tutorial: { version: 1, core: CORE.DONE, phase: PHASE.COMPLETE, tips: { club: true } },
      runCount: 200,
    });
    expect(state.core).toBe(CORE.DONE);

    act(() => api.replay());
    sync(tree);
    expect(state.core).toBe(CORE.RUNNING);
    expect(phase()).toBe(PHASE.WELCOME);
    expect(mockProfile.profile.tutorial.tips).toEqual({});
  });

  it('does not touch anything else in the profile', () => {
    const { tree } = boot({
      tutorialPending: false,
      tutorial: { version: 1, core: CORE.DONE, phase: PHASE.COMPLETE, tips: {} },
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
});

describe('contextual tips', () => {
  function done() {
    return boot({
      tutorialPending: false,
      tutorial: { version: 1, core: CORE.DONE, phase: PHASE.COMPLETE, tips: {} },
      runCount: 12,
    });
  }

  it('shows a tip once and remembers it', () => {
    const { tree } = done();
    act(() => api.requestTip(TIP.CLUB));
    sync(tree);
    expect(state.tip.key).toBe(TIP.CLUB);

    act(() => api.dismissTip());
    sync(tree);
    expect(state.tip).toBeNull();
    expect(mockProfile.profile.tutorial.tips[TIP.CLUB]).toBe(true);

    act(() => api.requestTip(TIP.CLUB));
    sync(tree);
    expect(state.tip).toBeNull();
  });

  it('NEVER interrupts the core tutorial', () => {
    const { tree } = boot({ tutorialPending: true, runCount: 0 });
    act(() => api.requestTip(TIP.LEADERBOARD));
    sync(tree);
    expect(state.tip).toBeNull();
    expect(stepPhase()).toBe(PHASE.WELCOME);
  });

  it('shows one at a time', () => {
    const { tree } = done();
    act(() => {
      api.requestTip(TIP.CLUB);
      api.requestTip(TIP.LEADERBOARD);
    });
    sync(tree);
    expect(state.tip.key).toBe(TIP.CLUB);
  });

  it('reports the impression', () => {
    const { tree } = done();
    act(() => api.requestTip(TIP.DEFENSE));
    sync(tree);
    expect(recentEvents().map((e) => e.name)).toContain(EVENTS.TUTORIAL_TIP_VIEWED);
  });
});
