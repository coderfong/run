/**
 * The Run screen's end of the watch link. What it publishes decides what the
 * wrist shows; what it lets through decides what a tap on the wrist can do to
 * a real run. So: a state on mount and idle on leaving, a resend only when
 * something shown changes (plus the heartbeat while running), and every
 * command judged against the phase it lands in. Start is also refused unless
 * the phone has the app in front, where iOS allows location to switch on.
 */

import React from 'react';
import { AppState } from 'react-native';
import renderer, { act } from 'react-test-renderer';

let mockModule = null;
jest.mock('../src/watch/nativeWatch', () => ({
  __esModule: true,
  default: () => mockModule,
}));

const { default: useWatchRun, WATCH_HEARTBEAT_MS } = require('../src/watch/useWatchRun');
const { PHASE } = require('../src/watch/watchState');

function fakeModule() {
  const listeners = [];
  return {
    listeners,
    getStatus: jest.fn(() => ({ supported: true, paired: true, installed: true, reachable: true })),
    updateState: jest.fn(),
    addListener: jest.fn((event, fn) => {
      listeners.push(fn);
      return { remove: jest.fn() };
    }),
  };
}

function Probe({ input, handlers }) {
  useWatchRun(input, handlers);
  return null;
}

const RUNNING = {
  phase: PHASE.RUNNING,
  getElapsedMs: () => 60000,
  distanceM: 1200,
  paceSPerKm: 330,
  landM2: null,
  accuracyM: 5,
  hint: '',
  accent: '#ec4899',
  countdown: null,
  qualified: false,
  afterRun: null,
};

let handlers;
let tree;

const sent = () => mockModule.updateState.mock.calls.map(([state]) => state);
const lastSent = () => sent()[sent().length - 1];

function mount(input) {
  act(() => {
    tree = renderer.create(<Probe input={input} handlers={handlers} />);
  });
}

function update(input) {
  act(() => {
    tree.update(<Probe input={input} handlers={handlers} />);
  });
}

async function press(cmd, at = Date.now()) {
  await act(async () => {
    mockModule.listeners.forEach((fn) => fn({ cmd, at }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockModule = fakeModule();
  AppState.currentState = 'active';
  AppState.addEventListener.mockClear();
  handlers = { start: jest.fn(), pause: jest.fn(), resume: jest.fn(), finish: jest.fn() };
});

afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = null;
  jest.useRealTimers();
});

describe('publishing', () => {
  it('sends the run as the screen mounts, and idle as it leaves', () => {
    mount(RUNNING);
    expect(lastSent()).toMatchObject({ phase: 'running', distance: '1.20', pace: '5:30', elapsedS: 60 });
    act(() => tree.unmount());
    tree = null;
    expect(lastSent().phase).toBe('idle');
  });

  it('sends again when something shown changes, not when a second turns', () => {
    mount(RUNNING);
    const count = sent().length;
    update({ ...RUNNING, getElapsedMs: () => 61000 });
    expect(sent().length).toBe(count);
    update({ ...RUNNING, distanceM: 1300 });
    expect(sent().length).toBe(count + 1);
    expect(lastSent().distance).toBe('1.30');
  });

  // Paused too: the watch treats a phone run it has not heard from for a
  // minute as over (PhoneLink.phoneRunActive), and would otherwise offer to
  // start a second run of its own during a long pause.
  it('keeps a running or paused state fresh on the heartbeat, and a finished one still', () => {
    jest.useFakeTimers();
    mount(RUNNING);
    const count = sent().length;
    act(() => jest.advanceTimersByTime(WATCH_HEARTBEAT_MS));
    expect(sent().length).toBe(count + 1);

    update({ ...RUNNING, phase: PHASE.PAUSED });
    const paused = sent().length;
    act(() => jest.advanceTimersByTime(WATCH_HEARTBEAT_MS * 3));
    expect(sent().length).toBe(paused + 3);

    update({ ...RUNNING, phase: PHASE.SAVED });
    const saved = sent().length;
    act(() => jest.advanceTimersByTime(WATCH_HEARTBEAT_MS * 3));
    expect(sent().length).toBe(saved);
  });
});

describe('commands from the watch', () => {
  it('pauses and finishes a running run, and ignores what it cannot do', async () => {
    mount(RUNNING);
    await press('resume');
    await press('start');
    expect(handlers.resume).not.toHaveBeenCalled();
    expect(handlers.start).not.toHaveBeenCalled();

    await press('pause');
    expect(handlers.pause).toHaveBeenCalledTimes(1);
    expect(handlers.pause).toHaveBeenCalledWith();
    await press('finish');
    expect(handlers.finish).toHaveBeenCalledTimes(1);
  });

  it('judges a press by the phase it lands in', async () => {
    mount({ ...RUNNING, phase: PHASE.PAUSED });
    await press('pause');
    expect(handlers.pause).not.toHaveBeenCalled();
    await press('resume');
    expect(handlers.resume).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale press', async () => {
    mount(RUNNING);
    await press('finish', Date.now() - 60000);
    expect(handlers.finish).not.toHaveBeenCalled();
  });

  it('survives a handler that fails', async () => {
    handlers.pause = jest.fn(() => Promise.reject(new Error('location unavailable')));
    mount(RUNNING);
    await press('pause');
    expect(handlers.pause).toHaveBeenCalledTimes(1);
  });

  it('starts a run only for a phone with the app in front', async () => {
    mount({ ...RUNNING, phase: PHASE.READY });
    expect(lastSent().phase).toBe('ready');
    const onChange = AppState.addEventListener.mock.calls[0][1];

    AppState.currentState = 'background';
    act(() => onChange('background'));
    expect(lastSent().phase).toBe('idle');
    await press('start');
    expect(handlers.start).not.toHaveBeenCalled();

    AppState.currentState = 'active';
    act(() => onChange('active'));
    expect(lastSent().phase).toBe('ready');
    await press('start');
    expect(handlers.start).toHaveBeenCalledTimes(1);
  });
});
