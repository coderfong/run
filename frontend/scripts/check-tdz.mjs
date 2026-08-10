// Temporal-dead-zone guard for React component bodies.
//
// WHY. `ResultScreen` computed a derived value from `energyStatus` forty lines
// above the `useState` that declares it:
//
//     const claimCost = options?.placements?.[i]?.energy_cost
//                    ?? energyStatus?.claim_cost ?? null;   // line 301
//     ...
//     const [energyStatus, setEnergyStatus] = useState(null);   // line 347
//
// A `const` is in its temporal dead zone until its own declaration runs, and
// optional chaining does NOT save you — `energyStatus?.x` still touches the
// binding. On the first render `options` was null, so the `??` fell through to
// the dead binding and threw `ReferenceError: Cannot access 'energyStatus'
// before initialization`. That is the post-run result screen, i.e. the payoff
// for every run in the app, and it is invisible to linters that only check for
// undefined globals.
//
// This walks every component body and flags a read of a const/let binding that
// appears earlier in the source than its declaration, ignoring reads inside
// nested functions (those run later, so they are legal and extremely common).
//
//   node scripts/check-tdz.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', 'src');

const findings = [];
let scanned = 0;

function scan(file) {
  const src = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(src, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (e) {
    findings.push({ file, line: e.loc?.line ?? 0, name: '(parse error)', message: e.message });
    return;
  }
  scanned += 1;

  traverse(ast, {
    // Every function body is its own straight-line region.
    Scopable(fnPath) {
      if (!fnPath.isFunction() && !fnPath.isProgram()) return;
      const bindings = fnPath.scope.bindings;
      for (const [name, binding] of Object.entries(bindings)) {
        if (binding.kind !== 'const' && binding.kind !== 'let') continue;
        const declStart = binding.path.node.start;
        if (declStart == null) continue;
        const declLine = binding.path.node.loc?.start.line ?? 0;
        for (const ref of binding.referencePaths) {
          if (ref.node.start == null || ref.node.start >= declStart) continue;
          // Babel reports the binding's own identifier (and, for `export const
          // X`, the export clause) as a reference sitting fractionally before
          // the declarator. Those are artifacts, and they are always on the
          // declaration's own line — a real dead-zone read is code written
          // above the declaration, never beside it.
          if ((ref.node.loc?.start.line ?? 0) >= declLine) continue;
          // A read inside a NESTED function runs later — legal, and the normal
          // way callbacks close over state.
          let p = ref.parentPath;
          let nested = false;
          while (p && p.node !== fnPath.node) {
            if (p.isFunction()) {
              nested = true;
              break;
            }
            p = p.parentPath;
          }
          if (nested) continue;
          findings.push({
            file,
            line: ref.node.loc?.start.line ?? 0,
            name,
            message: `read on line ${ref.node.loc?.start.line} but declared on line ${
              binding.path.node.loc?.start.line
            } — temporal dead zone`,
          });
        }
      }
    },
  });
}

for await (const entry of glob('**/*.js', { cwd: ROOT })) {
  scan(path.join(ROOT, entry));
}

console.log(`temporal-dead-zone scan — ${scanned} files under src/`);
if (findings.length) {
  for (const f of findings) {
    console.error(`  FAIL ${path.relative(path.join(here, '..'), f.file)}: ${f.name} — ${f.message}`);
  }
  console.log(`\n${findings.length} finding(s)`);
  process.exit(1);
}
console.log('no use-before-declaration in any component body');
