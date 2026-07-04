"""End-to-end smoke test for the Territory Run API (no external deps)."""
import json
import math
import time
import urllib.request
import urllib.error

BASE = "http://localhost:8000"
SUFFIX = str(int(time.time()))[-6:]  # unique per run so signups don't collide


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def polygon_points(center_lat, center_lon, radius_m, n=12, t0=None,
                   step_seconds=10.0, mocked=None):
    """A regular n-gon traced as GPS points, closing back to the first vertex.

    step_seconds controls implied speed (segment length / step_seconds);
    mocked, if set, stamps every point with the mock-provider flag."""
    t0 = t0 or time.time()
    pts = []
    for i in range(n + 1):  # +1 to return to the start
        ang = 2 * math.pi * (i % n) / n
        dx = radius_m * math.cos(ang)
        dy = radius_m * math.sin(ang)
        lat = center_lat + dy / 111320.0
        lon = center_lon + dx / (111320.0 * math.cos(math.radians(center_lat)))
        p = {"lat": lat, "lon": lon, "t": (t0 + i * step_seconds) * 1000}  # ms epoch
        if mocked is not None:
            p["mocked"] = mocked
        pts.append(p)
    return pts


def run_flow(username, center_lat, center_lon, radius_m=100.0):
    print(f"\n=== Flow for {username} ===")
    st, res = call("POST", "/auth/signup", {"username": username, "password": "passw0rd1"})
    assert st == 200, f"signup failed: {st} {res}"
    token = res["access_token"]
    print(f"  signup OK -> user {res['user']['id'][:8]} token {token[:12]}...")

    st, me = call("GET", "/me", token=token)
    assert st == 200 and me["username"] == username, f"/me failed: {st} {me}"
    print(f"  /me OK -> {me['username']}")

    st, run = call("POST", "/start-run", {}, token=token)
    assert st == 200, f"start-run failed: {st} {run}"
    run_id = run["run_id"]
    print(f"  start-run OK -> run {run_id[:8]}")

    pts = polygon_points(center_lat, center_lon, radius_m)
    st, sp = call("POST", "/submit-path", {"run_id": run_id, "points": pts}, token=token)
    assert st == 200, f"submit-path failed: {st} {sp}"
    print(f"  submit-path OK -> closed_loop={sp['closed_loop']} area={sp.get('preview_area_m2')}")
    assert sp["closed_loop"] is True, "expected a closed loop from submit-path"

    st, end = call("POST", "/end-run", {"run_id": run_id, "points": pts}, token=token)
    assert st == 200, f"end-run failed: {st} {end}"
    terr = end.get("territory")
    print(f"  end-run OK -> closed_loop={end['closed_loop']} dist={end['distance_m']:.1f}m "
          f"territory_area={terr['area_m2'] if terr else None:.1f}")
    assert terr is not None, "expected a territory from end-run"
    return token


def spoof_flow(username, center_lat, center_lon):
    """A spoofed run: every point carries the mock-provider flag and the
    implied pace is inhuman (~8 m/s sustained over >500m). The submitter
    must see a NORMAL success (shadow flag), but the territory must be
    invisible to everyone else."""
    print(f"\n=== Spoof flow for {username} ===")
    st, res = call("POST", "/auth/signup", {"username": username, "password": "passw0rd1"})
    assert st == 200, f"signup failed: {st} {res}"
    token = res["access_token"]
    user_id = res["user"]["id"]

    st, run = call("POST", "/start-run", {}, token=token)
    assert st == 200, f"start-run failed: {st} {run}"
    run_id = run["run_id"]

    # radius 100m -> segments ~52m; 6.5s steps -> ~8 m/s (2:05/km) sustained,
    # under the 12 m/s glitch filter but far beyond the 2:50/km pace floor.
    pts = polygon_points(center_lat, center_lon, 100.0, t0=time.time(),
                         step_seconds=6.5, mocked=True)
    st, end = call("POST", "/end-run", {"run_id": run_id, "points": pts,
                                        "step_count": 40}, token=token)
    assert st == 200, f"spoofed end-run should still return 200: {st} {end}"
    assert end["closed_loop"] is True, "spoof loop should close normally"
    assert end.get("territory") is not None, "spoofer must see a normal territory"
    print(f"  end-run OK (shadow) -> territory_area={end['territory']['area_m2']:.1f}")
    return token, user_id


# User A claims a territory.
run_flow(f"alice_{SUFFIX}", 1.3000, 103.8500)

# User B claims a heavily overlapping territory (exercises ST_Difference steal).
run_flow(f"bob_{SUFFIX}", 1.30015, 103.85015)

# User C submits a spoofed run (mocked + teleport-pace pattern).
cheat_name = f"carol_{SUFFIX}"
cheat_token, cheat_uid = spoof_flow(cheat_name, 1.3100, 103.8600)

# Shadow-flag assertions: the cheater is absent from public reads...
st, lb = call("GET", "/leaderboard")
assert st == 200
assert all(e["username"] != cheat_name for e in lb), \
    "flagged run must be excluded from the public leaderboard"
st, mp = call("GET", "/map-polygons")
assert st == 200
assert all(t["username"] != cheat_name for t in mp["territories"]), \
    "flagged territory must be excluded from the public map"

# ...but sees their own territory as if nothing happened.
st, lb_own = call("GET", "/leaderboard", token=cheat_token)
assert st == 200 and any(e["username"] == cheat_name for e in lb_own), \
    "the flagged runner should still see their own numbers"
st, mp_own = call("GET", "/map-polygons", token=cheat_token)
assert st == 200 and any(t["username"] == cheat_name for t in mp_own["territories"]), \
    "the flagged runner should still see their own territory"
print("  shadow-flag checks OK (hidden publicly, visible to owner)")

# Map + leaderboard reflect the result.
print("\n=== Global state ===")
st, mp = call("GET", "/map-polygons")
print(f"  map-polygons -> {st}, {len(mp['territories'])} territories")
for t in mp["territories"]:
    print(f"    {t['username']}: {t['area_m2']:.1f} m^2, {len(t['polygon'])} ring pts")

st, lb = call("GET", "/leaderboard")
print(f"  leaderboard -> {st}")
for e in lb:
    print(f"    {e['username']}: total {e['total_area_m2']:.1f} m^2 over {e['territory_count']} territories")

print("\nALL SMOKE CHECKS PASSED")
