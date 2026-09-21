// Fit Studio — writes the dragged fits back into the catalogue.
//
// Reads fit-overrides.json (produced by the studio UI) and rewrites the
// `layout: { ... }` of each edited item in cosmetics.js / outfitItems.js /
// hairSheetItems.js. Keys the studio does not own (maxH, anything added later)
// are merged, not dropped. Every touched file is backed up once per run.
//
//   node scripts/fit-studio/apply-fit.mjs            # apply
//   node scripts/fit-studio/apply-fit.mjs --dry-run  # show the diff only

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { backup, buildManifest, SOURCE_FILES } from './manifest.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const OVERRIDES_FILE = path.join(HERE, 'fit-overrides.json');

// Written in the order the catalogue already uses, so diffs stay readable.
const KEY_ORDER = ['w', 'top', 'cy', 'dx', 'maxH'];

const num = (v) => {
  const r = Math.round(Number(v) * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

function formatLayout(layout) {
  const keys = [
    ...KEY_ORDER.filter((k) => layout[k] != null),
    ...Object.keys(layout).filter((k) => !KEY_ORDER.includes(k) && layout[k] != null),
  ];
  return `layout: { ${keys.map((k) => `${k}: ${num(layout[k])}`).join(', ')} }`;
}

// `feet` is the one NESTED value in these lists — { l: {...}, r: {...} } — so
// it cannot ride along in the flat layout object and gets rewritten on its own.
// The regexes elsewhere in this file use [^}] and would stop at the first inner
// brace, which is why this one counts them instead.
const FOOT_KEYS = ['w', 'dx', 'top', 'rot'];

function formatFeet(feet) {
  const side = (o) => FOOT_KEYS.filter((k) => o[k] != null)
    .map((k) => `${k}: ${num(o[k])}`).join(', ');
  return `feet: { ${['l', 'r'].filter((k) => feet[k]).map((k) => `${k}: { ${side(feet[k])} }`).join(', ')} }`;
}

function findFeet(line) {
  const at = line.indexOf('feet: {');
  if (at < 0) return null;
  let depth = 0;
  for (let i = line.indexOf('{', at); i < line.length; i += 1) {
    if (line[i] === '{') depth += 1;
    else if (line[i] === '}') {
      depth -= 1;
      if (depth === 0) return { start: at, end: i + 1, text: line.slice(at, i + 1) };
    }
  }
  return null;
}

function parseFeet(text) {
  const out = {};
  for (const m of text.matchAll(/([lr])\s*:\s*\{([^}]*)\}/g)) {
    out[m[1]] = {};
    for (const kv of m[2].matchAll(/(\w+)\s*:\s*(-?[\d.]+)/g)) out[m[1]][kv[1]] = Number(kv[2]);
  }
  return out;
}

// Layout objects in the catalogue are flat and numeric — `{ w: 0.9, top: 0.31 }`.
// Draw side. `z: 'back'` sends an item behind the body; the field sits right
// after the layout. In front is the default everywhere, so 'front' simply drops
// the field, except on accessories, where the catalogue spells it out.
function writeZ(line, slot, z) {
  let out = line.replace(/,\s*z:\s*'(?:back|front)'/g, '');
  const want = z === 'back' ? 'back' : (slot === 'accessory' ? 'front' : null);
  if (!want) return out;
  const field = `, z: '${want}'`;
  const layout = out.match(/layout:\s*\{[^}]*\}/);
  if (layout) return out.slice(0, layout.index + layout[0].length) + field + out.slice(layout.index + layout[0].length);
  return out.includes('rarity:') ? out.replace(/,\s*rarity:/, `${field}, rarity:`) : null;
}

function parseLayout(text) {
  const out = {};
  for (const m of text.matchAll(/(\w+)\s*:\s*(-?[\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

// `slots` writes only those slots and leaves the rest pending, for finishing
// one kind of item without dragging half-done work on everything else in with it.
export async function applyOverrides({ dryRun = false, slots = null } = {}) {
  if (!fs.existsSync(OVERRIDES_FILE)) return { applied: 0, changes: [], errors: ['No fit-overrides.json yet.'] };
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
  const manifest = await buildManifest();

  const files = new Map(); // key -> { path, lines }
  const load = (key) => {
    if (!files.has(key)) {
      const file = SOURCE_FILES[key];
      files.set(key, { path: file, lines: fs.readFileSync(file, 'utf8').split('\n') });
    }
    return files.get(key);
  };

  const changes = [];
  const errors = [];

  const only = slots && slots.length ? new Set(slots) : null;
  for (const [slot, byId] of Object.entries(overrides)) {
    if (only && !only.has(slot)) continue;
    for (const [id, patch] of Object.entries(byId || {})) {
      if (!patch || !Object.keys(patch).length) continue;
      const item = (manifest.items[slot] || []).find((i) => i.id === id);
      if (!item) {
        errors.push(`${slot}:${id} — not in the catalogue any more, skipped.`);
        continue;
      }
      const f = load(item.source);
      const needle = `id: '${id}',`;
      const hits = [];
      f.lines.forEach((line, i) => {
        if (line.includes(needle)) hits.push(i);
      });
      if (hits.length !== 1) {
        errors.push(`${slot}:${id} — ${hits.length} matching lines in ${path.basename(f.path)}, skipped.`);
        continue;
      }

      const i = hits[0];
      let line = f.lines[i];

      // Per-shoe placement first, in place, so the layout rewrite below still
      // sees a line it recognises.
      if (patch.feet) {
        const found = findFeet(line);
        if (!found) {
          errors.push(`${slot}:${id} — per-shoe edit but no feet field on the line, skipped.`);
          continue;
        }
        const cur = parseFeet(found.text);
        const merged = { ...cur };
        for (const side of Object.keys(patch.feet)) {
          merged[side] = { ...(cur[side] || {}), ...patch.feet[side] };
        }
        line = line.slice(0, found.start) + formatFeet(merged) + line.slice(found.end);
      }
      if (patch.z) {
        const next = writeZ(line, slot, patch.z);
        if (next == null) {
          errors.push(`${slot}:${id} — nowhere to write z on the line, skipped.`);
          continue;
        }
        line = next;
      }
      const flat = { ...patch };
      delete flat.feet;
      delete flat.z;
      if (!Object.keys(flat).length) {
        if (line === f.lines[i]) {
          errors.push(`${slot}:${id} — rewrite produced no change, skipped.`);
          continue;
        }
        changes.push({ slot, id, label: item.label, file: path.basename(f.path), line: i + 1,
                       layout: {}, before: f.lines[i].trim(), after: line.trim() });
        f.lines[i] = line;
        continue;
      }
      const existing = line.match(/layout:\s*\{([^}]*)\}/);
      const merged = { ...(existing ? parseLayout(existing[1]) : {}), ...flat };
      // An anchor is either an edge (`top`) or a centre (`cy`) — the rig reads
      // cy first, so carrying both would make the studio's number the one that
      // silently loses.
      if (flat.cy != null) delete merged.top;
      if (flat.top != null) delete merged.cy;

      const next = formatLayout(merged);
      let updated;
      if (existing) {
        updated = line.replace(/layout:\s*\{[^}]*\}/, next);
      } else {
        // No layout yet: insert it just before `rarity:`, where every other
        // item in these lists carries it.
        if (!line.includes('rarity:')) {
          errors.push(`${slot}:${id} — no layout and no rarity field to insert before, skipped.`);
          continue;
        }
        updated = line.replace(/rarity:/, `${next}, rarity:`);
      }
      if (updated === line) {
        errors.push(`${slot}:${id} — rewrite produced no change, skipped.`);
        continue;
      }
      f.lines[i] = updated;
      changes.push({ slot, id, label: item.label, file: path.basename(f.path), line: i + 1, layout: merged, before: f.lines[i].trim(), after: updated.trim() });
    }
  }

  if (!dryRun && changes.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const f of files.values()) {
      backup(f.path, stamp);
      fs.writeFileSync(f.path, f.lines.join('\n'), 'utf8');
    }
    // The edits are in the source now — keep the run for reference, but start
    // the next session from a clean slate so nothing gets applied twice.
    fs.copyFileSync(OVERRIDES_FILE, path.join(HERE, `fit-overrides.applied-${stamp}.json`));
    const left = Object.fromEntries(
      Object.entries(overrides).filter(([slot, byId]) =>
        only && !only.has(slot) && byId && Object.keys(byId).length)
    );
    // Anything held back is still someone's unfinished work: it stays pending
    // rather than going out with the applied run.
    if (Object.keys(left).length) fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(left, null, 2), 'utf8');
    else fs.rmSync(OVERRIDES_FILE);
  }

  return { applied: dryRun ? 0 : changes.length, changes, errors, dryRun };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const dryRun = process.argv.includes('--dry-run');
  const res = await applyOverrides({ dryRun });
  for (const c of res.changes) {
    console.log(`${c.file}:${c.line}  ${c.slot}:${c.id} (${c.label})`);
    console.log(`  - ${c.before}`);
    console.log(`  + ${c.after}`);
  }
  for (const e of res.errors) console.warn(`! ${e}`);
  console.log(dryRun ? `\n${res.changes.length} item(s) would change.` : `\n${res.applied} item(s) written.`);
}
