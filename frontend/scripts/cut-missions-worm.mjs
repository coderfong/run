// Splits the Daily Missions board art into a worm-free board and a worm sprite.
//
//   node scripts/cut-missions-worm.mjs <board-with-worm.png> [--preview <dir>]
//
// The board ships as one flat illustration with the worm painted into the grass
// at the bottom left. The Missions screen animates that worm, and an animated
// worm over an identical painted one is two worms, so the two are separated:
//
//   assets/art/panel/missions-board-bg.png   the board, grass painted back in
//   assets/art/panel/missions-worm.png       the worm alone, transparent
//
// and the worm's box on the board is printed as the `WORM_BOX` constant that
// components/missions/MissionsBoard.js places the sprite with.
//
// THE MASK is the worm's salmon body, plus the dark outline within a few pixels
// of it, holes closed. Salmon is far from both the grass (green) and the board
// (dark brown), so a colour key is enough and nothing is hand-painted.
//
// THE PATCH copies each masked pixel from the same row a fixed distance to the
// right, where the plank edge, the grass line and the lawn continue unbroken,
// and feathers the seam. The worm's painted shadow is inside the patched area
// too; the screen draws a live one that moves with the worm.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '../assets/art/panel');

// Where to look for the worm on the 941x1672 board.
const SEARCH = { x0: 150, y0: 1480, x1: 380, y1: 1640 };
// How far right the patch is lifted from. The strip there is plain lawn under
// the same plank edge.
const PATCH_DX = 150;
const OUTLINE_REACH = 5;
const SHADOW_REACH = 7;
const SHADOW_DROP = 16;
const FEATHER = 3;

const src = process.argv[2];
const previewAt = process.argv.indexOf('--preview');
const previewDir = previewAt > 0 ? process.argv[previewAt + 1] : null;
if (!src) {
  console.error('usage: node scripts/cut-missions-worm.mjs <board-with-worm.png> [--preview <dir>]');
  process.exit(1);
}

const img = PNG.sync.read(fs.readFileSync(src));
const { width: W, height: H } = img;
const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// Warm and pinkish, down to the worm's shaded underside. The board's brown is
// warm too, but carries almost no blue (b ≈ 0.2g against the worm's ≈ 0.7g).
const salmon = ([r, g, b]) => r > 110 && r - g > 35 && g > 40 && b < g + 25 && b > 0.58 * g;
const dark = ([r, g, b]) => r + g + b < 200;

// 1. Body: salmon pixels in the search box, kept only as the largest blob so a
//    stray warm pixel elsewhere in the grass cannot join it.
const inBox = (x, y) => x >= SEARCH.x0 && x < SEARCH.x1 && y >= SEARCH.y0 && y < SEARCH.y1;
let body = new Uint8Array(W * H);
for (let y = SEARCH.y0; y < SEARCH.y1; y += 1) {
  for (let x = SEARCH.x0; x < SEARCH.x1; x += 1) if (salmon(px(x, y))) body[y * W + x] = 1;
}
// The segment lines split the body into bands, so the blob is chosen with the
// bands bridged, then trimmed back to the salmon it covers.
const bridged = largestBlob(dilate(body, 3));
for (let i = 0; i < body.length; i += 1) body[i] = body[i] && bridged[i] ? 1 : 0;

// 2. Outline: dark pixels within reach of the body. 3. Close the holes (the
//    segment lines are dark and inside the body).
const near = dilate(body, OUTLINE_REACH);
const worm = new Uint8Array(W * H);
for (let y = SEARCH.y0; y < SEARCH.y1; y += 1) {
  for (let x = SEARCH.x0; x < SEARCH.x1; x += 1) {
    const i = y * W + x;
    if (body[i] || (near[i] && dark(px(x, y)))) worm[i] = 1;
  }
}
const solid = fillHoles(erode(dilate(worm, 2), 2));

// The sprite's box, padded so the edge feather has room.
let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
for (let y = SEARCH.y0; y < SEARCH.y1; y += 1) {
  for (let x = SEARCH.x0; x < SEARCH.x1; x += 1) {
    if (!solid[y * W + x]) continue;
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
}
bx0 -= 2; by0 -= 2; bx1 += 2; by1 += 2;

// The worm sprite. Alpha is the mask, softened by one pixel at its edge.
const soft = blurMask(solid, 1);
const sprite = new PNG({ width: bx1 - bx0 + 1, height: by1 - by0 + 1 });
for (let y = by0; y <= by1; y += 1) {
  for (let x = bx0; x <= bx1; x += 1) {
    const s = (y * W + x) * 4;
    const d = ((y - by0) * sprite.width + (x - bx0)) * 4;
    sprite.data[d] = img.data[s];
    sprite.data[d + 1] = img.data[s + 1];
    sprite.data[d + 2] = img.data[s + 2];
    sprite.data[d + 3] = Math.round(255 * soft[y * W + x]);
  }
}

// The clean board: the worm and its shadow (the mask grown down and out)
// replaced from PATCH_DX to the right, feathered into what is around it.
// The painted shadow falls below and a little right of the worm, further than
// the outline, so the hole is also dragged down by SHADOW_DROP.
const hole = dilate(solid, SHADOW_REACH);
for (let y = SEARCH.y1 - 1; y >= SEARCH.y0; y -= 1) {
  for (let x = SEARCH.x0; x < SEARCH.x1; x += 1) {
    if (!solid[y * W + x]) continue;
    for (let d = 1; d <= SHADOW_DROP; d += 1) for (let dx = -2; dx <= 6; dx += 1) hole[(y + d) * W + x + dx] = 1;
  }
}
const blend = blurMask(hole, FEATHER);
const board = new PNG({ width: W, height: H });
img.data.copy(board.data);
for (let y = SEARCH.y0 - 20; y < SEARCH.y1 + 20; y += 1) {
  for (let x = SEARCH.x0 - 20; x < SEARCH.x1 + 20; x += 1) {
    const a = Math.min(1, blend[y * W + x] * 1.6);
    if (a <= 0) continue;
    const d = (y * W + x) * 4;
    const s = (y * W + x + PATCH_DX) * 4;
    for (let c = 0; c < 3; c += 1) board.data[d + c] = Math.round(img.data[d + c] * (1 - a) + img.data[s + c] * a);
    board.data[d + 3] = 255;
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'missions-board-bg.png'), PNG.sync.write(board));
fs.writeFileSync(path.join(OUT_DIR, 'missions-worm.png'), PNG.sync.write(sprite));
if (previewDir) {
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(path.join(previewDir, 'mask.png'), PNG.sync.write(maskPng(hole)));
}
console.log(`board ${W}x${H}`);
console.log(`WORM_BOX = { x: ${bx0}, y: ${by0}, width: ${sprite.width}, height: ${sprite.height} }`);

// ---------------------------------------------------------------------------

function dilate(mask, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!mask[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(mask, r) {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i += 1) inv[i] = mask[i] ? 0 : 1;
  const grown = dilate(inv, r);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i += 1) out[i] = grown[i] ? 0 : 1;
  return out;
}

// Anything not reachable from outside the search box is a hole: fill it.
function fillHoles(mask) {
  const x0 = SEARCH.x0 - 1, y0 = SEARCH.y0 - 1, x1 = SEARCH.x1, y1 = SEARCH.y1;
  const outside = new Uint8Array(W * H);
  const stack = [[x0, y0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < x0 || y < y0 || x > x1 || y > y1) continue;
    const i = y * W + x;
    if (outside[i] || mask[i]) continue;
    outside[i] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const out = new Uint8Array(W * H);
  for (let y = SEARCH.y0; y < SEARCH.y1; y += 1) {
    for (let x = SEARCH.x0; x < SEARCH.x1; x += 1) {
      const i = y * W + x;
      out[i] = mask[i] || !outside[i] ? 1 : 0;
    }
  }
  return out;
}

function largestBlob(mask) {
  const seen = new Uint8Array(W * H);
  let best = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    const blob = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      blob.push(j);
      const x = j % W, y = (j / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (blob.length > best.length) best = blob;
  }
  const out = new Uint8Array(W * H);
  for (const j of best) out[j] = 1;
  return out;
}

// Box blur of a 0/1 mask to a 0..1 coverage, only near the search box.
function blurMask(mask, r) {
  const out = new Float32Array(W * H);
  const n = (2 * r + 1) * (2 * r + 1);
  for (let y = SEARCH.y0 - 30; y < SEARCH.y1 + 30; y += 1) {
    for (let x = SEARCH.x0 - 30; x < SEARCH.x1 + 30; x += 1) {
      let s = 0;
      for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) s += mask[(y + dy) * W + x + dx];
      out[y * W + x] = s / n;
    }
  }
  return out;
}

function maskPng(mask) {
  const p = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i += 1) {
    const v = mask[i] ? 255 : 0;
    p.data[i * 4] = img.data[i * 4];
    p.data[i * 4 + 1] = v ? 0 : img.data[i * 4 + 1];
    p.data[i * 4 + 2] = img.data[i * 4 + 2];
    p.data[i * 4 + 3] = 255;
  }
  return p;
}
