// Fit Studio — removing an item from the catalogue.
//
// Deleting art is the one thing here that cannot be undone by dragging
// something back, so nothing is destroyed: the item's source line is recorded
// in deleted-items.json, every touched file is backed up, and the PNGs are
// MOVED into deleted-art/<timestamp>/ rather than unlinked. Putting an item
// back is a copy and a paste.
//
// An id that something else in the app names — a pass reward, a shop entry,
// the default loadout, a premium grant on the server — is refused until the
// caller says it means it, because those references are what turn a tidy-up
// into a crash.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { backup, buildManifest, SOURCE_FILES, FRONTEND } from './manifest.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const LOG_FILE = path.join(HERE, 'deleted-items.json');
const TRASH = path.join(HERE, 'deleted-art');
const REPO = path.resolve(FRONTEND, '..');

// Where an id can be spoken about outside the catalogue itself.
const SCAN_ROOTS = [
  path.join(FRONTEND, 'src'),
  path.join(REPO, 'backend', 'app'),
];
const SCAN_FILES = [path.join(REPO, 'economy-contract.json')];
const SCAN_EXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.json']);
const CATALOG = new Set(Object.values(SOURCE_FILES));

// The server's shop list is a GENERATED mirror of cosmetics.js. A hit there is
// not something to fix by hand — it is regenerated after the delete, which is
// what keeps `node scripts/check-catalog.js` passing.
const SHOP_CATALOG = path.join(REPO, 'backend', 'app', 'shop_catalog.py');
const GENERATED = new Set([SHOP_CATALOG]);

// A colourable item's ten variants live in cosmeticsArt.js as one ART entry,
// not on the item, so removing the item alone leaves ten require()s pointing
// at art that is gone — which is a bundler error, not a warning. Any entry
// whose files have ALL left disk is orphaned and goes with them; an entry that
// is only partly missing is reported instead, because that is not a deletion,
// it is damage.
//
// cosmeticsArt.js is not valid UTF-8 (a stray byte in its header comment), so
// it is read and written as latin1 — every byte round-trips untouched and the
// patterns matched here are ASCII.
export function pruneOrphanArt() {
  const file = path.join(FRONTEND, 'src', 'config', 'cosmeticsArt.js');
  if (!fs.existsSync(file)) return { removed: [], partial: [] };
  const lines = fs.readFileSync(file, 'latin1').split('\n');
  const removed = [];
  const partial = [];
  const kept = lines.filter((line) => {
    const specs = [...line.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    if (!specs.length) return true;
    const gone = specs.filter((s) => !fs.existsSync(path.resolve(path.join(FRONTEND, 'src', 'config'), s)));
    if (!gone.length) return true;
    const key = (line.match(/^\s*(\w+):/) || [, line.trim().slice(0, 24)])[1];
    if (gone.length === specs.length) { removed.push(key); return false; }
    partial.push({ key, missing: gone.length, of: specs.length });
    return true;
  });
  if (removed.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup(file, stamp);
    fs.writeFileSync(file, kept.join('\n'), 'latin1');
  }
  return { removed, partial };
}

function regenerateShopCatalog() {
  const script = path.join(FRONTEND, 'scripts', 'gen-shop-catalog.py');
  if (!fs.existsSync(script)) return { ran: false, note: 'gen-shop-catalog.py not found' };
  for (const exe of ['python', 'py', 'python3']) {
    try {
      const out = execFileSync(exe, [script], { cwd: FRONTEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ran: true, note: out.trim().split('\n').pop() || 'shop_catalog.py regenerated' };
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      return { ran: false, note: `gen-shop-catalog.py failed: ${String(err.stderr || err.message).trim().split('\n').pop()}` };
    }
  }
  return { ran: false, note: 'no python on PATH — run `python scripts/gen-shop-catalog.py` yourself' };
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(path.extname(entry.name))) yield full;
  }
}

// Quoted id, or the "<slot>:<id>" form used by server grants and previews.
function referencesOf(slot, id, ownLine) {
  const needles = [`'${id}'`, `"${id}"`, `${slot}:${id}`];
  const hits = [];
  const files = [...SCAN_ROOTS.filter(fs.existsSync).flatMap((d) => [...walk(d)]), ...SCAN_FILES.filter(fs.existsSync)];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!needles.some((n) => line.includes(n))) return;
      // The item's own definition is what we are deleting, and its authored
      // preview goes with it — neither is a reason to stop.
      if (CATALOG.has(file) && (line === ownLine || line.trim().startsWith(`'${slot}:${id}':`))) return;
      hits.push({
        file: path.relative(REPO, file).split(path.sep).join('/'),
        line: i + 1,
        text: line.trim().slice(0, 160),
        generated: GENERATED.has(file),
      });
    });
  }
  return hits;
}

// DEFAULT_EQUIPPED names one item per slot. Handing the slot to another item
// is the only way to delete the one that is currently the default.
function reassignDefault(slot, fromId, toId) {
  const file = SOURCE_FILES.cosmetics;
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('export const DEFAULT_EQUIPPED = {');
  if (start < 0) return { ok: false, error: 'DEFAULT_EQUIPPED not found in cosmetics.js.' };
  const end = text.indexOf('\n};', start);
  const block = text.slice(start, end);
  const line = new RegExp(`^(\\s*)${slot}: '${fromId}',`, 'm');
  if (!line.test(block)) return { ok: false, error: `DEFAULT_EQUIPPED has no ${slot}: '${fromId}' line.` };
  const next = block.replace(line, `$1${slot}: '${toId}',`);
  fs.writeFileSync(file, text.slice(0, start) + next + text.slice(end), 'utf8');
  return { ok: true, slot, from: fromId, to: toId };
}

// Everything an item OWNS. Footwear is the awkward one: the picker's `img` is a
// pair of shoes, but what the rig wears is footL/footR, plus the collar's back
// piece for each and the cut-open `wornImg` where there is one. Leaving those
// out means deleting a shoe and leaving five files of it on disk.
const artOf = (item) => [
  item.img, item.wornImg, item.backImg,
  item.footL, item.footR, item.footLBack, item.footRBack,
  ...(item.art || []), ...(item.backArt || []),
].filter(Boolean);

export async function deleteItem({ slot, id, removeArt = false, force = false, newDefault = null, dryRun = false }) {
  const manifest = await buildManifest();
  const item = (manifest.items[slot] || []).find((i) => i.id === id);
  if (!item) return { ok: false, error: `${slot}:${id} is not in the catalogue.` };
  if (id === 'none') return { ok: false, error: 'The empty-slot item cannot be deleted — it is how a slot is left bare.' };
  if ((manifest.items[slot] || []).length <= 1) return { ok: false, error: `${slot} would be left with no items.` };

  // The default loadout has to name something. Deleting the item it names is
  // fine as long as the slot is handed to another item in the same breath.
  const isDefault = manifest.defaultEquipped[slot] === id;
  let defaultMoved = null;
  if (isDefault) {
    const replacement = (manifest.items[slot] || []).find((i) => i.id === newDefault);
    if (!replacement || replacement.id === id) {
      return {
        ok: false,
        needsDefault: true,
        slot,
        id,
        error: `${id} is the default ${slot} — every new runner wears it. Pick what takes its place.`,
        suggestions: (manifest.items[slot] || []).filter((i) => i.id !== id && i.id !== 'none').slice(0, 40).map((i) => ({ id: i.id, label: i.label })),
      };
    }
    defaultMoved = { slot, from: id, to: replacement.id, label: replacement.label };
  }

  const file = SOURCE_FILES[item.source];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => { if (line.includes(`id: '${id}',`)) hits.push(i); });
  if (hits.length !== 1) return { ok: false, error: `${hits.length} lines match id: '${id}' in ${path.basename(file)} — refusing to guess.` };
  const lineNo = hits[0];
  const sourceLine = lines[lineNo];

  const refs = referencesOf(slot, id, sourceLine);
  // A generated mirror is not a reason to stop — it is rebuilt below. The
  // DEFAULT_EQUIPPED line is not either, since it is being handed over.
  const blocking = refs.filter((r) => !r.generated && !(defaultMoved && r.file.endsWith('src/config/cosmetics.js') && r.text.startsWith(`${slot}: '${id}'`)));
  if (blocking.length && !force) {
    return { ok: false, blocked: true, refs: blocking, error: `${slot}:${id} is referenced ${blocking.length} time(s) elsewhere.` };
  }

  // Art shared with an item that is staying must not move to the trash.
  const mine = new Set(artOf(item));
  const stillUsed = new Set();
  for (const [s, list] of Object.entries(manifest.items)) {
    for (const other of list) {
      if (s === slot && other.id === id) continue;
      for (const a of artOf(other)) if (mine.has(a)) stillUsed.add(a);
    }
  }
  // The picker's authored previews name their art directly rather than through
  // an item, so a file named there is still in use too.
  const cosmeticsText = fs.readFileSync(SOURCE_FILES.cosmetics, 'utf8');
  const previewLine = cosmeticsText.split('\n').find((l) => l.trim().startsWith(`'${slot}:${id}':`));

  // Everything above is a question; everything below writes. `dryRun` answers
  // the question and stops — which is how a whole slot can be checked for what
  // would refuse before anything is deleted.
  if (dryRun) {
    return {
      ok: true, dryRun: true, slot, id, label: item.label,
      file: path.basename(file), line: lineNo + 1,
      wouldMoveArt: removeArt ? [...mine].filter((a) => !stillUsed.has(a)
        && fs.existsSync(path.join(FRONTEND, a))) : [],
      artKeptInUse: [...stillUsed], refs: blocking, defaultMoved,
      previewLine: previewLine ? previewLine.trim() : null,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const moved = [];
  if (removeArt) {
    const dest = path.join(TRASH, stamp);
    for (const relPath of mine) {
      if (stillUsed.has(relPath)) continue;
      const from = path.join(FRONTEND, relPath);
      if (!fs.existsSync(from)) continue;
      const to = path.join(dest, relPath);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      moved.push(relPath);
    }
  }

  backup(file, stamp);
  if (defaultMoved) {
    // Before the item's own line goes, so the rewrite below reads a file that
    // already carries the new default.
    if (SOURCE_FILES.cosmetics !== file) backup(SOURCE_FILES.cosmetics, stamp);
    const moved = reassignDefault(slot, id, defaultMoved.to);
    if (!moved.ok) return { ok: false, error: moved.error };
  }

  const current = fs.readFileSync(file, 'utf8').split('\n');
  const at = current.findIndex((l) => l.includes(`id: '${id}',`));
  if (at < 0) return { ok: false, error: `${slot}:${id} vanished from ${path.basename(file)} mid-delete.` };
  current.splice(at, 1);
  fs.writeFileSync(file, current.join('\n'), 'utf8');

  if (previewLine) {
    const target = SOURCE_FILES.cosmetics;
    if (target !== file) backup(target, stamp);
    const text = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, text.split('\n').filter((l) => l !== previewLine).join('\n'), 'utf8');
  }

  // The colour variants the item owned are dead requires now — take them out
  // before anything tries to bundle them.
  const orphans = removeArt ? pruneOrphanArt() : { removed: [], partial: [] };

  // The server prices purchases from its own copy of the catalogue, so a
  // deleted item has to leave that copy too or check-catalog.js fails.
  const shop = refs.some((r) => r.generated) ? regenerateShopCatalog() : { ran: false, note: null };

  const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : [];
  log.push({
    at: new Date().toISOString(), slot, id, label: item.label,
    file: path.basename(file), line: lineNo + 1, sourceLine: sourceLine.trim(),
    previewLine: previewLine ? previewLine.trim() : null,
    art: [...mine], artMoved: moved, artKeptInUse: [...stillUsed], artEntriesRemoved: orphans.removed,
    defaultMoved, shopCatalog: shop.note, forcedPastRefs: force ? blocking : [],
  });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');

  return {
    ok: true, slot, id, label: item.label, file: path.basename(file), line: lineNo + 1,
    artMoved: moved, artKeptInUse: [...stillUsed], refs: blocking, defaultMoved, shopCatalog: shop.note,
    artEntriesRemoved: orphans.removed, artEntriesPartial: orphans.partial,
  };
}
