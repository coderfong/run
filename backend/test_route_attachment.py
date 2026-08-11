"""Rotation must stay attached to the route.

"You own where you ran" is the promise the whole game rests on. Rotation is a
real tactical move — the pivot sits on the route, so a modest turn still covers
ground that was covered — but at a full 360° a long claim can swing onto
streets the runner never saw. This checks the guard that closes those off.

Pure geometry: no server, no database.

    python test_route_attachment.py
"""

import math
import sys

from app.config import settings
from app.geospatial import (
    claim_area_m2,
    metric_frame,
    rotate_claim_polygon_wgs,
    route_attachment,
    route_claim_polygon_wgs,
    route_corridor,
)
from app.routes.runs import _claim_grid, _grid_pick

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' — ' + str(detail)) if detail else ''}")
    return ok


LAT, LON = 1.3600, 103.8200


def straight(metres, n=60):
    per_deg = 111320.0 * math.cos(math.radians(LAT))
    return [(LON + (metres * i / (n - 1)) / per_deg, LAT) for i in range(n)]


def square_loop(side, n_per_side=15):
    """A closed lap — compact, so its claim is a blob rather than a ribbon."""
    per_lat = 111320.0
    per_lon = 111320.0 * math.cos(math.radians(LAT))
    pts = []
    for dx, dy in ((0, 0), (side, 0), (side, side), (0, side), (0, 0)):
        pts.append((LON + dx / per_lon, LAT + dy / per_lat))
    out = []
    for a, b in zip(pts, pts[1:]):
        for i in range(n_per_side):
            f = i / n_per_side
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    out.append(pts[-1])
    return out


def test_straight_route():
    print("\n[1] a long straight run — turning it across the route detaches it")
    route = straight(4000)
    area = claim_area_m2(4000)
    frame = metric_frame(route)
    corridor = route_corridor(route, frame)
    poly = route_claim_polygon_wgs(route, area)
    check("the route grows a claim", poly is not None)
    if poly is None:
        return

    as_run = route_attachment(poly, corridor, frame)
    check("as run, the claim is on the route", as_run >= 0.9, f"{as_run:.2f}")

    across = route_attachment(rotate_claim_polygon_wgs(poly, 90.0, frame), corridor, frame)
    check(
        "turned 90° across a straight run, it is mostly off it",
        across < settings.claim_min_route_attachment,
        f"{across:.2f} < {settings.claim_min_route_attachment}",
    )

    # A long run's claim is a capsule several kilometres end to end, so ANY
    # real turn swings its ends far outside a ±100 m corridor: at 4 km even 15°
    # moves them ~520 m off the trail. That is not the metric being harsh, it
    # is what turning a 4 km shape actually does — and it is the case the rule
    # exists for.
    #
    # 180° is the exception that proves the metric is measuring the right
    # thing: it maps a capsule back onto itself, so it stays fully attached.
    reversed_ = route_attachment(rotate_claim_polygon_wgs(poly, 180.0, frame), corridor, frame)
    check(
        "turned 180°, a capsule lands back on its own route",
        reversed_ >= settings.claim_min_route_attachment,
        f"{reversed_:.2f}",
    )


def test_compact_loop():
    print("\n[2] a compact lap — rotation barely moves a blob, so it stays legal")
    route = square_loop(400)
    area = claim_area_m2(1600)
    frame = metric_frame(route)
    corridor = route_corridor(route, frame)
    poly = route_claim_polygon_wgs(route, area)
    if poly is None:
        check("the lap grows a claim", False)
        return
    worst = min(
        route_attachment(rotate_claim_polygon_wgs(poly, deg, frame), corridor, frame)
        for deg in (45.0, 90.0, 135.0, 180.0)
    )
    check(
        "every heading on a lap stays attached",
        worst >= settings.claim_min_route_attachment,
        f"worst {worst:.2f}",
    )


def test_grid_and_fallback():
    print("\n[3] the sample grid is rectangular, and invalid legacy indices fall back")
    route = straight(4000)
    area = claim_area_m2(4000)
    grid = _claim_grid(route, area)
    check("the grid is built", bool(grid), len(grid))
    if not grid:
        return

    n_rot = max(g[1] for g in grid) + 1
    n_pos = max(g[0] for g in grid) + 1
    check("the grid stays rectangular", len(grid) == n_pos * n_rot, f"{len(grid)} vs {n_pos}x{n_rot}")
    check("heading 0 exists at every sampled position", sum(g[1] == 0 for g in grid) == n_pos)

    exact = _grid_pick(grid, 0, min(1, n_rot - 1))
    check("a valid legacy index keeps its requested pose", exact[:2] == (0, min(1, n_rot - 1)))

    # Old clients send grid indices. Anything out of range must still land on
    # the documented middle-position, unturned fallback.
    wild = _grid_pick(grid, 999, 999)
    check("a made-up index falls back safely", wild is not None)
    check("fallback is the middle position", wild[0] == n_pos // 2, wild[0])
    check("fallback is unturned", wild[1] == 0, wild[1])


def main():
    print(
        f"route attachment — floor {settings.claim_min_route_attachment}, "
        f"corridor ±{settings.claim_route_attachment_buffer_m} m"
    )
    test_straight_route()
    test_compact_loop()
    test_grid_and_fallback()
    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        sys.exit(1)
    print("ROUTE ATTACHMENT HOLDS")


if __name__ == "__main__":
    main()
