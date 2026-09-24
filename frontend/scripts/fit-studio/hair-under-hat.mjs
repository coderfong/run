// Fit Studio — hair under a hat (src/config/hairUnderHat.json, read by
// src/config/headwearFit.js).
//
// Two things, both keyed so one entry can serve every hat or just one:
//
//   cover[hat][hair | '*']   which hair the hat HIDES, painted in the studio's
//                            "Hair under hat…" editor with the hat on, stored
//                            as polygons in head fractions.
//   layout[hair][hat | '*']  where the hairstyle SITS while the hat is worn,
//                            dragged on the stage with the hair position set
//                            to "every hat" or "this hat".
//
// "Regenerate" in the editor also re-measures the hat's seat in the browser
// from its art where it sits now (the maths of scripts/measure-headwear-fit.py)
// and can write it into headwearFit.json's `hats`, so the automatic shape
// follows a hat that was moved in the studio.
//
// Each file is copied to backups/hair-under-hat/<stamp>/ the first time this
// server run rewrites it (a hair drag autosaves many times a second).

import fs from 'node:fs';
import path from 'node:path';

import { FRONTEND } from './manifest.mjs';

export const UNDER_HAT_FILE = path.join(FRONTEND, 'src', 'config', 'hairUnderHat.json');
const FIT_FILE = path.join(FRONTEND, 'src', 'config', 'headwearFit.json');
const BACKUPS = path.join(FRONTEND, 'scripts', 'fit-studio', 'backups', 'hair-under-hat');
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const ID = /^[a-z0-9_]+$/;
const LAYOUT_KEYS = ['w', 'top', 'cy', 'dx'];

const backedUp = new Set();
function backupOnce(file) {
  if (backedUp.has(file)) return;
  const dir = path.join(BACKUPS, RUN_STAMP);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, path.basename(file)));
  backedUp.add(file);
}

export function readUnderHat() {
  return JSON.parse(fs.readFileSync(UNDER_HAT_FILE, 'utf8'));
}

// '*' first, then ids; one polygon or one layout per line, so a repaint is a
// readable diff rather than a thousand lines of lone numbers.
const scopeOrder = (a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b));
function formatUnderHat(doc) {
  const section = (byOuter, fmtEntry) => {
    const outer = Object.keys(byOuter).sort();
    if (!outer.length) return '{}';
    return '{\n' + outer.map((o) => {
      const inner = Object.keys(byOuter[o]).sort(scopeOrder)
        .map((k) => `   ${JSON.stringify(k)}: ${fmtEntry(byOuter[o][k])}`);
      return `  ${JSON.stringify(o)}: {\n${inner.join(',\n')}\n  }`;
    }).join(',\n') + '\n }';
  };
  const polys = (list) => (list.length ? '[\n' + list.map((p) => '    ' + JSON.stringify(p)).join(',\n') + '\n   ]' : '[]');
  return '{\n' +
    ` "_doc": ${JSON.stringify(doc._doc)},\n` +
    ` "cover": ${section(doc.cover, polys)},\n` +
    ` "layout": ${section(doc.layout, (l) => JSON.stringify(l))}\n` +
    '}\n';
}

function writeUnderHat(doc) {
  backupOnce(UNDER_HAT_FILE);
  fs.writeFileSync(UNDER_HAT_FILE, formatUnderHat(doc), 'utf8');
}

function validPolys(cover) {
  if (!Array.isArray(cover)) return false;
  return cover.every((poly) => Array.isArray(poly) && poly.length >= 3 &&
    poly.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((v) => Number.isFinite(v))));
}

function validSeat(seat) {
  return seat && ['edgeY', 'x0', 'x1', 'cover'].every((k) => seat[k] === null || Number.isFinite(seat[k]));
}

// Set or clear one entry of a two-level map, dropping the outer key when empty.
function setEntry(map, outer, inner, value) {
  const byOuter = { ...(map[outer] || {}) };
  if (value === null) delete byOuter[inner]; else byOuter[inner] = value;
  if (Object.keys(byOuter).length) map[outer] = byOuter; else delete map[outer];
}

// cover: polygons to store, or null to drop this scope's cover and go back to
// the automatic shape. seat: a freshly measured { edgeY, x0, x1, cover } for
// the hat, or null to leave headwearFit.json alone.
export function saveHairCover({ hat, hair, cover, seat }) {
  if (!ID.test(String(hat || ''))) throw new Error('Invalid hat id.');
  if (hair !== '*' && !ID.test(String(hair || ''))) throw new Error('Invalid hair id.');
  if (cover !== null && !validPolys(cover)) throw new Error('Cover must be a list of polygons of [x, y] pairs.');
  if (seat != null && !validSeat(seat)) throw new Error('Seat must be { edgeY, x0, x1, cover }.');

  const doc = readUnderHat();
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  setEntry(doc.cover, hat, hair, cover === null ? null : cover.map((poly) => poly.map(([x, y]) => [r4(x), r4(y)])));
  writeUnderHat(doc);

  let seatWritten = null;
  if (seat) {
    backupOnce(FIT_FILE);
    const raw = fs.readFileSync(FIT_FILE, 'utf8');
    const fit = JSON.parse(raw);
    // Same shape, rounding, indent and line ending measure-headwear-fit.py
    // writes (it runs on Windows, so CRLF), so a later run of that script
    // diffs cleanly against this.
    const r3 = (v) => (v == null ? null : Math.round(v * 1e3) / 1e3);
    seatWritten = { edgeY: r3(seat.edgeY), x0: r3(seat.x0), x1: r3(seat.x1), cover: Math.round(seat.cover * 100) / 100 };
    fit.hats[hat] = seatWritten;
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    // Python also prints a whole float as `1.0`, which JSON.stringify drops.
    const text = JSON.stringify(fit, null, 1).replace(/("(?:cover|edgeY|x0|x1)": -?\d+)(?=,?\n)/g, '$1.0');
    fs.writeFileSync(FIT_FILE, (text + '\n').replace(/\n/g, eol), 'utf8');
  }

  return { ok: true, hat, hair, polygons: cover ? cover.length : 0, removed: cover === null, seat: seatWritten };
}

// layout: { w, top | cy, dx } for `hair` while `hat` ('*' = every
// crown-covering hat) is worn, or null to go back to the plain position.
export function saveHairLayout({ hair, hat, layout }) {
  if (!ID.test(String(hair || ''))) throw new Error('Invalid hair id.');
  if (hat !== '*' && !ID.test(String(hat || ''))) throw new Error('Invalid hat id.');
  let clean = null;
  if (layout !== null) {
    clean = {};
    for (const k of LAYOUT_KEYS) {
      if (layout[k] == null) continue;
      if (!Number.isFinite(layout[k])) throw new Error(`layout.${k} must be a number.`);
      clean[k] = Math.round(layout[k] * 1e4) / 1e4;
    }
    if (clean.w == null || (clean.top == null && clean.cy == null)) throw new Error('Layout needs w and top or cy.');
  }
  const doc = readUnderHat();
  setEntry(doc.layout, hair, hat, clean);
  writeUnderHat(doc);
  return { ok: true, hair, hat, layout: clean };
}
