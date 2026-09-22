// Dump the resolved hair + headwear catalogue (ids, flags, layouts, art file
// paths) to JSON so the Python QA compositor (headwear-fit-qa.py) can mirror
// CharacterRig without re-parsing cosmetics.js.
//   node scripts/dump-hair-headwear.js > scripts/qa-headwear-fit/catalog.json
const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
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
const c = require('../src/config/cosmetics.js');
const fit = require('../src/config/headwearFit.js');
const pick = (slot) => c.ITEMS[slot].map((it) => ({
  id: it.id, label: it.label, layout: it.layout || null, z: it.z || null,
  bulky: !!it.bulky, hideHair: !!it.hideHair, hidesBulky: !!it.hidesBulky,
  img: it.img || null, art: it.art || null, backImg: it.backImg || null,
  hairRegions: it.hairRegions || null,
  fit: slot === 'headwear' ? fit.getHeadwearFitProfile(it) : undefined,
}));
process.stdout.write(JSON.stringify({ hair: pick('hair'), headwear: pick('headwear'), glasses: pick('glasses') }, null, 1));
