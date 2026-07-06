"""End-to-end smoke suite for the Territory Run v2 API (stdlib only).

Covers the whole surface: auth -> clan create -> invite/join -> two
overlapping verified loops (steal resolves) -> clan weekly goal + season
stats advance -> feed shows the runs -> splits/PRs/kudos -> a spoofed run is
shadow-excluded from public reads but visible to its owner -> leaderboards.

Run against a live local server:  python smoke_test.py
"""

import json
import math
import time
import urllib.error
import urllib.request

BASE = "http://localhost:8000"
SFX = str(int(time.time()))[-6:]


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


def loop(clat, clon, r=100.0, n=12, step=16.0, mocked=None, t0=None):
    """A regular n-gon traced as GPS points (closes back to the start)."""
    t0 = t0 or time.time()
    pts = []
    for i in range(n + 1):
        ang = 2 * math.pi * (i % n) / n
        dx = r * math.cos(ang)
        dy = r * math.sin(ang)
        p = {
            "lat": clat + dy / 111320.0,
            "lon": clon + dx / (111320.0 * math.cos(math.radians(clat))),
            "t": (t0 + i * step) * 1000,
        }
        if mocked is not None:
            p["mocked"] = mocked
        pts.append(p)
    return pts


def signup(name):
    st, res = call("POST", "/auth/signup", {"username": name, "password": "passw0rd1"})
    assert st == 200, f"signup {name}: {st} {res}"
    return res["access_token"], res["user"]["id"]


def run_loop(token, clat, clon, **kw):
    _, r = call("POST", "/start-run", {}, token=token)
    rid = r["run_id"]
    st, end = call("POST", "/end-run", {"run_id": rid, "points": loop(clat, clon, **kw)}, token=token)
    assert st == 200, f"end-run: {st} {end}"
    return rid, end


def main():
    print("=== auth + clan ===")
    ta, ua = signup(f"lead_{SFX}")
    tb, ub = signup(f"mem_{SFX}")
    tc, uc = signup(f"cheat_{SFX}")

    st, clan = call("POST", "/clans", {
        "name": f"Night Owls {SFX[-2:]}", "tag": "NO" + SFX[-1],
        "color_key": "violet", "badge_icon": "wolf", "privacy": "invite_only",
    }, token=ta)
    assert st == 200, clan
    cid = clan["id"]
    print(f"  clan {clan['tag']} created; leader={clan['my_role']}")

    st, inv = call("POST", f"/clans/{cid}/invites", {}, token=ta)
    assert st == 200, inv
    st, joined = call("POST", "/clans/join-by-code", {"code": inv["code"]}, token=tb)
    assert st == 200 and joined["member_count"] == 2, joined
    print(f"  member joined by code; members={joined['member_count']}")

    print("=== overlapping loops -> steal ===")
    _, ea = run_loop(ta, 1.3400, 103.7700)
    assert ea.get("territory"), "leader should claim"
    print(f"  leader claimed {round(ea['territory']['area_m2']):,} m²")
    rid_b, eb = run_loop(tb, 1.34012, 103.77012)
    assert (eb.get("stolen_m2") or 0) > 0, f"member should steal: {eb.get('stolen_m2')}"
    assert eb["stolen_from"] == f"lead_{SFX}", eb["stolen_from"]
    print(f"  member stole {round(eb['stolen_m2']):,} m² from {eb['stolen_from']}")

    print("=== clan stats advance ===")
    st, prof = call("GET", f"/clans/{cid}", token=ta)
    wg = prof["week_goal"]
    assert wg["progress_distance_m"] > 0 and wg["progress_claims"] >= 2, wg
    assert prof["season_area_m2"] > 0 and prof["season_rank"] is not None
    print(f"  weekly goal: {wg['progress_distance_m']/1000:.2f} km, {wg['progress_claims']} claims; "
          f"season area {round(prof['season_area_m2']):,} m², rank {prof['season_rank']}")

    print("=== feed + splits/PRs + kudos ===")
    st, fd = call("GET", "/feed", token=tb)
    assert st == 200 and len(fd["items"]) >= 2, fd
    assert any(i["clan_tag"] for i in fd["items"]), "feed items should carry clan_tag"
    assert "Longest run" in ea["achievements"], ea["achievements"]
    print(f"  feed {len(fd['items'])} items; leader PRs {ea['achievements']}")

    st, det = call("GET", f"/runs/{rid_b}", token=tb)
    # (a 628 m loop has no full-km split; path + detail must still resolve)
    assert st == 200 and len(det["path"]) >= 2 and det["territory_rings"], det
    st, k = call("POST", f"/runs/{rid_b}/kudos", {}, token=ta)
    assert st == 200 and k["kudoed"] and k["kudos_count"] == 1, k
    print(f"  run detail path={len(det['path'])} pts, rings={len(det['territory_rings'])}; kudos={k['kudos_count']}")

    print("=== spoofed run is shadow-excluded ===")
    _, r = call("POST", "/start-run", {}, token=tc)
    rid_c = r["run_id"]
    # mocked + inhuman pace (step 6.5s over ~52m segs ~= 8 m/s, 2:05/km)
    st, ec = call("POST", "/end-run", {
        "run_id": rid_c, "points": loop(1.3100, 103.8600, step=6.5, mocked=True), "step_count": 40,
    }, token=tc)
    assert st == 200 and ec.get("territory"), "spoofer must see a normal success"
    print("  spoofer sees normal success")

    st, mp = call("GET", "/map-polygons")
    assert all(t["username"] != f"cheat_{SFX}" for t in mp["territories"]), "flagged hidden on public map"
    st, mp_own = call("GET", "/map-polygons", token=tc)
    assert any(t["username"] == f"cheat_{SFX}" for t in mp_own["territories"]), "owner still sees it"
    print("  flagged territory hidden publicly, visible to owner")

    print("=== leaderboards ===")
    st, lb = call("GET", "/leaderboard")
    assert st == 200 and all(e["username"] != f"cheat_{SFX}" for e in lb), "cheater excluded from runner LB"
    assert any(e["username"] == f"lead_{SFX}" for e in lb)
    st, clb = call("GET", "/leaderboard/clans")
    assert st == 200 and any(c["clan_id"] == cid for c in clb), clb
    print(f"  runner LB {len(lb)} rows (cheater excluded); clan LB has our clan")

    print("\nALL E2E CHECKS PASSED")


if __name__ == "__main__":
    main()
