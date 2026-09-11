/**
 * What the phone tells the watch, and what it lets the watch do.
 *
 * The watch draws what it is sent and nothing else, so these are the rules
 * that decide what a runner sees on the wrist: values formatted exactly as the
 * Run screen formats them, `·` for anything not measured yet, never a dash,
 * and only property list values (WatchConnectivity drops a whole update over
 * one null). And a command is honoured only in the phase it makes sense in,
 * judged when it lands, never on the watch's word.
 */

import { REASON } from '../src/config/economy';
import {
  buildWatchState,
  COMMAND_MAX_AGE_MS,
  commandAllowed,
  EMPTY,
  formatClock,
  formatLand,
  formatPace,
  gpsQuality,
  PHASE,
  sanitizeAccent,
  WATCH_COMMANDS,
  WATCH_PROTOCOL,
  watchStateKey,
} from '../src/watch/watchState';

const NOW = Date.UTC(2026, 8, 11, 7, 0, 0);

const RUNNING = {
  phase: PHASE.RUNNING,
  getElapsedMs: () => 754900,
  distanceM: 3421.6,
  paceSPerKm: 312,
  landM2: 12345,
  accuracyM: 6,
  hint: '',
  accent: '#EC4899',
  countdown: null,
  qualified: true,
  afterRun: null,
};

const isPropertyListValue = (v) =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

describe('buildWatchState', () => {
  it('sends a running snapshot the watch can draw as it is', () => {
    expect(buildWatchState(RUNNING, { seq: 7, nowMs: NOW })).toEqual({
      v: WATCH_PROTOCOL,
      seq: 7,
      sentAt: NOW,
      phase: 'running',
      elapsedS: 754,
      distance: '3.42',
      pace: '5:12',
      land: '0.012',
      gps: 'good',
      hint: '',
      accent: '#ec4899',
      km: 3,
      qualified: true,
      countdown: '',
      notice: '',
      summaryDistance: '',
      summaryTime: '',
    });
  });

  it('carries only property list values, never null or undefined', () => {
    const inputs = [
      RUNNING,
      {},
      { phase: PHASE.IDLE },
      { ...RUNNING, paceSPerKm: null, landM2: null, accuracyM: null, accent: undefined },
      { ...RUNNING, getElapsedMs: () => NaN, distanceM: undefined },
      { phase: PHASE.SAVED, afterRun: { status: PHASE.SAVED, distanceM: 5000, elapsedMs: null } },
    ];
    inputs.forEach((input) => {
      Object.values(buildWatchState(input, { seq: 1, nowMs: NOW })).forEach((value) => {
        expect(isPropertyListValue(value)).toBe(true);
      });
    });
  });

  it('shows the empty mark for pace and land the run has not measured yet', () => {
    const s = buildWatchState({ ...RUNNING, paceSPerKm: null, landM2: null });
    expect(s.pace).toBe(EMPTY);
    expect(s.land).toBe(EMPTY);
  });

  it('keeps the clock at zero outside a run', () => {
    const s = buildWatchState({ ...RUNNING, phase: PHASE.READY });
    expect(s.elapsedS).toBe(0);
    expect(s.pace).toBe(EMPTY);
    expect(s.hint).toBe('');
  });

  it('sends a paused run the elapsed time it is given, frozen by the screen', () => {
    const s = buildWatchState({ ...RUNNING, phase: PHASE.PAUSED, getElapsedMs: () => 60000 });
    expect(s.phase).toBe('paused');
    expect(s.elapsedS).toBe(60);
  });

  it('treats a phase it does not know as idle', () => {
    expect(buildWatchState({ ...RUNNING, phase: 'sprinting' }).phase).toBe('idle');
  });

  it('carries the countdown only while counting down', () => {
    expect(buildWatchState({ phase: PHASE.COUNTDOWN, countdown: 2 }).countdown).toBe('2');
    expect(buildWatchState({ phase: PHASE.COUNTDOWN, countdown: 'GO' }).countdown).toBe('GO');
    expect(buildWatchState({ ...RUNNING, countdown: 'GO' }).countdown).toBe('');
  });

  it('summarises the run once it has ended', () => {
    const s = buildWatchState({
      phase: PHASE.SAVED,
      afterRun: { status: PHASE.SAVED, distanceM: 5432.7, elapsedMs: 1865000 },
    });
    expect(s.summaryDistance).toBe('5.43');
    expect(s.summaryTime).toBe('31:05');
  });

  it('carries a notice with no summary for a run too short to save', () => {
    const s = buildWatchState({
      phase: PHASE.READY,
      afterRun: { status: PHASE.READY, notice: 'Too short to save. Move around first.' },
    });
    expect(s.notice).toBe('Too short to save. Move around first.');
    expect(s.summaryDistance).toBe('');
  });

  it('never puts a dash in front of the runner', () => {
    const hints = Object.values(REASON);
    const states = [
      ...hints.map((hint) => buildWatchState({ ...RUNNING, hint })),
      buildWatchState({ ...RUNNING, paceSPerKm: null, landM2: null, accuracyM: null }),
      buildWatchState({ phase: PHASE.SAVED, afterRun: { distanceM: 12000, elapsedMs: 4000000 } }),
    ];
    states.forEach((s) => {
      Object.values(s)
        .filter((v) => typeof v === 'string')
        .forEach((v) => {
          expect(v).not.toMatch(/[–—]/);
          expect(v).not.toMatch(/[A-Za-z]-[A-Za-z]/);
        });
    });
  });
});

describe('formatting matches the Run screen', () => {
  it('rounds pace and carries a whole minute', () => {
    expect(formatPace(312)).toBe('5:12');
    expect(formatPace(359.6)).toBe('6:00');
    expect(formatPace(0)).toBe(EMPTY);
    expect(formatPace(undefined)).toBe(EMPTY);
  });

  it('prints land to three places below 0.1 km² and two above', () => {
    expect(formatLand(12345)).toBe('0.012');
    expect(formatLand(150000)).toBe('0.15');
    expect(formatLand(null)).toBe(EMPTY);
  });

  it('prints the clock as mm:ss, and h:mm:ss past the hour', () => {
    expect(formatClock(65000)).toBe('01:05');
    expect(formatClock(3725000)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('gpsQuality', () => {
  it('uses the Run screen thresholds', () => {
    expect(gpsQuality(null)).toBe('none');
    expect(gpsQuality(5)).toBe('good');
    expect(gpsQuality(15)).toBe('ok');
    expect(gpsQuality(40)).toBe('poor');
  });
});

describe('sanitizeAccent', () => {
  it('hands the watch plain lowercase #rrggbb', () => {
    expect(sanitizeAccent('#EC4899')).toBe('#ec4899');
    expect(sanitizeAccent('#abc')).toBe('#aabbcc');
    expect(sanitizeAccent('#ec489980')).toBe('#ec4899');
  });

  it('falls back to brand pink for anything else', () => {
    expect(sanitizeAccent('rgba(1,2,3,0.5)')).toBe('#ec4899');
    expect(sanitizeAccent(undefined)).toBe('#ec4899');
  });
});

describe('commandAllowed', () => {
  const at = NOW - 500;
  const allowedIn = (cmd) =>
    Object.values(PHASE).filter((phase) => commandAllowed({ cmd, at }, phase, NOW));

  it('honours each command only in the phase it makes sense in', () => {
    expect(allowedIn('start')).toEqual(['ready']);
    expect(allowedIn('pause')).toEqual(['running']);
    expect(allowedIn('resume')).toEqual(['paused']);
    expect(allowedIn('finish')).toEqual(['running', 'paused']);
  });

  it('knows exactly four commands', () => {
    expect(WATCH_COMMANDS).toEqual(['start', 'pause', 'resume', 'finish']);
    ['sync', 'constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach((cmd) => {
      Object.values(PHASE).forEach((phase) => {
        expect(commandAllowed({ cmd, at }, phase, NOW)).toBe(false);
      });
    });
  });

  it('ignores a stale press, and one with no time on it', () => {
    const stale = NOW - COMMAND_MAX_AGE_MS - 1;
    expect(commandAllowed({ cmd: 'finish', at: stale }, PHASE.RUNNING, NOW)).toBe(false);
    expect(commandAllowed({ cmd: 'finish', at: NOW + COMMAND_MAX_AGE_MS + 1 }, PHASE.RUNNING, NOW)).toBe(false);
    expect(commandAllowed({ cmd: 'finish' }, PHASE.RUNNING, NOW)).toBe(false);
    expect(commandAllowed(null, PHASE.RUNNING, NOW)).toBe(false);
  });
});

describe('watchStateKey', () => {
  it('ignores the clock and the envelope, and changes with what is shown', () => {
    const a = buildWatchState(RUNNING, { seq: 1, nowMs: NOW });
    const b = buildWatchState({ ...RUNNING, getElapsedMs: () => 999000 }, { seq: 2, nowMs: NOW + 5 });
    const c = buildWatchState({ ...RUNNING, distanceM: 3500 }, { seq: 3, nowMs: NOW });
    expect(watchStateKey(a)).toBe(watchStateKey(b));
    expect(watchStateKey(a)).not.toBe(watchStateKey(c));
  });
});
