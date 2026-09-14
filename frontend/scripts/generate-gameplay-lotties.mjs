// Generates PASER's original, shape-only gameplay Lotties (the heart and flame
// files are separately hand-authored). Each registry slot gets its own
// composition; no unrelated event is forced through a recycled generic burst.
// Run from frontend/: node scripts/generate-gameplay-lotties.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../assets/lottie');
fs.mkdirSync(outDir, { recursive: true });

const C = {
  pink: [0.91, 0.18, 0.48, 1],
  teal: [0.18, 0.83, 0.75, 1],
  purple: [0.55, 0.27, 0.95, 1],
  gold: [0.98, 0.75, 0.12, 1],
  orange: [0.98, 0.35, 0.08, 1],
  red: [0.94, 0.2, 0.22, 1],
  cream: [0.91, 0.89, 0.83, 1],
  white: [1, 1, 1, 1],
  ink: [0.04, 0.05, 0.06, 1],
};

const stat = (k) => ({ a: 0, k });
const arr = (value) => Array.isArray(value) ? value : [value];
function anim(frames) {
  return {
    a: 1,
    k: frames.map((frame, index) => {
      const s = arr(frame.v);
      const next = frames[index + 1];
      const item = { t: frame.t, s };
      if (next) {
        const dims = s.length;
        item.e = arr(next.v);
        item.i = { x: Array(dims).fill(0.67), y: Array(dims).fill(1) };
        item.o = { x: Array(dims).fill(0.33), y: Array(dims).fill(0) };
      }
      return item;
    }),
  };
}
const prop = (value, fallback) => Array.isArray(value) && value[0]?.t != null ? anim(value) : stat(value ?? fallback);

function transform({ p = [128, 128, 0], s = [100, 100, 100], r = 0, o = 100 } = {}) {
  return { o: prop(o, 100), r: prop(r, 0), p: prop(p, [128, 128, 0]), a: stat([0, 0, 0]), s: prop(s, [100, 100, 100]) };
}

function shapeTransform() {
  return { ty: 'tr', p: stat([0, 0]), a: stat([0, 0]), s: stat([100, 100]), r: stat(0), o: stat(100), sk: stat(0), sa: stat(0), nm: 'Transform' };
}

function ellipse({ name, color, size, stroke, strokeWidth = 8, ...motion }) {
  const paint = stroke
    ? { ty: 'st', c: stat(stroke), o: stat(100), w: stat(strokeWidth), lc: 2, lj: 2, nm: `${name} Stroke` }
    : { ty: 'fl', c: stat(color), o: stat(100), r: 1, nm: `${name} Fill` };
  return layer(name, [
    { ty: 'el', p: stat([0, 0]), s: stat(size), nm: `${name} Circle` },
    paint,
    shapeTransform(),
  ], motion);
}

function rect({ name, color, size, roundness = 0, ...motion }) {
  return layer(name, [
    { ty: 'rc', p: stat([0, 0]), s: stat(size), r: stat(roundness), nm: `${name} Rectangle` },
    { ty: 'fl', c: stat(color), o: stat(100), r: 1, nm: `${name} Fill` },
    shapeTransform(),
  ], motion);
}

function pathShape({ name, color, points, closed = true, stroke = false, strokeWidth = 10, ...motion }) {
  const zeros = points.map(() => [0, 0]);
  const paint = stroke
    ? { ty: 'st', c: stat(color), o: stat(100), w: stat(strokeWidth), lc: 2, lj: 2, nm: `${name} Stroke` }
    : { ty: 'fl', c: stat(color), o: stat(100), r: 1, nm: `${name} Fill` };
  return layer(name, [
    { ty: 'sh', ks: stat({ i: zeros, o: zeros, v: points, c: closed }), nm: `${name} Path` },
    paint,
    shapeTransform(),
  ], motion);
}

let layerIndex = 0;
function layer(name, shapes, motion) {
  return { ddd: 0, ind: ++layerIndex, ty: 4, nm: name, sr: 1, ks: transform(motion), ao: 0, shapes, ip: 0, op: 240, st: 0, bm: 0 };
}

function composition(name, op, layers, fr = 60) {
  layerIndex = 0;
  // Re-index after all helper calls have created their layers.
  layers.forEach((item, index) => { item.ind = index + 1; item.op = op; });
  return { v: '5.7.4', fr, ip: 0, op, w: 256, h: 256, nm: name, ddd: 0, assets: [], layers, markers: [] };
}

const fade = (hold, end) => [{ t: 0, v: 0 }, { t: 5, v: 100 }, { t: hold, v: 100 }, { t: end, v: 0 }];
const burstRing = (color, delay = 0) => ellipse({
  name: `Ring ${delay}`,
  stroke: color,
  size: [132, 132],
  strokeWidth: 10,
  s: [{ t: delay, v: [18, 18, 100] }, { t: delay + 38, v: [122, 122, 100] }],
  o: [{ t: delay, v: 95 }, { t: delay + 38, v: 0 }],
});

const dotBurst = (name, color, start, distance = 92, count = 6) =>
  Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    return ellipse({
      name: `${name} ${i + 1}`,
      color,
      size: [14 - (i % 2) * 3, 14 - (i % 2) * 3],
      p: [
        { t: start, v: [128, 128, 0] },
        { t: start + 34, v: [128 + Math.cos(angle) * distance, 128 + Math.sin(angle) * distance, 0] },
      ],
      s: [{ t: start, v: [25, 25, 100] }, { t: start + 12, v: [100, 100, 100] }],
      o: [{ t: start, v: 0 }, { t: start + 5, v: 100 }, { t: start + 25, v: 90 }, { t: start + 38, v: 0 }],
    });
  });

const lightning = [[-12, -70], [18, -70], [2, -18], [35, -18], [-24, 72], [-8, 12], [-36, 12]];
const star = [[0, -74], [18, -24], [68, -38], [30, 6], [64, 42], [14, 30], [0, 78], [-16, 30], [-66, 44], [-31, 5], [-70, -36], [-18, -23]];
const flag = [[-30, -28], [35, -16], [-30, 3]];
const chevron = [[-34, 15], [0, -20], [34, 15]];

const animations = {
  'run-start-burst.json': composition('PASER Run Start', 58, [
    burstRing(C.teal, 12),
    rect({ name: 'Start Line Left', color: C.white, size: [86, 10], roundness: 5, p: [{ t: 0, v: [128, 150, 0] }, { t: 30, v: [46, 150, 0] }], s: [{ t: 0, v: [20, 100, 100] }, { t: 16, v: [100, 100, 100] }], o: fade(30, 46) }),
    rect({ name: 'Start Line Right', color: C.white, size: [86, 10], roundness: 5, p: [{ t: 0, v: [128, 150, 0] }, { t: 30, v: [210, 150, 0] }], s: [{ t: 0, v: [20, 100, 100] }, { t: 16, v: [100, 100, 100] }], o: fade(30, 46) }),
    ...dotBurst('Speed Spark', C.gold, 14, 94, 5),
  ]),

  'route-head-loop.json': composition('PASER Route Head Loop', 72, [
    ellipse({ name: 'Route Core', color: C.white, size: [22, 22], s: [{ t: 0, v: [90, 90, 100] }, { t: 36, v: [118, 118, 100] }, { t: 72, v: [90, 90, 100] }], o: 100 }),
    ellipse({ name: 'Route Halo A', stroke: C.teal, size: [80, 80], strokeWidth: 7, s: [{ t: 0, v: [30, 30, 100] }, { t: 50, v: [120, 120, 100] }, { t: 72, v: [130, 130, 100] }], o: [{ t: 0, v: 0 }, { t: 5, v: 72 }, { t: 50, v: 0 }, { t: 72, v: 0 }] }),
    ellipse({ name: 'Route Halo B', stroke: C.pink, size: [64, 64], strokeWidth: 5, s: [{ t: 0, v: [110, 110, 100] }, { t: 22, v: [30, 30, 100] }, { t: 72, v: [120, 120, 100] }], o: [{ t: 0, v: 0 }, { t: 22, v: 60 }, { t: 68, v: 0 }, { t: 72, v: 0 }] }),
  ]),

  'kilometre-split.json': composition('PASER Kilometre Split', 68, [
    ellipse({ name: 'Lap Ring', stroke: C.teal, size: [148, 148], strokeWidth: 12, s: [{ t: 0, v: [15, 15, 100] }, { t: 26, v: [105, 105, 100] }, { t: 50, v: [118, 118, 100] }], o: fade(44, 64) }),
    rect({ name: 'Top Tick', color: C.gold, size: [12, 34], roundness: 6, p: [128, 42, 0], s: [{ t: 8, v: [20, 20, 100] }, { t: 24, v: [100, 100, 100] }], o: fade(42, 62) }),
    rect({ name: 'Right Tick', color: C.gold, size: [34, 12], roundness: 6, p: [214, 128, 0], s: [{ t: 12, v: [20, 20, 100] }, { t: 28, v: [100, 100, 100] }], o: fade(44, 64) }),
    ...dotBurst('Split Spark', C.pink, 24, 100, 4),
  ]),

  'claim-ready.json': composition('PASER Claim Ready', 82, [
    pathShape({ name: 'Territory Outline', color: C.teal, points: [[0, -76], [74, -20], [48, 66], [-48, 66], [-74, -20]], stroke: true, strokeWidth: 11, s: [{ t: 0, v: [15, 15, 100] }, { t: 32, v: [100, 100, 100] }], o: fade(58, 80) }),
    rect({ name: 'Flag Pole', color: C.ink, size: [8, 92], roundness: 4, p: [128, 114, 0], s: [{ t: 18, v: [100, 5, 100] }, { t: 40, v: [100, 100, 100] }], o: [{ t: 18, v: 0 }, { t: 22, v: 100 }, { t: 66, v: 100 }, { t: 80, v: 0 }] }),
    pathShape({ name: 'Claim Flag', color: C.pink, points: flag, p: [158, 76, 0], s: [{ t: 30, v: [20, 20, 100] }, { t: 47, v: [110, 110, 100] }, { t: 56, v: [100, 100, 100] }], o: [{ t: 30, v: 0 }, { t: 35, v: 100 }, { t: 66, v: 100 }, { t: 80, v: 0 }] }),
    burstRing(C.gold, 42),
  ]),

  'rival-entry.json': composition('PASER Rival Entry', 64, [
    ellipse({ name: 'Warning Scan', stroke: C.red, size: [156, 156], strokeWidth: 12, s: [{ t: 0, v: [25, 25, 100] }, { t: 38, v: [120, 120, 100] }], o: [{ t: 0, v: 0 }, { t: 5, v: 85 }, { t: 40, v: 0 }] }),
    pathShape({ name: 'Left Rival Flag', color: C.orange, points: flag, p: [{ t: 4, v: [128, 128, 0] }, { t: 28, v: [74, 98, 0] }], r: -12, s: [{ t: 4, v: [20, 20, 100] }, { t: 25, v: [85, 85, 100] }], o: fade(42, 60) }),
    pathShape({ name: 'Right Rival Flag', color: C.red, points: flag, p: [{ t: 8, v: [128, 128, 0] }, { t: 32, v: [182, 98, 0] }], r: 168, s: [{ t: 8, v: [20, 20, 100] }, { t: 29, v: [85, 85, 100] }], o: [{ t: 8, v: 0 }, { t: 13, v: 100 }, { t: 44, v: 100 }, { t: 62, v: 0 }] }),
    rect({ name: 'Warning Slash', color: C.white, size: [156, 12], roundness: 6, r: -16, s: [{ t: 18, v: [5, 100, 100] }, { t: 34, v: [100, 100, 100] }], o: [{ t: 18, v: 0 }, { t: 23, v: 90 }, { t: 38, v: 0 }] }),
  ]),

  'capture-impact.json': composition('PASER Capture Impact', 54, [
    pathShape({ name: 'Contact Star', color: C.gold, points: star, s: [{ t: 0, v: [12, 12, 100] }, { t: 13, v: [112, 112, 100] }, { t: 35, v: [138, 138, 100] }], r: [{ t: 0, v: -18 }, { t: 35, v: 18 }], o: [{ t: 0, v: 0 }, { t: 3, v: 100 }, { t: 22, v: 90 }, { t: 48, v: 0 }] }),
    ellipse({ name: 'Contact Core', color: C.white, size: [78, 78], s: [{ t: 0, v: [15, 15, 100] }, { t: 10, v: [100, 100, 100] }, { t: 25, v: [70, 70, 100] }], o: [{ t: 0, v: 0 }, { t: 2, v: 100 }, { t: 18, v: 0 }] }),
    ...dotBurst('Impact Chip', C.pink, 8, 104, 6),
  ]),

  'bomb-blast.json': composition('PASER Bomb Blast', 68, [
    ellipse({ name: 'Blast Core', color: C.white, size: [96, 96], s: [{ t: 0, v: [10, 10, 100] }, { t: 8, v: [120, 120, 100] }, { t: 20, v: [160, 160, 100] }], o: [{ t: 0, v: 0 }, { t: 2, v: 100 }, { t: 16, v: 0 }] }),
    pathShape({ name: 'Blast Star', color: C.orange, points: star, s: [{ t: 0, v: [12, 12, 100] }, { t: 18, v: [112, 112, 100] }, { t: 42, v: [145, 145, 100] }], r: [{ t: 0, v: 0 }, { t: 42, v: 28 }], o: [{ t: 0, v: 0 }, { t: 3, v: 95 }, { t: 32, v: 55 }, { t: 58, v: 0 }] }),
    ...Array.from({ length: 5 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      return ellipse({ name: `Smoke Puff ${i + 1}`, color: C.cream, size: [50, 50], p: [{ t: 12, v: [128, 128, 0] }, { t: 55, v: [128 + Math.cos(angle) * 82, 128 + Math.sin(angle) * 70, 0] }], s: [{ t: 12, v: [20, 20, 100] }, { t: 34, v: [100, 100, 100] }, { t: 55, v: [135, 135, 100] }], o: [{ t: 12, v: 0 }, { t: 18, v: 80 }, { t: 48, v: 50 }, { t: 65, v: 0 }] });
    }),
  ]),

  'energy-spend.json': composition('PASER Energy Spend', 52, [
    pathShape({ name: 'Energy Bolt Spend', color: C.pink, points: lightning, s: [{ t: 0, v: [100, 100, 100] }, { t: 18, v: [118, 82, 100] }, { t: 43, v: [15, 15, 100] }], r: [{ t: 0, v: 0 }, { t: 43, v: 22 }], o: [{ t: 0, v: 100 }, { t: 26, v: 90 }, { t: 46, v: 0 }] }),
    ...dotBurst('Spent Fragment', C.purple, 4, 86, 5).map((item) => ({ ...item, ks: { ...item.ks, p: item.ks.p } })),
  ]),

  'energy-gain.json': composition('PASER Energy Gain', 58, [
    pathShape({ name: 'Energy Bolt Gain', color: C.pink, points: lightning, s: [{ t: 16, v: [10, 10, 100] }, { t: 34, v: [118, 118, 100] }, { t: 45, v: [100, 100, 100] }], r: [{ t: 16, v: -18 }, { t: 45, v: 0 }], o: [{ t: 16, v: 0 }, { t: 20, v: 100 }, { t: 48, v: 100 }, { t: 56, v: 0 }] }),
    burstRing(C.pink, 28),
    ...dotBurst('Gain Spark', C.gold, 0, 82, 5),
  ]),

  'rank-up.json': composition('PASER Rank Up', 66, [
    pathShape({ name: 'Lower Chevron', color: C.teal, points: chevron, closed: false, stroke: true, strokeWidth: 15, p: [{ t: 0, v: [128, 188, 0] }, { t: 36, v: [128, 105, 0] }], s: [{ t: 0, v: [60, 60, 100] }, { t: 20, v: [100, 100, 100] }], o: fade(42, 60) }),
    pathShape({ name: 'Upper Chevron', color: C.gold, points: chevron, closed: false, stroke: true, strokeWidth: 15, p: [{ t: 8, v: [128, 180, 0] }, { t: 44, v: [128, 62, 0] }], s: [{ t: 8, v: [60, 60, 100] }, { t: 28, v: [100, 100, 100] }], o: [{ t: 8, v: 0 }, { t: 14, v: 100 }, { t: 48, v: 100 }, { t: 64, v: 0 }] }),
    ...dotBurst('Rank Spark', C.pink, 32, 88, 4),
  ]),

  // A self-contained level marker. It deliberately has no bounce: the disc
  // resolves with one eased scale-up, then the arrow travels through it while
  // the halo dissipates. Keeping it in Lottie means the avatar never inherits
  // the marker's transform or timing.
  'level-up-arrow.json': composition('PASER Level Up Arrow', 66, [
    ellipse({ name: 'Arrow Halo', stroke: C.gold, size: [150, 150], strokeWidth: 8, s: [{ t: 16, v: [68, 68, 100] }, { t: 48, v: [118, 118, 100] }], o: [{ t: 16, v: 0 }, { t: 20, v: 70 }, { t: 48, v: 0 }] }),
    ellipse({ name: 'Arrow Disc Outline', color: C.white, size: [132, 132], s: [{ t: 12, v: [72, 72, 100] }, { t: 34, v: [100, 100, 100] }], o: [{ t: 12, v: 0 }, { t: 18, v: 100 }] }),
    ellipse({ name: 'Arrow Disc', color: C.orange, size: [112, 112], s: [{ t: 12, v: [72, 72, 100] }, { t: 34, v: [100, 100, 100] }], o: [{ t: 12, v: 0 }, { t: 18, v: 100 }] }),
    rect({ name: 'Arrow Stem', color: C.white, size: [24, 62], roundness: 8, p: [{ t: 18, v: [128, 154, 0] }, { t: 42, v: [128, 121, 0] }], s: [{ t: 18, v: [100, 45, 100] }, { t: 36, v: [100, 100, 100] }], o: [{ t: 18, v: 0 }, { t: 24, v: 100 }] }),
    pathShape({ name: 'Arrow Head', color: C.white, points: [[0, -34], [38, 8], [15, 8], [15, 28], [-15, 28], [-15, 8], [-38, 8]], p: [{ t: 18, v: [128, 134, 0] }, { t: 42, v: [128, 101, 0] }], s: [{ t: 18, v: [72, 72, 100] }, { t: 38, v: [100, 100, 100] }], o: [{ t: 18, v: 0 }, { t: 24, v: 100 }] }),
  ]),

  'club-goal-progress.json': composition('PASER Club Goal Progress', 52, [
    rect({ name: 'Progress Dash', color: C.teal, size: [92, 14], roundness: 7, p: [{ t: 0, v: [42, 128, 0] }, { t: 34, v: [210, 128, 0] }], s: [{ t: 0, v: [30, 100, 100] }, { t: 14, v: [100, 100, 100] }], o: [{ t: 0, v: 0 }, { t: 4, v: 100 }, { t: 36, v: 100 }, { t: 48, v: 0 }] }),
    ellipse({ name: 'Goal Endpoint', stroke: C.gold, size: [70, 70], strokeWidth: 9, p: [210, 128, 0], s: [{ t: 25, v: [10, 10, 100] }, { t: 48, v: [110, 110, 100] }], o: [{ t: 25, v: 0 }, { t: 30, v: 100 }, { t: 50, v: 0 }] }),
    ...dotBurst('Goal Chip', C.pink, 29, 55, 4).map((item) => ({ ...item, ks: { ...item.ks, p: prop([{ t: 29, v: [210, 128, 0] }, { t: 50, v: [210, 72, 0] }]) } })),
  ]),

  'club-goal-complete.json': composition('PASER Club Goal Complete', 96, [
    pathShape({ name: 'Club Crest', color: C.purple, points: [[0, -76], [62, -45], [52, 36], [0, 78], [-52, 36], [-62, -45]], s: [{ t: 0, v: [12, 12, 100] }, { t: 28, v: [112, 112, 100] }, { t: 42, v: [100, 100, 100] }], o: [{ t: 0, v: 0 }, { t: 5, v: 100 }, { t: 70, v: 100 }, { t: 92, v: 0 }] }),
    pathShape({ name: 'Complete Flag Left', color: C.teal, points: flag, p: [56, 72, 0], r: -18, s: [{ t: 18, v: [20, 20, 100] }, { t: 38, v: [85, 85, 100] }], o: [{ t: 18, v: 0 }, { t: 22, v: 100 }, { t: 72, v: 100 }, { t: 92, v: 0 }] }),
    pathShape({ name: 'Complete Flag Right', color: C.pink, points: flag, p: [200, 72, 0], r: 198, s: [{ t: 22, v: [20, 20, 100] }, { t: 42, v: [85, 85, 100] }], o: [{ t: 22, v: 0 }, { t: 27, v: 100 }, { t: 74, v: 100 }, { t: 94, v: 0 }] }),
    burstRing(C.gold, 30),
    ...dotBurst('Club Confetti', C.gold, 34, 110, 8),
  ]),
};

for (const [filename, animation] of Object.entries(animations)) {
  fs.writeFileSync(path.join(outDir, filename), `${JSON.stringify(animation)}\n`);
  console.log(`generated ${filename}`);
}
