// The rank ladder — ten tiers, three divisions each, and the palette they are
// drawn in.
//
// THIS REPLACED THE ELO CARD. The app used to state standing as a bare number
// with a win/loss/draw record under it, which is a rating rather than a rank:
// "1,247 Elo, 12W 9L 1D" answers a question nobody asked and hides the only
// one anybody does, which is how far off the next badge you are. The ladder is
// the same underlying rating presented as a place you are standing on: a tier,
// a division inside it, and the gap to the one above.
//
// DIVISIONS ARE PRESENTATION, NOT A SECOND SYSTEM. Nothing is stored per
// division and the server knows nothing about them. A tier band is simply cut
// into three, so the long climb through Gold has two visible steps in it
// instead of a bar that creeps for a fortnight. They are numbered UPWARD
// (Gold I, then Gold II, then Gold III) because the ladder is drawn as a
// column you climb and the numbers have to run the same way as the column.
//
// The tier KEYS are the ones the whole app already uses for portrait borders
// and map filters (wood..mythic), so a badge, a border and a map tier can
// never disagree about what somebody is.

// Divisions per tier. Three: two is not a ladder and four makes the top tier's
// plaque stack taller than the screen.
export const DIVISIONS = 3;

// Solo outcome ranges mirror backend/app/elo.py.
export const RANK_SWING = 16;
export const RANK_SWING_MAX = 32;
export const RANK_RANGES = { take: '+1–24', hold: '+1–16', open: '+1–4', lose: '−1–32', decay: '−1–8', failed: '−1–16' };

// Roman numerals, and only ever these three. Written out rather than computed
// because a numeral function is a lot of code to produce a list of length 3.
const NUMERALS = ['I', 'II', 'III'];

// The ten tiers, floor first. Mirrors ELO_TIERS in backend/app/elo.py and
// RANK_TIERS in backend/app/ranks.py — the two ladders carry the same keys in
// the same order, which is what lets this file draw either one.
//
// `color` is the plaque and the badge. `glow` is the light the rank up
// ceremony floods the screen with, and is deliberately hotter than the plaque:
// a beam painted in the plaque's own colour looks like a bigger plaque.
export const RANK_TIERS = [
  { key: 'wood', label: 'Wood', color: '#a1724a', glow: '#c98f5e', ink: '#3d2415' },
  { key: 'bronze', label: 'Bronze', color: '#c87f3a', glow: '#f0a95c', ink: '#4a2a0e' },
  { key: 'silver', label: 'Silver', color: '#b4c0cc', glow: '#e8f1fb', ink: '#2f3946' },
  { key: 'gold', label: 'Gold', color: '#f2b632', glow: '#ffe07a', ink: '#4d3200' },
  { key: 'platinum', label: 'Platinum', color: '#5fd4c4', glow: '#a5f5ea', ink: '#0d3f39' },
  { key: 'diamond', label: 'Diamond', color: '#5aa9f5', glow: '#a8d6ff', ink: '#0b2f52' },
  { key: 'onyx', label: 'Onyx', color: '#6b6f86', glow: '#a9adc9', ink: '#16182a' },
  { key: 'ember', label: 'Ember', color: '#f2643c', glow: '#ffa070', ink: '#4d1508' },
  { key: 'prismatic', label: 'Prismatic', color: '#b06bf0', glow: '#dcaaff', ink: '#33104f' },
  { key: 'mythic', label: 'Mythic', color: '#ff3d8b', glow: '#ff9ec4', ink: '#4d0022' },
];

export const TOP_TIER = RANK_TIERS.length - 1;

const BY_KEY = RANK_TIERS.reduce((acc, tier, index) => {
  acc[tier.key] = { ...tier, tier: index };
  return acc;
}, {});

/** A tier descriptor from its key, falling back to the bottom of the ladder. */
export function tierByKey(key) {
  return BY_KEY[key] || { ...RANK_TIERS[0], tier: 0 };
}

/** A tier descriptor from its index, clamped to the ladder. */
export function tierAt(index) {
  const i = Math.max(0, Math.min(TOP_TIER, Math.round(Number(index) || 0)));
  return { ...RANK_TIERS[i], tier: i };
}

/**
 * Where a standing sits on the ladder: tier, division, and progress inside it.
 *
 * Takes the payload shape the server already sends for a rank — a tier index
 * or key, the points, the floor of the current tier and the floor of the next
 * one. Everything derived here is presentation.
 *
 * `progress` is progress across the WHOLE tier (what the tier plaque's rail
 * fills with); `divisionProgress` is progress across the current division
 * only (what the compact card fills with, so it visibly moves in a week).
 */
export function standingFrom(rank) {
  const source = rank || {};
  const key = source.key || source.rank_key;
  const index = key ? tierByKey(key).tier : Math.max(0, Math.min(TOP_TIER, Number(source.tier) || 0));
  const tier = tierAt(index);

  const points = Math.max(0, Number(source.points ?? source.rating ?? source.rank_points) || 0);
  const nextRaw = source.next_points ?? source.next_rating ?? source.rank_next_points;
  const next = nextRaw != null && Number.isFinite(Number(nextRaw)) ? Number(nextRaw) : null;

  // A MISSING THRESHOLD IS NOT THE TOP OF THE LADDER. Only Mythic has nothing
  // above it; every other tier with a null `next` is simply a payload that did
  // not carry one (a partial response, a board row, an unrated account whose
  // rank object is empty). Reading the two as the same thing put every brand
  // new player on "Wood III, top of the ladder", which is the worst possible
  // first impression of a ranking system.
  const atCeiling = index >= TOP_TIER;

  // TWO WAYS TO THE SAME NUMBER, because the payloads genuinely differ.
  // /me/progression sends the tier's `floor` and the position is computed from
  // it; /me/stats sends `rank_progress` already worked out and no floor at all.
  // Preferring the floor keeps this exact where it can be, and falling back to
  // a supplied progress is what stops the profile card showing everybody at
  // division one, nought percent — which is what a missing floor silently
  // produces if you treat it as equal to the points.
  const hasFloor = source.floor != null && Number.isFinite(Number(source.floor));
  const floor = hasFloor ? Number(source.floor) : points;
  const suppliedProgress = Number(source.progress ?? source.rank_progress);

  // At the ceiling there is no band to divide, so the top tier is one whole
  // division and reads as full. Anything else would show Mythic sitting at 4%
  // of a span that does not exist.
  const span = next != null ? Math.max(1, next - floor) : 0;
  const measured = hasFloor && next != null
    ? (points - floor) / span
    : (Number.isFinite(suppliedProgress) ? suppliedProgress : 0);
  const progress = atCeiling ? 1 : Math.max(0, Math.min(1, measured));

  const division = atCeiling
    ? DIVISIONS
    : Math.max(1, Math.min(DIVISIONS, Math.floor(progress * DIVISIONS) + 1));
  const divisionProgress = atCeiling
    ? 1
    : Math.max(0, Math.min(1, progress * DIVISIONS - (division - 1)));

  return {
    ...tier,
    points,
    floor,
    next,
    progress,
    division,
    divisionProgress,
    // "Gold II". The one string the whole ladder is labelled with, so a plaque,
    // a ceremony and a compact card can never phrase it differently.
    name: `${tier.label} ${NUMERALS[division - 1]}`,
    // Points still to go. Null when there is nothing to go to (the ceiling) or
    // nothing to go on (a payload with no threshold in it) — the caller shows
    // the plaque alone in both cases rather than a gap of NaN.
    toNext: atCeiling || next == null ? null : Math.max(0, next - points),
    isTop: atCeiling,
  };
}

/**
 * The points a given tier and division begins at.
 *
 * The ladder screen draws every rung, not just the one you are on, so it needs
 * a threshold for rungs the payload says nothing about. Derived from the tier
 * floors the server sent, falling back to the ladder's own floors.
 */
export function divisionFloor(floors, tierIndex, division) {
  const floor = floors[tierIndex];
  const above = floors[tierIndex + 1];
  if (floor == null) return null;
  if (above == null) return floor;
  return Math.round(floor + ((above - floor) * (division - 1)) / DIVISIONS);
}

/**
 * Every rung of the ladder, bottom first, ready to render as a column.
 *
 * `floors` is the per tier points threshold (from /leaderboard/rank-ladder, or
 * the tier floors on a rank payload). `shares` is the measured percentage of
 * players at or above each tier — absent until that request lands, and the
 * plaque simply omits the line rather than inventing one.
 */
export function ladderRungs({ floors = [], shares = [] } = {}) {
  return RANK_TIERS.map((tier, index) => ({
    ...tier,
    tier: index,
    floor: floors[index] ?? null,
    topPercent: shares[index] ?? null,
    divisions: Array.from({ length: DIVISIONS }, (_, d) => ({
      division: d + 1,
      numeral: NUMERALS[d],
      name: `${tier.label} ${NUMERALS[d]}`,
      floor: divisionFloor(floors, index, d + 1),
    })),
  }));
}

/** The numeral for a division, for callers building their own labels. */
export function numeral(division) {
  return NUMERALS[Math.max(1, Math.min(DIVISIONS, division)) - 1];
}

// ---------------------------------------------------------------------------
// The bar the payoff moves.
//
// Everywhere else on the ladder the thresholds arrive from the server
// (/leaderboard/rank-ladder) and this file only draws them — a screen can
// afford to wait a request for a number it is going to print. The claim payoff
// cannot: it is four seconds long, it opens on top of a celebration, and a bar
// that starts blank and snaps into place once a request lands is worse than no
// bar at all. So the floors are mirrored here for THAT one use, and every
// caller may still pass the measured ones in.
//
// Mirrors ELO_TIERS in backend/app/elo.py, tier for tier, in the same order as
// RANK_TIERS above.
// ---------------------------------------------------------------------------

export const RANK_FLOORS = [800, 1050, 1200, 1350, 1500, 1650, 1800, 1950, 2150, 2400];

/**
 * The ladder cut into its DIVISION bands, bottom first.
 *
 * One entry per rung a bar can be part-way up: thirty of them, or twenty-eight
 * plus Mythic, which has nothing above it and is therefore one whole band that
 * always reads as full.
 */
export function rankBands(floors) {
  const src = Array.isArray(floors) && floors.length === RANK_TIERS.length ? floors : RANK_FLOORS;
  const bands = [];
  RANK_TIERS.forEach((tier, index) => {
    const above = src[index + 1];
    if (above == null) {
      bands.push({
        ...tier,
        tier: index,
        division: DIVISIONS,
        name: `${tier.label} ${NUMERALS[DIVISIONS - 1]}`,
        lo: src[index],
        hi: null,
      });
      return;
    }
    for (let d = 1; d <= DIVISIONS; d += 1) {
      bands.push({
        ...tier,
        tier: index,
        division: d,
        name: `${tier.label} ${NUMERALS[d - 1]}`,
        lo: divisionFloor(src, index, d),
        hi: divisionFloor(src, index, d + 1),
      });
    }
  });
  return bands;
}

/** The band a points total stands on. Below the ladder's floor is still Wood I. */
export function bandAt(points, bands) {
  let index = 0;
  for (let i = 0; i < bands.length; i += 1) {
    if (points >= bands[i].lo) index = i;
  }
  return index;
}

/** Where inside its own band a points total sits, 0…1. */
function bandFraction(points, band) {
  if (band.hi == null) return 1;
  const span = Math.max(1, band.hi - band.lo);
  return Math.max(0, Math.min(1, (points - band.lo) / span));
}

/**
 * The move from one standing to another, as passes over ONE track.
 *
 * The same shape `xpSteps` produces, and for the same reason: a bar that jumps
 * to a percentage says where you ended up, and this has to say what happened.
 * The difference is that rank falls as well as climbs — a lost defence empties
 * the track back through the division below — so the passes run in whichever
 * direction the points went, and `from`/`to` are not ordered.
 */
export function rankSteps(fromPoints, toPoints, bands) {
  if (!bands?.length) return [];
  const first = bandAt(fromPoints, bands);
  const last = bandAt(toPoints, bands);
  const dir = last >= first ? 1 : -1;
  const out = [];
  for (let i = first; dir > 0 ? i <= last : i >= last; i += dir) {
    const band = bands[i];
    out.push({
      band,
      from: i === first ? bandFraction(fromPoints, band) : (dir > 0 ? 0 : 1),
      to: i === last ? bandFraction(toPoints, band) : (dir > 0 ? 1 : 0),
    });
  }
  return out;
}
