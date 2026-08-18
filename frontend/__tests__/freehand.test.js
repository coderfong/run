// Free drawing in the Territory Planner: the screen-space maths.
import {
  MIN_SAMPLE_GAP_PX,
  isDrag,
  shouldSample,
  simplify,
  strokeToRoute,
} from '../src/map/freehand';

describe('sampling a moving finger', () => {
  it('always keeps the first sample', () => {
    expect(shouldSample({ x: 10, y: 10 }, null)).toBe(true);
  });

  it('drops samples closer together than a finger can aim', () => {
    expect(shouldSample({ x: 10, y: 10 }, { x: 12, y: 10 })).toBe(false);
  });

  it('keeps a sample once it has actually moved', () => {
    expect(shouldSample({ x: 10 + MIN_SAMPLE_GAP_PX, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it('refuses a sample that is not a finite point', () => {
    expect(shouldSample({ x: NaN, y: 1 }, null)).toBe(false);
    expect(shouldSample(null, null)).toBe(false);
  });
});

describe('simplify', () => {
  it('reduces a straight line to its two ends', () => {
    const line = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: 100 }));
    expect(simplify(line)).toEqual([{ x: 0, y: 100 }, { x: 195, y: 100 }]);
  });

  it('keeps the corner of an L', () => {
    const corner = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 90, y: i * 10 })),
    ];
    const out = simplify(corner);
    expect(out).toContainEqual({ x: 90, y: 0 });
    expect(out.length).toBeLessThan(corner.length);
  });

  it('leaves a two-point stroke alone', () => {
    const two = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(simplify(two)).toEqual(two);
  });

  // The recursive form of this algorithm blows the stack on a long shallow arc,
  // which takes the screen down from inside a gesture handler.
  it('survives a stroke long enough to overflow a recursive implementation', () => {
    const arc = Array.from({ length: 12000 }, (_, i) => ({ x: i, y: Math.sin(i / 8000) * 4 }));
    expect(() => simplify(arc, 0.0001)).not.toThrow();
  });
});

describe('strokeToRoute', () => {
  it('turns a scribbled loop into a route with far fewer points', () => {
    const loop = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 200) * Math.PI * 2;
      return { x: 200 + Math.cos(a) * 100, y: 300 + Math.sin(a) * 100 };
    });
    const route = strokeToRoute(loop);
    expect(route.length).toBeGreaterThan(2);
    expect(route.length).toBeLessThan(loop.length);
    // The ends are preserved exactly — the route is what was drawn, not a
    // closed shape the planner invented.
    expect(route[0]).toEqual(loop[0]);
    expect(route[route.length - 1]).toEqual(loop[loop.length - 1]);
  });

  it('refuses anything too short to be a route', () => {
    expect(strokeToRoute([])).toEqual([]);
    expect(strokeToRoute([{ x: 1, y: 1 }])).toEqual([]);
    expect(strokeToRoute(null)).toEqual([]);
  });

  it('discards samples that are not finite points', () => {
    expect(strokeToRoute([{ x: 0, y: 0 }, { x: NaN, y: 2 }])).toEqual([]);
  });
});

describe('telling a drag from a tap', () => {
  it('calls a stationary touch a tap, so it places one point', () => {
    expect(isDrag([{ x: 10, y: 10 }, { x: 11, y: 10 }])).toBe(false);
    expect(isDrag([{ x: 10, y: 10 }])).toBe(false);
  });

  it('calls a real stroke a drag', () => {
    expect(isDrag([{ x: 10, y: 10 }, { x: 90, y: 60 }])).toBe(true);
  });
});
