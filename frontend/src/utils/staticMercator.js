// Fit a geographic ring into a fixed pixel box, the way a Mapbox Static Images
// tile does — and build the URL of the snapshot it is fitted to.
//
// Neither the land-capture alert nor a feed card has a live map to project
// against: both show a single static-map snapshot and draw over it. To box the
// EXACT ground a run covered (rather than a seeded stand-in), we need its
// [lon, lat] geometry in the snapshot's own pixel space. Mapbox GL / the Static
// Images API use 512px tiles, so a `zoom` here means the same coverage the
// snapshot at that same centre + zoom shows — which is what keeps the drawing
// aligned to the streets under it. Pick the centre + zoom that frame the shape,
// then project every vertex with that exact pair, and the two agree.
//
// The URL builder lives here WITH the projection on purpose. The two are one
// agreement about how much ground a box shows, and they were drifting apart the
// moment a second screen wanted a snapshot: get the size or the zoom out of step
// by a hair and the outline slides off the roads it was traced from.

import { MAPBOX_PUBLIC_TOKEN, MAP_READY, styleForTheme } from '../config/map';

const TILE = 512;
const DEG = Math.PI / 180;

// What the Static Images API will actually serve on a side. @2x doubles the
// pixels it comes back with, not what may be asked for.
const MAX_SIDE = 640;
const MIN_SIDE = 64;

// World pixel coordinate at a given zoom (top-left origin, y grows south).
function worldXY(lon, lat, zoom) {
  const scale = TILE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const s = Math.min(Math.max(Math.sin(lat * DEG), -0.9999), 0.9999);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Bounding box over any number of [lon, lat] layers (rings, routes, a single
// point), skipping anything that is not a finite pair.
function boundsOf(layers) {
  let west = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let south = Infinity;
  let count = 0;
  for (const layer of layers || []) {
    for (const pt of layer || []) {
      const lon = Number(pt?.[0]);
      const lat = Number(pt?.[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
      south = Math.min(south, lat);
      count += 1;
    }
  }
  return count ? { west, east, north, south, count } : null;
}

// The (fractional) zoom at which `bounds` fills `box` with `padding` to spare on
// every side. Measured at zoom 0 and scaled, so it is one log away from the
// answer. A degenerate shape (one point repeated) has no extent and comes back
// enormous; every caller clamps.
function zoomToFit(bounds, box, padding) {
  const availW = Math.max(1, box.width - padding * 2);
  const availH = Math.max(1, box.height - padding * 2);
  const nw = worldXY(bounds.west, bounds.north, 0);
  const se = worldXY(bounds.east, bounds.south, 0);
  const spanX = Math.abs(se.x - nw.x) || 1e-6;
  const spanY = Math.abs(se.y - nw.y) || 1e-6;
  return Math.min(Math.log2(availW / spanX), Math.log2(availH / spanY));
}

/**
 * Frame several [lon, lat] layers (a claim's rings AND the route inside it)
 * into one `box`, and hand back the projector that put them there.
 *
 * `project(points)` returns [[x, y], …] — the dialect the SVG drawings speak.
 * The zoom is FRACTIONAL here, unlike `fitRingToBox`: a thumbnail is small
 * enough that rounding down to a whole zoom leaves the shape rattling around in
 * a box twice its size.
 */
export function fitLayersToBox(layers, box, { padding = 10, minZoom = 1, maxZoom = 18 } = {}) {
  if (!box?.width || !box?.height) return null;
  const b = boundsOf(layers);
  if (!b) return null;

  // The centre in degrees, not in mercator: over a run's worth of ground the
  // two differ by a fraction of a pixel, and this is the centre the snapshot's
  // own URL carries.
  const center = { lon: (b.west + b.east) / 2, lat: (b.north + b.south) / 2 };
  const zoom = Math.max(minZoom, Math.min(maxZoom, zoomToFit(b, box, padding)));
  const c = worldXY(center.lon, center.lat, zoom);
  const project = (points) => (points || []).map((pt) => {
    const p = worldXY(Number(pt?.[0]), Number(pt?.[1]), zoom);
    return [box.width / 2 + (p.x - c.x), box.height / 2 + (p.y - c.y)];
  });
  return { center, zoom, project };
}

/**
 * A still frame of one place, from the Static Images API.
 *
 * `detail` asks for the SAME ground at more pixels: doubling the box and adding
 * one to the zoom covers identical geography, so a drawing projected at the
 * box's own size still lands on the streets. A 300pt card wants more than 300
 * pixels of map behind it.
 *
 * `overlay` is Mapbox's own overlay syntax (a `pin-s+hex(lon,lat)`, say),
 * already URL-safe. Most callers draw their own and leave it off.
 *
 * Returns null with no token configured, so every caller keeps whatever it drew
 * before the map existed.
 */
export function staticMapUrl({ center, zoom = 15, width, height, scheme, overlay, detail = 1 }) {
  if (!MAP_READY) return null;
  if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lon)) return null;
  if (!(width > 0) || !(height > 0)) return null;

  const style = styleForTheme(scheme).replace('mapbox://styles/', '');

  // ONE factor for both sides, never a clamp per side. The drawing over this
  // assumes one box pixel is one map pixel at `zoom` (see fitLayersToBox), so
  // changing the aspect ratio would slide the outline off the roads. Any
  // resize is paid for in zoom instead: fewer pixels over the identical
  // ground. @2x puts the density back.
  const w0 = width * detail;
  const h0 = height * detail;
  let k = 1;
  if (Math.max(w0, h0) > MAX_SIDE) k = MAX_SIDE / Math.max(w0, h0);
  if (Math.min(w0, h0) * k < MIN_SIDE) k = Math.min(MIN_SIDE / Math.min(w0, h0), MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  if (!(w > 0) || !(h > 0)) return null;

  const z = Math.max(1, Math.min(20, (Number(zoom) || 15) + Math.log2(detail * k)));
  const path = overlay ? `${overlay}/` : '';
  return `https://api.mapbox.com/styles/v1/${style}/static/${path}${center.lon},${center.lat},${z.toFixed(2)},0/${w}x${h}@2x?access_token=${MAPBOX_PUBLIC_TOKEN}`;
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

  const b = boundsOf([ring]);
  if (!b) return null;

  const center = { lon: (b.west + b.east) / 2, lat: (b.north + b.south) / 2 };

  // WHOLE zoom levels: the cutscene's stage is the size of the screen, so a
  // level either way is a lot of ground, and the tiles it lands on read as a
  // map you could have panned to. A degenerate (single-point) ring has no
  // extent and comes back enormous → maxZoom.
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.floor(zoomToFit(b, box, padding))));

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
