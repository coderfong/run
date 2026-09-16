/**
 * The main tabs are a swipeable pager whose other three tabs are built once the
 * app is idle, one at a time, and no tab is ever frozen or detached.
 *
 * This has been "fixed" the wrong way twice, both times as a side effect of a
 * change about something else, and both times nothing failed:
 *
 *   build 66  mounted each tab strictly on its first visit (a preload distance
 *             of 0), so the first swipe to a tab, Map's GL context included,
 *             was a mount inside the swipe gesture.
 *   build 68  swapped the pager for native bottom tabs with freezeOnBlur and
 *             detachInactiveScreens. A frozen tab is suspended, React hides
 *             suspended content with display: none, and Fabric does not mount
 *             a display: none subtree, so every tab switch tore down one
 *             screen's native views and built another's. The swipe went too.
 *
 * Changed ON PURPOSE on 2026-09-15: the idle preload used to jump from zero to
 * three, which built Map, Club and You in a single commit, the longest freeze
 * in the app. It now climbs one tab per step (see App.js). Still after launch,
 * still every tab, still never inside a gesture.
 *
 * App.js is too big to mount here, so this reads the navigator's source. It is
 * a tripwire, not a spec: if the tabs change on purpose, change this with them
 * and say why in App.js.
 */

import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const start = source.indexOf('function MainTabs()');
const end = source.indexOf('// --- record modal');
const mainTabs = source.slice(start, end);

describe('the main tab navigator', () => {
  it('can be found', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('is the swipeable material top-tab pager', () => {
    expect(source).toMatch(/const Tab = createMaterialTopTabNavigator\(\)/);
    expect(source).not.toMatch(/createBottomTabNavigator/);
    expect(mainTabs).toMatch(/swipeEnabled: true/);
    expect(mainTabs).toMatch(/tabBarPosition="bottom"/);
  });

  it('builds the other tabs once the app is idle, one per step, not at launch and not on first visit', () => {
    expect(mainTabs).toMatch(/useState\(0\)/);
    expect(mainTabs).toMatch(/InteractionManager\.runAfterInteractions/);
    // Climbs 1, 2, 3. Never a single commit that builds three tabs at once.
    expect(mainTabs).toMatch(/step\(1\)/);
    expect(mainTabs).toMatch(/setPreloadDistance\(distance\)/);
    expect(mainTabs).toMatch(/distance < 3/);
    expect(mainTabs).not.toMatch(/setPreloadDistance\(3\)/);
    expect(mainTabs).toMatch(/lazyPreloadDistance: preloadDistance/);
  });

  it('never freezes or detaches a tab', () => {
    expect(mainTabs).not.toMatch(/freezeOnBlur/);
    expect(mainTabs).not.toMatch(/detachInactiveScreens/);
  });
});
