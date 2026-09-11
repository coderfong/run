/**
 * Fixes recorded while a run is paused never reach the trail. With PASER on
 * a watch the background task keeps recording through a pause, so the drain
 * has to drop exactly the paused stretches: nothing before, nothing after.
 */

import { inPause, withoutPausedPoints } from '../src/run/pauseWindows';

const pts = (...ts) => ts.map((timestamp) => ({ latitude: 1.3, longitude: 103.8, timestamp }));

describe('withoutPausedPoints', () => {
  it('passes every point through when there has been no pause', () => {
    const points = pts(1, 2, 3);
    expect(withoutPausedPoints(points, [])).toBe(points);
  });

  it('drops a closed pause, start inclusive and end exclusive', () => {
    const out = withoutPausedPoints(pts(90, 100, 150, 199, 200, 250), [{ from: 100, to: 200 }]);
    expect(out.map((p) => p.timestamp)).toEqual([90, 200, 250]);
  });

  it('drops everything after a pause that is still on', () => {
    const out = withoutPausedPoints(pts(90, 100, 5000), [{ from: 100, to: null }]);
    expect(out.map((p) => p.timestamp)).toEqual([90]);
  });

  it('handles several pauses in one run', () => {
    const windows = [
      { from: 10, to: 20 },
      { from: 40, to: 50 },
    ];
    const out = withoutPausedPoints(pts(5, 15, 25, 45, 55), windows);
    expect(out.map((p) => p.timestamp)).toEqual([5, 25, 55]);
    expect(inPause(45, windows)).toBe(true);
    expect(inPause(30, windows)).toBe(false);
  });
});
