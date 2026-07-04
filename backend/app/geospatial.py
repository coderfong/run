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
