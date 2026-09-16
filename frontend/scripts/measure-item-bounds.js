// Measure where each cosmetic's DRAWING sits inside its canvas, so a reward
// tile can fit the drawing instead of the canvas.
//
//   node scripts/measure-item-bounds.js        (run from frontend/)
//
// Writes src/config/itemInkBounds.json: "<slot>:<id>" -> [x0, y0, x1, y1], the
// drawing's box as fractions of the SQUARE that PartThumb draws the art into
// with `contain`. Front and back layers are measured separately and united,
// because PartThumb stacks the back layer under the front.
//
// WHY THIS EXISTS. The art is not drawn to one margin. Some pieces fill their
// canvas edge to edge (o45t is 99% by 100%), some sit in a corner of it (o36t
// occupies the lower left 60%), and a pair of shoes is a wide strip across a
// much taller box. RewardArt used to apply one zoom per slot (1.08x to 1.28x)
// inside a clipping frame. No single number suits all three shapes: it cut the
// edge-to-edge pieces off at the sides and left the corner pieces small and
// off centre. Measuring every drawing once, here, lets every reward tile show
// the whole item at the same size.
//
// Re-run after adding or recutting art. __tests__/itemInkBounds.test.js fails
// when a catalogue item has no entry.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PNG } = require('pngjs');

const FRONT = path.resolve(__dirname, '..');
const OUT = path.join(FRONT, 'src', 'config', 'itemInkBounds.json');

// Alpha at or above this counts as drawing. Some cuts carry faint specks left
// behind by background removal (ofB383 has them across its whole canvas, all
// under alpha 20). They cannot be seen on screen and must not stretch the box.
const ALPHA = 64;
// An edge row or column of the box needs at least this share of opaque pixels
// to count, so a stray speck outside the drawing cannot widen it either.
const EDGE_SHARE = 0.005;

// ---------------------------------------------------------------------------
// Load the catalogue the way the app resolves it. cosmetics.js is an ES module
// that pushes outfitItems.js and hairSheetItems.js into ITEMS, so it has to be
// EVALUATED, not parsed. Imports are rewritten to require(), and every image
// require() is stubbed to the file it names.
// ---------------------------------------------------------------------------

const cache = new Map();

function loadModule(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  let src = fs.readFileSync(file, 'utf8');
  const fnExports = [];
  src = src.replace(/^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?/gm, (m, names, spec) => {
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [a, b] = s.split(/\s+as\s+/);
      return b ? `${a}: ${b}` : a;
    });
    return `const { ${parts.join(', ')} } = require(${JSON.stringify(spec)});`;
  });
  src = src.replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/gm,
    (m, name, spec) => `const ${name} = __default(require(${JSON.stringify(spec)}));`);
  src = src.replace(/^import\s+['"][^'"]+['"];?/gm, '');
  src = src.replace(/^export\s+const\s+(\w+)\s*=/gm, (m, name) => `const ${name} = exports.${name} =`);
  src = src.replace(/^export\s+(?:async\s+)?function\s+(\w+)/gm, (m, name) => {
    fnExports.push(name);
    return m.replace(/^export\s+/, '');
  });
  src = src.replace(/^export\s+default\s+/gm, 'exports.default = ');
  src += `\n${fnExports.map((n) => `exports.${n} = ${n};`).join('\n')}`;
  const dir = path.dirname(file);
  const req = (spec) => {
    if (/\.(png|jpe?g|webp|gif)$/i.test(spec)) return { __asset: path.resolve(dir, spec) };
    if (spec.endsWith('.json')) return JSON.parse(fs.readFileSync(path.resolve(dir, spec), 'utf8'));
    if (spec.startsWith('.')) {
      const p = path.resolve(dir, spec);
      for (const ext of ['', '.js', '/index.js']) {
        if (fs.existsSync(p + ext) && fs.statSync(p + ext).isFile()) return loadModule(p + ext);
      }
      throw new Error(`cannot resolve ${spec} from ${file}`);
    }
    // A package import (react-native, the theme's fonts...). The catalogue
    // only needs it to exist, never to work.
    return new Proxy({}, { get: (t, k) => (k === '__esModule' ? false : () => ({})) });
  };
  const fn = vm.runInThisContext(
    `(function (exports, require, module, __default) {\n${src}\n})`,
    { filename: file }
  );
  fn(mod.exports, req, mod, (m) => (m && m.default !== undefined ? m.default : m));
  return mod.exports;
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

function measure(file) {
  const { width: W, height: H, data } = PNG.sync.read(fs.readFileSync(file));
  const rows = new Uint32Array(H);
  const cols = new Uint32Array(W);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (data[(y * W + x) * 4 + 3] >= ALPHA) {
        rows[y] += 1;
        cols[x] += 1;
      }
    }
  }
  const minRow = Math.max(2, Math.round(W * EDGE_SHARE));
  const minCol = Math.max(2, Math.round(H * EDGE_SHARE));
  let y0 = 0;
  while (y0 < H && rows[y0] < minRow) y0 += 1;
  let y1 = H - 1;
  while (y1 > y0 && rows[y1] < minRow) y1 -= 1;
  let x0 = 0;
  while (x0 < W && cols[x0] < minCol) x0 += 1;
  let x1 = W - 1;
  while (x1 > x0 && cols[x1] < minCol) x1 -= 1;
  if (y0 >= H || x0 >= W) return null;
  return { W, H, x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// Canvas pixels -> fractions of the square `contain` centres the canvas in.
function inSquare(m) {
  const side = Math.max(m.W, m.H);
  const ox = (side - m.W) / 2;
  const oy = (side - m.H) / 2;
  return [(ox + m.x0) / side, (oy + m.y0) / side, (ox + m.x1) / side, (oy + m.y1) / side];
}

const round = (v) => Math.round(v * 10000) / 10000;

const cos = loadModule(path.join(FRONT, 'src', 'config', 'cosmetics.js'));
const assetFile = (a) => (a && a.__asset ? a.__asset : null);

const out = {};
const unmeasured = [];
let measured = 0;
for (const [slot, list] of Object.entries(cos.ITEMS)) {
  // Faces are drawn on PartThumb's own head disc, not fitted to a box.
  if (slot === 'face') continue;
  for (const item of list) {
    if (!item || item.id === 'none') continue;
    // The same two images PartThumb shows when it has no loadout to read.
    // Hair colour variants are recolours of one drawing, so the first stands
    // for all of them.
    const layers = [cos.itemPreviewImage(slot, item), cos.itemBackImage(slot, item, null)]
      .map(assetFile)
      .filter(Boolean);
    const boxes = layers.map(measure).filter(Boolean).map(inSquare);
    if (!boxes.length) {
      unmeasured.push(`${slot}:${item.id}`);
      continue;
    }
    out[`${slot}:${item.id}`] = [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ].map(round);
    measured += 1;
  }
}

// One entry per line, sorted, so a recut shows up as a one line diff.
const body = Object.keys(out)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: [${out[k].join(', ')}]`)
  .join(',\n');
fs.writeFileSync(OUT, `{\n${body}\n}\n`);

console.log(`measured ${measured} items -> ${path.relative(FRONT, OUT)}`);
if (unmeasured.length) {
  console.log(`no art found for ${unmeasured.length}: ${unmeasured.join(', ')}`);
  process.exitCode = 1;
}
