/**
 * The main tabs are a swipeable pager whose other three tabs are built once the
 * app is idle, and no tab is ever frozen or detached.
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

  it('builds the other tabs once the app is idle, not at launch and not on first visit', () => {
    expect(mainTabs).toMatch(/useState\(0\)/);
    expect(mainTabs).toMatch(/InteractionManager\.runAfterInteractions/);
    expect(mainTabs).toMatch(/setPreloadDistance\(3\)/);
    expect(mainTabs).toMatch(/lazyPreloadDistance: preloadDistance/);
  });

  it('never freezes or detaches a tab', () => {
    expect(mainTabs).not.toMatch(/freezeOnBlur/);
    expect(mainTabs).not.toMatch(/detachInactiveScreens/);
  });
});
