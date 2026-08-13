// Pure layout for reaction stickers drawn over a Home feed route thumbnail.
// Counts become individual emoji, and positions prefer clear ground away from
// the projected route instead of using fixed corners that may cover it.

export const MAX_ROUTE_STICKERS = 12;

const SLOT_FRACTIONS = [
  [0.065, 0.16], [0.225, 0.17], [0.395, 0.15], [0.585, 0.17], [0.765, 0.15], [0.935, 0.16],
  [0.075, 0.49], [0.235, 0.52], [0.405, 0.48], [0.595, 0.52], [0.765, 0.47], [0.925, 0.51],
  [0.065, 0.83], [0.225, 0.84], [0.395, 0.82], [0.585, 0.85], [0.765, 0.81], [0.935, 0.83],
];

const TILTS = [-11, 8, -6, 12, -9, 7, 10, -8, 5, -12, 9, -5, 7, -10, 11, -7, 6, -9];

function hash(value) {
  const text = String(value ?? '');
  let out = 0;
  for (let i = 0; i < text.length; i += 1) out = (out * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(out);
}

/** Turn aggregate rows into actual stickers, sharing slots fairly by type. */
export function expandReactionStickers(reactions = [], limit = MAX_ROUTE_STICKERS) {
  const rows = reactions
    .map((row) => ({ ...row, count: Math.max(0, Math.floor(Number(row?.count) || 0)) }))
    .filter((row) => row.emote && row.count > 0)
    // Server ordering changes when two counts cross. Stable emote ordering
    // stops every existing sticker jumping when that happens.
    .sort((a, b) => String(a.emote).localeCompare(String(b.emote)));
  const used = new Map();
  const out = [];
  let remaining = rows.reduce((sum, row) => sum + row.count, 0);

  while (remaining > 0 && out.length < limit) {
    for (const row of rows) {
      const ordinal = used.get(row.emote) || 0;
      if (ordinal >= row.count) continue;
      out.push({
        emote: row.emote,
        mine: !!row.mine,
        ordinal,
        key: `${row.emote}:${ordinal}`,
      });
      used.set(row.emote, ordinal + 1);
      remaining -= 1;
      if (out.length >= limit) break;
    }
  }
  return out;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(point.x - start[0], point.y - start[1]);
  const t = Math.max(0, Math.min(1,
    ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / length2
  ));
  return Math.hypot(point.x - (start[0] + t * dx), point.y - (start[1] + t * dy));
}

function routeDistance(point, layers) {
  let best = Infinity;
  for (const layer of layers || []) {
    for (let i = 1; i < (layer || []).length; i += 1) {
      best = Math.min(best, distanceToSegment(point, layer[i - 1], layer[i]));
    }
  }
  return best;
}

/** Scatter stickers, preferring route clearance and then separation. */
export function scatterReactionStickers(
  stickers,
  avoidLayers,
  seed,
  { width = 300, height = 110, size = 28 } = {}
) {
  if (!stickers?.length) return [];
  const offset = hash(seed) % SLOT_FRACTIONS.length;
  let available = SLOT_FRACTIONS.map((unused, index) => {
    const shifted = (index + offset) % SLOT_FRACTIONS.length;
    const [sx, sy] = SLOT_FRACTIONS[shifted];
    const point = { x: sx * width, y: sy * height };
    return {
      ...point,
      tilt: TILTS[(shifted + hash(seed)) % TILTS.length],
      routeGap: routeDistance(point, avoidLayers),
      tie: hash(`${seed}:${shifted}`) % 997,
    };
  });
  const chosen = [];
  const clearance = size * 0.72;

  for (const sticker of stickers.slice(0, available.length)) {
    // Never trade route clearance merely for an even scatter. A dense scribble
    // may leave no fully clear slot; then the furthest remaining one wins.
    const clear = available.filter((slot) => slot.routeGap >= clearance);
    const pool = clear.length ? clear : available;
    const scored = pool.map((slot) => {
      const neighbourGap = chosen.length
        ? Math.min(...chosen.map((other) => Math.hypot(slot.x - other.x, slot.y - other.y)))
        : Math.max(width, height);
      return {
        slot,
        score: Math.min(slot.routeGap, 90) * 2
          + Math.min(neighbourGap, 90)
          + slot.tie / 10000,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0].slot;
    chosen.push({ ...sticker, x: selected.x, y: selected.y, tilt: selected.tilt });
    available = available.filter((slot) => slot !== selected);
  }
  return chosen;
}
