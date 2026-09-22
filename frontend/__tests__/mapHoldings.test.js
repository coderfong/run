// Touching land held by one runner draws as one holding.
//
// The seams these merge away are made by the claim endpoint itself: a run that
// overlaps its owner's existing ground keeps the new footprint as one row and
// re-inserts `ST_Difference(old, footprint)` as another, so the two share an
// exact edge. Every case below is shaped like that.

import { mergeTouchingLand } from '../src/map/holdings';

const sq = (x, y, w = 1) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]];

const land = (id, user_id, ring, extra = {}) => ({
  id,
  user_id,
  rings: [ring],
  polygon: ring,
  area_m2: 100,
  clan_tag: null,
  freshness: 1,
  reinforcements: 0,
  contested: false,
  ...extra,
});

describe('merging touching land', () => {
  it('draws two edge-sharing plots of one runner as a single holding', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0)),
      land('b', 'u1', sq(1, 0)),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].rings).toHaveLength(1);
    // The seam at x=1 is gone: the merged outline is the 2x1 rectangle, so no
    // vertex sits inside the span the two plots used to share.
    const xs = out[0].rings[0].map(([x]) => x);
    const ys = out[0].rings[0].map(([, y]) => y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(2);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(1);
    expect(out[0].rings[0].some(([x, y]) => x === 1 && y > 0 && y < 1)).toBe(false);
  });

  it('gives the holding one portrait by giving it one row', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0)),
      land('b', 'u1', sq(1, 0)),
      land('c', 'u1', sq(2, 0)),
    ]);

    // Portraits are built one per row, so one row is one face.
    expect(out).toHaveLength(1);
    expect(out[0].mergedFrom.sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves land belonging to different runners alone', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0)),
      land('b', 'u2', sq(1, 0)),
    ]);

    expect(out).toHaveLength(2);
    expect(out.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  // One runner can hold neighbouring pieces under two badges, because a claim
  // splits its footprint by club attribution. The badge is what colours the
  // plot, so merging across it would paint one club's ground in another's.
  it('keeps one runner’s two club badges apart', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0), { clan_tag: 'RUN' }),
      land('b', 'u1', sq(1, 0), { clan_tag: 'PACE' }),
    ]);

    expect(out).toHaveLength(2);
    expect(out.map((t) => t.clan_tag).sort()).toEqual(['PACE', 'RUN']);
  });

  it('keeps one runner’s separated holdings separate', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0)),
      land('b', 'u1', sq(1, 0)),
      land('far', 'u1', sq(50, 50)),
    ]);

    expect(out).toHaveLength(2);
    const areas = out.map((t) => t.area_m2).sort((x, y) => x - y);
    expect(areas).toEqual([100, 200]);
  });

  // Land pinched to a single point is two plots that graze, not one holding.
  it('does not merge plots that meet only at a corner', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0)),
      land('b', 'u1', sq(1, 1)),
    ]);

    expect(out).toHaveLength(2);
  });

  it('wears the largest member’s identity and sums the holding’s area', () => {
    const out = mergeTouchingLand([
      land('small', 'u1', sq(0, 0), { area_m2: 40, freshness: 0.1, reinforcements: 0 }),
      land('big', 'u1', sq(1, 0), { area_m2: 900, freshness: 0.9, reinforcements: 4 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('big');
    expect(out[0].freshness).toBe(0.9);
    expect(out[0].reinforcements).toBe(4);
    expect(out[0].area_m2).toBe(940);
  });

  // A merge must never be able to hide a fight.
  it('keeps the contested flag if any member carries it', () => {
    const out = mergeTouchingLand([
      land('a', 'u1', sq(0, 0), { area_m2: 900 }),
      land('b', 'u1', sq(1, 0), { area_m2: 40, contested: true }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].contested).toBe(true);
  });

  // A tap resolves the feature's territoryId against the ORIGINAL rows, so the
  // id a merged holding carries has to be one of them.
  it('carries an id that still resolves to a real claim', () => {
    const rows = [land('a', 'u1', sq(0, 0)), land('b', 'u1', sq(1, 0))];
    const out = mergeTouchingLand(rows);

    expect(rows.some((t) => t.id === out[0].id)).toBe(true);
  });

  it('merges a runner’s multi-piece row with the claim that cut it', () => {
    // `b` is a remainder: one row, two pieces, each touching `a`.
    const out = mergeTouchingLand([
      land('a', 'u1', sq(1, 0)),
      { ...land('b', 'u1', sq(0, 0)), rings: [sq(0, 0), sq(2, 0)] },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].rings).toHaveLength(1);
  });

  it('survives junk without taking the board down', () => {
    expect(mergeTouchingLand(null)).toEqual([]);
    expect(mergeTouchingLand([])).toEqual([]);
    const broken = [
      land('a', 'u1', [[0, 0], [1, 0]]),
      land('b', 'u1', [[0, 0], [1, 0]]),
    ];
    expect(mergeTouchingLand(broken)).toHaveLength(2);
  });
});

// A runner who joined a club holds pieces from before and after it, under two
// badges. Their own board paints all of it in their accent, so it must draw as
// one holding with one face; anyone else's still splits on the badge.
describe('the viewer\'s own land across club badges', () => {
  const plots = () => [
    land('a', 'me', sq(0, 0), { clan_tag: null }),
    land('b', 'me', sq(1, 0), { clan_tag: 'RUN' }),
  ];

  it('merges when the viewer\'s land is drawn in one colour', () => {
    const out = mergeTouchingLand(plots(), { oneColourFor: 'me' });
    expect(out).toHaveLength(1);
    expect(out[0].mergedFrom.sort()).toEqual(['a', 'b']);
  });

  it('still splits on the badge for everyone else', () => {
    expect(mergeTouchingLand(plots())).toHaveLength(2);
    expect(mergeTouchingLand(plots(), { oneColourFor: 'someone-else' })).toHaveLength(2);
  });
});
