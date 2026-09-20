"""Economy stabilisation suite — qualification, entitlement, caps, idempotency.

Covers the verification matrix for the stabilisation pass:

  1  a 20 m activity earns nothing and cannot claim (but shows area it would earn)
  2  a 600 m / 5 min activity earns rewards but cannot claim (but shows area it would earn)
  3  a 1.2 km / 8 min activity does the full loop
  4  ten 1 km runs == one 10 km run in territorial entitlement
  5  three neutral claims, then a fourth is refused
  6  an attack still works after the neutral limit
  7  a reinforcement still works after the neutral limit
  8  daily coin/energy caps pay out partially, then nothing
  9  the Singapore game-day boundary
  10 duplicate /end-run replays and pays once
  11 duplicate /claim-territory replays and pays once
  12 concurrent claims produce exactly one territory
  13 a shadow-flagged run claims privately and burns no entitlement
  14 a pre-migration territory (no expires_at) still ages correctly
  15 the 90/270 geometry symmetry still holds

Boundary cases at 499/500 m, 999/1000 m, 239/240 s, 419/420 s and 699/700 m of
unique route are exercised as pure functions, where the thresholds actually
live — going through HTTP would test the GPS simulator's rounding, not the rule.

Run against a live server:  python test_economy.py [base_url]

The suite ends far more than ten runs a minute, so the server it points at
needs `RATE_LIMIT_END_RUN` relaxed (e.g. "1000/minute"). That is a property of
the harness, not of the rules being tested — the production limit is exactly
what stops this pace of submission for real.
"""

import math
import sys
import threading
import time
from datetime import datetime, timedelta

from app import economy
from app.config import settings
from app.geospatial import claim_area_m2, route_unique_length_m

import smoke_test as S

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' — ' + str(detail)) if detail else ''}")
    return ok


def eq(label, got, want, tol=0.0):
    return check(label, abs(got - want) <= tol, f"got {got:,.2f} want {want:,.2f}")


# ---------------------------------------------------------------------------
# Pure-function cases: the thresholds themselves
# ---------------------------------------------------------------------------


def test_boundaries():
    print("\n[1-3] qualification tiers at their exact boundaries")
    FAR, LONG, UNIQ = 2000.0, 900.0, 5000.0  # comfortably past whichever bar
    T = economy.run_tier

    # Reward bar: distance
    check("499 m is unqualified", T(499, LONG, UNIQ) == economy.UNQUALIFIED)
    check("500 m clears the reward bar", T(500, LONG, UNIQ) != economy.UNQUALIFIED)
    # Reward bar: duration
    check("239 s is unqualified", T(FAR, 239, UNIQ) == economy.UNQUALIFIED)
    check("240 s clears the reward bar", T(FAR, 240, UNIQ) != economy.UNQUALIFIED)
    # Claim bar: distance
    check("999 m is rewards-only", T(999, LONG, UNIQ) == economy.REWARDED)
    check("1000 m is claim-qualified", T(1000, LONG, UNIQ) == economy.CLAIMABLE)
    # Claim bar: duration
    check("419 s is rewards-only", T(FAR, 419, UNIQ) == economy.REWARDED)
    check("420 s is claim-qualified", T(FAR, 420, UNIQ) == economy.CLAIMABLE)
    # Claim bar: unique route
    check("699 m unique is rewards-only", T(FAR, LONG, 699) == economy.REWARDED)
    check("700 m unique is claim-qualified", T(FAR, LONG, 700) == economy.CLAIMABLE)
    # Anti-cheat
    check("a flagged run is its own tier",
          T(FAR, LONG, UNIQ, verified=False) == economy.SHADOW_FLAGGED)

    # The two reasons must be DIFFERENT things: an activity that earned coins
    # but cannot claim must not be described as having earned nothing.
    check("rewards-only reports a claim reason, not a reward one",
          economy.gate_reason_for(economy.REWARDED, 999, LONG, UNIQ)
          == economy.REASON_MIN_CLAIM_DISTANCE)
    check("unqualified reports a reward reason",
          economy.gate_reason_for(economy.UNQUALIFIED, 499, LONG, UNIQ)
          == economy.REASON_MIN_REWARD_DISTANCE)
    check("a flagged run that met every bar is told nothing",
          economy.gate_reason_for(economy.SHADOW_FLAGGED, FAR, LONG, UNIQ) is None)


def test_split_entitlement():
    print("\n[4] splitting a run must not multiply territory")
    ten_ones = 0.0
    before = 0.0
    for _ in range(10):
        ten_ones += economy.entitled_area_m2(before, 1000.0)
        before += 1000.0
    one_ten = economy.entitled_area_m2(0.0, 10_000.0)
    eq("ten 1 km runs == one 10 km run", ten_ones, one_ten, tol=1.0)
    check("...and that is the tapered figure, not ten fresh curves",
          ten_ones < 10 * claim_area_m2(1000.0),
          f"{ten_ones:,.0f} vs {10 * claim_area_m2(1000.0):,.0f} untapered")

    # Arbitrary splits of the same day must agree too.
    for parts in ([5000, 5000], [2000, 3000, 5000], [500] * 20):
        total, run_before = 0.0, 0.0
        for m in parts:
            total += economy.entitled_area_m2(run_before, m)
            run_before += m
        eq(f"split {parts[:3]}{'...' if len(parts) > 3 else ''} == one 10 km",
           total, one_ten, tol=1.0)


def test_unique_route():
    print("\n[boundary] unique route length rejects repetition")
    # Forty laps of a 40 m box: lots of distance, almost no ground.
    box, lat0, lon0 = [], 1.3521, 103.8198
    per_deg = 111320.0 * math.cos(math.radians(lat0))
    for _ in range(40):
        for dx, dy in ((0, 0), (40, 0), (40, 40), (0, 40)):
            box.append((lon0 + dx / per_deg, lat0 + dy / 111320.0))
    laps_unique = route_unique_length_m(box)
    straight_line = [(lon0 + i * 100 / per_deg, lat0) for i in range(30)]
    line_unique = route_unique_length_m(straight_line)
    check("40 laps of a 40 m box fall short of the unique bar",
          laps_unique < settings.min_unique_route_length_m, f"{laps_unique:,.0f} m")
    check("a 2.9 km straight line clears it",
          line_unique >= settings.min_unique_route_length_m, f"{line_unique:,.0f} m")


def test_day_boundary():
    print("\n[9] the game day rolls at Singapore midnight, not UTC")
    # 16:00 UTC == 00:00 SGT: the boundary itself.
    just_after = datetime(2026, 8, 5, 16, 0, 1)
    just_before = datetime(2026, 8, 5, 15, 59, 59)
    check("15:59 UTC belongs to the previous game day",
          economy.day_start_utc(just_before) == datetime(2026, 8, 4, 16, 0),
          economy.day_start_utc(just_before))
    check("16:00 UTC starts a new game day",
          economy.day_start_utc(just_after) == datetime(2026, 8, 5, 16, 0),
          economy.day_start_utc(just_after))
    check("a UTC-midnight run is NOT a boundary",
          economy.day_start_utc(datetime(2026, 8, 5, 0, 30))
          == economy.day_start_utc(datetime(2026, 8, 4, 20, 0)))


def test_reward_curves():
    print("\n[8] reward curves and their daily caps")
    eq("1 km pays 18 coins", economy.run_coins(1000), 18)
    eq("10 km pays 90 coins", economy.run_coins(10000), 90)
    eq("1 km pays 4 energy", economy.run_energy(1000), 4)
    eq("12 km pays the 15 energy ceiling", economy.run_energy(12000), 15)
    check("an unqualified tier pays nothing", not economy.rewards_earned(economy.UNQUALIFIED))
    check("a flagged tier pays nothing", not economy.rewards_earned(economy.SHADOW_FLAGGED))
    check("rewards-only still pays", economy.rewards_earned(economy.REWARDED))


# ---------------------------------------------------------------------------
# Live cases
# ---------------------------------------------------------------------------


_ENGINE = None


def _scalar(sql_text, params):
    """One value straight from the database.

    Some invariants are not observable through the API — "was this reward
    granted once or twice" is about the ledger, not about a balance — so the
    tests that check them read the ledger.
    """
    global _ENGINE
    from sqlalchemy import create_engine, text as sql
    if _ENGINE is None:
        _ENGINE = create_engine(settings.database_url)
    with _ENGINE.connect() as conn:
        return conn.execute(sql(sql_text), params).scalar()


def _user_id(token):
    return S.call("GET", "/me", token=token)[1]["id"]


def straight_points(lat, lon, metres, n=60, pace_s_per_km=420, t0=None):
    total = (metres / 1000.0) * pace_s_per_km
    t0 = t0 if t0 is not None else time.time() - total
    per_deg = 111320.0 * math.cos(math.radians(lat))
    return [
        {"lat": lat, "lon": lon + (metres * i / (n - 1)) / per_deg,
         "t": (t0 + total * i / (n - 1)) * 1000}
        for i in range(n)
    ]


def do_run(token, lat, lon, metres, duration_s=None, **kw):
    """A straight run of a given length, ended and ready."""
    dur = duration_s if duration_s is not None else max(metres * 0.42, 460)
    _, started = S.call(
        "POST", "/start-run",
        {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()},
        token=token,
    )
    rid = started["run_id"]
    pace = (dur / (metres / 1000.0)) if metres else 600
    st, end = S.call(
        "POST", "/end-run",
        {"run_id": rid, "points": straight_points(lat, lon, metres, pace_s_per_km=pace, **kw)},
        token=token,
    )
    assert st == 200, end
    return rid, end


def test_live_tiers(base_lat, base_lon):
    print("\n[1-3] live: the three tiers end to end")
    tok, _ = S.signup(f"tier_{S.SFX}")

    _, tiny = do_run(tok, base_lat, base_lon, 20, duration_s=8)
    check("20 m: unqualified", tiny["tier"] == economy.UNQUALIFIED, tiny["tier"])
    check("20 m: pays nothing",
          tiny["coins_gained"] == 0 and tiny["energy_gained"] == 0 and tiny["xp_gained"] == 0)
    check("20 m: says why", bool(tiny["qualification_reason"]), tiny["qualification_reason"])
    # Now short runs show the area they would earn if they met requirements
    check("20 m: shows calculated area based on distance", tiny["claim_area_m2"] > 0, tiny["claim_area_m2"])

    rid_r, rewarded = do_run(tok, base_lat + 0.01, base_lon, 600, duration_s=300)
    check("600 m / 5 min: rewards only",
          rewarded["tier"] == economy.REWARDED, rewarded["tier"])
    check("600 m / 5 min: pays coins and XP",
          rewarded["coins_gained"] > 0 and rewarded["xp_gained"] > 0, rewarded)
    check("600 m / 5 min: not claim eligible", rewarded["claim_eligible"] is False)
    check("600 m / 5 min: claim reason is about CLAIMING",
          rewarded["qualification_reason"] == economy.REASON_MIN_CLAIM_DISTANCE,
          rewarded["qualification_reason"])
    # Rewarded runs now show the area they would earn if they met claim requirements
    check("600 m / 5 min: shows calculated area based on distance", rewarded["claim_area_m2"] > 0, rewarded["claim_area_m2"])
    st, refused = S.call("POST", "/claim-territory", {"run_id": rid_r}, token=tok)
    check("600 m / 5 min: claim refused", st == 422, f"{st} {refused}")

    rid_c, full = do_run(tok, base_lat + 0.02, base_lon, 1200, duration_s=480)
    check("1.2 km / 8 min: claim qualified",
          full["tier"] == economy.CLAIMABLE, full["tier"])
    check("1.2 km / 8 min: claim eligible and unexplained",
          full["claim_eligible"] and full["qualification_reason"] is None)
    check("1.2 km / 8 min: earns land", full["claim_area_m2"] > 0, full["claim_area_m2"])
    return tok, rid_c


def test_live_split(base_lat, base_lon):
    print("\n[4] live: ten 1 km runs vs one 10 km run")
    t_many, _ = S.signup(f"many_{S.SFX}")
    t_one, _ = S.signup(f"one_{S.SFX}")
    # 1020 m nominal, not 1000: the simulator lays points on a flat
    # approximation and the server measures them geodesically, so a nominal
    # 1000 m arrives as 999.998 m and lands the wrong side of the claim bar.
    total_many, distance_many = 0.0, 0.0
    for i in range(10):
        _, end = do_run(t_many, base_lat + 0.03 + i * 0.004, base_lon, 1020, duration_s=460)
        check(f"  1 km run {i + 1} qualified", end["tier"] == economy.CLAIMABLE, end["tier"])
        total_many += end["claim_area_m2"]
        distance_many += end["distance_m"]
    _, big = do_run(t_one, base_lat + 0.08, base_lon, 10200, duration_s=4200)
    # Compared against the curve of the distance ACTUALLY recorded, so the
    # test measures the entitlement rule and not the simulator's rounding.
    expected = economy.entitled_area_m2(0.0, distance_many)
    eq("ten 1 km runs == the curve for their total distance", total_many, expected, tol=1.0)
    eq("...and one 10 km run of the same distance matches",
       big["claim_area_m2"], economy.entitled_area_m2(0.0, big["distance_m"]), tol=1.0)
    eq("the two totals agree", total_many, big["claim_area_m2"],
       tol=max(2000.0, big["claim_area_m2"] * 0.03))


def test_live_neutral_limit(base_lat, base_lon):
    """The neutral expansion ration, whichever way it is configured.

    It is OFF by default since 2026-08-10 — Energy is what caps claiming, and
    this was a second, harsher cap on the same decision. The test follows the
    configuration rather than asserting one answer, so switching it back on
    with `MAX_NEUTRAL_CLAIMS_PER_GAME_DAY` does not turn the suite red.
    """
    cap = settings.max_neutral_claims_per_game_day
    active = economy.neutral_limit_active()
    print(f"\n[5-7] live: the neutral expansion limit ({'cap ' + str(cap) if active else 'OFF'})")
    tok, _ = S.signup(f"neut_{S.SFX}")

    def claim_neutral(i):
        rid, _ = do_run(tok, base_lat + 0.10 + i * 0.01, base_lon, 1200, duration_s=480)
        opts = S.call("GET", f"/runs/{rid}/claim-options", token=tok)[1]
        p = opts["placements"][opts["default_index"]]
        st, res = S.call("POST", "/claim-territory",
                         {"run_id": rid, "placement": p["placement"], "rotation": p["rotation"]},
                         token=tok)
        return rid, opts, st, res

    if not active:
        # Energy is the only gate. Take open ground more times than the old
        # ration ever allowed and check nothing refuses it for being neutral.
        landed = 0
        for i in range(5):
            _rid, _opts, st, res = claim_neutral(i)
            if st == 200 and res.get("action") == economy.ACTION_EMPTY:
                landed += 1
            elif st == 402:
                # Ran out of Energy, which is the point — that IS the cap.
                check(f"neutral claim {i + 1} stopped by Energy, not by a ration", True)
                break
            else:
                check(f"neutral claim {i + 1} refused for something other than Energy",
                      False, f"{st} {res}")
                break
        check("more neutral claims land than the old ration allowed",
              landed > 3 or landed >= 4, landed)
        rid_n, opts_n, _st, _res = claim_neutral(9)
        neutral = [p for p in opts_n["placements"] if p["action"] == economy.ACTION_EMPTY]
        check("no placement is ever closed for the neutral reason",
              all(p.get("unavailable_reason") != economy.REASON_NEUTRAL_LIMIT
                  for p in opts_n["placements"]),
              next((p["unavailable_reason"] for p in opts_n["placements"]
                    if p.get("unavailable_reason") == economy.REASON_NEUTRAL_LIMIT), "none"))
        return tok

    claimed = 0
    for i in range(cap):
        _rid, _opts, st, res = claim_neutral(i)
        if st == 200 and res.get("action") == economy.ACTION_EMPTY:
            claimed += 1
            check(f"neutral claim {claimed} allowed, {res['neutral_claims_remaining']} left",
                  True)
    check(f"{cap} neutral claims landed", claimed == cap, claimed)

    # One past the cap: refused, and nothing consumed.
    rid4, _ = do_run(tok, base_lat + 0.14, base_lon, 1200, duration_s=480)
    opts4 = S.call("GET", f"/runs/{rid4}/claim-options", token=tok)[1]
    check("options report no neutral expansions left",
          opts4["neutral_claims_remaining"] == 0, opts4["neutral_claims_remaining"])
    neutral = [p for p in opts4["placements"] if p["action"] == economy.ACTION_EMPTY]
    check("options mark neutral placements unavailable, with the reason",
          bool(neutral) and not neutral[0]["available"]
          and neutral[0]["unavailable_reason"] == economy.REASON_NEUTRAL_LIMIT,
          neutral[0]["unavailable_reason"] if neutral else "no neutral placement")
    energy_before = opts4["energy"]
    st, refused = S.call("POST", "/claim-territory",
                         {"run_id": rid4, "placement": neutral[0]["placement"],
                          "rotation": neutral[0]["rotation"]}, token=tok)
    check("the expansion past the cap is refused", st == 409, f"{st} {refused}")
    _, en_after = S.call("GET", "/me/energy", token=tok)
    check("a refused expansion costs no energy",
          en_after["energy"] >= energy_before, f"{energy_before} -> {en_after['energy']}")
    st, still = S.call("GET", f"/runs/{rid4}/claim-options", token=tok)
    check("...and does not consume the run", st == 200, st)

    # [7] Reinforcement is still available: re-run the FIRST claim's ground.
    rid_re, _ = do_run(tok, base_lat + 0.10, base_lon, 1200, duration_s=480)
    opts_re = S.call("GET", f"/runs/{rid_re}/claim-options", token=tok)[1]
    reinforce = [p for p in opts_re["placements"] if p["action"] == economy.ACTION_REINFORCE]
    if reinforce:
        st, res = S.call("POST", "/claim-territory",
                         {"run_id": rid_re, "placement": reinforce[0]["placement"],
                          "rotation": reinforce[0]["rotation"]}, token=tok)
        check("reinforcement still allowed past the neutral limit", st == 200, f"{st} {res}")
    else:
        check("reinforcement placement offered past the neutral limit", False,
              "no reinforce placement — geometry did not re-cover own land")
    return tok


def test_live_attack_past_limit(base_lat, base_lon, blocked_token):
    print("\n[6] live: attacking still works past the neutral limit")
    # A victim plants land on a line the blocked player will run.
    tv, uv = S.signup(f"vic2_{S.SFX}")
    lat, lon = base_lat + 0.20, base_lon
    rid_v, _ = do_run(tv, lat, lon, 1500, duration_s=600)
    S.call("POST", "/claim-territory", {"run_id": rid_v}, token=tv)

    rid_a, _ = do_run(blocked_token, lat, lon, 1500, duration_s=460)
    opts = S.call("GET", f"/runs/{rid_a}/claim-options", token=blocked_token)[1]
    attacks = [p for p in opts["placements"]
               if p["action"] in (economy.ACTION_ATTACK, economy.ACTION_FORTIFIED)]
    if not attacks:
        check("an attack placement was available past the neutral limit", False,
              f"actions offered: {sorted(set(p['action'] for p in opts['placements']))}")
        return
    check("attack placements stay available past the neutral limit",
          attacks[0]["available"], attacks[0]["unavailable_reason"])
    st, res = S.call("POST", "/claim-territory",
                     {"run_id": rid_a, "placement": attacks[0]["placement"],
                      "rotation": attacks[0]["rotation"]}, token=blocked_token)
    check("the attack lands", st == 200, f"{st} {res}")


def test_idempotency(base_lat, base_lon):
    print("\n[10-11] live: duplicate requests pay once")
    tok, _ = S.signup(f"idem_{S.SFX}")
    dur = 480
    _, started = S.call(
        "POST", "/start-run",
        {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()},
        token=tok,
    )
    rid = started["run_id"]
    pts = straight_points(base_lat + 0.30, base_lon, 1200, pace_s_per_km=400)
    st1, e1 = S.call("POST", "/end-run", {"run_id": rid, "points": pts}, token=tok)
    _, coins1 = S.call("GET", "/me/coins", token=tok)
    st2, e2 = S.call("POST", "/end-run", {"run_id": rid, "points": pts}, token=tok)
    _, coins2 = S.call("GET", "/me/coins", token=tok)
    check("a repeated end-run returns 200, not 409", st2 == 200, f"{st2} {e2}")
    check("a repeated end-run replays the same rewards",
          e2["coins_gained"] == e1["coins_gained"] and e2["xp_gained"] == e1["xp_gained"],
          f"{e1['coins_gained']}/{e1['xp_gained']} vs {e2['coins_gained']}/{e2['xp_gained']}")
    check("a repeated end-run is marked as a replay", e2.get("replayed") is True)
    check("a repeated end-run pays no coins twice",
          coins2["coins"] == coins1["coins"], f"{coins1['coins']} -> {coins2['coins']}")
    check("a repeated end-run keeps the same claim area",
          abs(e2["claim_area_m2"] - e1["claim_area_m2"]) < 1.0)

    # XP isn't on /me, and checking a balance would prove nothing anyway — the
    # question is whether the GRANT happened twice, so ask the ledger that
    # enforces it.
    xp_before = _scalar("SELECT COALESCE(xp, 0) FROM users WHERE id = :i",
                        {"i": _user_id(tok)})
    st, c1 = S.call("POST", "/claim-territory", {"run_id": rid}, token=tok)
    assert st == 200, c1
    st, c2 = S.call("POST", "/claim-territory", {"run_id": rid}, token=tok)
    xp_after = _scalar("SELECT COALESCE(xp, 0) FROM users WHERE id = :i", {"i": _user_id(tok)})
    check("a repeated claim replays", st == 200 and c2["territory"]["id"] == c1["territory"]["id"],
          f"{st}")
    check("a repeated claim pays no XP twice",
          xp_after == xp_before + c1["xp_gained"],
          f"{xp_before} + {c1['xp_gained']} vs {xp_after}")
    for kind in ("coins", "energy", "run_xp", "claim_xp"):
        n = _scalar("SELECT COUNT(*) FROM reward_grants WHERE key = :k",
                    {"k": f"run:{rid}:{kind}"})
        check(f"exactly one {kind} grant exists for the run", n <= 1, n)
    steals = _scalar("SELECT COUNT(*) FROM territory_steals WHERE run_id = :r", {"r": rid})
    check("a repeated claim writes no second rivalry entry", steals == 0, steals)


def test_concurrency(base_lat, base_lon):
    print("\n[12] live: concurrent requests")
    tok, _ = S.signup(f"conc_{S.SFX}")

    # Two simultaneous end-run calls for one run.
    dur = 480
    _, started = S.call(
        "POST", "/start-run",
        {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()},
        token=tok,
    )
    rid = started["run_id"]
    pts = straight_points(base_lat + 0.34, base_lon, 1200, pace_s_per_km=400)
    results = []
    lock = threading.Lock()

    def end_it():
        r = S.call("POST", "/end-run", {"run_id": rid, "points": pts}, token=tok)
        with lock:
            results.append(r)

    threads = [threading.Thread(target=end_it) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    oks = [r for r in results if r[0] == 200]
    check("both concurrent end-runs answer 200", len(oks) == 2, [r[0] for r in results])
    coins = {r[1]["coins_gained"] for r in oks}
    check("they agree on the payout", len(coins) == 1, coins)
    _, ledger = S.call("GET", "/me/coins", token=tok)
    check("only one payout landed",
          ledger["coins"] == oks[0][1]["coins_gained"], ledger["coins"])

    # Two simultaneous claims for one run, aimed differently.
    claims = []

    def claim_it(placement, rotation):
        r = S.call("POST", "/claim-territory",
                   {"run_id": rid, "placement": placement, "rotation": rotation}, token=tok)
        with lock:
            claims.append(r)

    threads = [
        threading.Thread(target=claim_it, args=(0, 0)),
        threading.Thread(target=claim_it, args=(8, 4)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    ok_claims = [c for c in claims if c[0] == 200]
    check("both concurrent claims answer 200", len(ok_claims) == 2,
          [(c[0], c[1]) for c in claims if c[0] != 200])
    ids = {c[1]["territory"]["id"] for c in ok_claims}
    check("they resolve to ONE territory", len(ids) == 1, ids)
    uid = _user_id(tok)
    owned = _scalar("SELECT COUNT(*) FROM territories WHERE user_id = :u", {"u": uid})
    check("exactly one territory exists for this user", owned == 1, owned)
    energy_now = _scalar("SELECT COALESCE(energy, 0) FROM users WHERE id = :u", {"u": uid})
    check("energy never went negative", energy_now >= 0, energy_now)
    charged = _scalar(
        "SELECT COUNT(*) FROM runs WHERE id = :r AND claim_action IS NOT NULL", {"r": rid}
    )
    check("the run records exactly one claim action", charged == 1, charged)


def test_shadow_entitlement(base_lat, base_lon):
    print("\n[13] live: a flagged run burns no real entitlement")
    tok, _ = S.signup(f"shadow_{S.SFX}")
    dur = 600
    _, started = S.call(
        "POST", "/start-run",
        {"started_at": (datetime.utcnow() - timedelta(seconds=dur)).isoformat()},
        token=tok,
    )
    pts = straight_points(base_lat + 0.40, base_lon, 5000, pace_s_per_km=120)
    for p in pts:
        p["mocked"] = True
    st, flagged = S.call("POST", "/end-run",
                         {"run_id": started["run_id"], "points": pts}, token=tok)
    check("a mocked run reports its own tier",
          flagged["tier"] == economy.SHADOW_FLAGGED, flagged["tier"])
    check("a flagged run still looks claimable", flagged["claim_eligible"] is True)
    check("a flagged run pays nothing",
          flagged["coins_gained"] == 0 and flagged["energy_gained"] == 0)

    # The honest run that follows must get the FULL first slice of the day.
    _, honest = do_run(tok, base_lat + 0.46, base_lon, 5000, duration_s=2100)
    expected = economy.entitled_area_m2(0.0, honest["distance_m"])
    eq("a later honest run gets the untouched entitlement",
       honest["claim_area_m2"], expected, tol=max(500.0, expected * 0.02))


def test_legacy_expiry():
    print("\n[14] a pre-migration territory still ages")
    from sqlalchemy import create_engine, text as sql
    engine = create_engine(settings.database_url)
    with engine.begin() as conn:
        row = conn.execute(sql("SELECT id FROM territories LIMIT 1")).fetchone()
        if not row:
            check("a territory exists to test the fallback", False, "none in the database")
            return
        tid = row[0]
        # Null the stored expiry, as rows written before 0022 have it.
        conn.execute(sql("UPDATE territories SET expires_at = NULL WHERE id = :i"), {"i": tid})
        alive = conn.execute(sql(
            "SELECT now() < COALESCE(expires_at, created_at + make_interval("
            "secs => GREATEST(strength, 0.1) * :lp * 86400)) FROM territories WHERE id = :i"
        ), {"i": tid, "lp": settings.territory_life_days_per_strength}).scalar()
        check("a row with no expires_at is aged by the strength fallback", alive is True, alive)
        # And an ancient one is dead by the same rule.
        conn.execute(sql(
            "UPDATE territories SET created_at = now() - interval '60 days' WHERE id = :i"
        ), {"i": tid})
        dead = conn.execute(sql(
            "SELECT now() < COALESCE(expires_at, created_at + make_interval("
            "secs => GREATEST(strength, 0.1) * :lp * 86400)) FROM territories WHERE id = :i"
        ), {"i": tid, "lp": settings.territory_life_days_per_strength}).scalar()
        check("a 60-day-old row with no expires_at has expired", dead is False, dead)
        conn.execute(sql("DELETE FROM territories WHERE id = :i"), {"i": tid})


def main():
    if len(sys.argv) > 1:
        S.BASE = sys.argv[1]
    print(f"economy suite against {S.BASE}")

    test_boundaries()
    test_split_entitlement()
    test_unique_route()
    test_day_boundary()
    test_reward_curves()

    OX = (int(S.SFX) % 300) * 0.0004
    lat, lon = 1.2000 + OX, 103.6500 + OX

    tok, _rid = test_live_tiers(lat, lon)
    test_live_split(lat, lon)
    blocked = test_live_neutral_limit(lat, lon)
    test_live_attack_past_limit(lat, lon, blocked)
    test_idempotency(lat, lon)
    test_concurrency(lat, lon)
    test_shadow_entitlement(lat, lon)
    test_legacy_expiry()

    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        for f in FAILURES:
            print(f"  FAILED: {f}")
        sys.exit(1)
    print("ALL ECONOMY CHECKS PASSED")


if __name__ == "__main__":
    main()
