"""Is each placement's breakdown attached to the ring it claims to describe?

The grid is built by one code path and its breakdown by two SQL queries keyed
on WITH ORDINALITY. If those ever fell out of step the UI would offer a steal
at the wrong end of the run, and nothing would notice until a claim landed
somewhere else entirely.

So: plant a victim's territory, then check every candidate INDEPENDENTLY —
the victim must appear in a candidate's rival list exactly when that
candidate's own ring actually overlaps the victim's land. Geometry decides,
computed here from the rings the API returned, so the test does not care how
many other territories a shared dev database is littered with.
"""
import math
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, r"C:\Users\user\Desktop\run\backend")

from pyproj import Transformer  # noqa: E402
from shapely.geometry import Polygon  # noqa: E402

import smoke_test as S  # noqa: E402

S.BASE = "http://127.0.0.1:8011"
SFX = str(int(time.time()))[-6:]
OX = (int(SFX) % 400) * 0.0004
LAT, LON = 1.3600 + OX, 103.8200 + OX


def straight(lat, lon, metres, n=120, pace_s_per_km=300):
    t0 = time.time()
    total_s = (metres / 1000.0) * pace_s_per_km
    per_deg = 111320.0 * math.cos(math.radians(lat))
    return [
        {"lat": lat, "lon": lon + (metres * i / (n - 1)) / per_deg,
         "t": (t0 + total_s * i / (n - 1)) * 1000}
        for i in range(n)
    ]


# One shared AEQD frame for every polygon in this test. A flat
# degrees-times-111320 approximation is NOT good enough here: the overlaps are
# small parallelograms where two ~136 m corridors cross, so their area is very
# sensitive to the angle between them, and a per-polygon flattening quietly
# shears each one differently. That showed up as the oracle disagreeing with
# itself across the 90/270 symmetry the server got right.
_TO_M = Transformer.from_crs(
    "EPSG:4326",
    f"+proj=aeqd +lat_0={LAT} +lon_0={LON} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    always_xy=True,
)


def poly(ring):
    """The ring in true local metres, so areas are comparable to PostGIS's."""
    return Polygon([_TO_M.transform(x, y) for x, y in ring]).buffer(0)


def run_straight(token, lat, lon, metres, pace_s_per_km=300):
    """A straight qualifying run, ended and ready to claim."""
    dur = max((metres / 1000.0) * pace_s_per_km, 460.0)
    _, started = S.call(
        "POST", "/start-run",
        {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()},
        token=token,
    )
    rid = started["run_id"]
    st, end = S.call(
        "POST", "/end-run",
        {"run_id": rid, "points": straight(lat, lon, metres, pace_s_per_km=pace_s_per_km)},
        token=token,
    )
    assert st == 200, end
    assert end["tier"] == "qualified_for_claim", end
    return rid, end


# --- victim and attacker on the SAME line ----------------------------------
# Both run east from the same point, so the victim's corridor definitely lies
# under the attacker's early placements and definitely not under the late ones.
# Claims are ~136 m wide at the current area rate, so a shared line is the only
# setup that stays deterministic rather than depending on which side of a loop
# a crescent happened to land.
tv, uv = S.signup(f"vic_{SFX}")
vid, _ev = run_straight(tv, LAT, LON, 1500)
vc = S.place_claim(tv, vid)
victim = poly(vc["territory"]["rings"][0])
print(f"victim {uv[:8]} holds {round(vc['territory']['area_m2']):,} m²")

ta, _ua = S.signup(f"atk_{SFX}")
aid, ea = run_straight(ta, LAT, LON, 4000)

opts = S.claim_options(ta, aid)
ps = opts["placements"]
print(f"attacker earned {ea['claim_area_m2']:,.0f} m²; "
      f"{len(ps)} candidates ({opts['placement_count']}×{opts['rotation_count']})")

# --- the actual check -------------------------------------------------------
FLOOR = 25.0  # the server's own sliver floor for rivalry-worthy overlap
mismatches = []
reported = geometric = 0
for p in ps:
    overlap = poly(p["ring"]).intersection(victim).area
    said = next((r["area_m2"] for r in p["rivals"] if r["user_id"] == uv), 0.0)
    if said > 0:
        reported += 1
    if overlap > FLOOR:
        geometric += 1
    # Both directions: no invented battles, and no missed ones.
    if (said > 0) != (overlap > FLOOR):
        mismatches.append((p["index"], p["placement"], p["rotation"], overlap, said))
    elif said > 0 and abs(said - overlap) > max(overlap * 0.15, 50):
        mismatches.append((p["index"], p["placement"], p["rotation"], overlap, said))

print(f"candidates overlapping the victim: {geometric} by geometry, {reported} reported")
for m in mismatches:
    print(f"  MISMATCH index {m[0]} (pos {m[1]}, rot {m[2]}): "
          f"geometry says {m[3]:,.0f} m², API says {m[4]:,.0f} m²")
assert not mismatches, f"{len(mismatches)} candidates describe the wrong ring"
assert geometric > 0, "the attacker started on the victim — some candidate must overlap"
assert geometric < len(ps), "4 km of route must include candidates that miss the victim"
print("OK — every candidate's rival list matches its own ring, both ways")

# --- rotation reaches ground sliding alone cannot ---------------------------
by_pos = {}
for p in ps:
    by_pos.setdefault(p["placement"], []).append(p)
turned_only = [
    pos for pos, group in by_pos.items()
    if any(r["user_id"] == uv for g in group if g["rotation"] != 0 for r in g["rivals"])
    and not any(r["user_id"] == uv for g in group if g["rotation"] == 0 for r in g["rivals"])
]
print(f"positions that only reach the victim once TURNED: {turned_only}")

# --- claiming lands on exactly the previewed shape --------------------------
clean = [p for p in ps if not p["rivals"]]
assert clean, "expected some candidate to touch nobody"
pick = clean[len(clean) // 2]
res = S.place_claim(ta, aid, placement=pick["placement"], rotation=pick["rotation"])
got = poly(res["territory"]["rings"][0])
want = poly(pick["ring"])
iou = got.intersection(want).area / got.union(want).area
print(f"\nclaimed pos {pick['placement']} rot {pick['rotation']} "
      f"({pick['rotation_deg']}°): overlap with preview {iou:.1%}")
assert iou > 0.98, f"claim landed on a different shape than previewed (IoU {iou:.1%})"
assert (res.get("stolen_m2") or 0) == 0, "a candidate touching nobody must steal nothing"
print("OK — the claim is the shape that was previewed, and stole nothing")
