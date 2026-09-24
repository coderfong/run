// Catalogue sanity check: every file parses, every require() resolves, ids are
// globally safe, both pass maps use the right unlock/rarity rules, and the
// generated shop contains exactly the eligible stat-gated cosmetics.
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

// duplicate ids per slot.
//
// Scanned inside the ITEMS literal ONLY. cosmetics.js holds other objects
// shaped `slot: [ ... ]` at the same indent — FIRST_RUN_ITEMS, the first-run
// starter rack, is one — and reading the whole file reported those as extra
// slots holding zero items.
const wholeFile = fs.readFileSync('src/config/cosmetics.js', 'utf8');
const itemsStart = wholeFile.indexOf('export const ITEMS = {');
const itemsEnd = wholeFile.indexOf('\n};', itemsStart);
const src = itemsStart === -1 || itemsEnd === -1
  ? wholeFile
  : wholeFile.slice(itemsStart, itemsEnd);
const slotRe = /\n  (\w+): \[([\s\S]*?)\n  \],/g;
let s;
let dupes = 0;
const known = new Set();
const itemMeta = new Map();
const bareIds = new Map();

function rememberItem(slot, id, line) {
  known.add(`${slot}:${id}`);
  itemMeta.set(`${slot}:${id}`, {
    rarity: line.match(/rarity: '(\w+)'/)?.[1] || 'common',
    unlock: line.match(/unlock: (\w+)/)?.[1] || 'unknown',
  });
  if (id === 'none') return;
  const previous = bareIds.get(id);
  if (previous && previous !== slot) {
    console.log(`DUPLICATE global id across ${previous}/${slot}: ${id}`);
    dupes++;
  } else {
    bareIds.set(id, slot);
  }
}

while ((s = slotRe.exec(src))) {
  const slot = s[1];
  const lines = s[2].split('\n').filter((line) => /id: '[^']+'/.test(line));
  const ids = lines.map((line) => line.match(/id: '([^']+)'/)[1]);
  const seen = new Set();
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      console.log(`DUPLICATE id in ${slot}: ${id}`);
      dupes++;
    }
    seen.add(id);
    rememberItem(slot, id, lines[index]);
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
  const lines = block[1].split('\n').filter((line) => /id: '[^']+'/.test(line));
  const ids = lines.map((line) => line.match(/id: '([^']+)'/)[1]);
  for (const [index, id] of ids.entries()) {
    if (known.has(`${slot}:${id}`)) {
      console.log(`DUPLICATE id in ${slot}: ${id}`);
      dupes++;
    }
    rememberItem(slot, id, lines[index]);
  }
  console.log(`  ${slot} +${ids.length} from ${arr}`);
}
// curatedCosmetics.js is pushed in the same way (ITEMS.<slot>.push(...CURATED_*)).
// Its unlocks are written inline rather than by name, so they are mapped back
// onto the names the reward rules below expect.
const curatedSrc = fs.readFileSync('src/config/curatedCosmetics.js', 'utf8');
const CURATED = {
  CURATED_TOPS: 'top', CURATED_BOTTOMS: 'bottom', CURATED_FOOTWEAR: 'footwear', CURATED_HEADWEAR: 'headwear',
  CURATED_GLASSES: 'glasses', CURATED_ACCESSORIES: 'accessory', CURATED_EXTRAS: 'accessory',
};
const inlineUnlock = (line) => {
  const u = line.match(/unlock: (null|\{[^}]*\})/)?.[1];
  if (u === 'null') return 'free';
  if (/premium: true/.test(u || '')) return 'premiumOnly';
  if (/pass: true/.test(u || '')) return 'passOnly';
  return line.match(/unlock: (\w+)/)?.[1] || 'unknown';
};
for (const [arr, slot] of Object.entries(CURATED)) {
  const start = curatedSrc.indexOf(`export const ${arr} = [`);
  const end = start < 0 ? -1 : curatedSrc.indexOf('\n];', start);
  if (start < 0 || end < 0) {
    console.log(`MISSING array: ${arr} in curatedCosmetics.js`);
    dupes++;
    continue;
  }
  const lines = curatedSrc.slice(start, end).split('\n').filter((line) => /id: '[^']+'/.test(line));
  for (const line of lines) {
    const id = line.match(/id: '([^']+)'/)[1];
    if (known.has(`${slot}:${id}`)) {
      console.log(`DUPLICATE id in ${slot}: ${id}`);
      dupes++;
    }
    rememberItem(slot, id, line);
    itemMeta.get(`${slot}:${id}`).unlock = inlineUnlock(line);
  }
  console.log(`  ${slot} +${lines.length} from ${arr}`);
}
console.log(`${dupes} duplicate ids`);

// every reward key on BOTH tracks must resolve to a real catalogue item
const py = fs.readFileSync(
  path.resolve('../backend/app/progression.py'), 'utf8');
let bad = 0;
const rewardMaps = {};
for (const name of ['PREMIUM_ITEMS', 'FREE_ITEMS']) {
  const block = py.match(new RegExp(`${name} = \\{([\\s\\S]*?)\\n\\}`));
  if (!block) {
    console.log(`MISSING dict: ${name}`);
    bad++;
    continue;
  }
  const entries = [...block[1].matchAll(/(\d+): \("([\w]+:[\w]+)"/g)]
    .map((x) => ({ level: Number(x[1]), key: x[2] }));
  const keys = entries.map((entry) => entry.key);
  rewardMaps[name] = entries;
  const expectedUnlock = name === 'PREMIUM_ITEMS' ? 'premiumOnly' : 'passOnly';
  for (const k of keys) {
    if (!known.has(k)) {
      console.log(`UNRESOLVED ${name} key:`, k);
      bad++;
    } else if (itemMeta.get(k)?.unlock !== expectedUnlock) {
      console.log(`WRONG UNLOCK ${name} key: ${k} is ${itemMeta.get(k)?.unlock}, expected ${expectedUnlock}`);
      bad++;
    }
  }
  console.log(`${keys.length} ${name} keys, ${bad} reward issues so far`);
}

if (rewardMaps.FREE_ITEMS?.length !== 40) {
  console.log(`FREE_ITEMS must have 40 cosmetic tiers, got ${rewardMaps.FREE_ITEMS?.length || 0}`);
  bad++;
}
if (rewardMaps.PREMIUM_ITEMS?.length !== 17) {
  console.log(`PREMIUM_ITEMS must have 17 cosmetic tiers, got ${rewardMaps.PREMIUM_ITEMS?.length || 0}`);
  bad++;
}

const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
for (const { level, key } of rewardMaps.FREE_ITEMS || []) {
  const floor = level >= 46 ? 'legendary' : level >= 32 ? 'epic' : level >= 12 ? 'rare' : 'common';
  const rarity = itemMeta.get(key)?.rarity;
  if (rarityRank[rarity] < rarityRank[floor]) {
    console.log(`RARITY DROP FREE_ITEMS level ${level}: ${key} is ${rarity}, expected ${floor}+`);
    bad++;
  }
}
for (const { level, key } of rewardMaps.PREMIUM_ITEMS || []) {
  const floor = level >= 32 ? 'legendary' : 'epic';
  const rarity = itemMeta.get(key)?.rarity;
  if (rarityRank[rarity] < rarityRank[floor]) {
    console.log(`RARITY DROP PREMIUM_ITEMS level ${level}: ${key} is ${rarity}, expected ${floor}+`);
    bad++;
  }
}

const freeSlots = new Set((rewardMaps.FREE_ITEMS || []).map(({ key }) => key.split(':')[0]));
for (const slot of ['face', 'hair', 'headwear', 'glasses', 'top', 'bottom', 'footwear', 'accessory']) {
  if (!freeSlots.has(slot)) {
    console.log(`FREE_ITEMS has no ${slot} reward`);
    bad++;
  }
}

// The generated backend catalogue must contain every stat-gated shortcut and
// nothing from starter, free-pass, or PRO inventories. This catches both a
// forgotten generator run and a filter regression that leaks a pass reward.
const shopPy = fs.readFileSync(path.resolve('../backend/app/shop_catalog.py'), 'utf8');
const shopItems = new Map(
  [...shopPy.matchAll(/^\s+"([^"]+)": \("(\w+)", "(\w+)"\),/gm)]
    .map((match) => [match[1], { slot: match[2], rarity: match[3] }])
);
const excludedUnlocks = new Set(['free', 'passOnly', 'premiumOnly']);
// Items hidden from the app (src/config/hiddenCosmetics.js) are never sold.
const hiddenBlock = fs.readFileSync(path.resolve('src/config/hiddenCosmetics.js'), 'utf8')
  .split('// BEGIN HIDDEN')[1].split('// END HIDDEN')[0];
const hiddenIds = new Set([...hiddenBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]));
const expectedShop = [...itemMeta.entries()].filter(([key, meta]) => (
  !key.endsWith(':none') && !excludedUnlocks.has(meta.unlock) && !hiddenIds.has(key.split(':')[1])
));
for (const [key, meta] of expectedShop) {
  const [slot, id] = key.split(':');
  const actual = shopItems.get(id);
  if (!actual || actual.slot !== slot || actual.rarity !== meta.rarity) {
    console.log(`SHOP MISMATCH ${key}: expected ${meta.rarity}, got ${JSON.stringify(actual)}`);
    bad++;
  }
}
for (const [id, actual] of shopItems) {
  const meta = itemMeta.get(`${actual.slot}:${id}`);
  if (!meta || excludedUnlocks.has(meta.unlock) || hiddenIds.has(id)) {
    console.log(`SHOP LEAK ${actual.slot}:${id}: ${hiddenIds.has(id) ? 'hidden' : meta?.unlock || 'unknown item'}`);
    bad++;
  }
}
if (shopItems.size !== expectedShop.length) {
  console.log(`SHOP COUNT mismatch: ${shopItems.size} generated, ${expectedShop.length} expected`);
  bad++;
}
console.log(`${shopItems.size} shop items, ${bad} catalogue issues total`);
process.exit(miss + dupes + bad ? 1 : 0);
