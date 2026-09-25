// The Run screen wired to the run session, end to end with fake sensors.
//
// runSession.test.js proves the decisions; this proves the screen acts on
// them: a real start, a stream of GPS fixes and pedometer counts, a stop long
// enough to auto-pause, a resume, and a finish that submits only the accepted
// running segments with the session summary attached.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import * as Location from 'expo-location';

jest.mock('../src/components/GameMap', () => {
  const React2 = require('react');
  const Map = React2.forwardRef((props, ref) => {
    React2.useImperativeHandle(ref, () => ({ flyTo: () => {} }));
    return props.children || null;
  });
  return {
    __esModule: true,
    default: Map,
    MapPoint: () => null,
    TerritoryLayer: () => null,
    Trail: () => null,
    UserMarker: () => null,
  };
});
jest.mock('../src/components/character/CharacterRig', () => ({ CharacterBust: () => null }));
jest.mock('../src/components/DevRunSimulator', () => () => null);
jest.mock('../src/components/run/RunGameplayFx', () => ({ RunEventOverlay: () => null, RunStartOverlay: () => null }));
jest.mock('../src/components/LandCaptureAlert', () => ({ landCaptureAlert: jest.fn() }));
jest.mock('../src/state/avatar', () => ({ useAvatar: () => ({ equipped: {}, rankKey: 'bronze' }) }));
jest.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../src/state/clan', () => ({ useClan: () => ({ color: { stroke: '#ff00aa' } }) }));
jest.mock('../src/state/recording', () => ({ useRecording: () => ({ setRecording: () => {} }) }));
jest.mock('../src/state/settings', () => ({ useSettings: () => ({ trailGlowColor: null }) }));
jest.mock('../src/health', () => ({ writeWorkout: jest.fn(async () => {}) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../src/tutorial', () => ({
  DEMO_RUN_PHASES: new Set(),
  SIGNAL: {},
  TARGET: {},
  useTutorial: () => ({ signal: () => {} }),
  useTutorialState: () => ({ active: false, phase: null }),
  useTutorialTarget: () => ({}),
}));

let stepListener = null;
jest.mock('expo-sensors', () => ({
  Pedometer: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    isAvailableAsync: jest.fn(async () => true),
    watchStepCount: jest.fn((cb) => {
      stepListener = cb;
      return { remove: () => { stepListener = null; } };
    }),
    getStepCountAsync: jest.fn(async () => null),
  },
}));

// eslint-disable-next-line import/first
import RunningScreen from '../src/screens/RunningScreen';
// eslint-disable-next-line import/first
import { api } from '../src/api/client';

const M_PER_DEG = 111320;

describe('the run screen and the run session', () => {
  let fixListener;
  let lat;
  let lon;
  let steps;

  beforeEach(() => {
    jest.useFakeTimers({ now: Date.UTC(2026, 8, 24, 6, 0, 0) });
    fixListener = null;
    stepListener = null;
    lat = 1.3;
    lon = 103.8;
    steps = 0;
    Location.watchPositionAsync = jest.fn(async (_cfg, cb) => {
      fixListener = cb;
      return { remove: () => {} };
    });
    Location.getCurrentPositionAsync = jest.fn(async () => ({
      coords: { latitude: lat, longitude: lon, accuracy: 5 },
    }));
    jest.spyOn(api, 'startRun').mockResolvedValue({ run_id: 'run-1' });
    jest.spyOn(api, 'submitPath').mockResolvedValue({});
    jest.spyOn(api, 'mapPolygons').mockResolvedValue({ territories: [] });
    jest.spyOn(api, 'endRun').mockResolvedValue({ run_id: 'run-1' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function seconds(n, { speed = 0, cadence = 0, jitter = 0 } = {}) {
    for (let i = 0; i < n; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      lon += speed / (M_PER_DEG * 0.99974);
      steps += cadence / 60;
      const j = jitter ? ((i * 7919) % 11) / 10 - 0.5 : 0;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        stepListener?.({ steps: Math.round(steps) });
        await fixListener?.({
          coords: {
            latitude: lat + (j * jitter) / M_PER_DEG,
            longitude: lon,
            accuracy: 6,
            speed: speed || 0.1,
            altitude: null,
          },
          timestamp: Date.now(),
        });
      });
    }
  }

  const texts = (tree) => tree.root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
  const control = (tree, label) => tree.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function');

  test('auto-pauses a long stop, resumes, and submits only the running', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(<RunningScreen navigation={{ navigate: jest.fn(), canGoBack: () => true }} route={{ params: {} }} />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    const start = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Start run' && typeof n.props.onPress === 'function')[0];
    await act(async () => {
      start.props.onPress();
      await jest.advanceTimersByTimeAsync(2500);
    });
    expect(api.startRun).toHaveBeenCalled();
    expect(fixListener).toBeTruthy();

    await seconds(300, { speed: 3, cadence: 165 });
    // The notice shows as the stop is detected (after ~90 s), then clears.
    await seconds(100, { cadence: 0, jitter: 10 });
    expect(texts(tree)).toContain('AUTO PAUSED');
    await seconds(140, { cadence: 0, jitter: 10 });
    // Still paused by PASER: the round control offers Resume, not Pause.
    expect(control(tree, 'Resume run').length).toBeGreaterThan(0);
    const frozen = texts(tree).find((x) => /^[0-9]{2}:[0-9]{2}$/.test(x));

    // Auto-resume needs the runner out of the drift circle and ~10 s of
    // agreement, then it is backdated so no distance is lost.
    await seconds(40, { speed: 3, cadence: 165 });
    await seconds(140, { speed: 3, cadence: 165 });
    expect(control(tree, 'Pause run').length).toBeGreaterThan(0);
    expect(frozen).toBeDefined();

    const finisher = tree.root.findAll((n) => typeof n.props?.onFinish === 'function')[0];
    await act(async () => {
      finisher.props.onFinish();
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(api.endRun).toHaveBeenCalledTimes(1);
    const [runId, points, stepCount, simulated, session] = api.endRun.mock.calls[0];
    expect(runId).toBe('run-1');
    expect(simulated).toBe(false);
    // Two running stretches, never bridged: 300 s + 180 s at 3 m/s.
    const segs = new Set(points.map((p) => p.seg));
    expect(segs.size).toBe(2);
    expect(session.active_running_s).toBeGreaterThan(440);
    expect(session.active_running_s).toBeLessThan(520);
    expect(session.stationary_s).toBeGreaterThan(180);
    expect(session.running_distance_m).toBeGreaterThan(1300);
    expect(session.running_distance_m).toBeLessThan(1500);
    // Steps counted inside the running stretches only.
    expect(stepCount).toBeGreaterThan(1200);
    expect(stepCount).toBeLessThan(1400);
    act(() => tree.unmount());
  }, 240000);

  test('a run left open by a dead app asks, and finishes at the last movement', async () => {
    const { createRunSessionController } = require('../src/run/session/runSessionController');
    // A previous process: 5 minutes of running, saved, then the app died.
    const prior = createRunSessionController();
    await act(async () => {
      await prior.begin({ runId: 'run-9', startedAt: Date.now() });
    });
    for (let i = 0; i < 300; i += 1) {
      jest.setSystemTime(Date.now() + 1000);
      lon += 3 / (M_PER_DEG * 0.99974);
      steps += 165 / 60;
      stepListener?.({ steps: Math.round(steps) });
      prior.recordFix({ latitude: lat, longitude: lon, timestamp: Date.now(), accuracyM: 5, speedMps: 3 });
      prior.tick(Date.now());
    }
    const lastMoved = Date.now();
    await act(async () => {
      await prior.persist();
    });
    prior.detach();
    // Reopened 30 minutes later.
    jest.setSystemTime(lastMoved + 30 * 60 * 1000);

    let tree;
    await act(async () => {
      tree = renderer.create(<RunningScreen navigation={{ navigate: jest.fn(), canGoBack: () => true }} route={{ params: {} }} />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(texts(tree)).toContain('RUN STILL OPEN');
    expect(texts(tree).some((x) => /min ago/.test(x))).toBe(true);

    const finish = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Finish the run at your last running movement'
      && typeof n.props.onPress === 'function')[0];
    await act(async () => {
      finish.props.onPress();
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(api.endRun).toHaveBeenCalledTimes(1);
    const [runId, points, , , session] = api.endRun.mock.calls[0];
    expect(runId).toBe('run-9');
    // The 30 minutes the app was dead are not the run.
    expect(session.active_running_s).toBeLessThan(320);
    expect(points[points.length - 1].t <= new Date(lastMoved + 1000).toISOString()).toBe(true);
    act(() => tree.unmount());
  }, 120000);
});
