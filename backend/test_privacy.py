"""Route privacy — what other people can see of a run.

Two endpoints were handing out raw GPS traces: `GET /runs/{id}` returned the
full LineString of anyone's run to any authenticated caller, and `/feed` a
simplified one for every run on the page. Simplification hides a corner, not an
address. These are the rules that replaced that.

Pure functions: no server, no database.

    python test_privacy.py
"""

import math
import sys
from datetime import datetime, timedelta

from app import privacy
from app.config import settings

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' — ' + str(detail)) if detail else ''}")
    return ok


LAT, LON = 1.3600, 103.8200
PER_LON = 111320.0 * math.cos(math.radians(LAT))


def straight(metres, n=101):
    """A due-east line of `metres`, one point every `metres/(n-1)`."""
    return [(LON + (metres * i / (n - 1)) / PER_LON, LAT) for i in range(n)]


def span_m(path):
    if len(path) < 2:
        return 0.0
    return abs(path[-1][0] - path[0][0]) * PER_LON


def test_defaults():
    print("\n[1] an account that never opened the settings is still protected")
    check(
        "no stored trim means the DEFAULT, not zero",
        privacy.effective_trim_m(None) == settings.route_trim_default_m,
        privacy.effective_trim_m(None),
    )
    check("an explicit 0 is honoured", privacy.effective_trim_m(0) == 0.0)
    check(
        "no stored delay means the default",
        privacy.effective_delay_h(None) == settings.route_publish_delay_default_h,
    )


def test_trim():
    print("\n[2] both ends come off")
    path = straight(2000)
    trimmed = privacy.trim_ends(path, 250)
    check("something survives a 2 km route", len(trimmed) > 2, len(trimmed))
    check(
        "the published stretch is ~500 m shorter",
        abs(span_m(trimmed) - 1500) < 60,
        f"{span_m(trimmed):.0f} m of 2000",
    )
    start_moved = abs(trimmed[0][0] - path[0][0]) * PER_LON
    end_moved = abs(trimmed[-1][0] - path[-1][0]) * PER_LON
    check("the real start is gone", start_moved >= 200, f"{start_moved:.0f} m")
    check("the real finish is gone", end_moved >= 200, f"{end_moved:.0f} m")

    print("\n[3] a route with nothing but ends disappears")
    check("a 400 m route trimmed at 250 publishes nothing", privacy.trim_ends(straight(400), 250) == [])
    check("...and so does a 500 m one, exactly at the boundary",
          privacy.trim_ends(straight(500), 250) == [])


def test_zones():
    print("\n[4] privacy zones remove ground, without drawing a line across it")
    path = straight(2000)
    # A circle over the middle of the route.
    mid_lon = LON + (1000 / PER_LON)
    zones = [{"lat": LAT, "lon": mid_lon, "radius_m": 200.0, "label": "home"}]
    clipped = privacy.clip_zones(path, zones)
    check("something survives", len(clipped) > 1, len(clipped))
    inside = [p for p in clipped if abs(p[0] - mid_lon) * PER_LON <= 200.0]
    check("nothing published sits inside the zone", not inside, len(inside))
    # The longest surviving stretch only — not both halves stitched together,
    # which would draw a straight line straight through the hidden circle.
    spans = span_m(clipped)
    check("only ONE side survives, so no line bridges the zone", spans < 1000, f"{spans:.0f} m")


def test_clean_zones():
    print("\n[5] zones are clamped on the way in")
    cleaned = privacy.clean_zones(
        [
            {"lat": LAT, "lon": LON, "radius_m": 5},            # far too tight
            {"lat": LAT, "lon": LON, "radius_m": 99999},        # far too wide
            {"lat": 999, "lon": LON, "radius_m": 150},          # nonsense
            {"lon": LON, "radius_m": 150},                      # incomplete
        ]
    )
    check("bad entries are dropped", len(cleaned) == 2, len(cleaned))
    check(
        "a 5 m 'privacy' circle is widened to the floor",
        cleaned[0]["radius_m"] == privacy.MIN_ZONE_RADIUS_M,
        cleaned[0]["radius_m"],
    )
    check(
        "a neighbourhood-sized one is capped",
        cleaned[1]["radius_m"] == privacy.MAX_ZONE_RADIUS_M,
        cleaned[1]["radius_m"],
    )
    many = privacy.clean_zones([{"lat": LAT, "lon": LON, "radius_m": 150}] * 50)
    check("the count is capped", len(many) == privacy.MAX_ZONES, len(many))


def test_visibility_and_delay():
    print("\n[6] private runs, and the publish delay")
    path = straight(2000)
    prefs = {"trim_m": 250.0, "zones": [], "delay_h": 3.0}
    now = datetime(2026, 8, 6, 12, 0, 0)

    check(
        "a private run publishes nothing",
        privacy.public_path(path, prefs, visibility=privacy.PRIVATE,
                            ended_at=now - timedelta(hours=9), now=now) == [],
    )
    check(
        "a run that finished an hour ago is still withheld",
        privacy.public_path(path, prefs, ended_at=now - timedelta(hours=1), now=now) == [],
    )
    later = privacy.public_path(path, prefs, ended_at=now - timedelta(hours=9), now=now)
    check("...and is published, trimmed, once the delay passes", len(later) > 1, len(later))
    check("published route is shorter than the real one", span_m(later) < span_m(path))


def test_owner_sees_everything():
    print("\n[7] the owner is never hidden from their own run")
    path = straight(2000)
    prefs = {"trim_m": 250.0, "zones": [], "delay_h": 24.0}
    mine = privacy.path_for_viewer(
        path, owner_id="u1", viewer_id="u1", prefs=prefs,
        visibility=privacy.PRIVATE, ended_at=datetime.utcnow(),
    )
    check("owner gets the full trace", len(mine) == len(path), f"{len(mine)} of {len(path)}")
    theirs = privacy.path_for_viewer(
        path, owner_id="u1", viewer_id="u2", prefs=prefs,
        visibility=privacy.PRIVATE, ended_at=datetime.utcnow(),
    )
    check("anyone else gets nothing from a private run", theirs == [])


def test_minor_floor():
    print("\n[8] young accounts get a floor, not a default")
    from datetime import date

    today = datetime(2026, 8, 6)
    check("no birthday is not treated as a child", not privacy.is_minor(None, today))
    check("a 14-year-old is", privacy.is_minor(date(2012, 1, 1), today))
    check("an 18-year-old is not", not privacy.is_minor(date(2008, 1, 1), today))
    check(
        "...and the day before their 18th they still are",
        privacy.is_minor(date(2008, 8, 7), today),
        "born 2008-08-07, so 17 on 2026-08-06",
    )

    # A minor turning everything off still cannot publish their front door.
    loosened = {"trim_m": 0.0, "zones": [], "delay_h": 0.0, "minor": False}
    floored = privacy.apply_minor_floor(loosened, True)
    check(
        "trimming cannot be turned off",
        floored["trim_m"] >= settings.minor_min_trim_m,
        floored["trim_m"],
    )
    check(
        "the publish delay cannot be turned off",
        floored["delay_h"] >= settings.minor_min_delay_h,
        floored["delay_h"],
    )
    # ...but they can still be stricter than the floor.
    stricter = privacy.apply_minor_floor(
        {"trim_m": 1000.0, "zones": [], "delay_h": 48.0, "minor": False}, True
    )
    check("a stricter choice is kept", stricter["trim_m"] == 1000.0, stricter["trim_m"])
    check("...for the delay too", stricter["delay_h"] == 48.0, stricter["delay_h"])
    check("an adult is untouched", privacy.apply_minor_floor(loosened, False)["trim_m"] == 0.0)


def main():
    print(
        f"route privacy — default trim {settings.route_trim_default_m} m, "
        f"default delay {settings.route_publish_delay_default_h} h, "
        f"minor floors {settings.minor_min_trim_m} m / {settings.minor_min_delay_h} h"
    )
    test_defaults()
    test_trim()
    test_zones()
    test_clean_zones()
    test_visibility_and_delay()
    test_owner_sees_everything()
    test_minor_floor()
    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        sys.exit(1)
    print("ROUTE PRIVACY HOLDS")


if __name__ == "__main__":
    main()
