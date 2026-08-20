// Fit a geographic ring into a fixed pixel box, the way a Mapbox Static Images
// tile does.
//
// The land-capture alert has no live map to project against — it shows a single
// static-map snapshot and animates over it. To box the EXACT ground a rival ran
// (rather than a seeded stand-in fan), we need the attacker's [lon, lat] ring in
// the snapshot's own pixel space. Mapbox GL / the Static Images API use 512px
// tiles, so a `zoom` here means the same coverage the snapshot at that same
// centre + zoom shows — which is what keeps the box aligned to the streets under
// it. Pick the centre + zoom that frame the ring, then project every vertex with
// that exact pair, and the overlay and the image agree.

const TILE = 512;
const DEG = Math.PI / 180;

// World pixel coordinate at a given zoom (top-left origin, y grows south).
function worldXY(lon, lat, zoom) {
  const scale = TILE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const s = Math.min(Math.max(Math.sin(lat * DEG), -0.9999), 0.9999);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * Frame a [lon, lat] ring inside a `box` ({ width, height } in px).
 *
 * Returns the centre + zoom to hand a static map, and the ring reprojected into
 * that box as [{ x, y }] (the dialect the capture anchors speak). Returns null
 * if the ring is unusable, so callers keep their point-and-fan fallback.
 */
export function fitRingToBox(ring, box, { padding = 26, maxZoom = 17, minZoom = 1 } = {}) {
  if (!Array.isArray(ring) || ring.length < 3 || !box?.width || !box?.height) return null;

  let west = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let south = Infinity;
  for (const pt of ring) {
    const lon = Number(pt?.[0]);
    const lat = Number(pt?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
    south = Math.min(south, lat);
  }
  if (!Number.isFinite(west) || !Number.isFinite(north)) return null;

  const center = { lon: (west + east) / 2, lat: (north + south) / 2 };

  // Usable pixels after padding on every side.
  const availW = Math.max(1, box.width - padding * 2);
  const availH = Math.max(1, box.height - padding * 2);

  // Extent of the ring at zoom 0, then the largest zoom that still fits both
  // axes. A degenerate (single-point) ring collapses to ~0 extent → maxZoom.
  const nw = worldXY(west, north, 0);
  const se = worldXY(east, south, 0);
  const spanX = Math.abs(se.x - nw.x) || 1e-6;
  const spanY = Math.abs(se.y - nw.y) || 1e-6;
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, Math.floor(Math.min(Math.log2(availW / spanX), Math.log2(availH / spanY))))
  );

  const c = worldXY(center.lon, center.lat, zoom);
  const rings = [
    ring
      .map((pt) => {
        const lon = Number(pt?.[0]);
        const lat = Number(pt?.[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const p = worldXY(lon, lat, zoom);
        return { x: box.width / 2 + (p.x - c.x), y: box.height / 2 + (p.y - c.y) };
      })
      .filter(Boolean),
  ];
  if (rings[0].length < 3) return null;

  return { center, zoom, rings };
}
