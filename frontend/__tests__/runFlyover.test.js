/**
 * The 3D run replay's geometry.
 *
 * The flyover itself is a camera animation and cannot be asserted here — what
 * CAN break silently is the arithmetic underneath it, and both halves have a
 * failure mode that looks like a bug in the animation rather than in the maths:
 *
 *   * resample by DISTANCE, not by index. GPS fixes bunch up where the runner
 *     slowed down and thin out where they sped up, so flying the raw points
 *     crawls up every hill and sprints every descent;
 *   * bearings are compass degrees (clockwise from north), which is what
 *     Mapbox's `heading` wants — the opposite convention to the anticlockwise
 *     maths degrees used for the claim's own rotation. Getting these two mixed
 *     up gives a camera that turns the wrong way at every corner.
 */

import { bearing, evenlySpaced } from '../src/components/claim/runFlyover';

const at = (lat, lon) => ({ latitude: lat, longitude: lon });

// Metres per degree near the equator, near enough for spacing assertions.
const M_PER_DEG = 110540;

function gap(a, b) {
  const kx = Math.cos((a.latitude * Math.PI) / 180);
  return (
    Math.hypot((b.longitude - a.longitude) * kx, b.latitude - a.latitude) * M_PER_DEG
  );
}

describe('bearing', () => {
  it('reads clockwise from north, the way a compass does', () => {
    expect(bearing(at(0, 0), at(1, 0))).toBeCloseTo(0, 1); // north
    expect(bearing(at(0, 0), at(0, 1))).toBeCloseTo(90, 1); // east
    expect(bearing(at(1, 0), at(0, 0))).toBeCloseTo(180, 1); // south
    expect(bearing(at(0, 1), at(0, 0))).toBeCloseTo(270, 1); // west
  });

  it('never returns a negative heading', () => {
    for (const b of [
      bearing(at(0, 0), at(-1, -1)),
      bearing(at(0, 0), at(0, -1)),
      bearing(at(5, 5), at(4, 4)),
    ]) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe('evenlySpaced', () => {
  it('spaces waypoints by distance even when the fixes are not', () => {
    // A straight 1000 m line whose points cluster hard at the start — a
    // runner who set off slowly. Sampling by index would put most of the
    // camera's time in the first tenth of the route.
    const pts = [];
    for (let i = 0; i <= 50; i++) pts.push(at(0, (0.001 * i) / 50)); // dense
    for (let i = 1; i <= 5; i++) pts.push(at(0, 0.001 + (0.008 * i) / 5)); // sparse

    const out = evenlySpaced(pts, 10);
    expect(out).toHaveLength(10);

    const gaps = [];
    for (let i = 1; i < out.length; i++) gaps.push(gap(out[i - 1], out[i]));
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    // Every hop the same length, to within a percent.
    expect(max / min).toBeLessThan(1.01);
  });

  it('starts at the start and ends at the finish', () => {
    const pts = [at(0, 0), at(0, 0.005), at(0.005, 0.005)];
    const out = evenlySpaced(pts, 8);
    expect(out[0].longitude).toBeCloseTo(0, 9);
    expect(out[0].latitude).toBeCloseTo(0, 9);
    expect(out[out.length - 1].longitude).toBeCloseTo(0.005, 9);
    expect(out[out.length - 1].latitude).toBeCloseTo(0.005, 9);
  });

  it('follows a bent route round the corner instead of cutting it', () => {
    // An L. A sampler that interpolated between endpoints would put waypoints
    // on the diagonal, which is ground the runner never covered.
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push(at(0, (0.01 * i) / 20));
    for (let i = 1; i <= 20; i++) pts.push(at((0.01 * i) / 20, 0.01));
    const out = evenlySpaced(pts, 21);
    // Every waypoint sits on one leg or the other: either lat is ~0, or lon
    // is ~0.01. A cut corner satisfies neither.
    out.forEach((p) => {
      const onFirstLeg = Math.abs(p.latitude) < 1e-9;
      const onSecondLeg = Math.abs(p.longitude - 0.01) < 1e-9;
      expect(onFirstLeg || onSecondLeg).toBe(true);
    });
  });

  it('survives the degenerate paths a real recording can produce', () => {
    expect(evenlySpaced([], 10)).toEqual([]);
    expect(evenlySpaced([at(1, 1)], 10)).toEqual([at(1, 1)]);
    // A runner who never moved: no total length to divide by.
    const still = evenlySpaced([at(1, 1), at(1, 1), at(1, 1)], 6);
    expect(still.length).toBeGreaterThanOrEqual(2);
    still.forEach((p) => expect(p.latitude).toBeCloseTo(1, 9));
    // Fixes with junk coordinates are dropped rather than flown to.
    const dirty = evenlySpaced(
      [at(0, 0), { latitude: NaN, longitude: 0 }, null, at(0, 0.01)],
      5
    );
    expect(dirty).toHaveLength(5);
    dirty.forEach((p) => expect(isFinite(p.latitude) && isFinite(p.longitude)).toBe(true));
  });
});
