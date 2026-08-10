// Catalogue sanity check: every file parses, every require() resolves, no
// duplicate item ids per slot, and every PREMIUM_ITEMS key exists.
//   node scripts/check-catalog.js
const p = require('@babel/parser');
const fs = require('fs');
const path = require('path');

const files = [
  'src/config/cosmetics.js',
  'src/config/cosmeticsArt.js',
  'src/config/outfitItems.js',
  'src/components/character/CharacterRig.js',
];
for (const f of files) {
  p.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
}
console.log('parse ok:', files.length, 'files');

let miss = 0;
let total = 0;
for (const f of files.slice(0, 3)) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /require\('([^']+)'\)/g;
  let m;
  while ((m = re.exec(src))) {
    total++;
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) {
      console.log('MISSING ASSET:', m[1]);
      miss++;
    }
  }
}
console.log(`${total} requires, ${miss} missing`);

// duplicate ids per slot
const src = fs.readFileSync('src/config/cosmetics.js', 'utf8');
const slotRe = /\n  (\w+): \[([\s\S]*?)\n  \],/g;
let s;
let dupes = 0;
const known = new Set();
while ((s = slotRe.exec(src))) {
  const slot = s[1];
  const ids = [...s[2].matchAll(/id: '([^']+)'/g)].map((x) => x[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      console.log(`DUPLICATE id in ${slot}: ${id}`);
      dupes++;
    }
    seen.add(id);
    known.add(`${slot}:${id}`);
  }
  console.log(`  ${slot}: ${ids.length} items`);
}
// cosmetics.js only holds part of the wardrobe: ITEMS.top/bottom/footwear are
// then push()ed full of the arrays in outfitItems.js. Reading only the literal
// blocks above left ~two thirds of the tops and ALL of the bottoms and shoes
// invisible here, so a pass tier naming one of them reported as unresolved
// even though the app resolves it fine.
const outfitSrc = fs.readFileSync('src/config/outfitItems.js', 'utf8');
const PUSHED = { OUTFIT_TOPS: 'top', OUTFIT_SUITS: 'top', OUTFIT_BOTTOMS: 'bottom', FOOTWEAR: 'footwear' };
for (const [arr, slot] of Object.entries(PUSHED)) {
  const start = outfitSrc.indexOf(`export const ${arr} = [`);
  const end = start < 0 ? -1 : outfitSrc.indexOf('\n];', start);
  const block = start < 0 || end < 0 ? null : [null, outfitSrc.slice(start, end)];
  if (!block) {
    console.log(`MISSING array: ${arr} in outfitItems.js`);
    dupes++;
    continue;
  }
  const ids = [...block[1].matchAll(/id: '([^']+)'/g)].map((x) => x[1]);
  for (const id of ids) {
    if (known.has(`${slot}:${id}`)) {
      console.log(`DUPLICATE id in ${slot}: ${id}`);
      dupes++;
    }
    known.add(`${slot}:${id}`);
  }
  console.log(`  ${slot} +${ids.length} from ${arr}`);
}
console.log(`${dupes} duplicate ids`);

// every reward key on BOTH tracks must resolve to a real catalogue item
const py = fs.readFileSync(
  path.resolve('../backend/app/progression.py'), 'utf8');
let bad = 0;
for (const name of ['PREMIUM_ITEMS', 'FREE_ITEMS']) {
  const block = py.match(new RegExp(`${name} = \\{([\\s\\S]*?)\\n\\}`));
  if (!block) {
    console.log(`MISSING dict: ${name}`);
    bad++;
    continue;
  }
  const keys = [...block[1].matchAll(/\("([\w]+:[\w]+)"/g)].map((x) => x[1]);
  for (const k of keys) {
    if (!known.has(k)) {
      console.log(`UNRESOLVED ${name} key:`, k);
      bad++;
    }
  }
  console.log(`${keys.length} ${name} keys, ${bad} unresolved so far`);
}
process.exit(miss + dupes + bad ? 1 : 0);
