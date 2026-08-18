// Free drawing for the Territory Planner — the maths, with no React in it.
//
// Tapping out a route point by point is fine for three legs and miserable for
// a loop around a park, which is exactly the shape the planner is for. Drawing
// is the natural gesture and the one every mapping tool uses; this is what
// turns a finger drag into a route the planner can analyse.
//
// TWO SEPARATE PROBLEMS, and they are solved at different moments:
//
//   1. TOO MANY POINTS. A drag reports a sample every frame, so a two second
//      stroke is ~120 pixels of which most are a millimetre apart. Kept whole
//      they cost the analysis 120 containment tests per polygon and buy no
//      accuracy at all. Thinned WHILE DRAWING, by distance, because it is
//      cheap and it keeps the live line honest.
//
//   2. THE WRONG SHAPE. Even thinned, a hand-drawn line is jittery, and its
//      corners are rounded off by the way a finger actually moves. Simplified
//      AFTER the stroke with Ramer/Douglas/Peucker, which keeps the points
//      that carry the shape (the corners) and drops the ones that only carry
//      the wobble.
//
// Both run in SCREEN SPACE, before anything is unprojected. That is deliberate:
// the tolerances are perceptual ("closer together than a finger can aim") and
// a pixel is the unit those are actually expressed in. In degrees the same
// tolerance would mean different things at different latitudes and at every
// zoom level.

/**
 * The closest two samples may be, in points, while the finger is moving.
 *
 * About a third of a fingertip. Under this the samples are not describing a
 * different place, they are describing the same place twice.
 */
export const MIN_SAMPLE_GAP_PX = 6;

/**
 * How far a point may sit from the line between its neighbours before it is
 * considered part of the shape rather than part of the wobble.
 *
 * Deliberately small. A planner route is measured — the distance figure and
 * every containment test are computed from these points — so simplification
 * here must never round a corner off a route in a way that changes what the
 * panel then claims about it.
 */
export const SIMPLIFY_TOLERANCE_PX = 2.5;

/** A route needs at least this many points to be worth analysing. */
export const MIN_ROUTE_POINTS = 2;

/**
 * Should this sample be kept, given the last one that was?
 *
 * Called on every touch move, so it is a comparison and nothing else.
 */
export function shouldSample(point, last, minGap = MIN_SAMPLE_GAP_PX) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (!last) return true;
  return Math.hypot(point.x - last.x, point.y - last.y) >= minGap;
}

/** Perpendicular distance from `p` to the segment `a`→`b`. */
function segmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer/Douglas/Peucker, iteratively.
 *
 * ITERATIVE ON PURPOSE. The recursive form is the one everybody writes, and on
 * a pathological stroke — a long slow arc, where every point is very slightly
 * off the chord — it recurses once per point. A determined scribble on a big
 * phone can produce a few thousand samples, which is a stack overflow inside a
 * gesture handler and takes the screen with it. An explicit stack cannot.
 */
export function simplify(points, tolerance = SIMPLIFY_TOLERANCE_PX) {
  if (!Array.isArray(points) || points.length <= 2) return points ? [...points] : [];

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;

    let worst = -1;
    let worstAt = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = segmentDistance(points[i], points[first], points[last]);
      if (distance > worst) {
        worst = distance;
        worstAt = i;
      }
    }

    if (worst > tolerance && worstAt > 0) {
      keep[worstAt] = true;
      stack.push([first, worstAt], [worstAt, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

/**
 * Turn a raw stroke into the screen points a route should be built from.
 *
 * Returns [] for anything too short to be a route — a tap, or a drag that
 * never left the point it started on. That case matters: the planner must not
 * treat a stray touch as a one-point route, and the caller uses the empty
 * result to decide the stroke was a tap and should drop a point instead.
 */
export function strokeToRoute(stroke, { tolerance = SIMPLIFY_TOLERANCE_PX } = {}) {
  const points = (stroke || []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  if (points.length < MIN_ROUTE_POINTS) return [];

  const simplified = simplify(points, tolerance);
  if (simplified.length < MIN_ROUTE_POINTS) return [];

  // NOT closed here. A stroke whose ends nearly meet looks like a loop and the
  // temptation is to snap it shut, but the planner reports the distance and
  // the ground of the route AS DRAWN, and silently adding a leg the runner did
  // not draw would make its own numbers wrong. The claim geometry is the
  // server's to decide either way (see map/planner.js).
  return simplified;
}

/**
 * Was this gesture a drag, or a tap that wandered a couple of pixels?
 *
 * A planner in draw mode still has to let you TAP to place a single point,
 * because a route of two deliberate ends is a legitimate thing to want and
 * making people scribble a straight line to get one would be absurd.
 */
export function isDrag(stroke, threshold = MIN_SAMPLE_GAP_PX * 2) {
  if (!stroke || stroke.length < 2) return false;
  const first = stroke[0];
  return stroke.some((p) => Math.hypot(p.x - first.x, p.y - first.y) >= threshold);
}
