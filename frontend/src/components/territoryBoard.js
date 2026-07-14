// Shared territory-board helpers — the single source of truth for turning the
// /map-polygons payload into (a) a GeoJSON FeatureCollection the TerritoryLayer
// paints and (b) the owner-portrait markers pinned to each plot. GlobalMap,
// the running HUD and the post-run placement map all speak the same board so
// "everyone's land + character portraits" looks identical everywhere.
//
// Portraits sit at the AREA-WEIGHTED CENTROID of a territory's LARGEST ring.
// After a steal carves a plot with ST_Difference, the largest surviving
// fragment is rings[0], so the owner's portrait stays on the land they still
// hold instead of floating over ground that was taken from them.

import { NEUTRAL } from '../state/clan';

// Area-weighted centroid (shoelace) of a [lon,lat] ring -> {latitude, longitude}.
export function ringCentroid(ring) {
  if (!ring || ring.length < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-12) return { latitude: ring[0][1], longitude: ring[0][0] };
  a *= 0.5;
  return { latitude: cy / (6 * a), longitude: cx / (6 * a) };
}

function ringsOf(t) {
  return t.rings?.length ? t.rings : [t.polygon];
}

// GeoJSON features for the TerritoryLayer. Own land reads a touch stronger and
// uses the viewer accent; everyone else uses their clan colour. Opacity fades
// with freshness so decaying land visibly weakens.
export function buildBoardFeatures(territories, { userId, accent }) {
  const features = [];
  for (const t of territories || []) {
    const mine = t.user_id === userId;
    const col = t.clan_color || NEUTRAL;
    const fill = mine ? accent : col.stroke;
    ringsOf(t).forEach((ring, ri) => {
      if (!ring || ring.length < 3) return;
      const coords = ring.map(([lon, lat]) => [lon, lat]);
      const f = coords[0], l = coords[coords.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) coords.push(f);
      features.push({
        type: 'Feature',
        id: `${t.id}-${ri}`,
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {
          territoryId: t.id,
          fillColor: fill,
          strokeColor: fill,
          fillOpacity: (mine ? 0.45 : 0.32) * (0.35 + 0.65 * (t.freshness ?? 1)),
        },
      });
    });
  }
  return features;
}

// Owner-portrait markers, biggest plots first (capped for perf/clutter). The
// viewer's own portrait uses their freshest local loadout; others come from
// the API avatar. `at` is the largest-ring centroid — see file header.
export function buildLandPortraits(territories, { userId, accent, equipped, cap = 40 }) {
  return (territories || [])
    .map((t) => {
      const mine = t.user_id === userId;
      const col = t.clan_color || NEUTRAL;
      return {
        id: t.id,
        mine,
        userId: t.user_id,
        username: t.username,
        avatar: mine ? equipped : t.avatar,
        ring: mine ? accent : col.stroke,
        area: t.area_m2 || 0,
        at: ringCentroid(ringsOf(t)[0]),
      };
    })
    .filter((m) => m.at && m.avatar)
    .sort((a, b) => b.area - a.area)
    .slice(0, cap);
}

// ---- live overlap preview (placement map) --------------------------------
// A ray-cast point-in-ring test on [lon,lat] degrees. Local scale => the
// planar test is accurate enough for a display-only estimate.
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-18) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function bboxOf(rings) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

// Estimate how much of a claim circle (centre + radius m) overlaps each RIVAL
// territory (anyone but the claimer). Returns rivals sorted by area taken,
// each with owner name/avatar/colour so the placement UI can show exactly who
// and how much you're taking. Display-only — the server is authoritative.
//
// Method: a fixed grid of samples inside the circle (deterministic, no
// flicker), point-tested against nearby rivals only (bbox pre-filter), so it
// stays cheap as the slider drags. `grid`≈24 → ~450 in-circle samples.
export function estimateClaims(territories, center, radiusM, { userId, grid = 24 } = {}) {
  if (!center || !radiusM) return { rivals: [], sampleArea: 0 };
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((center.latitude * Math.PI) / 180);
  const dLat = radiusM / mPerLat;
  const dLon = radiusM / mPerLon;
  const circleBbox = {
    minLon: center.longitude - dLon, maxLon: center.longitude + dLon,
    minLat: center.latitude - dLat, maxLat: center.latitude + dLat,
  };

  // Nearby rivals only: skip own land and anything whose bbox can't touch us.
  const rivals = [];
  for (const t of territories || []) {
    if (t.user_id === userId) continue;
    const rings = ringsOf(t).filter((r) => r && r.length >= 3);
    if (!rings.length) continue;
    const bb = bboxOf(rings);
    if (bb.maxLon < circleBbox.minLon || bb.minLon > circleBbox.maxLon ||
        bb.maxLat < circleBbox.minLat || bb.minLat > circleBbox.maxLat) continue;
    const col = t.clan_color || NEUTRAL;
    rivals.push({
      id: t.id, username: t.username, avatar: t.avatar,
      clanTag: t.clan_tag || null, ring: col.stroke, rings, hits: 0,
    });
  }
  if (!rivals.length) return { rivals: [], sampleArea: 0 };

  // Deterministic grid over the circle bbox; keep points inside the disc.
  const circleAreaM2 = Math.PI * radiusM * radiusM;
  let inCircle = 0;
  const step = 1 / grid;
  const samples = [];
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      const fx = -1 + 2 * i * step; // -1..1
      const fy = -1 + 2 * j * step;
      if (fx * fx + fy * fy > 1) continue; // outside the disc
      inCircle++;
      samples.push([center.longitude + fx * dLon, center.latitude + fy * dLat]);
    }
  }
  if (!inCircle) return { rivals: [], sampleArea: 0 };
  const perSample = circleAreaM2 / inCircle;

  for (const [lon, lat] of samples) {
    for (const r of rivals) {
      // inside if the sample lands in an odd number of the plot's rings
      // (exterior rings dominate; holes are rare for these small claims).
      let inside = false;
      for (const ring of r.rings) if (pointInRing(lon, lat, ring)) inside = !inside;
      if (inside) r.hits++;
    }
  }

  return {
    rivals: rivals
      .map((r) => ({
        id: r.id, username: r.username, avatar: r.avatar,
        clanTag: r.clanTag, ring: r.ring, area: r.hits * perSample,
      }))
      .filter((r) => r.area >= 1)
      .sort((a, b) => b.area - a.area),
    sampleArea: circleAreaM2,
  };
}
