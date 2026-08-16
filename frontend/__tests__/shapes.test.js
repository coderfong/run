// The sticker set's geometry.
//
// Tested rather than eyeballed for the same reason `nbInk` is: the failure mode
// is SILENT. A path with a NaN in it renders as nothing at all — no warning, no
// red box, just a gap where the mark was — and a stroke expressed in viewBox
// units instead of points renders perfectly at whatever size it was checked at
// and wrong at every other.

import { BOX, SHAPES, petalRadius, shapeGeometry, strokeUnits } from '../src/components/ui/Shapes';

// Every number in a path or polygon, whatever the command letters around it.
const numbersIn = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

describe('the shape set', () => {
  it('has the whole brutalist vocabulary', () => {
    expect(SHAPES).toEqual([
      'burst', 'star', 'sparkle', 'daisy', 'blob', 'bolt', 'arrow', 'cross', 'disc', 'squiggle',
    ]);
  });

  it('returns nothing for a name it does not have, rather than throwing', () => {
    expect(shapeGeometry('trapezoid')).toBeNull();
  });

  it.each(SHAPES)('%s is finite everywhere', (name) => {
    const geo = shapeGeometry(name);
    if (geo.kind === 'circle') return;
    const nums = numbersIn(geo.d);
    expect(nums.length).toBeGreaterThan(0);
    nums.forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });

  // The authored box. Anything outside it would be cropped by the viewBox —
  // the padding the component adds is for the STROKE, and is only half a pen
  // wide, so it is not room for stray geometry.
  //
  // Sound for every shape here EXCEPT an arc. A bezier is contained by the
  // convex hull of its control points, so checking the numbers in the path is
  // genuinely checking the curve; an arc bulges well past both of its endpoints
  // by an amount that appears nowhere in the path data. The daisy is the only
  // arc in the set and it gets its own assertion below.
  it.each(SHAPES)('%s stays inside the 0…100 box it is authored in', (name) => {
    const geo = shapeGeometry(name);
    if (geo.kind === 'circle') return;
    numbersIn(geo.d).forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(BOX);
    });
  });

  it('gives the radial marks the point count their name implies', () => {
    // Outer and inner vertex per point, so twice the points.
    expect(shapeGeometry('star').d.split(' ')).toHaveLength(10);
    expect(shapeGeometry('burst').d.split(' ')).toHaveLength(24);
  });

  // The bug the in-box check above cannot see, and the reason `petalRadius`
  // exists. A petal is a MAJOR arc: it reaches `r + sqrt(r² - h²)` past the
  // midpoint of the chord it spans, so the distance it actually travels is not
  // a number written anywhere in the path. A plausible-looking radius of 22 put
  // these tips at 64 in a box that crops at 50, and all six came out sliced
  // flat — geometry that renders perfectly and is simply the wrong shape.
  it('reaches the edge of the box with its petals, and does not pass it', () => {
    const ring = 30;
    const n = 6;
    const r = petalRadius(n, ring);
    const h = ring * Math.sin(Math.PI / n);
    // A real arc needs a radius of at least the half-chord, or the two points
    // cannot be joined by a circle of that size at all.
    expect(r).toBeGreaterThanOrEqual(h);
    const tip = ring * Math.cos(Math.PI / n) + r + Math.sqrt(r * r - h * h);
    expect(tip).toBeCloseTo(50, 6);
  });

  it('draws the daisy as ONE closed path, not six overlapping petals', () => {
    const d = shapeGeometry('daisy').d;
    // Six arcs and a close. Separate petals would each need their own move.
    expect((d.match(/A/g) || [])).toHaveLength(6);
    expect((d.match(/M/g) || [])).toHaveLength(1);
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  it('keeps the squiggle a line — a filled squiggle is a ribbon', () => {
    expect(shapeGeometry('squiggle').stroked).toBe(true);
    // And it is the only one.
    const stroked = SHAPES.filter((n) => shapeGeometry(n).stroked);
    expect(stroked).toEqual(['squiggle']);
  });
});

describe('stroke weight is a point value, not a viewBox value', () => {
  it('renders the same on-screen weight at every size', () => {
    // The invariant: user units × (size / BOX) = points on screen. A 2pt mark
    // measures 2pt whether it is drawn at 12 points or at 120. A fixed
    // strokeWidth would make that number track the size instead.
    [12, 24, 48, 120].forEach((size) => {
      expect(strokeUnits(2, size) * (size / BOX)).toBeCloseTo(2, 6);
    });
  });

  it('needs a heavier pen in user units the smaller the mark gets', () => {
    expect(strokeUnits(3, 12)).toBeGreaterThan(strokeUnits(3, 96));
  });
});
