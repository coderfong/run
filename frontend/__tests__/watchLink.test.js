/**
 * The native edge of the watch link. Wherever the PaserWatch module is
 * missing (Android, jest, every build before it) the link must do nothing and
 * throw nothing, and where it exists it must hand the watch clean,
 * strictly ordered states and contain whatever a listener does.
 */

import { PHASE } from '../src/watch/watchState';

let mockModule = null;
jest.mock('../src/watch/nativeWatch', () => ({
  __esModule: true,
  default: () => mockModule,
}));

const link = require('../src/watch/watchLink');

const NOW = Date.UTC(2026, 8, 11, 7, 0, 0);

function fakeModule(status = { supported: true, paired: true, installed: true, reachable: true }) {
  const listeners = [];
  return {
    listeners,
    getStatus: jest.fn(() => status),
    updateState: jest.fn(),
    addListener: jest.fn((event, fn) => {
      listeners.push(fn);
      return { remove: jest.fn() };
    }),
  };
}

afterEach(() => {
  mockModule = null;
});

describe('bounded run save', () => {
  it('works without a native module or with an older binary', async () => {
    expect(await link.beginRunSave()).toBe(false);
    await expect(link.endRunSave()).resolves.toBeUndefined();
    mockModule = fakeModule();
    expect(await link.beginRunSave()).toBe(false);
  });

  it('requests and releases native execution time and tolerates expiration/failure', async () => {
    mockModule = { beginRunSave: jest.fn().mockResolvedValue(true), endRunSave: jest.fn().mockResolvedValue() };
    expect(await link.beginRunSave()).toBe(true);
    await link.endRunSave();
    expect(mockModule.endRunSave).toHaveBeenCalledTimes(1);
    mockModule.beginRunSave.mockRejectedValue(new Error('expired'));
    mockModule.endRunSave.mockRejectedValue(new Error('expired'));
    expect(await link.beginRunSave()).toBe(false);
    await expect(link.endRunSave()).resolves.toBeUndefined();
  });
});

describe('without the native module', () => {
  it('does nothing and throws nothing', () => {
    expect(link.publishToWatch({ phase: PHASE.RUNNING }, NOW)).toBeNull();
    expect(link.watchAppInstalled()).toBe(false);
    expect(link.watchStatus()).toEqual({
      supported: false,
      paired: false,
      installed: false,
      reachable: false,
    });
    const sub = link.addWatchCommandListener(() => {});
    expect(() => sub.remove()).not.toThrow();
  });
});

describe('with the native module', () => {
  it('publishes a built state', () => {
    mockModule = fakeModule();
    const sent = link.publishToWatch({ phase: PHASE.RUNNING, distanceM: 1500 }, NOW);
    expect(mockModule.updateState).toHaveBeenCalledWith(sent);
    expect(sent).toMatchObject({ v: 1, phase: 'running', distance: '1.50', km: 1 });
  });

  it('numbers every state above the clock and above the last one', () => {
    mockModule = fakeModule();
    const a = link.publishToWatch({ phase: PHASE.READY }, NOW);
    const b = link.publishToWatch({ phase: PHASE.READY }, NOW);
    const c = link.publishToWatch({ phase: PHASE.READY }, NOW - 60000);
    expect(a.seq).toBeGreaterThanOrEqual(NOW);
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  it('survives a native failure', () => {
    mockModule = fakeModule();
    mockModule.updateState.mockImplementation(() => {
      throw new Error('session not activated');
    });
    expect(link.publishToWatch({ phase: PHASE.IDLE }, NOW)).toBeNull();
    mockModule.getStatus.mockImplementation(() => {
      throw new Error('no session');
    });
    expect(link.watchAppInstalled()).toBe(false);
  });

  it('counts the watch app as installed only when paired and installed', () => {
    mockModule = fakeModule({ supported: true, paired: true, installed: false });
    expect(link.watchAppInstalled()).toBe(false);
    mockModule = fakeModule({ supported: true, paired: false, installed: true });
    expect(link.watchAppInstalled()).toBe(false);
    mockModule = fakeModule({ supported: true, paired: true, installed: true });
    expect(link.watchAppInstalled()).toBe(true);
  });

  it('forwards commands and contains a listener that throws', () => {
    mockModule = fakeModule();
    const handler = jest.fn(() => {
      throw new Error('boom');
    });
    const sub = link.addWatchCommandListener(handler);
    expect(mockModule.addListener).toHaveBeenCalledWith('onCommand', expect.any(Function));
    expect(() => mockModule.listeners[0]({ cmd: 'pause', at: NOW })).not.toThrow();
    expect(handler).toHaveBeenCalledWith({ cmd: 'pause', at: NOW });
    const nativeSub = mockModule.addListener.mock.results[0].value;
    sub.remove();
    expect(nativeSub.remove).toHaveBeenCalled();
  });
});
