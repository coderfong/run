/**
 * The phone (src/watch/watchState.js) and the watch
 * (targets/watch/RunState.swift) speak one protocol from two languages, and
 * nothing compiles them against each other. This does: every field the phone
 * sends is read by the watch and every field the watch reads is sent, the two
 * phase lists and command lists are the same, and the watch app's copy keeps
 * the app's rule of no dashes of any kind.
 */

const fs = require('fs');
const path = require('path');

const { buildWatchState, PHASE, WATCH_COMMANDS } = require('../src/watch/watchState');

const WATCH_DIR = path.join(__dirname, '..', 'targets', 'watch');
const read = (file) => fs.readFileSync(path.join(WATCH_DIR, file), 'utf8');
const watchConfig = require('../targets/watch/expo-target.config');

function enumCases(source, name) {
  const block = source.match(new RegExp(`enum ${name}: String \\{([\\s\\S]*?)\\}`));
  if (!block) throw new Error(`enum ${name} not found`);
  return [...block[1].matchAll(/case (\w+)/g)].map((m) => m[1]);
}

// String literals outside comments. Good enough for the watch app's sources,
// which have no multi line strings.
function stringLiterals(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .match(/"(?:[^"\\\n]|\\.)*"/g) || [];
}

describe('phone and watch protocol', () => {
  const runState = read('RunState.swift');

  it('reads every field the phone sends, and nothing it does not', () => {
    const sent = Object.keys(buildWatchState({}, { seq: 1, nowMs: 1 }))
      // Envelope only: when the phone sent it. The watch orders by seq.
      .filter((key) => key !== 'sentAt')
      .sort();
    const read = [...new Set([...runState.matchAll(/dict\["(\w+)"\]/g)].map((m) => m[1]))].sort();
    expect(read).toEqual(sent);
  });

  it('has the same phases on both sides', () => {
    expect(enumCases(runState, 'RunPhase').sort()).toEqual(Object.values(PHASE).sort());
  });

  it('has the same commands on both sides', () => {
    expect(enumCases(runState, 'RunCommand')).toEqual([...WATCH_COMMANDS]);
  });
});

describe('watch app copy', () => {
  const files = fs.readdirSync(WATCH_DIR).filter((f) => f.endsWith('.swift'));

  it('has Swift sources to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no dashes in its strings', (file) => {
    const offending = stringLiterals(read(file)).filter(
      (s) => /[–—]/.test(s) || /[A-Za-z]-[A-Za-z]/.test(s)
    );
    expect(offending).toEqual([]);
  });
});

describe('watch app compatibility', () => {
  it('remains installable on watchOS 9', () => {
    expect(watchConfig.deploymentTarget).toBe('9.0');
  });

  it('does not use the watchOS 10 only two-argument onChange overload', () => {
    expect(read('RunScreen.swift')).not.toMatch(
      /\.onChange\(of:\s*scenePhase\)\s*\{\s*_,\s*\w+\s+in/
    );
  });
});

describe('the runner portrait', () => {
  const link = read('PhoneLink.swift');
  const store = read('WatchAvatar.swift');

  // A picture is not run state. The state is re-sent on a ten second
  // heartbeat for the length of a run and goes out over a size limited live
  // message, so a base64 portrait riding along with it would be tens of
  // kilobytes on the wire per beat. It travels as its own file transfer.
  it('arrives as a file transfer rather than inside the run state', () => {
    expect(link).toMatch(/didReceive file: WCSessionFile/);
    expect(read('RunState.swift')).not.toMatch(/avatar/i);
  });

  it('asks the phone only for a portrait this watch does not already have', () => {
    expect(link).toMatch(/"cmd": "avatar"/);
    expect(link).toMatch(/"have": WatchAvatarStore\.shared\.key/);
  });

  // The watch records standalone, so it can go a whole run without the phone.
  // The portrait has to survive that, and a relaunch.
  it('keeps the last portrait on this watch', () => {
    expect(store).toMatch(/applicationSupportDirectory/);
    expect(store).toMatch(/UserDefaults/);
  });

  it('draws something in its place rather than a face that is not theirs', () => {
    expect(store).toMatch(/placeholder/);
  });
});

describe('watch screen layout', () => {
  const laidOut = ['RedesignedScreens.swift', 'RunScreen.swift'];

  // A fixed VStack centres what fits and silently cuts off what does not.
  // That is how the Ready screen's own Start button ended up under the curve
  // of the glass on a 40mm, with no way to reach it. WatchScreen scrolls.
  it.each(laidOut)('%s puts every screen in the scrolling container', (file) => {
    const source = read(file);
    const screens = source
      .split(/^struct /m)
      .slice(1)
      .filter((block) => /^\w+(View|Page): View \{/.test(block))
      // The pagers lay out other screens rather than content of their own.
      .filter((block) => !/TabView/.test(block));
    expect(screens.length).toBeGreaterThan(0);
    const loose = screens
      .filter((block) => !/WatchScreen\(/.test(block))
      .map((block) => block.slice(0, block.indexOf(':')));
    expect(loose).toEqual([]);
  });

  // watchOS draws the time over the app. PASER is not in a NavigationStack,
  // so nothing is inset for it and anything at the top of a screen lands
  // underneath it: that is what put the GPS pill and RUN STATS on top of the
  // clock. Reserved once, in the container every screen goes through, and
  // only the part the system's own safe area has not already taken: adding it
  // on top of that doubled the gap and cut the run page off at the bottom.
  it('reserves the strip where watchOS draws the time', () => {
    expect(read('ResponsiveDesign.swift')).toMatch(/static var clockInset/);
    const container = read('WatchDesign.swift');
    expect(container).toMatch(
      /topInset = max\(0, WatchLayout\.clockInset - geo\.safeAreaInsets\.top\)/
    );
    expect(container).toMatch(/\.padding\(\.top, topInset\)/);
  });

  // A pager draws its dots OVER its pages, so a page that does not say it is
  // in one runs its last line under them.
  it('tells every page of a pager that it is in one', () => {
    const source = read('RedesignedScreens.swift');
    const paged = [...source.matchAll(/(\w+)\(\)\.tag\(\d+\)/g)].map((m) => m[1]);
    expect(paged.length).toBeGreaterThan(0);
    const blocks = new Map(
      source
        .split(/^struct /m)
        .slice(1)
        .map((block) => [block.slice(0, block.indexOf(':')), block])
    );
    const loose = paged.filter((name) => !/inPager: true/.test(blocks.get(name) || ''));
    expect(loose).toEqual([]);
  });

  // PASER runs on watches from 136 points wide to 208. Type written in fixed
  // points fits exactly one of them.
  it.each(fs.readdirSync(WATCH_DIR).filter((f) => f.endsWith('.swift')))(
    '%s sizes its type against the screen',
    (file) => {
      expect(read(file)).not.toMatch(/\.font\(\.system\(size: \d/);
    }
  );
});

describe('standalone watch recording', () => {
  const recorder = read('WorkoutManager.swift');
  const plist = read('Info.plist');

  it('records a workout and route on the watch', () => {
    expect(recorder).toMatch(/HKWorkoutSession/);
    expect(recorder).toMatch(/HKLiveWorkoutBuilder/);
    expect(recorder).toMatch(/HKWorkoutRouteBuilder/);
    expect(recorder).toMatch(/CLLocationManager/);
  });

  it('does not require the companion phone app', () => {
    expect(plist).toMatch(/WKRunsIndependentlyOfCompanionApp[\s\S]*?<true\/>/);
    expect(plist).toMatch(/workout-processing/);
    expect(read('RunScreen.swift')).not.toMatch(/out of reach/i);
  });
});
