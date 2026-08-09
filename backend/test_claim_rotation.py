"""Rotation: cost, payload size, and does a turned claim actually land turned?"""
import json
import math
import sys
import time
import urllib.request
from datetime import datetime, timedelta

sys.path.insert(0, r"C:\Users\user\Desktop\run\backend")

import smoke_test as S  # noqa: E402

S.BASE = "http://127.0.0.1:8011"
SFX = str(int(time.time()))[-6:]
OX = (int(SFX) % 400) * 0.0004
LAT, LON = 1.3700 + OX, 103.8400 + OX


def straight(lat, lon, metres, n=120, pace=300):
    t0 = time.time()
    total = (metres / 1000.0) * pace
    per_deg = 111320.0 * math.cos(math.radians(lat))
    return [
        {"lat": lat, "lon": lon + (metres * i / (n - 1)) / per_deg,
         "t": (t0 + total * i / (n - 1)) * 1000}
        for i in range(n)
    ]


def principal_axis_deg(ring):
    """Heading of the ring's long axis, 0-180 — how the shape is oriented."""
    k = 111320.0 * math.cos(math.radians(ring[0][1]))
    pts = [(x * k, y * 111320.0) for x, y in ring]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - cx) ** 2 for p in pts)
    syy = sum((p[1] - cy) ** 2 for p in pts)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in pts)
    return math.degrees(0.5 * math.atan2(2 * sxy, sxx - syy)) % 180


def centre(ring):
    """Area centroid (shoelace) — the actual pivot. The vertex mean drifts
    under rotation whenever the ring is unevenly sampled, which it always is
    after a buffer/simplify, so it would report a turn as a move."""
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-15:
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    return (cx / (3 * a), cy / (3 * a))


def metres_between(a, b):
    k = 111320.0 * math.cos(math.radians(a[1]))
    return math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 111320.0)


tok, _ = S.signup(f"rot_{SFX}")
dur = 4 * 300
_, r = S.call("POST", "/start-run",
              {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()},
              token=tok)
rid = r["run_id"]
st, end = S.call("POST", "/end-run", {"run_id": rid, "points": straight(LAT, LON, 4000)}, token=tok)
assert st == 200, end
print(f"ran {end['distance_m']:.0f} m east, earned {end['claim_area_m2']:,.0f} m²")

# --- cost + payload ---------------------------------------------------------
t0 = time.perf_counter()
req = urllib.request.Request(f"{S.BASE}/runs/{rid}/claim-options")
req.add_header("Authorization", f"Bearer {tok}")
with urllib.request.urlopen(req) as resp:
    raw = resp.read()
elapsed = time.perf_counter() - t0
opts = json.loads(raw)
ps = opts["placements"]
print(f"\n/claim-options: {elapsed*1000:.0f} ms, {len(raw)/1024:.1f} KB, "
      f"{len(ps)} candidates ({opts['placement_count']} positions × {opts['rotation_count']} headings)")
assert len(ps) == opts["placement_count"] * opts["rotation_count"], "grid must be complete"

# --- grid layout is position-major ------------------------------------------
nrot = opts["rotation_count"]
for i, p in enumerate(ps):
    assert p["index"] == i, f"index {p['index']} at slot {i}"
    assert p["placement"] == i // nrot and p["rotation"] == i % nrot, \
        f"grid not position-major at {i}: {p['placement']},{p['rotation']}"
print("grid layout: position-major, indices consistent")

# --- rotation actually rotates ----------------------------------------------
base = ps[4 * nrot]  # middle position, unturned
assert base["rotation_deg"] == 0, base["rotation_deg"]
base_axis = principal_axis_deg(base["ring"])
base_centre = centre(base["ring"])
print(f"\nunturned claim: axis {base_axis:.1f}°  area {base['area_m2']:,.0f} m²")
print(f"{'rot':>4} {'deg':>7} {'axis':>7} {'expected':>9} {'area m²':>12} {'pivot drift':>12}")
for r_i in range(nrot):
    p = ps[4 * nrot + r_i]
    axis = principal_axis_deg(p["ring"])
    want = (base_axis + p["rotation_deg"]) % 180
    drift = metres_between(centre(p["ring"]), base_centre)
    print(f"{r_i:>4} {p['rotation_deg']:>7.1f} {axis:>7.1f} {want:>9.1f} "
          f"{p['area_m2']:>12,.0f} {drift:>10,.0f} m")
    err = min(abs(axis - want), 180 - abs(axis - want))
    assert err < 4.0, f"rotation {p['rotation_deg']}° gave axis {axis:.1f}°, expected {want:.1f}°"
    # A turn must not move the claim or change how much land it is.
    assert drift < 30, f"rotation moved the claim {drift:,.0f} m off its pivot"
    assert abs(p["area_m2"] - base["area_m2"]) < base["area_m2"] * 0.02, \
        f"rotation changed the area: {p['area_m2']:,.0f} vs {base['area_m2']:,.0f}"
print("\nOK — every heading turns the shape, keeps its pivot, and holds the same land")

# --- claiming a turned shape lands turned -----------------------------------
pick = ps[6 * nrot + 3]
res = S.place_claim(tok, rid, placement=pick["placement"], rotation=pick["rotation"])
got = res["territory"]["rings"][0]
axis_got = principal_axis_deg(got)
axis_want = principal_axis_deg(pick["ring"])
off = metres_between(centre(got), centre(pick["ring"]))
print(f"\nclaimed position {pick['placement']} at {pick['rotation_deg']}°: "
      f"axis {axis_got:.1f}° vs previewed {axis_want:.1f}°, centre {off:,.0f} m off")
assert min(abs(axis_got - axis_want), 180 - abs(axis_got - axis_want)) < 4.0
assert off < 150
print("OK — the claim landed on the previewed shape, at the previewed angle")

# --- a made-up rotation must not fail the claim -----------------------------
tok2, _ = S.signup(f"rot2_{SFX}")
rid2, _e2, _ = S.run_loop(tok2, LAT + 0.02, LON)
st, bad = S.call("POST", "/claim-territory",
                 {"run_id": rid2, "placement": 3, "rotation": 61}, token=tok2)
assert st == 200, f"out-of-range rotation should fall back, not fail: {st} {bad}"
print("OK — an out-of-range heading falls back to unturned")
