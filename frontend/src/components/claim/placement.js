// Moving the claim, locally, at the speed of a finger.
//
// The server grows ONE shape — the run's own silhouette at the earned area —
// and placing it is a rigid move: slide its centre along the route, turn it
// about that centre. Both axes are continuous, so the map cannot wait on a
// request per pixel; this is the same transform the server does
// (geospatial.ClaimStamp), redone here so the polygon under the runner's
// finger is drawn from local arithmetic and lands within a metre of what the
// claim will actually take.
//
// The two must agree, so the rules are worth stating:
//
//   * the pivot is the shape's own centre (`baseCentre`), already placed on
//     the route at `baseT` by the server;
//   * sliding is literal: a pose at `t` puts the centre on the matching route
//     point, including all the way around a closed loop;
//   * a positive angle turns anticlockwise, matching shapely's `rotate`.
//
// Everything runs in a local east-north metre frame centred on `baseCentre`.
// A claim is at most a couple of kilometres across, so the flat-earth error
// over that span is well under the width of the stroke this draws.

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

// A closure over both origins, built once per placer and handed every point.
function makeFrame(centre) {
  const [lon0, lat0] = centre;
  const kx = M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);
  return {
    toM: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT],
    toWgs: ([x, y]) => [lon0 + x / kx, lat0 + y / M_PER_DEG_LAT],
  };
}

// Cumulative arc length along a metric polyline, plus its total.
function arcTable(points) {
  const acc = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    acc.push(total);
  }
  return { acc, total };
}

// The point at normalised distance `t` along a metric polyline. Matches
// shapely's `interpolate(t, normalized=True)`, including how it clamps.
function interpolateAt(points, table, t) {
  if (points.length === 0) return [0, 0];
  if (points.length === 1 || table.total <= 0) return points[0];
  const want = Math.max(0, Math.min(1, t)) * table.total;
  // Linear scan is fine: routes here are a few hundred points and this runs
  // once per gesture frame, not once per vertex.
  let i = 1;
  while (i < table.acc.length - 1 && table.acc[i] < want) i += 1;
  const a = points[i - 1];
  const b = points[i];
  const seg = table.acc[i] - table.acc[i - 1];
  const f = seg > 0 ? (want - table.acc[i - 1]) / seg : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * A placer for one run's claim, built once from what /claim-options returned.
 *
 * `base` is the options payload: `base_ring`, `base_centre`, `base_t`, `route`
 * (all lon/lat). Returns null when the server sent no shape — the caller falls
 * back to drawing the ring it already has and to the server's own default.
 */
export function makePlacer(base) {
  const ring = base?.base_ring;
  const centre = base?.base_centre;
  const route = base?.route;
  if (!ring?.length || ring.length < 3 || !centre || !route || route.length < 2) return null;

  const { toM, toWgs } = makeFrame(centre);
  // The ring, relative to its own centre — so a turn is a rotation about the
  // origin and nothing has to hunt for the pivot on every frame.
  const local = ring.map((p) => toM(p));
  const metricRoute = route.map((p) => toM(p));
  const table = arcTable(metricRoute);
  const baseT = typeof base.base_t === 'number' ? base.base_t : 0.5;
  const offsetAt = (t) => interpolateAt(metricRoute, table, t);

  return {
    baseT,
    /** The claim's centre at this pose, as {latitude, longitude}. */
    centreAt(t) {
      const [dx, dy] = offsetAt(t);
      const [lon, lat] = toWgs([dx, dy]);
      return { latitude: lat, longitude: lon };
    },
    /** The placed ring as [lon, lat] pairs — the wire shape. */
    ringAt(t, deg) {
      const rad = ((deg || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const [dx, dy] = offsetAt(t);
      return local.map(([x, y]) =>
        toWgs([x * cos - y * sin + dx, x * sin + y * cos + dy])
      );
    },
    /** The placed ring as map points — what TerritoryFill draws. */
    pointsAt(t, deg) {
      return this.ringAt(t, deg).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
    },
  };
}

/** Fold any heading into [0, 360), the way the server does. */
export function normaliseDeg(deg) {
  const d = Number(deg);
  if (!isFinite(d)) return 0;
  return ((d % 360) + 360) % 360;
}

/** How far a heading is from the run's own, as a signed 0..180. For copy. */
export function turnFromRun(deg) {
  const d = normaliseDeg(deg);
  return d > 180 ? d - 360 : d;
}

/** Convert a touch around a dial centre into the claim's heading frame. */
export function headingFromDialPoint(x, y, centreX = 0, centreY = 0) {
  const dx = x - centreX;
  const dy = y - centreY;
  return normaliseDeg((Math.atan2(-dy, dx) * 180) / Math.PI - 90);
}

/** Screen-space vector for a heading needle: 0 is up, 90 is left. */
export function dialPointForHeading(deg, radius) {
  const rad = ((normaliseDeg(deg) + 90) * Math.PI) / 180;
  return [Math.cos(rad) * radius, -Math.sin(rad) * radius];
}
