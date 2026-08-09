"""End-to-end smoke suite for the Territory Run v2 API (stdlib only).

Covers the whole surface: auth -> clan create -> invite/join -> two runs
whose claims overlap (steal resolves) -> clan weekly goal +
season stats advance -> feed shows the runs -> splits/PRs/kudos -> a spoofed
run is shadow-excluded from public reads but visible to its owner ->
leaderboards.

ROUTE-GROWN CLAIM MODEL: /end-run returns claim_area_m2 (linear in distance)
plus claim_ring — the territory the run will take, grown around the middle of
the route. /runs/{id}/claim-options then offers a grid of moves — each position
along the route × each heading it can be turned to — and /claim-territory
takes the one those two indices address (never a client-supplied shape).

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


def run_loop(token, clat, clon, pace_s_per_km=480, r=200.0, expect_tier="qualified_for_claim", **kw):
    """A loop that actually qualifies as a run.

    Three bars have to be cleared now (see economy.run_tier): 1 km, 7 minutes,
    and 700 m of DISTINCT ground. A 200 m-radius dodecagon is ~1.24 km round,
    and started_at is ALWAYS backdated so the derived duration clears the time
    bar — a loop timed in real seconds is an activity, not a run.

    pace_s_per_km drives claim strength (~0.90 at 8:00/km, ~1.13 at 5:00/km,
    in the post-rebalance 0.85-1.20 band)."""
    km = 2 * math.pi * r * 0.9886 / 1000.0  # 12-gon perimeter ≈ 98.9% of a circle
    # Never shorter than the 7-minute claim bar, whatever pace was asked for.
    dur = max(pace_s_per_km * km, 460.0)
    body = {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()}
    kw.setdefault("r", r)
    # The POINT timestamps have to imply the same pace as started_at does, or
    # anti-cheat reads the gap between them as a teleport and shadow-flags the
    # run — which then earns nothing at all and fails every later assertion for
    # reasons that look nothing like the cause.
    n = kw.setdefault("n", 12)
    kw.setdefault("step", dur / n)
    kw.setdefault("t0", time.time() - dur)
    _, started = call("POST", "/start-run", body, token=token)
    rid = started["run_id"]
    pts = loop(clat, clon, **kw)
    st, end = call("POST", "/end-run", {"run_id": rid, "points": pts}, token=token)
    assert st == 200, f"end-run: {st} {end}"
    assert end.get("tier") == expect_tier, \
        f"expected tier {expect_tier}: got {end.get('tier')} {end.get('qualification_reason')}"
    assert end["claim_area_m2"] > 0, end
    assert len(end.get("claim_ring") or []) >= 4, f"end-run must preview the claim: {end}"
    return rid, end, pts


def claim_options(token, rid):
    """Where this run could deploy its land — the "choose your attack" step."""
    st, res = call("GET", f"/runs/{rid}/claim-options", token=token)
    assert st == 200, f"claim-options: {st} {res}"
    return res


def place_claim(token, rid, at=None, placement=None, rotation=None):
    """Take the run's claim. The shape comes from the route; `placement` is
    where along it the land lands and `rotation` which way it faces — both
    indices into claim-options, or None for the middle of the run, unturned."""
    body = {"run_id": rid}
    if placement is not None:
        body["placement"] = placement
    if rotation is not None:
        body["rotation"] = rotation
    st, res = call("POST", "/claim-territory", body, token=token)
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
          f"(earned {round(ea['claim_area_m2']):,} m², strength {ca['territory']['strength']})")
    # Claiming again REPLAYS the stored result rather than erroring — the run
    # is spent either way, and a client that lost its response needs the
    # answer, not a 409. What must not happen is a second payout.
    _, me_before = call("GET", "/me", token=ta)
    st, dup = call("POST", "/claim-territory", {"run_id": rid_a}, token=ta)
    assert st == 200, f"duplicate claim should replay: {st} {dup}"
    assert dup["territory"]["id"] == ca["territory"]["id"], "replay must return the same territory"
    assert dup["xp_gained"] == ca["xp_gained"], "replay must report the same XP"
    _, me_after = call("GET", "/me", token=ta)
    assert me_after.get("xp") == me_before.get("xp"), \
        f"a replayed claim must not pay again: {me_before.get('xp')} -> {me_after.get('xp')}"
    # ...and a placement/rotation that differs must not create a second claim.
    st, dup2 = call("POST", "/claim-territory",
                    {"run_id": rid_a, "placement": 8, "rotation": 3}, token=ta)
    assert st == 200 and dup2["territory"]["id"] == ca["territory"]["id"], \
        f"a retry with different aim must not re-place the claim: {st} {dup2}"
    print("  duplicate claim replayed the stored result; no second payout")

    print("=== economy gates: a 20 m walk is not a run ===")
    tg, _ug = signup(f"gate_{SFX}")
    _, sg = call("POST", "/start-run", {}, token=tg)
    t0 = time.time()
    tiny = [
        {"lat": 1.31, "lon": 103.91, "t": t0 * 1000},
        {"lat": 1.31 + 20 / 111320.0, "lon": 103.91, "t": (t0 + 8) * 1000},
    ]
    st, te = call("POST", "/end-run", {"run_id": sg["run_id"], "points": tiny}, token=tg)
    assert st == 200, te
    assert te["tier"] == "unqualified_for_rewards", f"a 20 m walk must not qualify: {te}"
    assert te["coins_gained"] == 0 and te["energy_gained"] == 0, \
        f"unqualified activities must pay nothing: {te}"
    assert te["qualification_reason"], "an activity that earned nothing must say why"
    assert te["claim_eligible"] is False, te
    _, cg = call("GET", "/me/coins", token=tg)
    assert (cg.get("coins") or 0) == 0, f"a 20 m walk minted coins: {cg}"
    st, gone = call("POST", "/claim-territory", {"run_id": sg["run_id"]}, token=tg)
    assert st == 422, f"a 20 m walk must not be claimable: {st} {gone}"
    print(f"  20 m / 8 s: tier={te['tier']}, 0 coins, 0 energy, claim refused")
    print(f"  reason surfaced: \"{te['qualification_reason']}\"")

    # ...and a real run pays, scaled to its distance.
    rid_g, eg, _ = run_loop(tg, 1.3200 + OX, 103.7600 + OX)
    assert eg["coins_gained"] > 0 and eg["energy_gained"] > 0, eg
    assert eg["tier"] == "qualified_for_claim", eg
    print(f"  {eg['distance_m']:.0f} m run: +{eg['coins_gained']} coins, "
          f"+{eg['energy_gained']} energy, {eg['xp_gained']} XP")

    print("=== choose your attack: placement options ===")
    # The run earns a fixed area; WHERE it lands is the runner's move. Fresh
    # ground so the breakdown is pure new land and nothing gets carved.
    tp, _up = signup(f"aim_{SFX}")
    lat_p, lon_p = 1.3500 + OX, 103.7800 + OX
    rid_p, ep, _pts_p = run_loop(tp, lat_p, lon_p)
    opts = claim_options(tp, rid_p)
    ps = opts["placements"]
    assert ps, f"claim-options must offer at least one placement: {opts}"
    assert all(len(p["ring"]) >= 4 for p in ps), "every placement needs a drawable ring"
    # Same land wherever it goes — the choice is position, not size.
    areas = [p["area_m2"] for p in ps]
    assert max(areas) - min(areas) < max(areas) * 0.05, f"placements must cover equal land: {areas}"
    assert abs(max(areas) - ep["claim_area_m2"]) < ep["claim_area_m2"] * 0.1, \
        f"placement area should match the land earned: {max(areas)} vs {ep['claim_area_m2']}"
    # `held_m2` is what survives the carve, so it can only ever be smaller, and
    # its parts must add up to it.
    for p in ps:
        parts = p["new_m2"] + p["enemy_m2"] + p["mine_m2"] + p["ally_m2"]
        assert abs(parts - p["held_m2"]) < 1.0, f"held_m2 must be its own parts: {p}"
        assert p["held_m2"] <= p["area_m2"] + 1.0, f"held more than covered: {p}"
    # The grid is position × heading, laid out position-major, and complete.
    n_pos, n_rot = opts["placement_count"], opts["rotation_count"]
    assert len(ps) == n_pos * n_rot, f"grid must be complete: {len(ps)} vs {n_pos}×{n_rot}"
    for i, p in enumerate(ps):
        assert p["index"] == i and p["placement"] == i // n_rot and p["rotation"] == i % n_rot, \
            f"grid not position-major at {i}: {p}"
    if n_pos > 1:
        # Positions must actually be different places, or the choice is fake.
        assert ps[0]["ring"][0] != ps[(n_pos - 1) * n_rot]["ring"][0], \
            "placements must move along the route"
    if n_rot > 1:
        # ...and headings must actually turn it.
        assert ps[0]["ring"][0] != ps[1]["ring"][0], "rotations must turn the claim"
        assert ps[0]["rotation_deg"] == 0, "heading 0 must be the shape as it was run"
    assert 0 <= opts["default_index"] < len(ps), opts["default_index"]
    # Every move is priced, and the price follows what the move DOES.
    assert all(p["energy_cost"] > 0 for p in ps), "every placement must carry a cost"
    assert opts["first_claim_of_day"] is True, "this account has not claimed today"
    empties = [p for p in ps if p["action"] == "empty"]
    assert empties, f"a claim on open ground must read as 'empty': {set(p['action'] for p in ps)}"
    print(f"  actions offered: {sorted(set(p['action'] for p in ps))}; "
          f"costs {sorted(set(p['energy_cost'] for p in ps))} "
          f"(first claim of the day, half price)")
    # Indices the client made up must not land a claim off the route.
    st, bad = call("POST", "/claim-territory",
                   {"run_id": rid_p, "placement": 62, "rotation": 61}, token=tp)
    assert st == 200, f"out-of-range move should fall back, not fail: {st} {bad}"
    print(f"  {n_pos} positions × {n_rot} headings (window {opts['window_frac']:.2f}), "
          f"each ~{round(max(areas)):,} m²; out-of-range indices fell back safely")
    # Already claimed — the chooser must not offer a second move.
    st, gone = call("GET", f"/runs/{rid_p}/claim-options", token=tp)
    assert st == 409, f"claim-options after claiming should 409: {st} {gone}"

    print("=== circle claims (continued) ===")
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
    # A QUALIFYING run — right distance, right duration, right spread — that is
    # nonetheless mock-located. The shadow-flag has to be what excludes it, not
    # the economy gates: a spoof that simply fails to qualify would prove
    # nothing about whether flagged land stays hidden.
    rid_c, ec, pts_c = run_loop(tc, 1.3100, 103.8600, mocked=True,
                                expect_tier="shadow_flagged")
    assert ec["claim_radius_m"] > 0, "spoofer must see a normal success"
    assert ec["claim_eligible"] is True, "a flagged run must still look claimable"
    assert ec["qualification_reason"] is None, \
        f"a flagged run must not be told why: {ec['qualification_reason']}"
    assert ec["coins_gained"] == 0, "a flagged run must not pay out"
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
    _rid_x, endx, _ = run_loop(tb, 1.360, 103.80)
    assert endx["xp_gained"] > 0, f"xp not returned: {endx}"
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
