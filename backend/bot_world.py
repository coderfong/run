"""Shared world-simulation helpers for seed_world.py and bot_activity.py.

Both scripts need the same four things, and they used to disagree about all
of them, which is what made the seeded world read as seeded:

  * usernames that look like people, not like generated handles
  * a ROUTE — bots ran no route at all, so their land was a perfect circle
    while every human claim is grown around the shape of the path actually
    run. A map of discs among silhouettes reads as fake at a glance, and no
    amount of scattering the discs fixes it.
  * a run record, so a bot has history, a route thumbnail, and a pace
  * a schedule that lands at the hours people actually run

Kept out of both scripts so seed and cron cannot drift apart on any of it.
"""

from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Sequence, Tuple

from sqlalchemy import text

from app.geospatial import (
    circle_polygon_wgs,
    claim_area_m2,
    claim_radius_m,
    route_claim_polygon_wgs,
)

# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------
#
# The handles the owner picked out as the target texture. These are used
# VERBATIM and first, so the recognisable ones are certain to be in the world
# rather than left to chance; everything past them is generated to match.
SEED_USERNAMES: List[str] = [
    "joshua.tan", "marcuslim_", "ryanng98", "jeremyteo", "seanlwx",
    "nicoleongg", "danieltan97", "cheryl_lim", "bryanlee_", "javierkoh",
    "amandatyy", "keith.ng", "darrenloww", "rachelchua", "ethanlim23",
    "jonathankoh_", "melissayap", "zaccheong", "alyssatanx", "samuelgoh_",
]

FIRST_NAMES: List[str] = [
    "joshua", "marcus", "ryan", "jeremy", "sean", "nicole", "daniel", "cheryl",
    "bryan", "javier", "amanda", "keith", "darren", "rachel", "ethan",
    "jonathan", "melissa", "zac", "alyssa", "samuel", "aaron", "benjamin",
    "brandon", "calvin", "clarissa", "denise", "dominic", "edwin", "elaine",
    "felicia", "gerald", "gwen", "hazel", "ivan", "jamie", "jasmine", "jerome",
    "joanne", "jolene", "kelvin", "kenneth", "lionel", "matthias", "natalie",
    "nigel", "pamela", "priscilla", "rebecca", "russell", "shannon", "sophia",
    "terence", "valerie", "vernon", "wayne", "yvonne", "zachary", "adeline",
    "benedict", "charmaine", "clement", "dawn", "desmond", "eugene", "evelyn",
    "gabriel", "geraldine", "isaac", "jared", "joel", "kelly", "lydia",
    "marvin", "melvin", "nicholas", "olivia", "patrick", "shawn", "sheryl",
    "stefanie", "timothy", "trevor", "wendy", "xavier", "andre", "bernice",
    "colin", "delphine", "ernest", "fiona", "glenn", "hannah", "ian", "janice",
    # Malay, Indian and Eurasian given names, because a Singapore map with
    # only Chinese handles on it is its own kind of obviously synthetic.
    "aisyah", "farhan", "hafiz", "nurul", "siti", "irfan", "amirah", "syafiq",
    "haziq", "nabilah", "rizwan", "shahrul", "aravind", "deepa", "kavitha",
    "praveen", "shanti", "vikram", "divya", "rahul", "meera", "sanjay",
]

LAST_NAMES: List[str] = [
    "tan", "lim", "lee", "ng", "wong", "chua", "koh", "teo", "goh", "ong",
    "cheong", "yap", "sim", "chan", "low", "loh", "chia", "seah", "toh",
    "quek", "tay", "heng", "neo", "foo", "kwek", "chew", "soh", "wee", "yeo",
    "ho", "khoo", "phua", "leong", "chong", "lau", "yong", "sng", "boey",
    "rahman", "ismail", "hassan", "yusof", "kamal", "aziz", "salleh",
    "kumar", "raj", "nair", "menon", "pillai", "das",
    "fernandez", "pereira", "dsouza",
]


def _initials(rng: random.Random) -> str:
    """A short consonant tail like the `lwx` in seanlwx or the `tyy` in
    amandatyy — initials of a full Chinese name, which is why they read as
    real even though they are not words."""
    pool = "bcdfghjklmnpqrstvwxyz"
    return "".join(rng.choice(pool) for _ in range(rng.randint(2, 3)))


def make_username(rng: random.Random, taken: set) -> str:
    """One handle in the same eight shapes the seed list uses.

    Weighted toward the plain `firstlast` form because that is what most
    people actually register; the decorations are what a name-clash forces,
    so they are the minority exactly as they are in a real user table.
    """
    shapes = [
        ("plain", 30), ("dot", 12), ("underscore", 10), ("trail_us", 12),
        ("year", 14), ("number", 8), ("doubled", 7), ("initials", 5),
        ("trail_x", 2),
    ]
    forms = [s for s, _w in shapes]
    weights = [w for _s, w in shapes]

    for _ in range(400):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        form = rng.choices(forms, weights=weights, k=1)[0]

        if form == "plain":
            name = f"{first}{last}"
        elif form == "dot":
            name = f"{first}.{last}"
        elif form == "underscore":
            name = f"{first}_{last}"
        elif form == "trail_us":
            name = f"{first}{last}_"
        elif form == "year":
            # Birth years for people in their twenties and thirties: 88-99
            # and 00-05, always two digits, which is where the 98 in
            # ryanng98 and the 97 in danieltan97 come from.
            year = rng.choice(list(range(88, 100)) + list(range(0, 6)))
            name = f"{first}{last}{year:02d}"
        elif form == "number":
            name = f"{first}{last}{rng.randint(2, 99)}"
        elif form == "doubled":
            name = f"{first}{last}{last[-1]}"
        elif form == "initials":
            name = f"{first}{_initials(rng)}"
        else:
            name = f"{first}{last}x"

        if name not in taken and 3 <= len(name) <= 32:
            taken.add(name)
            return name
    raise RuntimeError("could not generate a unique username")


def allocate_usernames(rng: random.Random, count: int, taken: set) -> List[str]:
    """The curated handles first, then generated ones to fill `count`."""
    out: List[str] = []
    for name in SEED_USERNAMES:
        if len(out) >= count:
            break
        if name not in taken:
            taken.add(name)
            out.append(name)
    while len(out) < count:
        out.append(make_username(rng, taken))
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
#
# WHY THIS EXISTS AT ALL. A human claim is grown around the path actually run
# (`route_claim_polygon_wgs`) — a long organic silhouette that follows the
# streets. Bots claimed with `circle_polygon_wgs`, so every seeded holding on
# the map was a geometrically perfect disc. That is the single loudest tell
# there is: real players' land and bot land did not merely differ in size,
# they were different KINDS of shape, and no amount of scattering the discs
# around Singapore hides that. Giving a bot a real route fixes the shape, the
# route thumbnail, the pace, and the feed entry all at once, because every one
# of those is downstream of the path.
#
# The routes are synthesised rather than drawn from real road data: an
# 80 MB street graph for cosmetic bot paths is not a trade worth making. The
# walk below is tuned to *read* as street running instead — mostly straight
# stretches with occasional square corners, which is what a GPS trace through
# an HDB estate looks like from map zoom.

_BLOCK_MIN_M = 90.0
_BLOCK_MAX_M = 340.0
_SAMPLE_EVERY_M = 12.0
_GPS_NOISE_M = 2.5


def _local_frame(lat0: float, lon0: float):
    """Metres <-> degrees around an origin. Equirectangular is wrong at
    continental scale and irrelevantly wrong across one city's worth of
    running route."""
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * max(0.1, math.cos(math.radians(lat0)))

    def to_lonlat(x: float, y: float) -> Tuple[float, float]:
        return lon0 + x / m_per_deg_lon, lat0 + y / m_per_deg_lat

    return to_lonlat


def _walk(
    target_m: float,
    rng: random.Random,
    curl_deg: float,
    on_land,
    home_from: Optional[float] = None,
) -> List[Tuple[float, float]]:
    """A correlated random walk in metres, run until it has covered
    `target_m`. `curl_deg` is a constant bias applied every leg — zero walks
    away in a line, a full 360/legs closes a loop.

    `home_from` starts pulling the heading back toward the origin once that
    fraction of the target is covered. Curl alone does not reliably close a
    loop: a few unlucky corner rolls and the walk finishes half a kilometre
    from where it started, leaving the closing leg to sprint back in a
    straight line that is both longer than the rest of the route and visibly
    not a street. The pull makes the last third bend home the way a runner
    heading back to their block does.
    """
    pts: List[Tuple[float, float]] = [(0.0, 0.0)]
    x = y = 0.0
    heading = rng.uniform(0, 360)
    covered = 0.0
    guard = 0

    while covered < target_m and guard < 4000:
        guard += 1
        roll = rng.random()
        if roll < 0.18:
            heading += rng.choice([-90.0, 90.0]) + rng.gauss(0, 7)   # street corner
        elif roll < 0.30:
            heading += rng.choice([-45.0, 45.0]) + rng.gauss(0, 6)   # park path
        else:
            heading += rng.gauss(0, 9)                                # road drift
        heading += curl_deg

        if home_from is not None and covered > target_m * home_from:
            # Blend toward the bearing home, hard enough to arrive but not so
            # hard it overrides the street grid into a beeline.
            bearing = math.degrees(math.atan2(-y, -x))
            delta = (bearing - heading + 180) % 360 - 180
            heading += delta * 0.35

        leg = rng.uniform(_BLOCK_MIN_M, _BLOCK_MAX_M)
        leg = min(leg, target_m - covered + _BLOCK_MIN_M)
        nx = x + leg * math.cos(math.radians(heading))
        ny = y + leg * math.sin(math.radians(heading))

        if not on_land(nx, ny):
            # Ran out of land: turn around the way a person would rather than
            # walking into the strait.
            heading += 180 + rng.gauss(0, 25)
            nx = x + leg * math.cos(math.radians(heading))
            ny = y + leg * math.sin(math.radians(heading))
            if not on_land(nx, ny):
                break

        pts.append((nx, ny))
        covered += leg
        x, y = nx, ny

    return pts


def _densify(pts: Sequence[Tuple[float, float]], rng: random.Random) -> List[Tuple[float, float]]:
    """Corners into a GPS trace: a point every ~12 m with a couple of metres
    of jitter, which is roughly what a phone records."""
    out: List[Tuple[float, float]] = []
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(seg / _SAMPLE_EVERY_M))
        for s in range(steps):
            t = s / steps
            out.append((
                x0 + (x1 - x0) * t + rng.gauss(0, _GPS_NOISE_M),
                y0 + (y1 - y0) * t + rng.gauss(0, _GPS_NOISE_M),
            ))
    if pts:
        out.append(pts[-1])
    return out


def synth_route(
    lat: float,
    lon: float,
    distance_m: float,
    rng: random.Random,
    land=None,
) -> List[Tuple[float, float]]:
    """A plausible running route of about `distance_m`, starting at (lat, lon).

    Returns [(lon, lat), ...] — the order `route_claim_polygon_wgs` and
    PostGIS both want. `land` is an optional shapely geometry in lon/lat that
    the route is kept inside, so nobody runs across the sea.
    """
    to_lonlat = _local_frame(lat, lon)

    def on_land(x: float, y: float) -> bool:
        if land is None:
            return True
        from shapely.geometry import Point as _P
        lo, la = to_lonlat(x, y)
        return land.contains(_P(lo, la))

    kind = rng.choices(
        ["loop", "out_and_back", "wander"], weights=[0.50, 0.32, 0.18], k=1
    )[0]

    if kind == "loop":
        # Curl the whole way round so the route comes back to where it
        # started, the way a park circuit or an estate lap does, and start
        # steering home over the last third so it actually arrives.
        est_legs = max(6.0, distance_m / ((_BLOCK_MIN_M + _BLOCK_MAX_M) / 2))
        corners = _walk(distance_m, rng, 360.0 / est_legs, on_land, home_from=0.66)
        corners.append(corners[0])
    elif kind == "out_and_back":
        corners = _walk(distance_m / 2.0, rng, 0.0, on_land)
        # The return leg is the same road, not the same coordinates — a real
        # out and back overlays itself to within a lane's width.
        back = [(x + rng.gauss(0, 6), y + rng.gauss(0, 6)) for x, y in reversed(corners[:-1])]
        corners = corners + back
    else:
        corners = _walk(distance_m, rng, rng.gauss(0, 4), on_land)

    if len(corners) < 3:
        # Degenerate walk (bot boxed in on a sliver of land): a small circuit
        # around the start is still a better route than no route.
        r = max(60.0, distance_m / (2 * math.pi))
        corners = [
            (r * math.cos(2 * math.pi * i / 16), r * math.sin(2 * math.pi * i / 16))
            for i in range(17)
        ]

    dense = _densify(corners, rng)

    # Scale the finished trace about its start so its length is the distance
    # we set out to run. Three things inflate the raw walk — the closing leg
    # of a loop, the reflection off a coastline, and the GPS jitter added by
    # `_densify`, which lengthens every 12 m step a little — and together they
    # were overshooting by up to 50%. That matters beyond tidiness: distance
    # drives claim area, XP and pace, so an uncorrected walk hands out a
    # 21 km long run's worth of territory for what was planned as a 14 km one.
    # A uniform scale is the one correction that changes none of the shape.
    planar = sum(
        math.hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][1] - dense[i][1])
        for i in range(len(dense) - 1)
    )
    if planar > 1.0:
        f = distance_m / planar
        dense = [(x * f, y * f) for x, y in dense]

    return [to_lonlat(x, y) for x, y in dense]


def route_length_m(path_lonlat: Sequence[Tuple[float, float]]) -> float:
    """Great-circle length of the synthesised trace, so distance and pace are
    reported from the path itself rather than from the number we aimed at."""
    total = 0.0
    for i in range(len(path_lonlat) - 1):
        lon1, lat1 = path_lonlat[i]
        lon2, lat2 = path_lonlat[i + 1]
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2
             + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
        total += 2 * 6_371_000.0 * math.asin(min(1.0, math.sqrt(a)))
    return total


# ---------------------------------------------------------------------------
# When people actually run
# ---------------------------------------------------------------------------
#
# The old schedule was `now + uniform(20, 56) hours`, which spreads runs
# perfectly evenly around the clock. That is wrong in a way you can see
# without measuring anything: open the feed at 3am and half the world went
# running. Real recreational running in Singapore is bimodal and sharp —
# before work while it is still bearable, or after sunset — so the schedule
# picks a DAY offset and then drops the run into one of those windows.

_SGT_OFFSET_H = 8

# (start hour, end hour, weight) in Singapore local time.
_RUN_WINDOWS = [
    (5.5, 8.0, 38),    # before work, the big one
    (17.5, 21.5, 46),  # after work, the bigger one
    (8.0, 11.0, 11),   # weekend late morning
    (11.0, 17.5, 5),   # the few who run in the afternoon heat
]


def next_run_at(rng: random.Random, after: Optional[datetime] = None) -> datetime:
    """The next time this bot goes running, as naive UTC.

    Gap is 1-4 days, weighted toward 1-2: a casual runner's cadence. The hour
    within the chosen day comes from the windows above rather than from a
    uniform draw, which is what stops the world running at 4am.
    """
    now = after or datetime.utcnow()
    days = rng.choices([1, 2, 3, 4], weights=[36, 34, 20, 10], k=1)[0]

    starts = [w[0] for w in _RUN_WINDOWS]
    ends = [w[1] for w in _RUN_WINDOWS]
    weights = [w[2] for w in _RUN_WINDOWS]
    idx = rng.choices(range(len(_RUN_WINDOWS)), weights=weights, k=1)[0]
    local_hour = rng.uniform(starts[idx], ends[idx])

    target_local = (now + timedelta(days=days, hours=_SGT_OFFSET_H)).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(hours=local_hour)
    utc = target_local - timedelta(hours=_SGT_OFFSET_H)
    if utc <= now:
        utc = now + timedelta(hours=rng.uniform(6, 18))
    return utc


def recent_run_times(rng: random.Random, count: int, now: Optional[datetime] = None) -> List[datetime]:
    """`count` past run timestamps walking backwards from now, same cadence
    and same hours as the forward schedule. Used to give a freshly seeded bot
    a history instead of a single claim minted at seed time."""
    now = now or datetime.utcnow()
    out: List[datetime] = []
    cursor = now
    for _ in range(count):
        gap_days = rng.choices([1, 2, 3, 4], weights=[36, 34, 20, 10], k=1)[0]
        idx = rng.choices(range(len(_RUN_WINDOWS)), weights=[w[2] for w in _RUN_WINDOWS], k=1)[0]
        local_hour = rng.uniform(_RUN_WINDOWS[idx][0], _RUN_WINDOWS[idx][1])
        cursor = cursor - timedelta(days=gap_days)
        day_local = (cursor + timedelta(hours=_SGT_OFFSET_H)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        out.append(day_local + timedelta(hours=local_hour) - timedelta(hours=_SGT_OFFSET_H))
    return out


# ---------------------------------------------------------------------------
# Where a bot sits on the ladder
# ---------------------------------------------------------------------------
#
# Seeded bots used to have no rank points at all, so the entire world sat at
# Wood. That is invisible on the profile screen and fatal on the rank-scoped
# map: the tier filter had nothing above tier 0 to show, so filtering to Gold
# returned an empty map and read as a broken feature rather than an empty
# bracket. Every tier now has residents.
#
# Shaped as a pyramid rather than spread evenly, because a ladder where the
# top tier is as crowded as the bottom is not a ladder. The weights below put
# most of the roster in Wood through Silver and leave Mythic to a couple of
# accounts, which is also what makes reaching Gold feel like anything.
_TIER_WEIGHTS = [26, 22, 17, 12, 8, 6, 4, 3, 1.5, 0.5]


def rank_points_pyramid(rng: random.Random, count: int) -> List[int]:
    """`count` rank-point totals distributed across every tier."""
    from app.ranks import RANK_TIERS

    out: List[int] = []
    idxs = rng.choices(range(len(RANK_TIERS)), weights=_TIER_WEIGHTS, k=count)
    for i in idxs:
        floor = RANK_TIERS[i][0]
        ceil = RANK_TIERS[i + 1][0] if i + 1 < len(RANK_TIERS) else int(floor * 1.4) + 4000
        # Cluster toward the bottom of each band: most people have just
        # arrived in their tier, few are about to leave it.
        out.append(int(rng.triangular(floor, ceil, floor + (ceil - floor) * 0.3)))
    return out


def apply_rank_points(db, user_id: str, points: int, rng: random.Random) -> None:
    """Set a bot's standing directly, with a plausible last-earned stamp.

    Writes the same three columns `ranks.award` maintains. `rank_points_at`
    is backdated a little so decay is a live force on the seeded world too,
    rather than every bot being frozen at exactly full strength.
    """
    from app.ranks import rank_for_points

    tier = rank_for_points(points)["tier"]
    db.execute(
        text(
            """
            UPDATE users
            SET rank_points = :p,
                rank_points_at = timezone('utc', now()) - (:h || ' hours')::interval,
                rank_best = GREATEST(COALESCE(rank_best, 0), :t)
            WHERE id = :u
            """
        ),
        {"p": int(points), "h": rng.uniform(0, 200), "t": tier, "u": user_id},
    )


# ---------------------------------------------------------------------------
# A run
# ---------------------------------------------------------------------------


def ability(user_id: str) -> float:
    """A stable pace multiplier for one bot, derived from its id.

    Derived rather than stored so it needs no column and no migration, and
    STABLE because that is the whole point: a bot that runs 5:10/km today and
    7:40/km on Thursday is not a person. Roughly 0.82 (quick club runner) to
    1.18 (comfortable jogger).
    """
    h = uuid.UUID(str(user_id)).int
    return 0.82 + (h % 1000) / 1000.0 * 0.36


def plan_run(rng: random.Random, user_id: Optional[str] = None) -> Tuple[float, float]:
    """(distance_m, pace_s_per_km) for one session.

    A mixture, not a single triangular: recreational running is mostly short
    easy sessions with a long run occasionally hung off the end, and the old
    triangular(1800, 8000, 3500) could never produce the 15 km that makes a
    leaderboard look real.
    """
    bucket = rng.choices(["easy", "steady", "long", "very_long"],
                         weights=[55, 30, 12, 3], k=1)[0]
    if bucket == "easy":
        distance_m = rng.uniform(2500, 6000)
    elif bucket == "steady":
        distance_m = rng.uniform(6000, 11000)
    elif bucket == "long":
        distance_m = rng.uniform(11000, 16000)
    else:
        distance_m = rng.uniform(16000, 25000)

    # Base pace, slowing slightly with distance, scaled by who is running.
    base = 330.0 + (distance_m / 1000.0) * 4.5
    pace = base * (ability(user_id) if user_id else rng.uniform(0.85, 1.15))
    pace *= rng.gauss(1.0, 0.045)          # day to day variation
    pace = max(240.0, min(560.0, pace))
    return distance_m, pace


def path_wkt(path_lonlat: Sequence[Tuple[float, float]]) -> str:
    pts = ", ".join(f"{lon:.6f} {lat:.6f}" for lon, lat in path_lonlat)
    return f"LINESTRING({pts})"


def record_run(
    db,
    user_id: str,
    path_lonlat: Sequence[Tuple[float, float]],
    distance_m: float,
    duration_s: float,
    started_at: datetime,
) -> str:
    """Insert the runs row behind a bot's claim and return its id.

    Bots used to claim with `run_id=None`, which left them with territory and
    no history: an empty profile, no route thumbnail anywhere, and nothing a
    club-mate could ever see in the feed. The row is marked verified so it
    behaves like a clean human run everywhere downstream.
    """
    run_id = str(uuid.uuid4())
    db.execute(
        text(
            """
            INSERT INTO runs (id, user_id, started_at, ended_at, path,
                              distance_m, duration_s, claimed_at, verified,
                              claim_distance_m, claim_area_m2, post_media)
            VALUES (:id, :u, :start, :end, ST_GeomFromText(:wkt, 4326),
                    :dist, :dur, :end, true, :dist, :area, '[]'::jsonb)
            """
        ),
        {
            "id": run_id, "u": user_id, "start": started_at,
            "end": started_at + timedelta(seconds=duration_s),
            "wkt": path_wkt(path_lonlat), "dist": distance_m,
            "dur": duration_s, "area": claim_area_m2(distance_m),
        },
    )
    return run_id


def claim_polygon(
    path_lonlat: Sequence[Tuple[float, float]],
    distance_m: float,
    fallback_lat: float,
    fallback_lon: float,
):
    """The territory this run earns, grown around the route it was run on.

    Falls back to the circle only when the route genuinely cannot carry a
    shape — the same fallback `/claim` uses, and for the same reason.

    The result is repaired before it is returned. `territories` carries
    CHECK (ST_IsValid(polygon)) and the fresh-claim INSERT inside
    `_claim_territory` does NOT wrap the caller's geometry in ST_MakeValid
    the way its difference and union branches do — it trusts what it is
    handed. A human claim earns that trust because it is grown around a
    cleaned GPS path. A synthesised loop crosses itself far more often, and
    `make_valid` on a self-crossing buffer hands back a MultiPolygon, so the
    trust does not carry over. Repairing here keeps the fix on the caller
    that needs it instead of loosening a check every real claim relies on.
    """
    area = claim_area_m2(distance_m)
    poly = route_claim_polygon_wgs(list(path_lonlat), area)
    poly = _repair(poly)
    if poly is not None:
        return poly
    return circle_polygon_wgs(fallback_lat, fallback_lon, claim_radius_m(distance_m))


def _repair(poly):
    """A single valid Polygon, or None if nothing usable survives.

    Territory is one contiguous claim, so when repair shatters the shape the
    largest surviving piece is the claim — the slivers a self-intersection
    leaves behind are artefacts of the crossing, not land anybody ran.
    """
    if poly is None or poly.is_empty:
        return None
    if not poly.is_valid:
        from shapely.validation import make_valid
        poly = make_valid(poly)
    if poly.is_empty:
        return None
    if poly.geom_type in ("MultiPolygon", "GeometryCollection"):
        parts = [g for g in poly.geoms if g.geom_type == "Polygon" and not g.is_empty]
        if not parts:
            return None
        poly = max(parts, key=lambda g: g.area)
    if poly.geom_type != "Polygon":
        return None
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.geom_type != "Polygon" or not poly.is_valid or poly.area <= 0:
        return None
    return poly
