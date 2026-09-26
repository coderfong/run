// Resolve hair + headwear pairs through the APP's own code
// (src/config/headwearFit.js), for render.py to draw. The Python side never
// re-implements a rule: it rasterises exactly what the rig would clip.
//
//   node scripts/hair-headwear-qa/resolve.js < pairs.json > resolved.json
//
// stdin: { "pairs": [["hairId", "hatId"], ...] }  (omit for every visible
// hairstyle under every visible headwear item)
// stdout: { catalog: {hair, headwear}, pairs: [{hair, hat, layout, clip}] }
// where `clip` is `resolveHairClip`'s answer in ART fractions of the hair:
// null (draw it all), 'hide', or { hidden: [[ring...]...] } polygons.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..', '..');
const origJs = Module._extensions['.js'];
for (const ext of ['.png', '.webp', '.jpg']) {
  Module._extensions[ext] = (m, f) => { m.exports = path.relative(ROOT, f).split(path.sep).join('/'); };
}
Module._extensions['.js'] = (m, f) => {
  if (f.includes('node_modules')) return origJs(m, f);
  const { code } = babel.transformSync(fs.readFileSync(f, 'utf8'), {
    filename: f, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  m._compile(code, f);
};

const sizeOf = (rel) => {
  // PNG IHDR: width/height at bytes 16..24. Enough for every hair asset.
  const b = fs.readFileSync(path.join(ROOT, rel));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

// The rig's placement constants, evaluated out of CharacterRig.js the way the
// Fit Studio's manifest does, so the hair frame here is the rig's own.
const RIG = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/character/CharacterRig.js'), 'utf8');
  const body = src.slice(src.indexOf('export const BODY_RATIO'), src.indexOf('const SWAP_SPRING')).replace(/^export /gm, '');
  return new Function(`const HAIR_COLORS = [];\n${body}\nreturn { HEAD, LAYOUT, HAIR_LIFT };`)();
})();

// CharacterRig's Layer frame for the hair at bodyW 248 (body art px), then
// its frameInHead(): the box the clip rules are written in.
function hairFrameInHead(layout, size) {
  const spec = { ...RIG.LAYOUT.hair, ...(layout || {}) };
  const w = spec.w * 248;
  const h = (w * size.height) / size.width;
  const top = (spec.cy != null ? spec.cy * 640 - h / 2 : spec.top * 640) + RIG.HAIR_LIFT * 640;
  const left = 124 - w / 2 + (spec.dx || 0) * 248;
  const H = RIG.HEAD;
  return { x: (left - (124 - H.w / 2)) / H.w, y: (top - H.top) / H.h, w: w / H.w, h: h / H.h, px: { left, top, w, h } };
}

// The same for the hat's front art (no hair lift), for the sky rule.
function hatFrameInHead(layout, size) {
  const spec = { ...RIG.LAYOUT.headwear, ...(layout || {}) };
  const w = spec.w * 248;
  const h = (w * size.height) / size.width;
  const top = spec.cy != null ? spec.cy * 640 - h / 2 : spec.top * 640;
  const left = 124 - w / 2 + (spec.dx || 0) * 248;
  const H = RIG.HEAD;
  return { x: (left - (124 - H.w / 2)) / H.w, y: (top - H.top) / H.h, w: w / H.w, h: h / H.h };
}

const c = require('../../src/config/cosmetics.js');
// --legacy: the committed (HEAD) headwearFit.js, for before/after sheets. It
// has no features, so its answer is the cover or the measured notch as-is.
const LEGACY = process.argv.includes('--legacy');
const fit = LEGACY ? loadLegacy() : require('../../src/config/headwearFit.js');

function loadLegacy() {
  const { execSync } = require('child_process');
  const src = execSync('git show HEAD:frontend/src/config/headwearFit.js', { cwd: ROOT, encoding: 'utf8' });
  const tmp = path.join(ROOT, 'src/config/.headwearFit.legacy-qa.js');
  fs.writeFileSync(tmp, src);
  try {
    const mod = require(tmp);
    const notch = (o) => [[o.edgeX0, -3], [o.edgeX0, o.revealY], [o.crownX0, o.crownY], [o.crownX1, o.crownY], [o.edgeX1, o.revealY], [o.edgeX1, -3]];
    return {
      ...mod,
      getHeadwearFamily: (h) => (h && h.id !== 'none' ? `was ${mod.getHeadwearCategory(h)}` : null),
      resolveHairClip(hat, hair, f) {
        const o = mod.getHairOcclusion(hat, hair);
        if (!o) return null;
        if (o.hide) return 'hide';
        const base = o.cover || [notch(o)];
        const rings = base.map((r) => r.map(([x, y]) => [(x - f.x) / f.w, (y - f.y) / f.h]));
        return rings.length ? { rings } : null;
      },
    };
  } finally {
    fs.unlinkSync(tmp);
  }
}
const { HIDDEN_IDS } = require('../../src/config/hiddenCosmetics.js');
const hidden = new Set(HIDDEN_IDS);

const art = (it) => it.img || (it.art && it.art[1]) || (it.art && it.art[0]) || null;
const input = (() => {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
})();
const visible = (slot) => c.ITEMS[slot].filter((it) => it.id !== 'none' && !hidden.has(it.id));
const pairs = input.pairs || visible('hair').flatMap((h) => visible('headwear').map((w) => [h.id, w.id]));

const out = pairs.map(([hairId, hatId]) => {
  const hair = c.getItem('hair', hairId);
  const hat = c.getItem('headwear', hatId);
  const layout = fit.getHairLayout(hat, hair);
  const src = art(hair);
  const frame = src ? hairFrameInHead(layout, sizeOf(src)) : null;
  const hatSrc = hat.id !== 'none' ? (hat.img || (hat.art && hat.art[0])) : null;
  const hatFrame = hatSrc ? hatFrameInHead(hat.layout, sizeOf(hatSrc)) : null;
  return {
    hair: hairId,
    hat: hatId,
    layout,
    family: fit.getHeadwearFamily(hat),
    frame: frame && frame.px,
    clip: frame ? fit.resolveHairClip(hat, hair, frame, hatFrame) : null,
  };
});

const pick = (it) => ({ id: it.id, label: it.label, layout: it.layout || null, img: it.img || null, art: it.art || null, backImg: it.backImg || null, z: it.z || null });
process.stdout.write(JSON.stringify({
  head: RIG.HEAD,
  layout: RIG.LAYOUT,
  catalog: { hair: c.ITEMS.hair.map(pick), headwear: c.ITEMS.headwear.map(pick), hidden: [...hidden] },
  pairs: out,
}));
