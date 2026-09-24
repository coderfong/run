// Every push the backend sends carries `data.screen` (+ what that screen needs
// to land on the right thing). One module turns that into a navigation action,
// shared by the warm tap listener, the cold-start handler, and a tapped inbox
// row — so a capture opens the same place however the runner got to it.

import { targetForNotification, routeNotification } from '../src/notifications/route';

describe('targetForNotification', () => {
  test('a capture on your land opens the map, fitted to the ground', () => {
    const [route, params] = targetForNotification({
      category: 'stolen',
      screen: 'map',
      lat: 1.3,
      lon: 103.8,
      territory_ring: [
        [103.8, 1.3],
        [103.81, 1.3],
        [103.81, 1.31],
      ],
    });
    expect(route).toBe('Tabs');
    expect(params.screen).toBe('Map');
    expect(params.params).toEqual({
      screen: 'MapMain',
      params: { focus: { lat: 1.3, lon: 103.8, ring: expect.any(Array) } },
    });
  });

  test('a defense that held also opens the map', () => {
    const [, params] = targetForNotification({ category: 'defended', screen: 'map', lat: 1, lon: 2 });
    expect(params.screen).toBe('Map');
    expect(params.params.params.focus).toMatchObject({ lat: 1, lon: 2 });
  });

  test('a comment on your run opens that run with comments focused', () => {
    const [route, params] = targetForNotification({
      category: 'kudos',
      screen: 'run',
      kind: 'run_comment',
      run_id: 'run-42',
    });
    expect(route).toBe('Tabs');
    expect(params.screen).toBe('Home');
    expect(params.params).toEqual({
      screen: 'RunDetail',
      params: { runId: 'run-42', focusComments: true },
      initial: false,
    });
  });

  test('kudos with no run id falls back to the inbox rather than a dead tap', () => {
    const [, params] = targetForNotification({ category: 'kudos', screen: 'run' });
    expect(params.params.screen).toBe('Notifications');
  });

  test('a club join request opens the club', () => {
    const [, params] = targetForNotification({ category: 'clan_goal', screen: 'club' });
    expect(params.screen).toBe('Club');
  });

  test('a paser request opens Pasers with Home underneath', () => {
    const [, params] = targetForNotification({ screen: 'pasers' });
    expect(params.screen).toBe('Home');
    expect(params.params).toEqual({ screen: 'Pasers', initial: false });
  });

  test('crossed paths opens the plaza', () => {
    const [, params] = targetForNotification({ category: 'paserby', kind: 'paserby_arrival' });
    expect(params.params.screen).toBe('Crossroads');
  });

  test('the weekly recap opens home', () => {
    const [, params] = targetForNotification({ category: 'recap', screen: 'home' });
    expect(params.params.screen).toBe('HomeMain');
  });

  test('a streak reminder opens the run recorder', () => {
    expect(targetForNotification({ category: 'reminder', screen: 'record' })).toEqual(['Record']);
  });

  test('an unknown payload still goes somewhere — the inbox', () => {
    const [route, params] = targetForNotification({});
    expect(route).toBe('Tabs');
    expect(params.params.screen).toBe('Notifications');
  });

  test('older payloads with no screen route by category', () => {
    const [, params] = targetForNotification({ category: 'stolen', lat: 5, lon: 6 });
    expect(params.screen).toBe('Map');
  });
});

describe('routeNotification', () => {
  test('no-ops until the navigator is ready, then navigates', () => {
    const nav = { isReady: () => false, navigate: jest.fn() };
    expect(routeNotification(nav, { screen: 'home' })).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();

    nav.isReady = () => true;
    expect(routeNotification(nav, { screen: 'home' })).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('Tabs', expect.objectContaining({ screen: 'Home' }));
  });
});
