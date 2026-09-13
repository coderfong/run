/**
 * Start belongs on the wrist even when the phone is on Home, Map, Club or You.
 * App.js is too large to mount here, so these source tripwires pin the bridge:
 * the app-level listener opens Record, and Record consumes the fresh command
 * through the same startRun function as the phone button.
 */

import fs from 'fs';
import path from 'path';

const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const running = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'screens', 'RunningScreen.js'),
  'utf8'
);

describe('watch initiated run', () => {
  it('offers Start throughout the active signed-in app and opens Record', () => {
    expect(app).toMatch(/function WatchRunLauncher/);
    expect(app).toMatch(/publishToWatch\(\{ phase: canStart \? WATCH_PHASE\.READY/);
    expect(app).toMatch(/navigationRef\.navigate\('Record', \{ watchStartAt: command\.at \}\)/);
  });

  it('passes the wrist command into RunningScreen', () => {
    expect(app).toMatch(/initialParams=\{\{ watchStartAt \}\}/);
    expect(running).toMatch(/freshWatchStart[\s\S]*await startRun\(\)/);
    expect(running).toMatch(/commandAllowed\([\s\S]*WATCH_PHASE\.READY/);
  });

  it('single-flights finish and save when phone and watch are pressed together', () => {
    expect(running).toMatch(/if \(finishingRef\.current \|\| !isRunningRef\.current\) return/);
    expect(running).toMatch(/if \(savingRef\.current\) return/);
  });
});
