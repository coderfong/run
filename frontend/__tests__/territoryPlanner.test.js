/**
 * The Territory Planner's arithmetic, and the intelligence layers' honesty.
 *
 * WHY THIS IS TESTED HARDER THAN A NORMAL SCREEN. These are the numbers PASER
 * asks people to pay for, and they are numbers somebody will plan a real run
 * around. The app has already been bitten once by a client-side claim formula
 * drifting from the server's — the comment at the top of config/economy.js
 * records it promising 1.99 km² where the server granted 0.375. This suite
 * exists so that cannot happen again quietly:
 *
 *   · the land estimate must come from the SHARED economy mirror, not from
 *     anything re-derived here;
 *   · route classification must be measured against real polygons;
 *   · a layer whose backend data does not exist yet must render NOTHING,
 *     structurally, rather than as a matter of somebody remembering to.
 */

import { claimAreaM2 } from '../src/config/economy';
import {
  analyseRoute,
  haversineM,
  pointInRing,
  routeLengthM,
  sampleRoute,
} from '../src/map/planner';
import {
  AT_RISK_FRESHNESS,
  LAYERS,
  layerByKey,
  layerFeatureCollection,
  territoriesForLayer,
} from '../src/map/intelligence';

// A square of side ~roughly 220 m at this latitude, as [lon, lat] like the API
// sends. Small enough to be a plausible plot, big enough to sample inside.
const square = (lon, lat, size = 0.002) => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];

const territory = (over) => ({
  id: 't1',
  user_id: 'them',
  username: 'rival',
  area_m2: 40000,
  strength: 1,
  defenders: 1,
  contested: false,
  freshness: 1,
  created_at: new Date().toISOString(),
  polygon: square(0, 51),
  ...over,
});

describe('distance', () => {
  it('measures a known separation to within a metre', () => {
    // 0.001 degrees of latitude is ~111.2 m anywhere on Earth.
    const d = haversineM({ latitude: 51, longitude: 0 }, { latitude: 51.001, longitude: 0 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(113);
  });

  it('sums a multi leg route', () => {
    const pts = [
      { latitude: 51, longitude: 0 },
      { latitude: 51.001, longitude: 0 },
      { latitude: 51.002, longitude: 0 },
    ];
    expect(routeLengthM(pts)).toBeCloseTo(haversineM(pts[0], pts[1]) * 2, 0);
  });

  it('is zero for a route that is not one yet', () => {
    expect(routeLengthM([])).toBe(0);
    expect(routeLengthM([{ latitude: 51, longitude: 0 }])).toBe(0);
  });
});

describe('sampling', () => {
  it('walks the line at roughly the requested spacing', () => {
    const pts = [
      { latitude: 51, longitude: 0 },
      { latitude: 51.01, longitude: 0 }, // ~1112 m
    ];
    const samples = sampleRoute(pts, 25);
    // ~1112 / 25 ≈ 44, plus the endpoints.
    expect(samples.length).toBeGreaterThan(40);
    expect(samples.length).toBeLessThan(50);
  });

  it('caps the work on an absurdly long route rather than hanging', () => {
    const pts = [
      { latitude: 0, longitude: 0 },
      { latitude: 10, longitude: 0 }, // ~1100 km
    ];
    // Widening the spacing rather than producing 44,000 samples is the whole
    // point: a runner can drag the planner across a continent.
    expect(sampleRoute(pts, 25).length).toBeLessThanOrEqual(1300);
  });
});

describe('containment', () => {
  const ring = square(0, 51);

  it('finds a point inside', () => {
    expect(pointInRing({ latitude: 51.001, longitude: 0.001 }, ring)).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(pointInRing({ latitude: 51.5, longitude: 0.001 }, ring)).toBe(false);
  });

  it('treats a degenerate ring as containing nothing', () => {
    expect(pointInRing({ latitude: 51, longitude: 0 }, [[0, 51]])).toBe(false);
    expect(pointInRing({ latitude: 51, longitude: 0 }, null)).toBe(false);
  });
});

describe('analyseRoute', () => {
  // A line straight through the middle of one rival plot and out the far side.
  const through = [
    { latitude: 51.001, longitude: -0.004 },
    { latitude: 51.001, longitude: 0.006 },
  ];

  it('takes its land estimate from the shared economy curve, not its own maths', () => {
    // The single most important assertion in this file. If the planner ever
    // grows its own formula, this fails.
    const out = analyseRoute({ points: through, territories: [], userId: 'me' });
    expect(out.estimatedClaimM2).toBe(claimAreaM2(out.distanceM));
  });

  it('reports open ground when there is nothing in the way', () => {
    const out = analyseRoute({ points: through, territories: [], userId: 'me' });
    expect(out.openShare).toBe(1);
    expect(out.ownShare).toBe(0);
    expect(out.rivalShare).toBe(0);
    expect(out.crossings).toEqual([]);
  });

  it('names the rival plot a route actually crosses', () => {
    const out = analyseRoute({ points: through, territories: [territory()], userId: 'me' });
    expect(out.crossings).toHaveLength(1);
    expect(out.crossings[0]).toMatchObject({ id: 't1', username: 'rival', mine: false });
    expect(out.rivalShare).toBeGreaterThan(0);
    expect(out.rivalsCrossed).toBe(1);
  });

  it('splits own ground from theirs', () => {
    const out = analyseRoute({
      points: through,
      territories: [territory({ id: 'mine', user_id: 'me' })],
      userId: 'me',
    });
    expect(out.ownShare).toBeGreaterThan(0);
    expect(out.rivalShare).toBe(0);
    expect(out.crossings[0].mine).toBe(true);
  });

  it('ignores a plot nowhere near the line', () => {
    const far = territory({ id: 'far', polygon: square(20, 20) });
    const out = analyseRoute({ points: through, territories: [far], userId: 'me' });
    expect(out.crossings).toEqual([]);
    expect(out.openShare).toBe(1);
  });

  it('shares always account for the whole route', () => {
    const out = analyseRoute({
      points: through,
      territories: [territory(), territory({ id: 'mine', user_id: 'me', polygon: square(0.006, 51) })],
      userId: 'me',
    });
    expect(out.ownShare + out.rivalShare + out.openShare).toBeCloseTo(1, 6);
  });

  it('says how far short of a claimable distance a short route is', () => {
    const tiny = [
      { latitude: 51, longitude: 0 },
      { latitude: 51.0005, longitude: 0 },
    ];
    const out = analyseRoute({ points: tiny, territories: [], userId: 'me' });
    expect(out.qualifies).toBe(false);
    expect(out.shortfallM).toBeGreaterThan(0);
  });

  it('reports duration as unknown rather than assuming it passed', () => {
    // The planner cannot know how fast somebody will run. Saying so is the
    // difference between an estimate and a promise.
    const out = analyseRoute({ points: through, territories: [], userId: 'me' });
    expect(out.durationKnown).toBe(false);
  });

  it('survives an empty route', () => {
    const out = analyseRoute({ points: [], territories: [territory()], userId: 'me' });
    expect(out.distanceM).toBe(0);
    expect(out.crossings).toEqual([]);
  });
});

describe('intelligence layers', () => {
  const ctx = { userId: 'me' };

  it('keeps the free board free', () => {
    const free = LAYERS.filter((l) => !l.pro).map((l) => l.key);
    // Everything the map showed before this feature existed must still be
    // reachable without paying: all territory, your own, and the contested
    // heat that the flame button has always drawn.
    expect(free).toEqual(expect.arrayContaining(['all', 'mine', 'contested']));
  });

  it('finds your own land that is close to expiring', () => {
    const rows = territoriesForLayer(layerByKey('at_risk'), [
      territory({ id: 'a', user_id: 'me', freshness: AT_RISK_FRESHNESS - 0.05 }),
      territory({ id: 'b', user_id: 'me', freshness: 0.9 }),
      territory({ id: 'c', user_id: 'them', freshness: 0.01 }),
    ], ctx);
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('will not call weak ground vulnerable if it is strongly held', () => {
    const rows = territoriesForLayer(layerByKey('vulnerable'), [
      territory({ id: 'weak', freshness: 0.1, strength: 1 }),
      territory({ id: 'fortified', freshness: 0.1, strength: 3 }),
    ], ctx);
    expect(rows.map((r) => r.id)).toEqual(['weak']);
  });

  it('reads strongholds off strength and defenders, not off area', () => {
    const rows = territoriesForLayer(layerByKey('strongholds'), [
      territory({ id: 'big-but-soft', area_m2: 9e9, strength: 1, defenders: 1 }),
      territory({ id: 'strong', strength: 2 }),
      territory({ id: 'crowded', defenders: 5 }),
    ], ctx);
    expect(rows.map((r) => r.id).sort()).toEqual(['crowded', 'strong']);
  });

  it('never leaks your own land into an enemy layer', () => {
    const mine = territory({ id: 'mine', user_id: 'me', freshness: 0.05, strength: 4, defenders: 9 });
    expect(territoriesForLayer(layerByKey('vulnerable'), [mine], ctx)).toEqual([]);
    expect(territoriesForLayer(layerByKey('strongholds'), [mine], ctx)).toEqual([]);
  });

  it('renders NOTHING for a layer whose data the backend does not send', () => {
    // The honesty rule, made structural. `churn` is declared so the UI
    // contract is real, but it must never draw a plausible-looking guess
    // derived from area or age.
    const churn = layerByKey('churn');
    expect(churn.available).toBe(false);
    expect(churn.requires).toMatch(/owner_changes/);
    const rows = territoriesForLayer(churn, [territory(), territory({ id: 'x' })], ctx);
    expect(rows).toEqual([]);
    expect(layerFeatureCollection(churn, [territory()], ctx, (t) => [t.polygon]).features).toEqual([]);
  });

  it('every unavailable layer says what it needs', () => {
    for (const layer of LAYERS.filter((l) => !l.available)) {
      expect([layer.key, typeof layer.requires]).toEqual([layer.key, 'string']);
    }
  });

  it('builds closed rings the map can draw', () => {
    const fc = layerFeatureCollection(
      layerByKey('contested'),
      [territory({ contested: true })],
      ctx,
      (t) => [t.polygon]
    );
    expect(fc.features).toHaveLength(1);
    const ring = fc.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(fc.features[0].properties.strokeColor).toBeTruthy();
  });
});
