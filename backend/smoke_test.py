"""End-to-end smoke suite for the Territory Run v2 API (stdlib only).

Covers the whole surface: auth -> clan create -> invite/join -> two runs
whose placed circle claims overlap (steal resolves) -> clan weekly goal +
season stats advance -> feed shows the runs -> splits/PRs/kudos -> a spoofed
run is shadow-excluded from public reads but visible to its owner ->
leaderboards.

CIRCLE-CLAIM MODEL: /end-run returns claim_radius_m/claim_area_m2 (the
circle whose circumference = run distance); /claim-territory places it at a
chosen point on the trail and creates the territory.

Run against a live local server:  python smoke_test.py
"""

import json
import math
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

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


def run_loop(token, clat, clon, pace_s_per_km=None, **kw):
    """pace_s_per_km backdates started_at so the server derives that pace
    (drives claim strength: ~0.87 at 8:00/km, ~1.38 at 5:00/km)."""
    body = {}
    if pace_s_per_km:
        dur = pace_s_per_km * 0.63  # ~630 m loop
        body["started_at"] = (datetime.utcnow() - timedelta(seconds=dur)).isoformat()
    _, r = call("POST", "/start-run", body, token=token)
    rid = r["run_id"]
    pts = loop(clat, clon, **kw)
    st, end = call("POST", "/end-run", {"run_id": rid, "points": pts}, token=token)
    assert st == 200, f"end-run: {st} {end}"
    assert end["claim_radius_m"] > 0 and end["claim_area_m2"] > 0, end
    return rid, end, pts


def place_claim(token, rid, at):
    """Place the run's circle claim at a point on its trail."""
    st, res = call("POST", "/claim-territory", {"run_id": rid, "lat": at["lat"], "lon": at["lon"]}, token=token)
    assert st == 200, f"claim-territory: {st} {res}"
    assert res.get("territory"), res
    return res


def main():
    print("=== auth + clan ===")
    ta, ua = signup(f"lead_{SFX}")
    tb, ub = signup(f"mem_{SFX}")
    tc, uc = signup(f"cheat_{SFX}")

    st, clan = call("POST", "/clans", {
        "name": f"Night Owls {SFX}", "tag": f"T{SFX[-4:]}",
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

    print("=== circle claims: club stacking + strength ===")
    # Fresh land per test run — old test territories now DEFEND (strength
    # model), so reusing coordinates would bounce the first claim.
    OX = (int(SFX) % 400) * 0.0004
    lat_a, lon_a = 1.3400 + OX, 103.7700 + OX
    lat_e, lon_e = 1.3450 + OX, 103.7750 + OX
    rid_a, ea, pts_a = run_loop(ta, lat_a, lon_a)
    ca = place_claim(ta, rid_a, pts_a[0])
    print(f"  leader claimed {round(ca['territory']['area_m2']):,} m² "
          f"(circle r={round(ea['claim_radius_m'])} m, strength {ca['territory']['strength']})")
    # Placing again must be rejected — one claim per run.
    st, dup = call("POST", "/claim-territory",
                   {"run_id": rid_a, "lat": pts_a[0]["lat"], "lon": pts_a[0]["lon"]}, token=ta)
    assert st == 409, f"duplicate claim should 409: {st} {dup}"
    # A centre off the trail must be rejected.
    st, off = call("POST", "/claim-territory",
                   {"run_id": rid_a, "lat": pts_a[0]["lat"] + 0.01, "lon": pts_a[0]["lon"]}, token=ta)
    assert st in (409, 422), f"off-trail centre should be rejected: {st} {off}"

    # Clubmate overlap: never steals; both rows coexist (stacked defense).
    rid_b, eb, pts_b = run_loop(tb, lat_a + 0.00012, lon_a + 0.00012)
    cb = place_claim(tb, rid_b, pts_b[0])
    assert (cb.get("stolen_m2") or 0) == 0, f"clubmates must not steal: {cb.get('stolen_m2')}"
    print("  member overlapped clubmate: no steal — defense stacks")

    # Outsider attacks the stacked club land: strength holds, claim carved.
    td, _ud = signup(f"raid_{SFX}")
    rid_d, ed, pts_d = run_loop(td, lat_a + 0.00135, lon_a, pace_s_per_km=300)
    cd = place_claim(td, rid_d, pts_d[0])
    assert (cd.get("stolen_m2") or 0) == 0, "stacked club land must hold"
    assert cd["territory"]["area_m2"] < ed["claim_area_m2"] * 0.95, "claim should be carved around defended land"
    print(f"  outsider (strength {cd['territory']['strength']}) bounced off stacked defense; "
          f"claim carved to {round(cd['territory']['area_m2']):,} m²")

    # On fresh ground, a faster claim beats a slower defender.
    te, _ue = signup(f"slow_{SFX}")
    rid_e, ee, pts_e = run_loop(te, lat_e, lon_e, pace_s_per_km=480)
    ce = place_claim(te, rid_e, pts_e[0])
    rid_d2, ed2, pts_d2 = run_loop(td, lat_e, lon_e, pace_s_per_km=300)
    cd2 = place_claim(td, rid_d2, pts_d2[0])
    assert (cd2.get("stolen_m2") or 0) > 0, "faster claim must beat slower defense"
    assert cd2["stolen_from"] == f"slow_{SFX}", cd2["stolen_from"]
    print(f"  fast ({cd2['territory']['strength']}) stole {round(cd2['stolen_m2']):,} m² "
          f"from slow ({ce['territory']['strength']})")

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
    pts_c = loop(1.3100, 103.8600, step=6.5, mocked=True)
    st, ec = call("POST", "/end-run", {
        "run_id": rid_c, "points": pts_c, "step_count": 40,
    }, token=tc)
    assert st == 200 and ec["claim_radius_m"] > 0, "spoofer must see a normal success"
    cc = place_claim(tc, rid_c, pts_c[0])
    assert cc.get("territory"), "spoofer must see a normal-looking claim"
    print("  spoofer sees normal success")

    st, mp = call("GET", "/map-polygons")
    assert all(t["username"] != f"cheat_{SFX}" for t in mp["territories"]), "flagged hidden on public map"
    st, mp_own = call("GET", "/map-polygons", token=tc)
    assert any(t["username"] == f"cheat_{SFX}" for t in mp_own["territories"]), "owner still sees it"
    print("  flagged territory hidden publicly, visible to owner")

    print("=== avatar portrait + xp + streak ===")
    av = {"face": "smiley", "hair": "topknot", "hairColor": 3, "top": "hoodie", "topColor": 5}
    st, _ = call("PUT", "/me/avatar", {"avatar": av}, token=ta)
    assert st == 200, "avatar save"
    st, fd_av = call("GET", "/feed", token=tb)
    mine = next((i for i in fd_av["items"] if i["user_id"] == ua), None)
    assert mine and mine["avatar"] and mine["avatar"]["hair"] == "topknot", mine
    st, days = call("GET", "/me/run-days", token=ta)
    assert st == 200 and len(days["days"]) >= 1, days
    st, ms = call("GET", "/me/stats", token=ta)
    assert st == 200 and ms["current_streak_days"] >= 1, ms  # ran today -> day streak
    # the owner's avatar rides along on map-polygons so portraits render on the map
    st, mp_av = call("GET", "/map-polygons", token=tb)
    owned = next((t for t in mp_av["territories"] if t["user_id"] == ua), None)
    assert owned and owned.get("avatar") and owned["avatar"]["hair"] == "topknot", owned
    # fresh claims carry high freshness (decay signal)
    assert owned.get("freshness", 0) > 0.9, f"fresh territory should be ~1.0: {owned.get('freshness')}"
    # end-run returns xp for the distance covered
    _, rr = call("POST", "/start-run", {}, token=tb)
    st, endx = call("POST", "/end-run", {"run_id": rr["run_id"], "points": loop(1.360, 103.80, r=140)}, token=tb)
    assert st == 200 and endx["xp_gained"] > 0, f"xp not returned: {endx}"
    print(f"  avatar visible on others' feed; run-days={len(days['days'])}; xp_gained={endx['xp_gained']}")

    print("=== comments + club chat ===")
    st, cmt = call("POST", f"/runs/{rid_b}/comments", {"body": "nice circle!"}, token=ta)
    assert st == 200 and cmt["body"] == "nice circle!" and cmt["is_you"], cmt
    st, clist = call("GET", f"/runs/{rid_b}/comments", token=tb)
    assert st == 200 and len(clist) == 1 and clist[0]["username"] == f"lead_{SFX}", clist
    st, fd2 = call("GET", "/feed", token=tb)
    fitem = next(i for i in fd2["items"] if i["id"] == rid_b)
    assert fitem["comment_count"] == 1, fitem
    st, msg = call("POST", f"/clans/{cid}/messages", {"body": "who's running tonight?"}, token=ta)
    assert st == 200 and msg["is_you"], msg
    st, msgs = call("GET", f"/clans/{cid}/messages", token=tb)
    assert st == 200 and len(msgs) == 1 and msgs[0]["username"] == f"lead_{SFX}" and not msgs[0]["is_you"], msgs
    st, _ = call("POST", f"/clans/{cid}/messages", {"body": "spy!"}, token=tc)
    assert st == 403, "non-member must not post to club chat"
    print(f"  comment on run + count in feed OK; chat send/list OK; outsider blocked")

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
