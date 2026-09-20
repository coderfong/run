// The token and the styles come from env / expo-constants, which a test has
// neither of. Pinning them here also keeps the URL assertions below about the
// shape of the URL rather than about whoever's `.env` ran them.
let mockMapReady = true;
jest.mock('../src/config/map', () => ({
  get MAP_READY() { return mockMapReady; },
  MAPBOX_PUBLIC_TOKEN: 'pk.test-token',
  styleForTheme: (theme) => (theme === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11'),
  MAP_SURFACE: { light: '#F0ECE6', dark: '#1A1B1D' },
  mapSurfaceFor: (theme) => (theme === 'dark' ? '#1A1B1D' : '#F0ECE6'),
}));

import { fitLayersToBox, fitRingToBox, staticMapUrl } from '../src/utils/staticMercator';

// One test takes the token away to prove the fallback; every other test in the
// file wants it back, whatever order they run in.
beforeEach(() => { mockMapReady = true; });

const box = { width: 300, height: 220 };

// A small square ring near Singapore, [lon, lat].
const ring = [
  [103.8198, 1.3521],
  [103.8210, 1.3521],
  [103.8210, 1.3533],
  [103.8198, 1.3533],
];

describe('fitRingToBox', () => {
  it('returns a centre, zoom and one projected ring for a real shape', () => {
    const framed = fitRingToBox(ring, box);
    expect(framed).not.toBeNull();
    expect(framed.center.lon).toBeCloseTo(103.8204, 3);
    expect(framed.center.lat).toBeCloseTo(1.3527, 3);
    expect(framed.zoom).toBeGreaterThanOrEqual(1);
    expect(framed.zoom).toBeLessThanOrEqual(17);
    expect(framed.rings).toHaveLength(1);
    expect(framed.rings[0]).toHaveLength(ring.length);
  });

  it('projects the shape inside the box and roughly centred', () => {
    const { rings } = fitRingToBox(ring, box);
    for (const p of rings[0]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(box.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(box.height);
    }
    // The ring's own centroid should land near the box centre.
    const cx = rings[0].reduce((s, p) => s + p.x, 0) / rings[0].length;
    const cy = rings[0].reduce((s, p) => s + p.y, 0) / rings[0].length;
    expect(cx).toBeCloseTo(box.width / 2, 0);
    expect(cy).toBeCloseTo(box.height / 2, 0);
  });

  it('preserves winding: north maps to a smaller y than south', () => {
    const { rings } = fitRingToBox(ring, box);
    // Vertices 0/1 are the south edge (lat 1.3521), 2/3 the north edge.
    const south = (rings[0][0].y + rings[0][1].y) / 2;
    const north = (rings[0][2].y + rings[0][3].y) / 2;
    expect(north).toBeLessThan(south);
  });

  it('rejects unusable input', () => {
    expect(fitRingToBox(null, box)).toBeNull();
    expect(fitRingToBox([[103.8, 1.35], [103.81, 1.35]], box)).toBeNull();
    expect(fitRingToBox(ring, { width: 0, height: 0 })).toBeNull();
  });

  it('clamps to maxZoom for a degenerate (single-point) ring', () => {
    const dot = [
      [103.82, 1.35],
      [103.82, 1.35],
      [103.82, 1.35],
    ];
    const framed = fitRingToBox(dot, box, { maxZoom: 17 });
    expect(framed.zoom).toBe(17);
  });
});

// A route running through the middle of that ring, [lon, lat].
const route = [
  [103.8201, 1.3524],
  [103.8206, 1.3527],
  [103.8208, 1.3530],
];

const thumb = { width: 300, height: 110 };
const PAD = 10;

const spanOf = (points, axis) => {
  const vals = points.map((p) => p[axis]);
  return Math.max(...vals) - Math.min(...vals);
};

describe('fitLayersToBox', () => {
  it('frames the claim and the route inside it with one projection', () => {
    const view = fitLayersToBox([ring, route], thumb, { padding: PAD });
    const shape = view.project(ring);
    const line = view.project(route);

    for (const [x, y] of [...shape, ...line]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(thumb.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(thumb.height);
    }
    // The route has to land INSIDE the claim, not beside it — that is the
    // whole reason the two are fitted together rather than separately.
    const shapeX = shape.map((p) => p[0]);
    for (const [x] of line) {
      expect(x).toBeGreaterThanOrEqual(Math.min(...shapeX));
      expect(x).toBeLessThanOrEqual(Math.max(...shapeX));
    }
  });

  it('fills the box to the padding instead of rounding down a whole zoom', () => {
    const view = fitLayersToBox([ring], thumb, { padding: PAD });
    const shape = view.project(ring);
    const filled = Math.max(
      spanOf(shape, 0) / (thumb.width - PAD * 2),
      spanOf(shape, 1) / (thumb.height - PAD * 2)
    );
    // A floored zoom can leave the shape at half the box; a fitted one touches
    // the padding on its binding axis.
    expect(filled).toBeGreaterThan(0.98);
    expect(filled).toBeLessThanOrEqual(1.001);
  });

  it('puts north above south and keeps the shape centred', () => {
    const view = fitLayersToBox([ring], thumb, { padding: PAD });
    const shape = view.project(ring);
    const south = (shape[0][1] + shape[1][1]) / 2;
    const north = (shape[2][1] + shape[3][1]) / 2;
    expect(north).toBeLessThan(south);

    const cx = shape.reduce((s, p) => s + p[0], 0) / shape.length;
    const cy = shape.reduce((s, p) => s + p[1], 0) / shape.length;
    expect(cx).toBeCloseTo(thumb.width / 2, 0);
    expect(cy).toBeCloseTo(thumb.height / 2, 0);
  });

  it('rejects input it cannot frame', () => {
    expect(fitLayersToBox([], thumb)).toBeNull();
    expect(fitLayersToBox([[]], thumb)).toBeNull();
    expect(fitLayersToBox([[['x', 'y']]], thumb)).toBeNull();
    expect(fitLayersToBox([ring], { width: 0, height: 0 })).toBeNull();
  });
});

describe('staticMapUrl', () => {
  it('asks for the frame it was given, in the scheme it was given', () => {
    const url = staticMapUrl({
      center: { lon: 103.8204, lat: 1.3527 },
      zoom: 15.25,
      width: 300,
      height: 110,
      scheme: 'dark',
    });

    expect(url).toContain('/styles/v1/mapbox/dark-v11/static/');
    expect(url).toContain('103.8204,1.3527,15.25,0/300x110@2x');
    expect(url).toContain('access_token=pk.test-token');
  });

  it('buys pixels with detail, never ground', () => {
    const base = { center: { lon: 103.8204, lat: 1.3527 }, zoom: 14, width: 300, height: 110, scheme: 'light' };
    const plain = staticMapUrl(base);
    const sharp = staticMapUrl({ ...base, detail: 2 });

    // Twice the box at one zoom deeper is the identical ground, which is what
    // lets a drawing projected at the box's own size still line up.
    expect(plain).toContain(',14.00,0/300x110@2x');
    expect(sharp).toContain(',15.00,0/600x220@2x');
  });

  it('shrinks an oversized box on both sides at once and pays for it in zoom', () => {
    const url = staticMapUrl({
      center: { lon: 103.8204, lat: 1.3527 },
      zoom: 16,
      width: 1280,
      height: 640,
      scheme: 'light',
    });

    // Halved, so the aspect ratio survives and one box pixel is still one map
    // pixel at the zoom the drawing was projected with — one level shallower.
    expect(url).toContain('/640x320@2x');
    expect(url).toContain(',15.00,0/');
  });

  it('threads an overlay in ahead of the centre', () => {
    const url = staticMapUrl({
      center: { lon: 103.82, lat: 1.35 },
      zoom: 15,
      width: 300,
      height: 300,
      scheme: 'light',
      overlay: 'pin-s+FF4967(103.82,1.35)',
    });
    expect(url).toContain('/static/pin-s+FF4967(103.82,1.35)/103.82,1.35,15.00,0/');
  });

  it('returns nothing without a usable frame or a token', () => {
    expect(staticMapUrl({ center: null, width: 300, height: 110 })).toBeNull();
    expect(staticMapUrl({ center: { lon: 1, lat: NaN }, width: 300, height: 110 })).toBeNull();
    expect(staticMapUrl({ center: { lon: 1, lat: 1 }, width: 0, height: 110 })).toBeNull();

    mockMapReady = false;
    expect(staticMapUrl({ center: { lon: 1, lat: 1 }, width: 300, height: 110 })).toBeNull();
  });
});

describe('the snapshot and the drawing agree', () => {
  it('asks for exactly the ground the projector placed the claim on', () => {
    const view = fitLayersToBox([ring, route], thumb, { padding: PAD });
    const url = staticMapUrl({ ...view, width: thumb.width, height: thumb.height, scheme: 'light', detail: 2 });

    // Same centre, and the zoom raised by precisely the detail factor.
    expect(url).toContain(`/${view.center.lon},${view.center.lat},`);
    expect(url).toContain(`,${(view.zoom + 1).toFixed(2)},0/600x220@2x`);
  });
});
