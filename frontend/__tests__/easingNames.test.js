// Every easing the app names has to actually exist on Reanimated's Easing.
//
// `Easing.out(Easing.quint)` shipped in build 43. Reanimated has no `quint` —
// quintic is `poly(5)` — so `out()` was handed `undefined` and returned a
// worklet that called it. Nothing failed at import, at render, or on mount:
// the callee is only invoked once the timing animation runs its first frame,
// on the UI thread. There, a release build has no error boundary and no call
// guard, so the throw escaped as an uncaught C++ exception and SIGABRT'd the
// process — the app vanished to the home screen with no error, no red box,
// and nothing in Sentry. It took a native patch to even see the message.
//
// A typo'd easing is the same shape of bug as the lucide one next door: a name
// that resolves to `undefined` and only bites on the screen that runs it. So
// the same treatment — read every `Easing.x` in the source, check the real
// module really has it. One test, the whole app, nothing rendered.
//
// Ground truth is read out of Reanimated's own source rather than imported,
// because importing it here would go through the jest mock, and the jest mock
// is exactly what let this ship green in the first place.

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', 'src');
const EASING_SRC = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-reanimated',
  'src',
  'Easing.ts'
);

// The `const EasingObject = { linear, ease, quad, ..., in: in_, out, inOut };`
// literal, which is what `Easing` is exported as.
function realEasingNames() {
  const source = fs.readFileSync(EASING_SRC, 'utf8');
  const literal = /const EasingObject = \{([\s\S]*?)\}/.exec(source);
  if (!literal) throw new Error('could not find EasingObject in Easing.ts');
  return new Set(
    literal[1]
      .split(',')
      .map((entry) => entry.split(':')[0].trim())
      .filter(Boolean)
  );
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

// Textual, so comments go first — this file's own cautionary tale names
// `Easing.quint`, and so does the constant it was replaced by.
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const USES = /\bEasing\.([a-zA-Z_$][\w$]*)/g;

function usedEasings() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    let match;
    while ((match = USES.exec(source))) {
      found.push({ name: match[1], file: path.relative(SRC, file) });
    }
  }
  return found;
}

describe('Easing names', () => {
  test('every easing the app names exists on the installed Reanimated', () => {
    const real = realEasingNames();
    const missing = usedEasings()
      .filter(({ name }) => !real.has(name))
      .map(({ name, file }) => `Easing.${name} (${file})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  test('the scan is really looking', () => {
    // Guards against the regex quietly matching nothing after a refactor, or
    // Reanimated moving Easing.ts, leaving this file passing on empty lists.
    expect(realEasingNames().size).toBeGreaterThan(10);
    expect(usedEasings().length).toBeGreaterThan(50);
  });
});
