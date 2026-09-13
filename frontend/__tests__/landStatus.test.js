/**
 * Your land, in words (src/territory/landStatus.js).
 *
 * The page and the profile card both speak through this module, so these are
 * the rules the runner actually reads: how long a plot has, when it counts as
 * fading, what the line under it says, and where tapping it takes the map.
 *
 * The clock is read against the PHONE's time at render, not frozen at fetch,
 * because the response is cached: a list opened three hours after it was
 * fetched has to say how long each plot has now.
 */

import {
  FADING_HOURS,
  beatFocus,
  beatTitle,
  fmtArea,
  isFading,
  lifeLeft,
  plotDetail,
  plotFocus,
  summaryCells,
  timeLeftLabel,
} from '../src/territory/landStatus';

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);
const H = 60 * 60 * 1000;
const at = (offset) => new Date(NOW + offset).toISOString();
const plot = (leftH, extra = {}) => ({
  expires_at: at(leftH * H),
  claimed_at: at(-24 * H),
  ...extra,
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('how long a plot has', () => {
  test('inside the fading window it names the deadline', () => {
    expect(timeLeftLabel(plot(20.5))).toBe('Fades in 20h');
    expect(timeLeftLabel(plot(0.5))).toBe('Fades in 30m');
    expect(timeLeftLabel(plot(FADING_HOURS))).toBe(`Fades in ${FADING_HOURS}h`);
  });

  test('outside it, the time in hand', () => {
    expect(timeLeftLabel(plot(40))).toBe('40h left');
    expect(timeLeftLabel(plot(4.5 * 24))).toBe('4d left');
  });

  test('it floors, so the promise is kept', () => {
    expect(timeLeftLabel(plot(1.99))).toBe('Fades in 1h');
    expect(timeLeftLabel(plot(2.99 * 24))).toBe('2d left');
  });

  test('a plot at or past its clock is fading now', () => {
    expect(timeLeftLabel(plot(0))).toBe('Fading now');
    expect(timeLeftLabel(plot(-2))).toBe('Fading now');
  });

  test('an unknown clock is the placeholder, not a guess', () => {
    expect(timeLeftLabel({})).toBe('·');
  });

  test('a naive server timestamp is read as UTC', () => {
    // Older responses carry no zone. Read as local time on a phone at UTC+8,
    // twenty hours would come out as twenty eight.
    const naive = at(20.5 * H).replace('Z', '');
    expect(timeLeftLabel({ expires_at: naive })).toBe('Fades in 20h');
  });

  test('the window is whatever the server says it is', () => {
    expect(timeLeftLabel(plot(40), { fadingHours: 48 })).toBe('Fades in 40h');
  });
});

describe('fading', () => {
  test('is judged now, not when the response was fetched', () => {
    const p = plot(40, { fading: false });
    expect(isFading(p)).toBe(false);
    expect(isFading(p, { now: NOW + 5 * H })).toBe(true);
  });

  test('falls back to the server flag when there is no clock', () => {
    expect(isFading({ fading: true })).toBe(true);
    expect(isFading({})).toBe(false);
  });
});

describe('life left', () => {
  test('is the share of the clock still to run', () => {
    // Claimed a day ago with a day to go: half.
    expect(lifeLeft(plot(24))).toBeCloseTo(0.5, 5);
  });

  test('never runs below empty', () => {
    expect(lifeLeft(plot(-1))).toBe(0);
  });

  test('takes the server figure when the clock cannot be read', () => {
    expect(lifeLeft({ life_left: 0.3 })).toBe(0.3);
    expect(lifeLeft({})).toBe(0);
  });
});

describe('the line under a plot', () => {
  test('what it has been through comes first, two facts at most', () => {
    expect(plotDetail({ held: 2, reinforcements: 3, club: true })).toBe(
      'Held 2 attacks · Reinforced 3×'
    );
    expect(plotDetail({ held: 1, run_distance_m: 5230 })).toBe(
      'Held 1 attack · From a 5.2 km run'
    );
  });

  test('a quiet plot says where it came from', () => {
    expect(plotDetail({ run_distance_m: 5230, claimed_at: at(-3 * 24 * H) })).toBe(
      'From a 5.2 km run · Claimed 3d ago'
    );
    expect(plotDetail({ claimed_at: at(-2 * H) })).toBe('Claimed 2h ago');
  });
});

describe('the summary', () => {
  test('only goes red when something is about to go', () => {
    const quiet = summaryCells({ fading_plots: 0, held_times: 3, lost_times: 1 });
    expect(quiet.map((c) => c.value)).toEqual([0, 3, 1]);
    expect(quiet.some((c) => c.alarm)).toBe(false);
    expect(summaryCells({ fading_plots: 2 })[0].alarm).toBe(true);
  });

  test('an empty summary is zeros, not a crash', () => {
    expect(summaryCells(undefined).map((c) => c.value)).toEqual([0, 0, 0]);
  });
});

describe('history', () => {
  test('is told in the second person, naming the rival', () => {
    expect(beatTitle({ kind: 'lost', rival_username: 'denise' })).toBe('Lost to denise');
    expect(beatTitle({ kind: 'held', rival_username: 'denise' })).toBe('Held against denise');
    expect(beatTitle({ kind: 'faded' })).toBe('Faded');
  });

  test('still reads when the rival account is gone', () => {
    expect(beatTitle({ kind: 'lost', rival_username: null })).toBe('Lost ground');
    expect(beatTitle({ kind: 'held' })).toBe('Held an attack');
  });
});

describe('the map', () => {
  test('frames the whole plot, not a point on it', () => {
    const focus = plotFocus({ lat: 1.3005, lon: 103.8005, bbox: [103.8, 1.3, 103.801, 1.301] });
    expect(focus).toEqual({
      lat: 1.3005,
      lon: 103.8005,
      ring: [
        [103.8, 1.3],
        [103.801, 1.3],
        [103.801, 1.301],
        [103.8, 1.301],
      ],
    });
  });

  test('falls back to the point, and to nothing', () => {
    expect(plotFocus({ lat: 1.3, lon: 103.8, bbox: [] })).toEqual({ lat: 1.3, lon: 103.8 });
    expect(plotFocus({ bbox: [] })).toBeNull();
    expect(beatFocus({ lat: 1.3, lon: 103.8 })).toEqual({ lat: 1.3, lon: 103.8 });
    expect(beatFocus({ lat: null, lon: null })).toBeNull();
  });
});

test('land uses the one unit the app uses everywhere', () => {
  expect(fmtArea(12000)).toBe('0.012 km²');
  expect(fmtArea(250000)).toBe('0.25 km²');
});

test('nothing this module says contains a dash', () => {
  // House rule: no em dash, en dash or hyphen in anything a runner reads.
  const said = [
    timeLeftLabel(plot(20.5)),
    timeLeftLabel(plot(40)),
    timeLeftLabel(plot(100)),
    timeLeftLabel(plot(0.5)),
    timeLeftLabel(plot(-1)),
    plotDetail({ held: 2, reinforcements: 1 }),
    plotDetail({ club: true, run_distance_m: 4000, claimed_at: at(-H) }),
    ...summaryCells({}).map((c) => c.label),
    beatTitle({ kind: 'lost' }),
    beatTitle({ kind: 'held', rival_username: 'x' }),
    beatTitle({ kind: 'faded' }),
  ];
  for (const text of said) expect([text, /[-–—]/.test(text)]).toEqual([text, false]);
});
