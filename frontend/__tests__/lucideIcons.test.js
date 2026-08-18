// Every lucide icon the app imports has to actually exist.
//
// `import { Instagram } from 'lucide-react-native'` compiled, bundled and
// shipped — lucide v1 had dropped its brand icons, so the name resolved to
// `undefined`, and the share screen died the moment that element was created.
// A named import of something a package does not export is not a build error
// in this toolchain: it is a runtime crash on whichever screen renders it,
// found only by whoever opens that screen.
//
// So: read every lucide import in the source, and check the package really
// exports it. One test, the whole app, no rendering required.

import fs from 'fs';
import path from 'path';

import * as lucide from 'lucide-react-native';

const SRC = path.join(__dirname, '..', 'src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

// Only the `import { A, B } from 'lucide-react-native'` form, which is the one
// the app uses everywhere.
const IMPORTS = /import\s*\{([^}]*)\}\s*from\s*'lucide-react-native'/g;

// The scan is textual, so comments have to go first — RunShareSheet.js quotes
// the broken import in the comment explaining it, and that quote is not code.
// LINE COMMENTS FIRST, then block comments — the order is load-bearing.
//
// Done the other way round, a `//` comment that happens to contain `/*` opens
// a block comment as far as this scan is concerned, and everything up to the
// next `*/` in the file disappears. That is not hypothetical: the onboarding
// screen's header says `assets/art/*`, which swallowed its own import line and
// quietly excluded the file from the scan.
const withoutComments = (source) =>
  source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function importedIcons() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    let match;
    while ((match = IMPORTS.exec(source))) {
      for (const clause of match[1].split(',')) {
        const name = clause.trim().split(/\s+as\s+/)[0];
        if (name) found.push({ name, file: path.relative(SRC, file) });
      }
    }
  }
  return found;
}

describe('lucide icon imports', () => {
  test('every icon the app imports is exported by the installed lucide', () => {
    const missing = importedIcons()
      .filter(({ name }) => lucide[name] == null)
      .map(({ name, file }) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });

  test('the app imports at least one icon, so the scan is really looking', () => {
    // Guards against the regex quietly matching nothing after a refactor and
    // this file passing on an empty list forever.
    expect(importedIcons().length).toBeGreaterThan(20);
  });
});
