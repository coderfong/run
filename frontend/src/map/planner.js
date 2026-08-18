// Territory Planner — the analysis, with no React in it.
//
// WHAT THIS IS ALLOWED TO CLAIM, and why the list is short.
//
// The server owns claim geometry. `/end-run` grows the claim shape around the
// route with PostGIS, cuts it against everyone else's land, applies the day's
// entitlement and decides what is actually granted. NONE of that is reproduced
// here, because a client-side reimplementation of a server rule is a rule that
// drifts, and this app has already been bitten by exactly that once — see the
// header of config/economy.js, where a local claim formula promised 1.99 km²
// against the server's 0.375.
//
// So the planner reports four things, and every one of them is either measured
// from the route itself or read straight off data the server sent:
//
//   1. DISTANCE — haversine along the drawn line. Ours to measure.
//   2. LAND ESTIMATE — `claimAreaM2` from config/economy.js, which is a
//      contract-tested mirror of the server's own curve. Labelled an estimate
//      from a standing start, because that is exactly what it is: it does not
//      know what else you have already run today (the real entitlement is
//      `entitledAreaM2`, and the client does not hold the day's banked
//      distance).
//   3. QUALIFICATION — the same distance bars the run screen already draws.
//   4. WHOSE GROUND THE ROUTE CROSSES — computed against the REAL polygons
//      /map-polygons returned. Not a guess, not a heatmap, not a model.
//
// What it will never report: the shape of the claim, the exact area that would
// be granted, who would lose what, or a probability of anything. If a number
// is not on the list above, it is not in this file, and it must not be added
// without the server being the one to answer it.

import { claimAreaM2, ECONOMY, runTier, RUN_TIER } from '../config/economy';
import { territoryRings } from '../components/claim/geometry';

// How finely the route is sampled when working out whose ground it runs over.
// 25 m is well under the size of any claimable plot, so a territory cannot be
// stepped over, and it keeps a 10 km route at 400 containment tests per
// polygon — cheap enough to run on every preview.
const SAMPLE_M = 25;

// A route can be dragged arbitrarily long. Past this the sampling stops being
// free and the answer stops being interesting, so the count is capped and the
// spacing widens instead.
const MAX_SAMPLES = 1200;

const R_EARTH_M = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle metres between two {latitude, longitude} points. */
export function haversineM(a, b) {
  if (!a || !b) return 0;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a drawn route, in metres. */
export function routeLengthM(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
}

/**
 * Even samples along the route, including both ends.
 *
 * Sampling rather than integrating because the question ("how much of this
 * route is on somebody else's ground") is answered by containment, and
 * containment is a point test.
 */
export function sampleRoute(points, spacingM = SAMPLE_M) {
  if (!points || points.length === 0) return [];
  if (points.length === 1) return [points[0]];

  const total = routeLengthM(points);
  const step = Math.max(spacingM, total / MAX_SAMPLES);
  const out = [points[0]];
  let carried = 0;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const segment = haversineM(from, to);
    if (segment <= 0) continue;
    let travelled = step - carried;
    while (travelled <= segment) {
      const t = travelled / segment;
      out.push({
        latitude: from.latitude + (to.latitude - from.latitude) * t,
        longitude: from.longitude + (to.longitude - from.longitude) * t,
      });
      travelled += step;
    }
    carried = segment - (travelled - step);
  }

  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Even-odd ray casting against one ring of [lon, lat] pairs.
 *
 * Flat rather than spherical on purpose: a territory is a few hundred metres
 * across, where the difference between the two is far below the GPS noise the
 * polygon was built from.
 */
export function pointInRing(point, ring) {
  if (!ring || ring.length < 3) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is this point inside any ring of this territory? */
export function pointInTerritory(point, territory) {
  return territoryRings(territory).some((ring) => pointInRing(point, ring));
}

/**
 * What a drawn route runs over.
 *
 * @param {object} args
 * @param {Array}  args.points       [{latitude, longitude}] as drawn
 * @param {Array}  args.territories  exactly what /map-polygons returned
 * @param {string} args.userId       the planning runner, to split own from others'
 * @param {number} [args.durationS]  planned duration, if the runner said one.
 *                                   Omitted means the duration bar cannot be
 *                                   judged, and it is reported as unknown
 *                                   rather than assumed passed.
 */
export function analyseRoute({ points, territories = [], userId, durationS = null }) {
  const distanceM = routeLengthM(points);
  const samples = sampleRoute(points);

  // Only the polygons that could possibly matter. A viewport can hold hundreds
  // and most are nowhere near the line; a bounding-box reject is one comparison
  // against a ring test per sample.
  const near = territories.filter((t) => bboxTouchesRoute(t, points));

  let ownSamples = 0;
  let rivalSamples = 0;
  const crossed = new Map();

  for (const sample of samples) {
    let hitOwn = false;
    let hitRival = false;
    for (const t of near) {
      if (!pointInTerritory(sample, t)) continue;
      const mine = String(t.user_id) === String(userId);
      if (mine) hitOwn = true;
      else hitRival = true;
      if (!crossed.has(t.id)) {
        crossed.set(t.id, {
          id: t.id,
          userId: t.user_id,
          username: t.username,
          clanTag: t.clan_tag || null,
          areaM2: t.area_m2 || 0,
          mine,
          contested: !!t.contested,
          // Server-supplied decay position, 0..1. Used by the intelligence
          // layers too; never recomputed locally.
          freshness: t.freshness ?? null,
          samples: 0,
        });
      }
      crossed.get(t.id).samples += 1;
    }
    // A sample inside both your land and somebody else's counts as contested
    // ground for the split, which is the honest reading: you are running over
    // a boundary.
    if (hitRival) rivalSamples += 1;
    else if (hitOwn) ownSamples += 1;
  }

  const total = samples.length || 1;
  const openSamples = total - ownSamples - rivalSamples;

  // Distance bars only. `uniqueLengthM` is a buffered-corridor measure the
  // client genuinely cannot compute (see runTier's own note), so Infinity is
  // passed and the answer is optimistic by exactly that one term — which is
  // why `qualifies` is reported alongside `durationKnown` rather than as a
  // promise.
  const tier = runTier(distanceM, durationS ?? Infinity, Infinity);

  return {
    distanceM,
    sampleCount: samples.length,

    // The shared curve, from a standing start. See the header.
    estimatedClaimM2: claimAreaM2(distanceM),
    estimateIsCapped: claimAreaM2(distanceM) >= ECONOMY.maxPolygonAreaM2,

    qualifies: tier === RUN_TIER.CLAIMABLE,
    tier,
    durationKnown: durationS != null,
    shortfallM: Math.max(0, ECONOMY.minClaimDistanceM - distanceM),

    // Shares of the ROUTE, not of any area. Named accordingly everywhere they
    // are rendered.
    ownShare: ownSamples / total,
    rivalShare: rivalSamples / total,
    openShare: openSamples / total,

    // Biggest crossings first: the interesting ones are the ones the route
    // spends time on.
    crossings: [...crossed.values()].sort((a, b) => b.samples - a.samples),
    rivalsCrossed: [...crossed.values()].filter((c) => !c.mine).length,
  };
}

/**
 * Cheap reject: does this territory's bounding box come near the route's?
 * Exact containment is still tested afterwards — this only skips the polygons
 * that cannot possibly match.
 */
function bboxTouchesRoute(territory, points) {
  const rings = territoryRings(territory);
  if (!rings.length || !points?.length) return false;

  let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < tMinX) tMinX = lon;
      if (lon > tMaxX) tMaxX = lon;
      if (lat < tMinY) tMinY = lat;
      if (lat > tMaxY) tMaxY = lat;
    }
  }

  let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
  for (const p of points) {
    if (p.longitude < rMinX) rMinX = p.longitude;
    if (p.longitude > rMaxX) rMaxX = p.longitude;
    if (p.latitude < rMinY) rMinY = p.latitude;
    if (p.latitude > rMaxY) rMaxY = p.latitude;
  }

  return !(tMinX > rMaxX || tMaxX < rMinX || tMinY > rMaxY || tMaxY < rMinY);
}
