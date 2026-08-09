"""What of a route other people are allowed to see.

A GPS trace is a home address. `GET /runs/{id}` used to return the full raw
LineString of any run to any authenticated caller, and `/feed` a simplified one
for every run on the page — so finding out where someone lives took a single
request and no privileges.

Three controls, applied in this order by `public_path`:

  1. visibility   — a private run's route is never published at all
  2. publish delay— a route is withheld for a few hours after the run ends, so
                    "who is out right now, and where" is not a live query
  3. trim + zones — the ends are cut off, and anything inside a privacy circle
                    is removed

The owner always sees their own route in full. The territory polygon is NOT
touched here: it is the game, it is already a coarse shape, and hiding it would
hide the thing everyone came for. What it must not do is begin at the runner's
front door, which trimming is what prevents.

Pure functions plus one row read. No route depends on the shape of another.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import List, Optional, Sequence, Tuple

from sqlalchemy import text

from .config import settings

LonLat = Tuple[float, float]

PUBLIC = "public"
PRIVATE = "private"
VISIBILITIES = (PUBLIC, PRIVATE)

# A zone smaller than this is not privacy, it is a pin on the map — at 25 m a
# circle round a house still says which house. A zone larger than the cap would
# be used to blank whole neighbourhoods, which is a different feature.
MIN_ZONE_RADIUS_M = 100.0
MAX_ZONE_RADIUS_M = 1000.0
MAX_ZONES = 10


def _haversine_m(a: LonLat, b: LonLat) -> float:
    r = 6_371_000.0
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ---------------------------------------------------------------------------
# settings for one runner
# ---------------------------------------------------------------------------


def effective_trim_m(raw) -> float:
    """Metres to cut from each end. NULL means never set, NOT zero.

    An account created before the column existed must not be published in full
    just because it has no preference recorded.
    """
    if raw is None:
        return float(settings.route_trim_default_m)
    return max(0.0, float(raw))


def effective_delay_h(raw) -> float:
    if raw is None:
        return float(settings.route_publish_delay_default_h)
    return max(0.0, float(raw))


def clean_zones(zones) -> List[dict]:
    """Validate and clamp a submitted zone list. Bad entries are dropped."""
    out: List[dict] = []
    for z in (zones or [])[:MAX_ZONES]:
        try:
            lat = float(z["lat"])
            lon = float(z["lon"])
            radius = float(z.get("radius_m") or MIN_ZONE_RADIUS_M)
        except (KeyError, TypeError, ValueError):
            continue
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            continue
        label = str(z.get("label") or "")[:32]
        out.append(
            {
                "lat": lat,
                "lon": lon,
                "radius_m": max(MIN_ZONE_RADIUS_M, min(MAX_ZONE_RADIUS_M, radius)),
                "label": label,
            }
        )
    return out


def prefs_from_row(trim_raw, zones_raw, delay_raw, birthday_raw=None) -> dict:
    """Build prefs from columns already fetched.

    The feed carries up to fifty rows from up to fifty different runners, and
    calling `load` per row would be fifty round trips for columns the page's
    own query can just select.
    """
    prefs = {
        "trim_m": effective_trim_m(trim_raw),
        "zones": clean_zones(zones_raw),
        "delay_h": effective_delay_h(delay_raw),
        "minor": False,
    }
    return apply_minor_floor(prefs, is_minor(birthday_raw))


def is_minor(birthday, today: Optional[datetime] = None) -> bool:
    """Under `settings.minor_age` on the given day. Unknown age is NOT a minor.

    Deliberately not the other way round: treating every account with no
    birthday as a child would silently apply the strictest floors to the whole
    existing user base, which is a support problem rather than a safety one.
    Accounts that DO tell us get protected.
    """
    if birthday is None:
        return False
    d = today.date() if isinstance(today, datetime) else (today or datetime.utcnow().date())
    years = d.year - birthday.year - ((d.month, d.day) < (birthday.month, birthday.day))
    return years < settings.minor_age


def apply_minor_floor(prefs: dict, minor: bool) -> dict:
    """Raise a young account's protection to the floor.

    A FLOOR, not a default: a 14-year-old turning "hide the start of my routes"
    off should not be able to publish their front door. They can make it
    stricter, never looser.
    """
    if not minor:
        return prefs
    return {
        **prefs,
        "trim_m": max(prefs["trim_m"], settings.minor_min_trim_m),
        "delay_h": max(prefs["delay_h"], settings.minor_min_delay_h),
        "minor": True,
    }


def load(db, user_id) -> dict:
    """One runner's privacy settings, defaults and age floors already applied."""
    row = db.execute(
        text(
            "SELECT route_trim_m, privacy_zones, route_publish_delay_h, birthday "
            "FROM users WHERE id = :u"
        ),
        {"u": user_id},
    ).fetchone()
    if not row:
        return {
            "trim_m": effective_trim_m(None),
            "zones": [],
            "delay_h": effective_delay_h(None),
            "minor": False,
        }
    prefs = {
        "trim_m": effective_trim_m(row[0]),
        "zones": clean_zones(row[1]),
        "delay_h": effective_delay_h(row[2]),
        "minor": False,
    }
    return apply_minor_floor(prefs, is_minor(row[3]))


# ---------------------------------------------------------------------------
# the geometry
# ---------------------------------------------------------------------------


def trim_ends(path: Sequence[LonLat], trim_m: float) -> List[LonLat]:
    """Drop the first and last `trim_m` metres of a route.

    Measured along the path rather than as a radius, so an out-and-back that
    doubles over itself still loses both real ends. A route shorter than twice
    the trim disappears entirely — correct: there is nothing left of it that is
    not an endpoint.
    """
    pts = list(path)
    if trim_m <= 0 or len(pts) < 2:
        return pts

    # Cumulative distance from the start.
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + _haversine_m(a, b))
    total = cum[-1]
    if total <= 2 * trim_m:
        return []

    lo, hi = trim_m, total - trim_m
    return [p for p, d in zip(pts, cum) if lo <= d <= hi]


def _in_any_zone(p: LonLat, zones: Sequence[dict]) -> bool:
    for z in zones:
        if _haversine_m(p, (z["lon"], z["lat"])) <= z["radius_m"]:
            return True
    return False


def clip_zones(path: Sequence[LonLat], zones: Sequence[dict]) -> List[LonLat]:
    """Remove everything inside a privacy circle.

    Returns the LONGEST surviving contiguous stretch rather than the leftovers
    stitched together: joining them would draw a straight line across the zone,
    which both looks wrong and still shows a viewer exactly where the runner
    disappeared and reappeared.
    """
    if not zones:
        return list(path)
    best: List[LonLat] = []
    current: List[LonLat] = []
    for p in path:
        if _in_any_zone(p, zones):
            if len(current) > len(best):
                best = current
            current = []
        else:
            current.append(p)
    return current if len(current) > len(best) else best


def public_path(
    path: Sequence[LonLat],
    prefs: dict,
    *,
    visibility: str = PUBLIC,
    ended_at: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> List[LonLat]:
    """What a viewer who is NOT the owner may see of this route.

    Order matters: a private run is withheld whatever the zones say, and a run
    inside its publish delay is withheld whatever its visibility says.
    """
    if not path:
        return []
    if visibility != PUBLIC:
        return []
    delay_h = prefs.get("delay_h", 0.0)
    if delay_h > 0 and ended_at is not None:
        if (now or datetime.utcnow()) < ended_at + timedelta(hours=delay_h):
            return []
    trimmed = trim_ends(path, prefs.get("trim_m", 0.0))
    return clip_zones(trimmed, prefs.get("zones", ()))


def path_for_viewer(
    path: Sequence[LonLat],
    *,
    owner_id,
    viewer_id,
    prefs: dict,
    visibility: str = PUBLIC,
    ended_at: Optional[datetime] = None,
) -> List[LonLat]:
    """The owner sees everything; everyone else sees `public_path`."""
    if str(owner_id) == str(viewer_id):
        return list(path)
    return public_path(path, prefs, visibility=visibility, ended_at=ended_at)
