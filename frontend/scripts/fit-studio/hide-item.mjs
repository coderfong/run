// Fit Studio — hide an item from the app's UI without deleting it.
//
// Rewrites the id list in src/config/hiddenCosmetics.js (read that for what
// "hidden" means in the app), then regenerates the server's shop catalogue so
// a hidden item is never sold. Undo is the same call with hidden: false.
//
// The file is copied to backups/hidden/<stamp>/ before each rewrite.

import fs from 'node:fs';
import path from 'node:path';

import { FRONTEND } from './manifest.mjs';
import { regenerateShopCatalog } from './delete-item.mjs';

export const HIDDEN_FILE = path.join(FRONTEND, 'src', 'config', 'hiddenCosmetics.js');
const BACKUPS = path.join(FRONTEND, 'scripts', 'fit-studio', 'backups', 'hidden');
const BEGIN = '// BEGIN HIDDEN';
const END = '// END HIDDEN';
const ID = /^[a-z0-9_]+$/;

function split(src) {
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error('hiddenCosmetics.js has lost its BEGIN/END HIDDEN markers.');
  return { head: src.slice(0, a), block: src.slice(a, b), tail: src.slice(b) };
}

export function readHidden() {
  const { block } = split(fs.readFileSync(HIDDEN_FILE, 'utf8'));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// `ids` sorted, one per line, so hiding one item is a one-line diff.
function writeHidden(ids) {
  const src = fs.readFileSync(HIDDEN_FILE, 'utf8');
  const { head, tail } = split(src);
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = [BEGIN, 'export const HIDDEN_IDS = [', ...ids.map((id) => `  '${id}',`), '];', ''];
  fs.writeFileSync(HIDDEN_FILE, head + lines.join(eol) + tail, 'utf8');
}

export function setHidden({ ids, hidden }) {
  const list = Array.isArray(ids) ? ids : [ids];
  if (!list.length || !list.every((id) => ID.test(String(id || '')) && id !== 'none')) {
    throw new Error('Invalid item id.');
  }
  const before = readHidden();
  const next = new Set(before);
  for (const id of list) { if (hidden) next.add(id); else next.delete(id); }
  const sorted = [...next].sort();
  if (sorted.join() === [...before].sort().join()) return { ok: true, changed: false, hidden: sorted };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUPS, stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(HIDDEN_FILE, path.join(dir, 'hiddenCosmetics.js'));
  writeHidden(sorted);
  const shop = regenerateShopCatalog();
  return { ok: true, changed: true, hidden: sorted, shop };
}
