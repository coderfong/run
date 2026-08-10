"""The invariants that make a free-form claim placement safe to offer.

A run grows ONE shape and the runner moves it rigidly — slide it anywhere
along the route, turn it to any angle. Everything the old grid enforced by
only ever offering nine pre-vetted positions is now enforced by the geometry
itself, so this is where that is actually checked:

  * the shape holds exactly the area the run earned, and no pose can change
    it — otherwise a heading would be worth more land than another;
  * every slider position puts the centre on the corresponding route point;
  * a turn pivots about the claim's own centre, so it cannot walk off;
  * the centre never drifts away from the trail.

Unlike test_claim_placement.py and test_claim_rotation.py this needs no server
and no database — it is pure geometry. Run it directly:

    .venv/Scripts/python.exe test_claim_stamp.py
"""
import math
import sys

sys.path.insert(0, r"C:\Users\user\Desktop\run\backend")

from shapely.geometry import Point  # noqa: E402

from app.geospatial import (  # noqa: E402
    build_claim_stamp,
    claim_placement_samples,
    clamp_t,
    normalise_rotation,
)

LAT, LON = 1.36, 103.82
PER_LON = 111320.0 * math.cos(math.radians(LAT))
PER_LAT = 110540.0


def straight(metres, n=120):
    return [(LON + (metres * i / (n - 1)) / PER_LON, LAT) for i in range(n)]


def lap(side_m, n=160):
    """A square-ish lap — the case where the shape's centre is OFF the route."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x = math.copysign(abs(math.cos(a)) ** 0.6, math.cos(a)) * side_m / 2
        y = math.copysign(abs(math.sin(a)) ** 0.6, math.sin(a)) * side_m / 2
        pts.append((LON + x / PER_LON, LAT + y / PER_LAT))
    pts.append(pts[0])
    return pts


def area_m2(stamp, t, deg):
    return stamp.metric_at(t, deg).area


def report(name, ok, extra=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + extra) if extra else ''}")
    return ok


failures = 0
AREA = 1_200_000.0  # 1.2 km²

for label, route in (("straight 3km", straight(3000)), ("lap 600m", lap(600))):
    print(f"\n--- {label} ---")
    stamp = build_claim_stamp(route, AREA)
    if stamp is None:
        failures += 1
        print("FAIL  stamp built")
        continue
    print(f"      t0 = {stamp.t0:.4f}")

    # 1. the grown shape holds the earned area
    a0 = area_m2(stamp, stamp.t0, 0.0)
    failures += not report(
        "area == earned area", abs(a0 - AREA) / AREA < 0.02, f"{a0/1e6:.4f} km²"
    )

    # 2. a rigid move cannot change the area — at ANY t, at ANY angle
    areas = [
        area_m2(stamp, t, d)
        for t in (0.0, 0.13, 0.5, 0.77, 1.0)
        for d in (0, 17, 90, 180, 271, 359)
    ]
    spread = (max(areas) - min(areas)) / AREA
    failures += not report("area invariant under pose", spread < 1e-6, f"spread {spread:.2e}")

    # 3. the initial handle position is a literal point on the route
    rest_off = stamp.line.distance(Point(*stamp.centre_metric(stamp.t0)))
    failures += not report(
        "resting centre is on the route", rest_off < 1e-6, f"offset {rest_off:.2e} m"
    )

    # 4. sliding actually moves it, over a range that scales with the route.
    #    NOT measured end to end: on a closed lap t=0 and t=1 are the same
    #    point, so dragging orbits the claim around the loop and back — the
    #    endpoints coincide and the SPAN is what matters.
    centres = [stamp.centre_metric(i / 40) for i in range(41)]
    reach = max(
        math.hypot(a[0] - b[0], a[1] - b[1]) for a in centres for b in centres
    )
    line_len = stamp.line.length
    failures += not report(
        "slide covers the route", reach > line_len * 0.25,
        f"centre reaches {reach:.0f} m across a {line_len:.0f} m route",
    )

    # 5. rotation turns it about its own centre — the centre must not drift
    c_rest = stamp.centre_metric(0.4)
    for deg in (0, 45, 90, 180, 300):
        c = stamp.metric_at(0.4, deg).centroid
        drift = math.hypot(c.x - c_rest[0], c.y - c_rest[1])
        if drift > 0.5:
            failures += 1
            print(f"FAIL  centre drifts on rotation at {deg}deg: {drift:.2f} m")
            break
    else:
        report("rotation pivots about the claim's own centre", True)

    # 6. every pose puts the centre on the run itself, including a closed lap.
    offs = [stamp.line.distance(Point(*stamp.centre_metric(t))) for t in (0.0, 0.25, 0.75, 1.0)]
    failures += not report(
        "centre follows the route",
        all(o < 1e-6 for o in offs),
        f"max offset {max(offs):.2e} m",
    )

print("\n--- input folding ---")
failures += not report("clamp_t folds out-of-range", clamp_t(-3) == 0.0 and clamp_t(9) == 1.0)
failures += not report("clamp_t survives junk", clamp_t(float("nan")) == 0.5 and clamp_t(None) == 0.5)
failures += not report(
    "rotation folds to [0,360)",
    normalise_rotation(-90) == 270.0 and normalise_rotation(725) == 5.0
    and normalise_rotation(None) == 0.0,
)
samples = claim_placement_samples()
failures += not report(
    "samples span the whole route", samples[0] == 0.0 and samples[-1] == 1.0, str(len(samples))
)

print(f"\n{'ALL PASS' if not failures else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)
