// Client claim-shape geometry — mirrors backend/app/geospatial.py so the
// placement-map PREVIEW matches the polygon the server will stamp. Each shape
// is a unit polygon scaled to EQUAL AREA with a circle of `radiusM` (so the
// preview area never lies about what you'll get), then projected to lat/lon.

const TWO_PI = Math.PI * 2;

function regularNgon(n) {
  return Array.from({ length: n }, (_, i) => [Math.cos((TWO_PI * i) / n), Math.sin((TWO_PI * i) / n)]);
}
function star(points, innerRatio) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const a = (Math.PI * i) / points - Math.PI / 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}
function heart() {
  return Array.from({ length: 72 }, (_, i) => {
    const t = (TWO_PI * i) / 72;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [x, y];
  });
}
function circleUnit(n = 48) {
  return Array.from({ length: n }, (_, i) => {
    const a = (TWO_PI * i) / n;
    return [Math.cos(a), Math.sin(a)];
  });
}

// Exported so reward tiles can draw the REAL claim shape as their icon
// (components/RewardArt.js) instead of a stand-in glyph.
export function unitShape(shape) {
  switch (shape) {
    case 'hexagon': return regularNgon(6);
    case 'gem': return regularNgon(8);
    case 'star': return star(5, 0.5);
    case 'heart': return heart();
    default: return circleUnit();
  }
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) / 2;
}

// {latitude, longitude} ring for `shape`, equal-area to a circle of radiusM.
export function shapeRing(center, radiusM, shape = 'circle') {
  const targetArea = Math.PI * radiusM * radiusM;
  const unit = unitShape(shape);
  const scale = Math.sqrt(targetArea / Math.max(1e-9, polyArea(unit)));
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((center.latitude * Math.PI) / 180);
  return unit.map(([x, y]) => ({
    latitude: center.latitude + (y * scale) / mPerLat,
    longitude: center.longitude + (x * scale) / mPerLon,
  }));
}
