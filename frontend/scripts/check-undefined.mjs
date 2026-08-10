// Free-variable scan: identifiers referenced with nothing declaring them.
//
// THE BUG THIS EXISTS FOR. `FeedCard` used `styles.kudosSlot` while the only
// `const styles = useThemedStyles(makeStyles)` in the file sat inside a
// different component. The file had been moved to themed styles and one of the
// two components was missed. Every feed row therefore threw
// `ReferenceError: styles is not defined`, the per-tab ErrorBoundary turned
// that into "Something went wrong" on Home, and the stack went to Sentry and
// nowhere a developer would look. An empty feed rendered fine, so it presented
// as intermittent.
//
// `check-tdz.mjs` does NOT catch this: that one looks for use-BEFORE-declaration
// inside a component body, and here there is no declaration at all. Nor does
// jest, unless a test happens to render the exact subtree — the crash lives in
// one branch of one component.
//
//   node scripts/check-undefined.mjs
//
// A hit is either a genuine missing declaration or a global this script has
// not been told about; add real globals to KNOWN below rather than silencing
// the file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default ?? _traverse;
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const KNOWN = new Set([
  // JS + platform globals that legitimately appear unbound in a module.
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  'Promise', 'Math', 'Number', 'String', 'Object', 'Array', 'JSON', 'Date',
  'Boolean', 'Error', 'TypeError', 'RangeError', 'RegExp', 'Symbol', 'Proxy',
  'Reflect', 'Set', 'Map', 'WeakMap', 'WeakSet', 'BigInt', 'Intl',
  'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'NaN', 'Infinity', 'undefined',
  'globalThis', 'global', 'structuredClone',
  'fetch', 'AbortController', 'URL', 'URLSearchParams', 'FormData', 'Blob',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'performance',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'ArrayBuffer', 'Uint8Array', 'Float32Array', 'DataView',
  // React Native / Expo / bundler.
  'require', 'module', 'exports', '__DEV__', 'process',
]);

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = jsFiles(SRC);
const hits = [];

for (const file of files) {
  let ast;
  try {
    ast = parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (e) {
    hits.push({ file, line: 0, name: `PARSE FAILED: ${e.message}` });
    continue;
  }

  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (KNOWN.has(name)) return;
      // `hasBinding(name, true)` walks out to the program scope.
      if (p.scope.hasBinding(name, true)) return;
      // <div>, <View> — a lowercase JSX name is a host element, not a binding.
      const parent = p.parentPath;
      if (
        (parent.isJSXOpeningElement() || parent.isJSXClosingElement()) &&
        /^[a-z]/.test(name)
      ) {
        return;
      }
      hits.push({ file, line: p.node.loc.start.line, name });
    },
  });
}

const rel = (f) => path.relative(path.join(SRC, '..'), f).replace(/\\/g, '/');
console.log(`free-variable scan — ${files.length} files under src/`);
if (!hits.length) {
  console.log('no undefined references');
  process.exit(0);
}
for (const h of hits) console.log(`  ${rel(h.file)}:${h.line}  ${h.name}`);
console.log(`\n${hits.length} undefined reference(s)`);
process.exit(1);
