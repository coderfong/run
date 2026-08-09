"""
Core geospatial logic for the territory-running game.

Conventions
-----------
* All inputs are WGS84 lon/lat. Storage in PostGIS is also WGS84 (SRID 4326).
* For *measurements* (distance, area, "is point N within X meters of segment K")
  we project to a local Azimuthal Equidistant CRS centered on the path. This
  gives accurate metric distance/area near the run regardless of latitude,
  unlike Web Mercator (which distorts area badly off the equator) or raw
  lat/lon (degrees aren't meters).
* Once we've decided WHERE the polygon closes in projected space, we map
  the closure point back to WGS84 and produce the final polygon in WGS84.
* Loop detection treats a path as a sequence of segments and looks for a
  point on a *recent* segment that lies within `closure_radius_m` of the
  current location. This is more robust than requiring an exact crossing,
  because real GPS traces almost never cross precisely.

We deliberately use Shapely (not raw PostGIS) for the closure detection
because it's a tight per-point loop and a roundtrip-per-point to Postgres
would be far too slow for live submissions. PostGIS is used for storage
and for cross-territory operations (ST_Difference / ST_Intersects).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Tuple

from pyproj import Transformer
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import transform as shapely_transform
from shapely.validation import make_valid

from .config import settings
from .schemas import GpsPoint


# ---------------------------------------------------------------------------
# Projection helpers
# ---------------------------------------------------------------------------


def _aeqd_proj_string(lat0: float, lon0: float) -> str:
    """An Azimuthal Equidistant projection centered on (lat0, lon0).
    Distances *from* (lat0,lon0) are exact in meters; distances near the
    centre are accurate enough for run-scale work (a few km radius)."""
    return (
        f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} "
        f"+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    )


def _make_transformers(lat0: float, lon0: float) -> Tuple[Transformer, Transformer]:
    """(to_metric, to_wgs84) — note pyproj's always_xy=True so we pass (lon, lat)."""
    proj = _aeqd_proj_string(lat0, lon0)
    to_m = Transformer.from_crs("EPSG:4326", proj, always_xy=True)
    to_wgs = Transformer.from_crs(proj, "EPSG:4326", always_xy=True)
    return to_m, to_wgs


def project_metric(points_lonlat: List[Tuple[float, float]]):
    """Project a list of (lon, lat) WGS84 coords to a local equal-distance
    metric CRS centered on the path centroid. Returns:
        (metric_coords, to_wgs84_transformer)
    so callers can convert results back to WGS84 for storage."""
    if not points_lonlat:
        raise ValueError("project_metric: empty input")
    lon0 = sum(p[0] for p in points_lonlat) / len(points_lonlat)
    lat0 = sum(p[1] for p in points_lonlat) / len(points_lonlat)
    to_m, to_wgs = _make_transformers(lat0, lon0)
    metric = [to_m.transform(lon, lat) for lon, lat in points_lonlat]
    return metric, to_wgs


def reproject_geometry_to_wgs84(geom, to_wgs84: Transformer):
    return shapely_transform(lambda x, y, z=None: to_wgs84.transform(x, y), geom)


# ---------------------------------------------------------------------------
# Path cleanup
# ---------------------------------------------------------------------------


@dataclass
class CleanedPath:
    """A scrubbed path ready for loop detection / polygon construction."""
    metric_coords: List[Tuple[float, float]]   # in local AEQD meters
    wgs_coords: List[Tuple[float, float]]      # parallel list in (lon, lat)
    timestamps: List[datetime]
    to_wgs84: Transformer
    distance_m: float


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance, used only for the speed-filter pre-pass
    (where we don't yet have a projection)."""
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def clean_path(points: List[GpsPoint]) -> Optional[CleanedPath]:
    """Build a CleanedPath from raw GPS samples.

    Steps:
      1. Drop duplicate timestamps (some phones double-emit).
      2. Drop samples that imply > max_speed_mps from the previous accepted
         sample — almost always a GPS glitch (urban canyons, indoors).
      3. Project to local metric CRS.
      4. Run a Douglas-Peucker simplification with a small tolerance to
         remove micro-jitter without distorting the route.
    """
    if len(points) < 2:
        return None

    # 1 + 2: temporal + speed filtering, in lat/lon space.
    accepted: List[GpsPoint] = [points[0]]
    for p in points[1:]:
        prev = accepted[-1]
        dt = (p.t - prev.t).total_seconds()
        if dt <= 0:
            continue
        d = _haversine_m(prev.lat, prev.lon, p.lat, p.lon)
        if d / dt > settings.max_speed_mps:
            continue
        accepted.append(p)

    if len(accepted) < 2:
        return None

    wgs = [(p.lon, p.lat) for p in accepted]
    metric, to_wgs = project_metric(wgs)

    # 4: simplification. Done in metric space so the tolerance is in meters.
    line = LineString(metric).simplify(settings.simplify_tolerance_m, preserve_topology=False)
    simp_metric = list(line.coords)

    # We need timestamps and wgs coords parallel to simp_metric. Since we
    # simplified, some intermediate points were dropped — for downstream
    # logic we only need timestamps at the kept vertices, so we map by
    # nearest-original-index in metric space.
    keep_indices: List[int] = []
    j = 0
    for sx, sy in simp_metric:
        # Walk forward through the original list to find the matching point.
        while j < len(metric) and metric[j] != (sx, sy):
            j += 1
        if j >= len(metric):
            # Shouldn't happen with preserve_topology=False on the original,
            # but guard against edge cases by snapping to nearest.
            j = min(
                range(len(metric)),
                key=lambda k: (metric[k][0] - sx) ** 2 + (metric[k][1] - sy) ** 2,
            )
        keep_indices.append(j)

    cleaned = CleanedPath(
        metric_coords=simp_metric,
        wgs_coords=[wgs[i] for i in keep_indices],
        timestamps=[accepted[i].t for i in keep_indices],
        to_wgs84=to_wgs,
        distance_m=line.length,
    )
    return cleaned


# ---------------------------------------------------------------------------
# Loop detection
# ---------------------------------------------------------------------------


@dataclass
class LoopResult:
    polygon_wgs: Polygon          # final WGS84 polygon, simple + valid
    polygon_metric: Polygon       # same polygon in local meters (for area)
    area_m2: float
    closure_segment_index: int    # which earlier segment did we close on
    closure_point_metric: Tuple[float, float]


def _segment_closest_point(seg_a, seg_b, p) -> Tuple[Tuple[float, float], float]:
    """Closest point on segment AB to point P, plus distance. All in metric."""
    ax, ay = seg_a
    bx, by = seg_b
    px, py = p
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        cx, cy = ax, ay
    else:
        t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
        t = max(0.0, min(1.0, t))
        cx, cy = ax + t * dx, ay + t * dy
    d = math.hypot(px - cx, py - cy)
    return (cx, cy), d


def detect_loop(cleaned: CleanedPath) -> Optional[LoopResult]:
    """Decide whether `cleaned.metric_coords` contains a closed loop.

    Algorithm:
      For each new vertex i (latest), examine all *non-adjacent* earlier
      segments [k, k+1] where k <= i - 3. If the latest point lies within
      `closure_radius_m` of segment k, we declare closure at the closest
      point on that segment. The polygon is then formed by:

          closure_point -> coords[k+1] -> coords[k+2] -> ... -> coords[i]

      followed by an explicit close back to closure_point.

    Why "non-adjacent" (k <= i-3): a path is always within zero meters of
    its own most-recent segments, which would trivially "close" every step.

    Why "latest point only": loop detection runs incrementally as new
    points arrive. The closure that matters is the one the runner just
    completed — earlier potential closures would have already triggered.

    We pick the *earliest* qualifying k (smallest k), so the polygon
    encloses as much area as possible — i.e. the user gets credit for
    the largest loop their path implies.
    """
    coords = cleaned.metric_coords
    n = len(coords)
    if n < settings.min_loop_points:
        return None

    latest = coords[-1]
    chosen: Optional[Tuple[int, Tuple[float, float], float]] = None

    # k is the index of the start of an earlier segment [coords[k], coords[k+1]].
    # Walk forward (smallest k first) so we lock onto the largest loop.
    for k in range(0, n - 3):
        cp, d = _segment_closest_point(coords[k], coords[k + 1], latest)
        if d <= settings.closure_radius_m:
            chosen = (k, cp, d)
            break

    if chosen is None:
        return None

    k, cp, _ = chosen

    # Build the polygon ring. Note we replace coords[k] with the exact
    # closure point cp so the ring closes geometrically clean.
    ring = [cp] + list(coords[k + 1 : n])  # noqa: E203
    if len(ring) < 3:
        return None
    if ring[-1] != ring[0]:
        ring.append(ring[0])

    poly_metric = Polygon(ring)
    if not poly_metric.is_valid:
        # Self-intersecting paths: make_valid will return a MultiPolygon.
        # Take the largest piece — that's the dominant loop.
        fixed = make_valid(poly_metric)
        if fixed.geom_type == "Polygon":
            poly_metric = fixed
        elif fixed.geom_type == "MultiPolygon":
            poly_metric = max(fixed.geoms, key=lambda g: g.area)
        else:
            return None

    area = poly_metric.area  # already in m^2 because we're in AEQD meters
    if area < settings.min_loop_area_m2:
        return None
    if area > settings.max_polygon_area_m2:
        return None

    poly_wgs = reproject_geometry_to_wgs84(poly_metric, cleaned.to_wgs84)

    return LoopResult(
        polygon_wgs=poly_wgs,
        polygon_metric=poly_metric,
        area_m2=area,
        closure_segment_index=k,
        closure_point_metric=cp,
    )


# ---------------------------------------------------------------------------
# Circle claims
# ---------------------------------------------------------------------------


# Diminishing returns on distance, as (km_threshold, marginal_rate). Past 5 km
# each further kilometre is worth less GROUND — not less anything else. A
# marathon should out-earn a 5 km on XP, coins, club distance, leaderboards and
# achievements; what it should not do is quietly erase a neighbourhood.
_TERRITORIAL_CURVE = [(5.0, 1.0), (10.0, 0.65), (20.0, 0.30), (float("inf"), 0.10)]


def territorial_distance_m(distance_m: float) -> float:
    """Distance as the map values it, in metres.

    A straight cap made the 13th kilometre worth literally nothing and every
    serious runner hit the wall at the same place. This tapers instead, so
    there is never a step where running further stops counting."""
    km = max(0.0, distance_m) / 1000.0
    eq = 0.0
    lower = 0.0
    for upper, rate in _TERRITORIAL_CURVE:
        if km <= lower:
            break
        eq += (min(km, upper) - lower) * rate
        lower = upper
    return eq * 1000.0


def claim_area_m2(distance_m: float) -> float:
    """Land a run earns, capped at max_polygon_area_m2.

    Linear in TERRITORIAL distance (see above): every such metre is worth
    `claim_area_per_m` of ground. The original rule made the run distance the
    CIRCUMFERENCE of the claim circle, so area went as d²/4π — doubling your
    distance quadrupled your land, which is why long runs ran away with the
    map. The linear rule that replaced it fixed the growth but kept a rate
    (400 m²/m) that painted a ~400 m-wide swathe along every route."""
    return min(
        territorial_distance_m(distance_m) * settings.claim_area_per_m,
        settings.max_polygon_area_m2,
    )


# Half the width of the corridor a route is credited with covering, for the
# distinct-ground measure below. 10 m each side ≈ a road and its pavements.
_UNIQUE_HALF_WIDTH_M = 10.0


def route_unique_length_m(path_lonlat: List[Tuple[float, float]]) -> float:
    """How much DISTINCT ground a route covered, as an equivalent length.

    Distance alone says nothing about where you went: forty laps of a corridor,
    a phone shaken on a desk and a GPS drifting under a roof all accumulate
    metres without going anywhere. This buffers the route into a corridor and
    measures its AREA, so ground covered twice is only counted once, then
    converts back to a length. A there-and-back run is honest here — the outward
    and return legs overlap, so it reads roughly half its distance, which is a
    fair description of the ground it actually touched."""
    if not path_lonlat or len(path_lonlat) < 2:
        return 0.0
    try:
        metric, _ = project_metric(path_lonlat)
        line = LineString(metric)
        if line.length <= 0:
            return 0.0
        corridor = line.buffer(_UNIQUE_HALF_WIDTH_M, quad_segs=4)
        # Subtract the round caps so a straight run measures its own length
        # rather than length + one radius at each end.
        return max(0.0, corridor.area / (2 * _UNIQUE_HALF_WIDTH_M) - _UNIQUE_HALF_WIDTH_M * 1.57)
    except Exception:
        # Never fail a run over a diversity check — fall back to trusting it.
        return float("inf")


def claim_radius_m(distance_m: float) -> float:
    """Radius of the fallback claim circle — the disc holding the earned area.
    Only used when a run has no usable route to grow the territory around."""
    return math.sqrt(claim_area_m2(distance_m) / math.pi)


def circle_polygon_wgs(lat: float, lon: float, radius_m: float) -> Polygon:
    """A circle of `radius_m` meters around (lat, lon) as a WGS84 polygon.
    Built by buffering in a local AEQD projection so the radius is true
    meters at any latitude."""
    _to_m, to_wgs = _make_transformers(lat, lon)
    disc = Point(0.0, 0.0).buffer(
        radius_m, quad_segs=max(4, settings.claim_circle_segments // 4)
    )
    return reproject_geometry_to_wgs84(disc, to_wgs)


# ---------------------------------------------------------------------------
# Route-grown territory
#
# The run does not stamp a fixed shape on the map — it GROWS one. Distance
# decides how much land you earn (claim_area_m2); the route decides what that
# land looks like. A straight run becomes a long capsule, an L becomes a bent
# province, laps of one neighbourhood become a compact block.
#
# The pipeline, in local metric space:
#
#   1. simplify the path down to 4–12 anchors — the major turns, not the GPS
#      wobble, so the silhouette is the broad shape of where you went
#   2. connect the anchors into a hidden spine
#   3. thicken the spine, then CLOSE it (dilate/erode) so neighbouring legs
#      merge into one solid body instead of parallel ribbons, then OPEN it
#      (erode/dilate) so nothing narrow survives
#   4. fill any interior hole — a lap round the block takes the block, not a
#      donut around it
#   5. bisect the thickness until the region holds exactly the earned area
#
# Nothing here is ever thinner than claim_min_width_m. When a route is too
# spread out to hold its earned area at that minimum thickness, the SPINE is
# shrunk toward its own centre instead of the territory being thinned — the
# shape stays recognisable and just covers less ground.
# ---------------------------------------------------------------------------

_BUFFER_KW = dict(quad_segs=8, cap_style=1, join_style=1)  # round caps + joins


def _largest_polygon(geom) -> Optional[Polygon]:
    """The dominant piece of a possibly-multi geometry, holes filled."""
    if geom.is_empty:
        return None
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type != "Polygon":
        return None
    # Holes filled: running a lap around a park claims the park, not a ring
    # of pavement around it.
    return Polygon(geom.exterior)


def _route_anchors(coords: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Reduce a metric path to `claim_anchor_min`..`claim_anchor_max` anchors.

    Douglas-Peucker with the tolerance bisected until the vertex count lands
    in the window; a path with too few turns to hit the minimum (a dead
    straight run) is resampled at even arc-length instead, so the spine always
    has enough points to bend."""
    lo_n, hi_n = settings.claim_anchor_min, settings.claim_anchor_max
    line = LineString(coords)
    best = list(line.coords)

    if len(best) > hi_n:
        lo, hi = 0.0, max(line.length, 1.0)
        for _ in range(32):
            mid = (lo + hi) / 2
            trial = list(line.simplify(mid, preserve_topology=False).coords)
            if len(trial) > hi_n:
                lo = mid
            else:
                best, hi = trial, mid
                if len(trial) >= lo_n:
                    break

    if len(best) < lo_n:
        # Evenly spaced samples along the ORIGINAL line, not the simplified
        # one — otherwise a straight run collapses to its two endpoints.
        step = line.length / (lo_n - 1)
        best = [line.interpolate(i * step).coords[0] for i in range(lo_n)]

    # Drop consecutive duplicates; a zero-length spine buffers to nothing.
    out: List[Tuple[float, float]] = []
    for p in best:
        if not out or math.dist(out[-1], p) > 0.5:
            out.append(p)
    return out


def _grow_region(spine: LineString, half_width: float) -> Optional[Polygon]:
    """Thicken `spine` into one solid, smooth, hole-free territory."""
    if half_width <= 0:
        return None
    region = spine.buffer(half_width, **_BUFFER_KW)
    s = half_width * settings.claim_smooth_frac
    if s > 0.5:
        # closing: legs that run near each other fuse into one body
        region = region.buffer(s, **_BUFFER_KW).buffer(-s, **_BUFFER_KW)
        # opening: whatever is left thinner than the minimum is cut away
        region = region.buffer(-s, **_BUFFER_KW).buffer(s, **_BUFFER_KW)
    if not region.is_valid:
        region = make_valid(region)
    poly = _largest_polygon(region)
    if poly is None or poly.area <= 0:
        return None
    # A province, not a grid: shed the vertices the buffering left behind.
    smoothed = poly.simplify(max(1.0, half_width * 0.08), preserve_topology=True)
    return smoothed if smoothed.is_valid and not smoothed.is_empty else poly


def _scale_spine(spine: LineString, factor: float) -> LineString:
    cx, cy = spine.centroid.coords[0]
    return LineString([(cx + (x - cx) * factor, cy + (y - cy) * factor) for x, y in spine.coords])


def _spine_extent(spine: LineString) -> float:
    """How far the route reaches end to end — the longest gap between any two
    anchors. Deliberately NOT the route's length: ten laps of one block are
    6 km of running inside a 500 m box, and that box is what the territory has
    to fit, not the 6 km."""
    pts = list(spine.coords)
    return max(
        (math.dist(a, b) for i, a in enumerate(pts) for b in pts[i + 1:]),
        default=0.0,
    )


def _bisect(fn, lo: float, hi: float, target: float, steps: int = 14) -> float:
    """Smallest x in [lo, hi] with fn(x) >= target, for monotonic fn.

    14 steps splits the width search (roughly 70 m..700 m) to under 5 cm, which
    is four orders of magnitude finer than anything a claim boundary means.
    Each step re-grows the whole region — six buffer operations — so the count
    is the single biggest lever on how long a claim takes to build."""
    for _ in range(steps):
        mid = (lo + hi) / 2
        if fn(mid) < target:
            lo = mid
        else:
            hi = mid
    return hi


def _slice_by_arc(
    coords: List[Tuple[float, float]], start_frac: float, end_frac: float
) -> List[Tuple[float, float]]:
    """The stretch of a metric path between two fractions of its own length.

    Cuts mid-segment at both ends rather than snapping to the nearest vertex,
    so sliding the window moves the territory smoothly instead of jumping from
    GPS point to GPS point."""
    line = LineString(coords)
    total = line.length
    if total <= 0:
        return list(coords)
    a = max(0.0, min(1.0, start_frac)) * total
    b = max(0.0, min(1.0, end_frac)) * total
    if b - a < 1.0:
        return list(coords)

    out = [line.interpolate(a).coords[0]]
    pts = list(line.coords)
    cum = 0.0
    for i in range(1, len(pts)):
        cum += math.dist(pts[i - 1], pts[i])
        if a < cum < b:
            out.append(pts[i])
    out.append(line.interpolate(b).coords[0])

    # A window that lands between two vertices can pick up duplicates at the
    # cut; a zero-length spine buffers to nothing.
    deduped: List[Tuple[float, float]] = []
    for p in out:
        if not deduped or math.dist(deduped[-1], p) > 0.5:
            deduped.append(p)
    return deduped if len(deduped) >= 2 else list(coords)


def claim_window_frac(path_lonlat: List[Tuple[float, float]]) -> float:
    """How much of the route one placement covers, as a fraction of its length.

    1.0 means the run is too short to slide anything along: the only available
    placement is the whole route, exactly as before placement existed."""
    if not path_lonlat or len(path_lonlat) < 2:
        return 1.0
    try:
        metric, _ = project_metric(path_lonlat)
        length = LineString(metric).length
    except Exception:
        return 1.0
    if length <= 0:
        return 1.0
    w = max(0.05, min(1.0, settings.claim_window_frac))
    # A short run's window would be a stub — widen it back out, up to the
    # whole route, and the placement choice quietly disappears.
    return min(1.0, max(w, settings.claim_window_min_m / length))


def claim_placement_samples(count: Optional[int] = None) -> List[float]:
    """Positions along the route to SAMPLE, as fractions, start to finish.

    Placement is continuous — the runner drags the shape anywhere along the
    route — so this is not a list of choices. It is where the server looks when
    it has to survey the whole route at once: the first breakdown shown before
    anything has been dragged, and the "most land / biggest steal / best
    defence" recommendations.

    The full [0, 1] range is offered, ends included. Under the window model the
    ends had to be held back because a window there had no route to grow
    around; a rigid stamp has no such problem, it simply overhangs the start or
    the finish, which is a legitimate place to want your land.
    """
    n = max(1, count if count is not None else settings.claim_placement_count)
    if n == 1:
        return [0.5]
    return [i / (n - 1) for i in range(n)]


def claim_placement_offsets(count: int, window: float) -> List[float]:
    """Window CENTRES, as fractions of the route, first to last.

    Deterministic and index-addressable: the client picks an index and the
    server rebuilds the same list, so a placement is never sent as geometry
    and can never be forged into someone else's neighbourhood."""
    half = window / 2.0
    lo, hi = half, 1.0 - half
    if count <= 1 or hi - lo <= 1e-9:
        return [0.5]
    step = (hi - lo) / (count - 1)
    return [lo + step * i for i in range(count)]


def claim_rotation_offsets(count: Optional[int] = None, span: Optional[float] = None) -> List[float]:
    """Headings a claim can be turned to, in degrees, starting at 0 = as run.

    A span below 360 is centred on 0, so the run's own orientation stays the
    middle option and turning it is a deviation from the route rather than a
    free choice of direction."""
    n = max(1, count if count is not None else settings.claim_rotation_count)
    arc = span if span is not None else settings.claim_rotation_span_deg
    if n <= 1 or arc <= 0:
        return [0.0]
    if arc >= 360.0:
        # A full turn: the last step would land back on the first.
        return [round(i * 360.0 / n, 3) for i in range(n)]
    step = arc / (n - 1)
    return [round(-arc / 2 + step * i, 3) for i in range(n)]


def metric_frame(path_lonlat: List[Tuple[float, float]]):
    """A (to_metric, to_wgs84) pair centred on a route, to be REUSED.

    Building a pyproj Transformer costs ~100 ms — more than every shapely
    operation it is then used for. Anything that projects the same
    neighbourhood repeatedly (the placement grid does it dozens of times)
    must build the frame once and pass it down, or the transformers alone
    become the whole response time."""
    if not path_lonlat:
        raise ValueError("metric_frame: empty input")
    lon0 = sum(p[0] for p in path_lonlat) / len(path_lonlat)
    lat0 = sum(p[1] for p in path_lonlat) / len(path_lonlat)
    return _make_transformers(lat0, lon0)


def rotate_claim_polygon_wgs(poly: Polygon, degrees: float, frame=None) -> Polygon:
    """Turn a claim about its own centre by `degrees` (anticlockwise).

    The pivot is the claim's centroid, which sits on the route — so however far
    it is turned, the territory still covers ground the runner stood on. Done
    in a local metric projection: rotating raw lon/lat would shear the shape
    everywhere except the equator.

    `frame` is a `metric_frame` to project through. Any frame near the claim
    will do — an AEQD centred a few km away is still true to well under a
    metre at this scale — so callers turning many shapes should build one and
    hand it in rather than paying for a transformer per rotation."""
    if not degrees or degrees % 360 == 0:
        return poly
    to_m, to_wgs = frame if frame is not None else _make_transformers(
        poly.centroid.y, poly.centroid.x
    )
    metric = shapely_transform(lambda x, y, z=None: to_m.transform(x, y), poly)
    turned = affinity.rotate(metric, degrees, origin="centroid")
    return reproject_geometry_to_wgs84(turned, to_wgs)


def route_corridor(path_lonlat: List[Tuple[float, float]], frame, buffer_m: Optional[float] = None):
    """The ground within `buffer_m` of the route, in the frame's metric space.

    Built ONCE and reused across the whole candidate grid — it is a buffer over
    the full trail, which is far too expensive to redo per candidate.
    """
    if not path_lonlat or len(path_lonlat) < 2:
        return None
    to_m, _to_wgs = frame
    r = settings.claim_route_attachment_buffer_m if buffer_m is None else buffer_m
    try:
        metric = [to_m.transform(lon, lat) for lon, lat in path_lonlat]
        line = LineString(metric)
        if line.length <= 0:
            return None
        return line.buffer(r, quad_segs=8)
    except Exception:
        return None


def route_attachment(poly_wgs: Polygon, corridor, frame) -> float:
    """How much of a candidate claim lies on ground the runner actually covered.

    Returns the share of the claim's area inside the route corridor, 0..1.

    This is what keeps rotation honest. Turning a claim about its centroid is a
    genuine tactical move — the pivot sits on the route, so a modest turn still
    covers ground that was run — but at a full 360° a long claim can swing onto
    streets the runner never saw. Candidates below
    `settings.claim_min_route_attachment` are closed off rather than offered.

    A geometry pathology returns 1.0, not 0.0: the fallback must never be to
    silently refuse a claim the runner has already earned.
    """
    if corridor is None or corridor.is_empty:
        return 1.0
    to_m, _to_wgs = frame
    try:
        metric = shapely_transform(lambda x, y, z=None: to_m.transform(x, y), poly_wgs)
        if metric.is_empty or metric.area <= 0:
            return 0.0
        return max(0.0, min(1.0, metric.intersection(corridor).area / metric.area))
    except Exception:
        return 1.0


def claim_placements(
    path_lonlat: List[Tuple[float, float]], area_m2: float, count: Optional[int] = None
) -> List[Tuple[float, Polygon]]:
    """Every territory this run could deploy its earned land onto.

    The run earns a fixed `area_m2` whichever placement is chosen — the choice
    is WHERE it lands, not how much. Returns [(centre_fraction, polygon)] in
    route order; an empty list means the route can't carry a shape at all and
    the caller should fall back to the circle claim."""
    if not path_lonlat or len(path_lonlat) < 2 or area_m2 <= 0:
        return []
    n = max(1, count if count is not None else settings.claim_placement_count)
    window = claim_window_frac(path_lonlat)
    if window >= 1.0:
        poly = route_claim_polygon_wgs(path_lonlat, area_m2)
        return [(0.5, poly)] if poly is not None else []

    half = window / 2.0
    out: List[Tuple[float, Polygon]] = []
    for t in claim_placement_offsets(n, window):
        poly = route_claim_polygon_wgs(path_lonlat, area_m2, window=(t - half, t + half))
        if poly is not None:
            out.append((t, poly))
    if not out:
        # Every window failed but the route itself might still work — better a
        # single placement than no claim at all.
        poly = route_claim_polygon_wgs(path_lonlat, area_m2)
        if poly is not None:
            out.append((0.5, poly))
    return out


def grow_claim_region_metric(
    metric: List[Tuple[float, float]], area_m2: float
) -> Optional[Polygon]:
    """The run's silhouette at exactly `area_m2`, in the metric space it was
    handed. Returns None when the coords can't carry a shape.

    Split out of `route_claim_polygon_wgs` so the shape can be grown ONCE and
    then moved around as a rigid body (see `ClaimStamp`). Growing is the
    expensive half — a bisection over buffer operations — and it is also the
    half that must not be repeated, because re-growing on a different stretch
    of route produces a DIFFERENT silhouette. The runner is placing one shape,
    not choosing between a dozen.
    """
    if len(metric) < 2 or area_m2 <= 0:
        return None
    anchors = _route_anchors(metric)
    if len(anchors) < 2:
        return None
    spine = LineString(anchors)
    if spine.length <= 0:
        return None

    # Compactness pressure. Without it the area cap turns a marathon into a
    # 36 km pinstripe: legal (nothing is under the minimum width) and still
    # a coloured line drawn across the city. Reining the SPAN in first
    # forces the same land into a fat capsule with the same silhouette.
    max_extent = math.sqrt(settings.claim_max_aspect * area_m2)
    extent = _spine_extent(spine)
    if extent > max_extent > 0:
        spine = _scale_spine(spine, max_extent / extent)

    min_half = settings.claim_min_width_m / 2.0

    thin = _grow_region(spine, min_half)
    if thin is None:
        return None

    if thin.area > area_m2:
        # Too much route for the land earned: keep the silhouette, shrink
        # it, rather than letting the claim thin out into a ribbon.
        def area_at_scale(f: float) -> float:
            g = _grow_region(_scale_spine(spine, max(f, 1e-3)), min_half)
            return g.area if g else 0.0

        f = _bisect(area_at_scale, 0.0, 1.0, area_m2)
        region = _grow_region(_scale_spine(spine, max(f, 1e-3)), min_half)
    else:
        # A disc of this radius already holds the target, so it bounds the
        # search from above whatever the route looks like.
        hi = math.sqrt(area_m2 / math.pi)
        if hi <= min_half:
            region = thin
        else:
            w = _bisect(lambda x: (lambda g: g.area if g else 0.0)(_grow_region(spine, x)),
                        min_half, hi, area_m2)
            region = _grow_region(spine, w)

    if region is None or region.area <= 0:
        return None
    return region


def route_claim_polygon_wgs(
    path_lonlat: List[Tuple[float, float]],
    area_m2: float,
    window: Optional[Tuple[float, float]] = None,
) -> Optional[Polygon]:
    """Grow `area_m2` of territory around a run's route, in WGS84.

    `window` restricts the growth to a stretch of the route, given as (start,
    end) fractions of its length. It is a legacy path: placement no longer
    re-grows the shape (see `ClaimStamp`), and the only caller left passes
    None, which grows around the whole route. Kept because it is also the
    single-shot fallback used when a stamp cannot be built at all.

    Returns None when the route can't carry a shape (too few points, degenerate
    geometry) — the caller falls back to the circle claim."""
    if not path_lonlat or len(path_lonlat) < 2 or area_m2 <= 0:
        return None
    try:
        metric, to_wgs = project_metric(path_lonlat)
        if window is not None:
            metric = _slice_by_arc(metric, window[0], window[1])
            if len(metric) < 2:
                return None
        region = grow_claim_region_metric(metric, area_m2)
        if region is None:
            return None
        return reproject_geometry_to_wgs84(region, to_wgs)
    except Exception:
        # Any geometry pathology falls back to the circle rather than failing
        # a claim the runner already paid energy for.
        return None


# ---------------------------------------------------------------------------
# The claim stamp
# ---------------------------------------------------------------------------
#
# A run claims ONE shape: the silhouette of the whole route at the earned area.
# Placing it is a RIGID MOVE of that one shape — slide its centre anywhere
# along the route, turn it to any heading — and nothing about the move changes
# what the shape is.
#
# This replaces the window model, where each position re-grew the territory
# around a 55% stretch of the route. That was wrong in the way that matters:
# the thing being positioned kept becoming a different thing as it moved, so
# there was no "your run, as territory" to aim — only a menu of nine unrelated
# blobs. Growing once and moving it rigidly is both what the game means and,
# incidentally, an order of magnitude cheaper: one bisection over buffers
# instead of one per position.
#
# Two properties fall out of the construction, and they are what make a
# free 360° turn safe to offer:
#
#   * the centre always sits ON the route, because placement is defined as
#     putting it there — so a claim is always anchored to ground the runner
#     actually stood on, at any angle;
#   * the area is fixed by the grow, and a rigid move cannot change it — so
#     no position or heading can earn more land than another.
#
# The old `route_attachment` gate existed to stop a rotation swinging a claim
# grown around one stretch onto streets that were never run. It is not needed
# here and is not applied: turning a centre-anchored shape cannot walk it into
# the next neighbourhood.


@dataclass
class ClaimStamp:
    """One grown claim shape plus the route it can be moved along.

    `base` is in metric space with its centroid at the ORIGIN, which is what
    makes a turn a plain rotation about (0, 0) rather than an affine hunt for
    the right pivot. `anchor` is where that centroid actually sits — the shape
    AS RUN — and `t0` is the point on the route nearest to it.

    Sliding is RELATIVE to the run, not absolute along the route: a placement
    at `t` moves the shape by however far the route travels between `t0` and
    `t`. That is the only definition under which "as run" is a pose the runner
    can return to, and it is the only one that survives a loop. On a lap of a
    block the grown territory is the filled block, so its centroid sits in the
    middle of the loop with no route anywhere near it; putting that centroid
    ON the route would shove the whole territory off to one side of the ground
    it was grown from, and the shape would jump the moment the control was
    touched.

    Build it once per run and ask it for as many placements as you like: each
    costs a rotation and a translation of an existing polygon, plus one
    reprojection.
    """

    base: Polygon           # metric, centroid at (0, 0)
    anchor: Tuple[float, float]   # metric, where that centroid sits as run
    line: LineString        # metric route
    t0: float               # route fraction nearest `anchor` — the resting pose
    to_metric: Transformer
    to_wgs: Transformer

    @property
    def frame(self) -> Tuple[Transformer, Transformer]:
        """The (to_metric, to_wgs) pair, for helpers that take a frame."""
        return (self.to_metric, self.to_wgs)

    @property
    def area_m2(self) -> float:
        return float(self.base.area)

    def _route_point(self, t: float) -> Tuple[float, float]:
        p = self.line.interpolate(clamp_t(t), normalized=True)
        return (p.x, p.y)

    def centre_metric(self, t: float) -> Tuple[float, float]:
        """Where the claim's centre sits once slid to `t`."""
        ax, ay = self.anchor
        rx, ry = self._route_point(t)
        ox, oy = self._route_point(self.t0)
        return (ax + rx - ox, ay + ry - oy)

    def metric_at(self, t: float, deg: float) -> Polygon:
        """The placed shape, still in metric space."""
        turned = affinity.rotate(self.base, normalise_rotation(deg), origin=(0.0, 0.0))
        cx, cy = self.centre_metric(t)
        return affinity.translate(turned, xoff=cx, yoff=cy)

    def at(self, t: float, deg: float) -> Polygon:
        """The placed shape in WGS84 — what actually gets claimed."""
        return reproject_geometry_to_wgs84(self.metric_at(t, deg), self.to_wgs)

    def centre_wgs(self, t: float) -> Tuple[float, float]:
        """The centre as (lon, lat), for the camera and the reveal's origin."""
        cx, cy = self.centre_metric(t)
        return self.to_wgs.transform(cx, cy)


def build_claim_stamp(
    path_lonlat: List[Tuple[float, float]],
    area_m2: float,
    frame: Optional[Tuple[Transformer, Transformer]] = None,
) -> Optional[ClaimStamp]:
    """Grow this run's one claim shape and return it ready to be placed.

    `frame` is an existing `metric_frame` to project through, so a caller that
    already built one (the options grid does) does not pay for a second set of
    transformers — they cost more than every shapely operation here put
    together.

    Returns None when the route can't carry a shape at all; the caller falls
    back to `route_claim_polygon_wgs` and then to the circle claim.
    """
    if not path_lonlat or len(path_lonlat) < 2 or area_m2 <= 0:
        return None
    try:
        to_m, to_wgs = frame if frame is not None else metric_frame(path_lonlat)
        metric = [to_m.transform(lon, lat) for lon, lat in path_lonlat]
        line = LineString(metric)
        if line.length <= 0:
            return None
        region = grow_claim_region_metric(metric, area_m2)
        if region is None:
            return None
        # Centre it on the origin ONCE, so every placement is a plain rotate
        # about (0, 0) followed by a translate. Rotating about "centroid" at
        # placement time would work too, but it recomputes the centroid on
        # every candidate and leaves the pivot implicit.
        c = region.centroid
        base = affinity.translate(region, xoff=-c.x, yoff=-c.y)
        # Where along the route the shape is at rest. `project` is arc length
        # to the nearest point on the line, which for a loop lands on whichever
        # pass of the lap runs closest to the middle — any of them is the same
        # place on the ground, so the choice does not matter.
        t0 = line.project(c, normalized=True) if line.length > 0 else 0.5
        return ClaimStamp(
            base=base,
            anchor=(c.x, c.y),
            line=line,
            t0=clamp_t(t0),
            to_metric=to_m,
            to_wgs=to_wgs,
        )
    except Exception:
        return None


def normalise_rotation(deg: Optional[float]) -> float:
    """Any angle the client sends, folded into [0, 360)."""
    try:
        d = float(deg or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(d):
        return 0.0
    return d % 360.0


def clamp_t(t: Optional[float], default: float = 0.5) -> float:
    """Any position the client sends, folded into [0, 1]."""
    try:
        v = float(default if t is None else t)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(v):
        return default
    return max(0.0, min(1.0, v))


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def polygon_to_lonlat_ring(poly: Polygon) -> List[Tuple[float, float]]:
    """Exterior ring as [(lon, lat), ...]. Used for API responses."""
    return [(x, y) for x, y in poly.exterior.coords]


def geometry_to_rings(geom) -> List[List[Tuple[float, float]]]:
    """All exterior rings of a Polygon or MultiPolygon, largest-first.
    Shape: [[[lon, lat], ...], ...] — one entry per piece."""
    if geom.geom_type == "Polygon":
        parts = [geom]
    elif geom.geom_type == "MultiPolygon":
        parts = sorted(geom.geoms, key=lambda g: g.area, reverse=True)
    else:
        return []
    return [polygon_to_lonlat_ring(p) for p in parts]
