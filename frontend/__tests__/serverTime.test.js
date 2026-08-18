// The "8h ago on a run you just finished" regression.
import { parseServerDate, timeAgo, sinceServer } from '../src/utils/time';

describe('server timestamps', () => {
  test('a zoneless server string is read as UTC, not local', () => {
    // The exact shape the API sends for a naive utcnow() column.
    const utcNoon = parseServerDate('2026-08-18T12:00:00');
    expect(utcNoon.toISOString()).toBe('2026-08-18T12:00:00.000Z');
  });

  test('an explicit zone is respected rather than double-stamped', () => {
    expect(parseServerDate('2026-08-18T12:00:00Z').toISOString())
      .toBe('2026-08-18T12:00:00.000Z');
    expect(parseServerDate('2026-08-18T20:00:00+08:00').toISOString())
      .toBe('2026-08-18T12:00:00.000Z');
  });

  test('microseconds from Postgres survive the parse', () => {
    expect(parseServerDate('2026-08-18T12:00:00.123456').toISOString())
      .toBe('2026-08-18T12:00:00.123Z');
  });

  test('a run that just ended reads as just now, whatever the device offset', () => {
    const nowUtcNaive = new Date().toISOString().replace('Z', '');
    expect(timeAgo(nowUtcNaive)).toBe('just now');
  });

  test('ages are measured from the real instant', () => {
    const threeHours = new Date(Date.now() - 3 * 3600 * 1000)
      .toISOString()
      .replace('Z', '');
    expect(timeAgo(threeHours)).toBe('3h ago');
  });

  test('a clock skewed slightly into the future is still just now', () => {
    const ahead = new Date(Date.now() + 4000).toISOString().replace('Z', '');
    expect(timeAgo(ahead)).toBe('just now');
    expect(sinceServer(ahead)).toBeLessThanOrEqual(0);
  });

  test('missing and malformed values degrade to the empty glyph', () => {
    expect(timeAgo(null)).toBe('·');
    expect(timeAgo('not a date')).toBe('·');
  });
});
