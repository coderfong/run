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
