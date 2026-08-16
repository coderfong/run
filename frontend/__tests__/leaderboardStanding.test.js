/**
 * The leaderboard's free/paid line, from the client's side.
 *
 * The rule the whole competitive game rests on: a runner must never have to
 * wonder whether they are winning. PASER PRO sells the ability to ask the
 * board a different QUESTION — a shorter window, a smaller field — and never
 * the ANSWER to "where do I stand". If `myStanding` ever starts carrying PRO
 * parameters it was not given, or the default board starts sending them, this
 * is where it should fail.
 *
 * `useCoarsePosition` is here for a different reason. It must never trigger a
 * permission prompt: a location dialog raised by tapping a leaderboard chip is
 * both unexplained and the exact shape of thing that has already cost this app
 * a review rejection (5.1.1(iv)).
 */

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  Accuracy: { Low: 1, High: 6 },
}));

describe('leaderboard requests', () => {
  let requested;
  let api;

  beforeEach(() => {
    jest.resetModules();
    requested = [];
    jest.doMock('../src/api/http', () => ({}), { virtual: true });
    // The client builds URLs; what matters here is which one it builds.
    jest.isolateModules(() => {
      const mod = require('../src/api/client');
      api = mod.api;
    });
    global.fetch = jest.fn((url) => {
      requested.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}'),
        headers: { get: () => 'application/json' },
      });
    });
  });

  const lastPath = () => {
    const url = requested[requested.length - 1] || '';
    const i = url.indexOf('/leaderboard');
    return i === -1 ? url : url.slice(i);
  };

  it('asks for the free board when given no filters', async () => {
    await api.seasonLeaderboard('solo', 'land').catch(() => {});
    const path = lastPath();
    expect(path).toContain('scope=solo');
    expect(path).toContain('category=land');
    // The defaults must not be sent. A shipped build that never heard of these
    // params asks exactly this URL, and the server keys "free" off their
    // absence.
    expect(path).not.toContain('window=');
    expect(path).not.toContain('filter=');
  });

  it('sends the PRO parameters only when they differ from the free board', async () => {
    await api.seasonLeaderboard('solo', 'land', { window: 'season', filter: 'all' }).catch(() => {});
    expect(lastPath()).not.toContain('window=');
    await api.seasonLeaderboard('solo', 'land', { window: 'week', filter: 'pasers' }).catch(() => {});
    expect(lastPath()).toContain('window=week');
    expect(lastPath()).toContain('filter=pasers');
  });

  it('carries a position only for the filter that needs one', async () => {
    await api.seasonLeaderboard('solo', 'land', { filter: 'local', lat: 1.35, lon: 103.8 }).catch(() => {});
    expect(lastPath()).toContain('lat=1.35');
    expect(lastPath()).toContain('lon=103.8');
    await api.seasonLeaderboard('solo', 'land', { filter: 'local' }).catch(() => {});
    // No coordinates to send: the server refuses rather than answering
    // globally under a "near me" heading, which is the behaviour we want.
    expect(lastPath()).not.toContain('lat=');
  });

  it('asks for a standing on the free board with no PRO parameters', async () => {
    await api.myStanding('land').catch(() => {});
    const path = lastPath();
    expect(path).toContain('/leaderboard/standing');
    expect(path).toContain('category=land');
    expect(path).not.toContain('window=');
    expect(path).not.toContain('filter=');
  });
});

describe('useCoarsePosition never prompts', () => {
  it('has no call to any request-permission API', () => {
    // Asserted against the SOURCE rather than by rendering: the failure being
    // guarded against is somebody adding the prompt back, and a hook test
    // would only catch it if the test also happened to render the branch.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'hooks', 'useCoarsePosition.js'),
      'utf8',
    );
    expect(src).not.toMatch(/requestForegroundPermissionsAsync|requestBackgroundPermissionsAsync/);
    expect(src).toMatch(/getForegroundPermissionsAsync/);
  });
});
