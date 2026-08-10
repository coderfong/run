// Take the collar back piece off one shoe, or redraw where the cut goes.
//
// scripts/split-shoe-collars.py cuts every shoe in two so the ankle can pass
// through the collar, on a line that is right for most of them and wrong for
// some. This is the undo for the ones it gets wrong: it puts the shoe back
// together as one layer, exactly as it was before the split.
//
// Nothing is thrown away. The whole art is restored from the split's own
// backup, the back piece is moved to deleted-art/ rather than unlinked, and
// the stem is recorded in collars.json as opted out so re-running the split
// leaves it alone.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPTS = path.dirname(HERE);
const FRONTEND = path.dirname(SCRIPTS);
const SHOES = path.join(FRONTEND, 'assets', 'character', 'footwear');
const SPLIT_BACKUP = path.join(SCRIPTS, 'backups', 'shoe-collars');
const COLLARS = path.join(SCRIPTS, 'collars.json');
const CONFIG = path.join(FRONTEND, 'src', 'config', 'outfitItems.js');
const GRAVE = path.join(HERE, 'deleted-art');

// The images the rig wears for one item, which is what got split.
function wornNames(line, stem) {
  if (line.includes('footL: ')) return [`${stem}L.png`, `${stem}R.png`];
  const worn = `${stem}_worn.png`;
  return [fs.existsSync(path.join(SHOES, worn)) ? worn : `${stem}.png`];
}

export function removeCollar({ id }) {
  const src = fs.readFileSync(CONFIG, 'utf8');
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.includes(`id: '${id}'`));
  if (i < 0) return { ok: false, error: `no item ${id}` };

  const stem = (lines[i].match(/footwear\/(shoe\d+)\.png/) || [])[1];
  if (!stem) return { ok: false, error: `${id} is not footwear` };
  if (!/foot[LR]Back: |backImg: /.test(lines[i])) {
    return { ok: false, error: `${id} has no back piece` };
  }

  // Put the whole shoe back, then retire the back piece.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const grave = path.join(GRAVE, stamp);
  const restored = [];
  const moved = [];
  for (const name of wornNames(lines[i], stem)) {
    const keep = path.join(SPLIT_BACKUP, name);
    if (fs.existsSync(keep)) {
      fs.copyFileSync(keep, path.join(SHOES, name));
      restored.push(name);
    }
    const back = `${name.replace(/\.png$/, '')}-back.png`;
    if (fs.existsSync(path.join(SHOES, back))) {
      fs.mkdirSync(grave, { recursive: true });
      fs.renameSync(path.join(SHOES, back), path.join(grave, back));
      moved.push(back);
    }
  }
  if (!restored.length) {
    return { ok: false, error: `no pre-split backup for ${stem}; refusing to ` +
      `strip the catalogue and leave the shoe missing its collar` };
  }

  fs.copyFileSync(CONFIG, path.join(HERE, 'backups',
    `outfitItems.js.collarbak-${stamp}`));
  lines[i] = lines[i]
    .replace(/foot[LR]Back: require\('[^']*'\), /g, '')
    .replace(/backImg: require\('[^']*footwear[^']*'\), /g, '');
  fs.writeFileSync(CONFIG, lines.join('\n'), 'utf8');

  // Opt the stem out, so the next split run does not undo this.
  const map = fs.existsSync(COLLARS)
    ? JSON.parse(fs.readFileSync(COLLARS, 'utf8')) : { cut: {} };
  map.cut = map.cut || {};
  map.cut[stem] = null;
  fs.writeFileSync(COLLARS, JSON.stringify(map, null, 1), 'utf8');

  return { ok: true, id, stem, restored, moved, gravePath: moved.length ? grave : null };
}

// --- painting the cut by hand ----------------------------------------------
// The split's line is horizontal because these shoes are drawn in three-quarter
// view, and on most of them one line is enough. On the rest it is not: a boot
// with a folded cuff or a strap that rises on one side wants a shaped edge. So
// the line can be redrawn per shoe, by brushing pixels from one piece to the
// other in the studio.
//
// The pieces are never edited in place. Both are recomputed each save from the
// WHOLE shoe — the copy the split kept — and a mask the brush moves, so a pixel
// is always on exactly one side of the leg and nothing can be lost by painting.

const ART_REQ = (name) => `require('../../assets/character/footwear/${name}')`;
const backName = (name) => `${name.replace(/\.png$/, '')}-back.png`;
const artUrl = (name) => `/art/assets/character/footwear/${name}`;

// The shoe before any cut. Kept aside by the split on the first run; a shoe it
// never touched is still whole where it lies.
export function origFile(name) {
  if (!/^shoe[\w-]+\.png$/.test(name)) return null;
  const keep = path.join(SPLIT_BACKUP, name);
  return fs.existsSync(keep) ? keep : path.join(SHOES, name);
}

// The line the item's own id sits on, with the stem read off its art.
function findItem(id) {
  const lines = fs.readFileSync(CONFIG, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(`id: '${id}'`));
  if (i < 0) return { error: `no item ${id}` };
  const stem = (lines[i].match(/footwear\/(shoe\d+)\.png/) || [])[1];
  if (!stem) return { error: `${id} is not footwear` };
  return { lines, i, stem };
}

// What the editor needs to open: the whole shoe to paint on, and the back piece
// as it stands, which is the mask it starts from.
export function collarArt({ id }) {
  const found = findItem(id);
  if (found.error) return { ok: false, error: found.error };
  const { lines, i, stem } = found;
  const pieces = wornNames(lines[i], stem).map((name) => ({
    name,
    label: /L\.png$/.test(name) ? 'left shoe' : /R\.png$/.test(name) ? 'right shoe' : 'pair',
    orig: `/collar-orig/${name}`,
    back: fs.existsSync(path.join(SHOES, backName(name))) ? artUrl(backName(name)) : null,
  }));
  return { ok: true, id, stem, pieces };
}

// Point the catalogue at a back piece it is not carrying yet. Same anchors as
// scripts/wire-shoe-collars.py, so a hand-painted shoe reads no differently
// from a machine-cut one.
function wireBack(line, names) {
  if (line.includes('footL: ')) {
    if (line.includes('footLBack: ')) return line;
    const at = line.match(/footR: require\('[^']*'\), /);
    if (!at) return null;
    const ins = ['L', 'R']
      .map((s) => {
        const name = names.find((n) => n.endsWith(`${s}.png`));
        return name ? `foot${s}Back: ${ART_REQ(backName(name))}, ` : '';
      })
      .join('');
    const end = at.index + at[0].length;
    return line.slice(0, end) + ins + line.slice(end);
  }
  if (line.includes('backImg: ')) return line;
  const at = line.match(/(?:wornImg|img): require\('[^']*'\), /);
  if (!at) return null;
  const end = at.index + at[0].length;
  return line.slice(0, end) + `backImg: ${ART_REQ(backName(names[0]))}, ` + line.slice(end);
}

const pngBytes = (data) =>
  Buffer.from(String(data || '').replace(/^data:image\/png;base64,/, ''), 'base64');

// `pieces` is [{ name, front, back }] as PNG data URLs, one per image the rig
// wears. `back` is null on every piece when the brush has cleared the collar
// altogether, which is the same outcome as the Remove button.
export function savePaint({ id, pieces }) {
  const found = findItem(id);
  if (found.error) return { ok: false, error: found.error };
  const { lines, i, stem } = found;
  const want = wornNames(lines[i], stem);
  if (!Array.isArray(pieces) || !pieces.length) return { ok: false, error: 'nothing to save' };
  for (const p of pieces) {
    if (!want.includes(p.name)) return { ok: false, error: `${p.name} is not part of ${id}` };
    if (!p.front) return { ok: false, error: `${p.name} came back without a front piece` };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  // The whole shoe has to survive being written over. The split keeps a copy of
  // everything it cuts; a shoe it never cut is still whole on disk, so take the
  // copy now, before the front piece replaces it.
  for (const p of pieces) {
    const keep = path.join(SPLIT_BACKUP, p.name);
    if (!fs.existsSync(keep)) {
      fs.mkdirSync(SPLIT_BACKUP, { recursive: true });
      fs.copyFileSync(path.join(SHOES, p.name), keep);
    }
  }

  const kept = path.join(HERE, 'backups', 'collar-paint', stamp);
  fs.mkdirSync(kept, { recursive: true });
  const wrote = [];
  const moved = [];
  const grave = path.join(GRAVE, stamp);
  for (const p of pieces) {
    const back = backName(p.name);
    for (const name of [p.name, back]) {
      const live = path.join(SHOES, name);
      if (fs.existsSync(live)) fs.copyFileSync(live, path.join(kept, name));
    }
    fs.writeFileSync(path.join(SHOES, p.name), pngBytes(p.front));
    wrote.push(p.name);
    if (p.back) {
      fs.writeFileSync(path.join(SHOES, back), pngBytes(p.back));
      wrote.push(back);
    } else if (fs.existsSync(path.join(SHOES, back))) {
      fs.mkdirSync(grave, { recursive: true });
      fs.renameSync(path.join(SHOES, back), path.join(grave, back));
      moved.push(back);
    }
  }

  // Brushing the collar on or off changes what the catalogue has to name.
  const anyBack = pieces.some((p) => p.back);
  const next = anyBack
    ? wireBack(lines[i], pieces.map((p) => p.name))
    : lines[i]
        .replace(/foot[LR]Back: require\('[^']*'\), /g, '')
        .replace(/backImg: require\('[^']*footwear[^']*'\), /g, '');
  if (next == null) {
    return { ok: false, error: `${id}: nowhere to add the back piece on its catalogue line` };
  }
  let catalogue = 'unchanged';
  if (next !== lines[i]) {
    fs.copyFileSync(CONFIG, path.join(HERE, 'backups', `outfitItems.js.collarbak-${stamp}`));
    lines[i] = next;
    fs.writeFileSync(CONFIG, lines.join('\n'), 'utf8');
    catalogue = anyBack ? 'wired' : 'stripped';
  }

  // Hands off from here: a shoe cut by hand must not be re-cut by the script.
  const map = fs.existsSync(COLLARS)
    ? JSON.parse(fs.readFileSync(COLLARS, 'utf8')) : { cut: {} };
  map.cut = map.cut || {};
  map.cut[stem] = null;
  map.painted = { ...(map.painted || {}), [stem]: stamp };
  fs.writeFileSync(COLLARS, JSON.stringify(map, null, 1), 'utf8');

  return { ok: true, id, stem, wrote, moved, catalogue, keptPath: kept };
}
