// Art manifest check: every file parses and every require() in the art/icon
// manifests and screens resolves to a real file.
//   node scripts/check-art.js
const p = require('@babel/parser');
const fs = require('fs');
const path = require('path');

const files = [
  'src/config/onboardingArt.js',
  'src/config/borderArt.js',
  'src/components/PortraitBorder.js',
  'src/components/AppIcon.js',
  'src/components/RewardArt.js',
  'src/screens/ProgressionScreen.js',
  'src/config/cosmetics.js',
  'src/config/cosmeticsArt.js',
  'src/components/character/CharacterRig.js',
];

let miss = 0;
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  p.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  // Commented-out requires are the "not generated yet" placeholders — Metro
  // never resolves them, so they must not count as missing assets.
  for (const line of src.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    const re = /require\('(\.\.[^']+\.(?:png|jpg|json))'\)/g;
    let m;
    while ((m = re.exec(line))) {
      total++;
      if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) {
        console.log('MISSING:', m[1], '<-', f);
        miss++;
      }
    }
  }
}
console.log(`parse ok: ${files.length} files`);
console.log(`${total} asset requires, ${miss} missing`);

// report which manifest keys are live vs still commented
const art = fs.readFileSync('src/config/onboardingArt.js', 'utf8');
const live = [...art.matchAll(/^\s{2}(\w+): require/gm)].map((x) => x[1]);
const todo = [...art.matchAll(/^\s{2}\/\/ (\w+): require/gm)].map((x) => x[1]);
console.log(`art keys live (${live.length}): ${live.join(', ')}`);
console.log(`art keys pending (${todo.length}): ${todo.join(', ') || 'none'}`);
process.exit(miss ? 1 : 0);
