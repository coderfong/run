// Geometry for the claim reveal.
//
// The permanent territory belongs to Mapbox — it's a real FillLayer, tied to
// real coordinates. The *reveal* is screen-space: we ask the map where each
// polygon vertex lands in pixels, then draw and animate that shape in an SVG
// overlay. That buys an expanding-circle mask and a traced outline for any
// polygon shape, which no map layer can give us.
//
// The whole thing is only valid while the camera is still. Project after the
// flight settles, and never move the camera mid-reveal.

// Server territories come back as either `rings` (outer + holes) or a single
// `polygon`. Both are arrays of [lon, lat]. Normalise to rings-of-rings.
export function territoryRings(territory) {
  if (!territory) return [];
  const rings = territory.rings?.length ? territory.rings : [territory.polygon];
  return rings.filter((ring) => Array.isArray(ring) && ring.length >= 3);
}

// Cap vertices per ring before projecting. A claim polygon can carry far more
// detail than a 300pt-wide map can show, and every vertex kept is one more
// native round trip through getPointInView.
const MAX_VERTICES = 64;

function decimate(ring) {
  if (ring.length <= MAX_VERTICES) return ring;
  const step = ring.length / MAX_VERTICES;
  const out = [];
  for (let i = 0; i < MAX_VERTICES; i++) out.push(ring[Math.floor(i * step)]);
  return out;
}

// [lon, lat] rings → {latitude, longitude} points, which is the dialect every
// screen and GameMap helper speaks.
export function ringsToLatLngs(rings) {
  return rings.flat().map(([longitude, latitude]) => ({ latitude, longitude }));
}

// Project every vertex to this map's pixel space. Returns null if the map
// can't project (no native module, camera torn down mid-flight) so the caller
// can skip the overlay and just show the final layer.
export async function projectRings(map, rings) {
  if (!map?.projectCoordinate) return null;
  try {
    const screenRings = await Promise.all(
      rings.map((ring) =>
        Promise.all(
          decimate(ring).map(([longitude, latitude]) =>
            map.projectCoordinate({ latitude, longitude })
          )
        )
      )
    );
    // A single failed vertex makes the whole shape wrong — treat it as a miss.
    if (screenRings.some((ring) => ring.length < 3 || ring.some((p) => !p))) return null;
    return screenRings;
  } catch (e) {
    return null;
  }
}

// Screen rings → an SVG path. Holes work because the <Path> uses evenodd.
export function ringsToPath(screenRings) {
  let d = '';
  screenRings.forEach((ring) => {
    if (!ring || ring.length < 3) return;
    ring.forEach((p, i) => {
      d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    });
    d += 'Z ';
  });
  return d.trim();
}

// Total outline length in px — the dasharray budget for the tracing stroke.
export function ringsPerimeter(screenRings) {
  let total = 0;
  screenRings.forEach((ring) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  });
  return Math.max(total, 1);
}

// How far the mask circle must grow to cover the shape from the claim point.
// The pad guarantees the last sliver of a long thin polygon still fills.
export function maxRadiusFromPoint(screenRings, origin) {
  let max = 0;
  screenRings.forEach((ring) => {
    ring.forEach((p) => {
      max = Math.max(max, Math.hypot(p.x - origin.x, p.y - origin.y));
    });
  });
  return max + 28;
}
