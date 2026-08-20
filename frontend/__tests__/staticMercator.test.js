import { fitRingToBox } from '../src/utils/staticMercator';

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
