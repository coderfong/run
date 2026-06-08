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


def polygon_points(center_lat, center_lon, radius_m, n=12, t0=None):
    """A regular n-gon traced as GPS points, closing back to the first vertex."""
    t0 = t0 or time.time()
    pts = []
    for i in range(n + 1):  # +1 to return to the start
        ang = 2 * math.pi * (i % n) / n
        dx = radius_m * math.cos(ang)
        dy = radius_m * math.sin(ang)
        lat = center_lat + dy / 111320.0
        lon = center_lon + dx / (111320.0 * math.cos(math.radians(center_lat)))
        pts.append({"lat": lat, "lon": lon, "t": (t0 + i * 10) * 1000})  # ms epoch
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


# User A claims a territory.
run_flow(f"alice_{SUFFIX}", 1.3000, 103.8500)

# User B claims a heavily overlapping territory (exercises ST_Difference steal).
run_flow(f"bob_{SUFFIX}", 1.30015, 103.85015)

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
