const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');
const files = [
  'App.js',
  'src/config/pitStop.js',
  'src/config/onboardingArt.js',
  'src/components/shop/PitStopArt.js',
  'src/components/shop/PitStopCrew.js',
  'src/components/shop/PitStopScene.js',
  'src/components/shop/useShopkeeperState.js',
  'src/screens/ShopScreen.js',
];
let fail = 0;
const localImports = [];
for (const f of files) {
  try {
    const out = babel.transformFileSync(f, { presets: ['babel-preset-expo'], babelrc: false, configFile: false, ast: true });
    console.log('PARSE OK   ' + f);
    const src = fs.readFileSync(f, 'utf8');
    const re = /(?:from\s+|require\()\s*['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) localImports.push([f, m[1]]);
  } catch (e) {
    fail++;
    console.log('PARSE FAIL ' + f + '\n   ' + e.message.split('\n').slice(0,3).join('\n   '));
  }
}
console.log('\n--- local import resolution ---');
const exts = ['', '.js', '.jsx', '.json', '.png', '/index.js'];
for (const [f, spec] of localImports) {
  const base = path.resolve(path.dirname(f), spec);
  const hit = exts.some((e) => fs.existsSync(base + e));
  if (!hit) { fail++; console.log('MISSING  ' + spec + '  (from ' + f + ')'); }
}
console.log(fail ? `\n${fail} problem(s)` : `\nall ${localImports.length} local imports resolve`);
process.exit(fail ? 1 : 0);
