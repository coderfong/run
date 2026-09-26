// Fit Studio — catalogue reader.
//
// The cosmetics catalogue is React Native source: ES modules full of
// `require('../../assets/...png')`. Node cannot import that directly, so each
// config file is copied to a temp dir with every require() rewritten to the
// asset's path string, and the copies are imported. Nothing in these four
// files has a runtime dependency beyond each other, so the copies load clean.
//
// The rig geometry is read out of CharacterRig.js the same way — evaluated,
// not transcribed — so the studio can never drift from what the app draws.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const FRONTEND = path.resolve(HERE, '..', '..');
const CONFIG = path.join(FRONTEND, 'src', 'config');
const RIG_FILE = path.join(FRONTEND, 'src', 'components', 'character', 'CharacterRig.js');
const HEADWEAR_FIT_FILE = path.join(CONFIG, 'headwearFit.json');

const CATALOG_FILES = ['cosmetics.js', 'cosmeticsArt.js', 'outfitItems.js', 'hairSheetItems.js', 'curatedCosmetics.js', 'hiddenCosmetics.js'];

// Which source file owns each item — that is where a fit gets written back.
export const SOURCE_FILES = {
  cosmetics: path.join(CONFIG, 'cosmetics.js'),
  outfits: path.join(CONFIG, 'outfitItems.js'),
  hairSheets: path.join(CONFIG, 'hairSheetItems.js'),
  curated: path.join(CONFIG, 'curatedCosmetics.js'),
};

const rel = (abs) => path.relative(FRONTEND, abs).split(path.sep).join('/');

// Backups live beside the tool, not beside the source. Dropping them in
// src/config buries the catalogue in hundreds of near-identical files and puts
// them in front of anyone reading a diff.
export const BACKUP_DIR = path.join(HERE, 'backups');

export function backup(file, stamp) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `${path.basename(file)}.fitbak-${stamp}`);
  fs.copyFileSync(file, dest);
  return dest;
}

// The rig's placement constants, evaluated from the component itself. The
// slice runs from BODY_RATIO to the first animation constant — everything in
// between is plain arithmetic over literals.
export function readRig() {
  const src = fs.readFileSync(RIG_FILE, 'utf8');
  const from = src.indexOf('export const BODY_RATIO');
  const to = src.indexOf('const SWAP_SPRING');
  if (from < 0 || to < 0 || to < from) {
    throw new Error(
      'CharacterRig.js no longer has its constants between BODY_RATIO and SWAP_SPRING — ' +
      'fit-studio/manifest.mjs needs updating to match.'
    );
  }
  const body = src.slice(from, to).replace(/^export /gm, '');
  const read = new Function(
    `const HAIR_COLORS = ['#26282B','#4A2F1F','#7B4B2A','#C9922B','#E8D06B'];\n${body}\nreturn { BODY_RATIO, HEADROOM, HEAD, LAYOUT, HAIR_LIFT, BUST,` +
    ` FACE_W_OF_HEAD, FACE_TOP_OF_HEAD, EYE_LINE_OF_HEAD, GLASSES_W_OF_HEAD };`
  );
  const rig = read();
  for (const key of ['BODY_RATIO', 'HEADROOM', 'LAYOUT', 'HAIR_LIFT']) {
    if (rig[key] == null) throw new Error(`CharacterRig.js: could not read ${key}`);
  }
  return rig;
}

// Import the catalogue with asset requires flattened to path strings.
async function loadCatalog() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paser-fit-'));
  for (const file of CATALOG_FILES) {
    let src = fs.readFileSync(path.join(CONFIG, file), 'utf8');
    src = src.replace(/require\((['"])(.*?)\1\)/g, (_m, _q, spec) =>
      JSON.stringify(rel(path.resolve(CONFIG, spec)))
    );
    src = src.replace(/from '\.\/(cosmeticsArt|outfitItems|hairSheetItems|curatedCosmetics|hiddenCosmetics)'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(tmp, file.replace(/\.js$/, '.mjs')), src, 'utf8');
  }
  const mod = await import(`${url.pathToFileURL(path.join(tmp, 'cosmetics.mjs'))}?t=${Date.now()}`);
  const outfits = await import(`${url.pathToFileURL(path.join(tmp, 'outfitItems.mjs'))}?t=${Date.now()}`);
  const hair = await import(`${url.pathToFileURL(path.join(tmp, 'hairSheetItems.mjs'))}?t=${Date.now()}`);
  const curated = await import(`${url.pathToFileURL(path.join(tmp, 'curatedCosmetics.mjs'))}?t=${Date.now()}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { mod, outfits, hair, curated };
}

export async function buildManifest() {
  const { mod, outfits, hair, curated } = await loadCatalog();

  // Generated waves live in their own files; everything else is hand-written
  // in cosmetics.js.
  const fromOutfits = new Set(
    [...outfits.OUTFIT_TOPS, ...outfits.OUTFIT_BOTTOMS, ...outfits.OUTFIT_SUITS, ...outfits.FOOTWEAR]
      .map((i) => i.id)
  );
  const fromHairSheets = new Set(hair.HAIR_SHEETS.map((i) => i.id));
  const fromCurated = new Set([
    ...curated.CURATED_TOPS, ...curated.CURATED_BOTTOMS, ...curated.CURATED_FOOTWEAR,
    ...curated.CURATED_HEADWEAR, ...curated.CURATED_GLASSES,
    ...curated.CURATED_ACCESSORIES, ...curated.CURATED_EXTRAS,
  ].map((i) => i.id));
  const sourceOf = (id) =>
    fromOutfits.has(id) ? 'outfits' : fromHairSheets.has(id) ? 'hairSheets' : fromCurated.has(id) ? 'curated' : 'cosmetics';

  const slots = mod.SLOTS.map(({ key, label }) => ({ key, label }));
  // Hidden from the app (hiddenCosmetics.js; hide-item.mjs writes it). Read
  // here rather than imported, since hide-item.mjs imports this module.
  const hiddenSrc = fs.readFileSync(path.join(CONFIG, 'hiddenCosmetics.js'), 'utf8');
  const hidden = new Set([...hiddenSrc.split('// BEGIN HIDDEN')[1].split('// END HIDDEN')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  // Anything that makes hiding an item surprising: a pass or PRO reward is
  // still paid out by its ladder, and a default is still what a new runner
  // starts in.
  const defaults = new Set(Object.values(mod.DEFAULT_EQUIPPED || {}));
  const items = {};
  for (const { key } of slots) {
    items[key] = (mod.ITEMS[key] || []).map((item) => {
      const override = path.join(FRONTEND, 'assets', 'character', 'body-overrides', key, `${item.id}.png`);
      return ({
      id: item.id,
      label: item.label,
      source: sourceOf(item.id),
      fit: item.fit || null,
      layout: item.layout || null,
      img: item.img || null,
      // Open footwear that could not be split is cut into a second image for
      // wearing, with the lining punched out so the leg shows through the
      // mouth. The rig draws that one; the item list keeps `img`, same as the
      // picker in the app.
      wornImg: item.wornImg || null,
      art: item.art || null,
      backImg: item.backImg || null,
      backArt: item.backArt || null,
      // Split footwear: the pair's two halves and a placement each, so the
      // studio can move and rotate one shoe at a time.
      footL: item.footL || null,
      footR: item.footR || null,
      // The far rim of the collar, drawn before the body so the ankle passes
      // through the shoe. Same box as the front piece — the two tile.
      footLBack: item.footLBack || null,
      footRBack: item.footRBack || null,
      feet: item.feet || null,
      z: item.z || null,
      atNeck: !!item.atNeck,
      hideHair: !!item.hideHair,
      hidesBulky: !!item.hidesBulky,
      hidesBottom: !!item.hidesBottom,
      bulky: !!item.bulky,
      rarity: item.rarity || null,
      bodyOverride: fs.existsSync(override) ? rel(override) : null,
      hidden: hidden.has(item.id),
      reward: item.unlock?.pass ? 'pass' : item.unlock?.premium ? 'PRO' : null,
      isDefault: defaults.has(item.id),
    });
    });
  }

  return {
    rig: readRig(),
    // The same seat-line data src/config/headwearFit.js reads, so a hat's
    // hair crop in the studio is computed by the identical function as the
    // rig rather than approximated — see index.html's hairOcclusion().
    // Hair under a hat (hairUnderHat.json) rides along as `fit.hairCover`
    // (painted covers) and `fit.hairLayout` (with-hat hair positions).
    fit: (() => {
      const under = JSON.parse(fs.readFileSync(path.join(CONFIG, 'hairUnderHat.json'), 'utf8'));
      // The hair + headwear compatibility table (families, hair types) rides
      // along as `fit.compat`, so the studio classifies hats the way the rig does.
      const compat = JSON.parse(fs.readFileSync(path.join(CONFIG, 'hairHeadwearCompat.json'), 'utf8'));
      return { ...JSON.parse(fs.readFileSync(HEADWEAR_FIT_FILE, 'utf8')), hairCover: under.cover, hairLayout: under.layout, compat };
    })(),
    slots,
    items,
    body: mod.BODY_IMG,
    head: mod.HEAD_IMG,
    defaultEquipped: mod.DEFAULT_EQUIPPED,
    palettes: { hair: mod.HAIR_COLORS, cloth: mod.CLOTH_COLORS },
    colorKey: {
      hair: 'hairColor',
      headwear: 'headwearColor',
      glasses: 'glassesColor',
      top: 'topColor',
      bottom: 'bottomColor',
    },
  };
}
