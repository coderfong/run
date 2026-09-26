"""Club runs as a first-class thing: one eligibility rule, a named verdict for
every comparison, and the group written down.

    .venv/Scripts/python.exe -m pytest test_club_run_sessions.py

No database. The geometry and the session SQL are exercised against a real
PostGIS in test_club_runs_db.py; this file holds the rules to the code.
"""

import inspect
import logging
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app import club_runs, economy
from app.config import settings
from app.routes import runs as runs_routes


def _trace(offset_s=0, lon_shift=0.0, reverse=False, seconds=1200):
    pts = [[t, 1.3, 103.8 + t / 100000 + lon_shift] for t in range(0, seconds + 1, 5)]
    if reverse:
        lons = [p[2] for p in pts][::-1]
        pts = [[p[0], p[1], lon] for p, lon in zip(pts, lons)]
    return [[t + offset_s, lat, lon] for t, lat, lon in pts]


def _row(**kw):
    base = dict(
        run_id="theirs", user_id="mate", distance_m=5000.0,
        start_delta_s=30.0, overlap_frac=0.95,
        mine_shared_m=4800.0, theirs_shared_m=4700.0,
        mine_len_m=5000.0, theirs_len_m=5000.0,
        mine_trace=_trace(), theirs_trace=_trace(),
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ---------------------------------------------------------------------------
# 1. ONE eligibility definition
# ---------------------------------------------------------------------------

def _run(**kw):
    base = dict(verified=True, ended_at=datetime.utcnow(), tier=economy.CLAIMABLE)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.parametrize("tier", [economy.REWARDED, economy.CLAIMABLE])
def test_rewarded_runs_are_eligible(tier):
    assert club_runs.eligible(_run(tier=tier))


@pytest.mark.parametrize("tier", [economy.UNQUALIFIED, economy.SHADOW_FLAGGED])
def test_runs_below_the_reward_bar_are_not(tier):
    """A run too short to pay its own runner cannot pay the club either,
    whichever side of the match it is on."""
    assert not club_runs.eligible(_run(tier=tier))


def test_unverified_or_unfinished_runs_are_not():
    assert not club_runs.eligible(_run(verified=False))
    assert not club_runs.eligible(_run(ended_at=None))


def test_a_null_tier_reads_as_claimable_like_the_replay_does():
    """Bot runs and pre-0023 rows carry no tier. `_end_run_replay` reads that
    as CLAIMABLE; matching must use the same convention or the seeded world
    silently stops producing club land."""
    assert club_runs.eligible(_run(tier=None))
    assert f"COALESCE(r.tier, '{economy.CLAIMABLE}')" in club_runs.eligible_sql("r")


def test_the_sql_and_python_rules_name_the_same_tiers():
    sql = club_runs.eligible_sql("r")
    for tier in (economy.UNQUALIFIED, economy.REWARDED, economy.CLAIMABLE, economy.SHADOW_FLAGGED):
        assert (f"'{tier}'" in sql) == economy.rewards_earned(tier), tier
    assert "r.verified" in sql and "r.ended_at IS NOT NULL" in sql


def test_both_sides_of_the_probe_use_the_rule():
    sql = club_runs.partner_sql()
    assert club_runs.eligible_sql("r") in sql
    # The runner's own run, inside the `mine` CTE (unaliased).
    assert "verified AND ended_at IS NOT NULL AND COALESCE(tier," in sql


def test_the_credit_sync_uses_the_rule():
    """A partner that could never be logged now can never be paid either."""
    assert club_runs.eligible_sql("r") in club_runs._SYNC_SQL


def test_end_run_and_the_claim_ask_the_same_question():
    """The drift this replaces: /end-run gated on verified AND the reward
    bar, the claim on verified only."""
    end_src = inspect.getsource(runs_routes.end_run)
    claim_src = inspect.getsource(runs_routes.claim_territory)
    assert "club_runs.eligible(run)" in end_src
    assert "club_runs.eligible(run)" in claim_src
    assert "if run.verified:\n        club_id" not in claim_src


def test_both_responses_carry_the_same_status():
    assert "safe_club_run_status(db, run, user.id, user.clan_id)" in inspect.getsource(runs_routes.end_run)
    assert "safe_club_run_status(db, run, user.id, user.clan_id)" in inspect.getsource(runs_routes.claim_territory)
    assert "club_run=safe_club_run_status" in inspect.getsource(runs_routes._end_run_replay)


# ---------------------------------------------------------------------------
# 2. every comparison gets a named verdict
# ---------------------------------------------------------------------------

def test_two_runners_side_by_side_qualify():
    v = club_runs.judge(_row())
    assert v["ok"] and v["reason"] == club_runs.REASON_QUALIFIED
    assert v["temporal_proximity_ratio"] >= settings.club_run_min_shared_frac


def test_starting_too_far_apart_is_named():
    v = club_runs.judge(_row(start_delta_s=settings.club_run_time_grace_s + 1))
    assert not v["ok"] and v["reason"] == club_runs.REASON_START_DELTA


def test_too_little_time_overlap_is_named():
    v = club_runs.judge(_row(overlap_frac=0.4))
    assert v["reason"] == club_runs.REASON_DURATION_OVERLAP


def test_a_short_accidental_overlap_fails_on_the_route():
    """A clubmate's 2 km loop inside a 10 km run: fine from the short side,
    nowhere near 60% from the long side."""
    v = club_runs.judge(_row(mine_shared_m=2000, theirs_shared_m=2000,
                             mine_len_m=10000, theirs_len_m=2050))
    assert v["reason"] == club_runs.REASON_ROUTE_OVERLAP


def test_a_tiny_shared_loop_fails_on_distance():
    v = club_runs.judge(_row(mine_shared_m=300, theirs_shared_m=300,
                             mine_len_m=300, theirs_len_m=300))
    assert v["reason"] == club_runs.REASON_SHARED_DISTANCE


def test_same_route_opposite_directions_fails_on_time_proximity():
    v = club_runs.judge(_row(theirs_trace=_trace(reverse=True)))
    assert v["reason"] == club_runs.REASON_TEMPORAL_PROXIMITY


def test_same_route_minutes_apart_fails_on_time_proximity():
    v = club_runs.judge(_row(theirs_trace=_trace(offset_s=180)))
    assert v["reason"] == club_runs.REASON_TEMPORAL_PROXIMITY


def test_an_old_run_with_no_trace_fails_safely():
    v = club_runs.judge(_row(theirs_trace=None))
    assert not v["ok"] and v["reason"] == club_runs.REASON_NO_TRACE


def test_a_gps_gap_earns_no_shared_time():
    gappy = [p for p in _trace() if not (200 <= p[0] <= 800)]
    assert club_runs.together_ratio(_trace(), gappy) < settings.club_run_min_shared_frac


def test_thresholds_are_unchanged():
    """Observability first; the anti-cheat numbers move only on evidence."""
    assert settings.club_run_path_tolerance_m == 35.0
    assert settings.club_run_min_shared_frac == 0.60
    assert settings.club_run_min_shared_m == 400.0
    assert settings.club_run_time_grace_s == 600
    assert settings.club_run_min_partners == 1


def test_the_diagnostic_radius_only_widens_what_is_looked_at():
    """Wider than the tolerance so near misses get a verdict, but a pair that
    never comes within the tolerance shares no metres and still fails."""
    assert settings.club_run_diagnostic_radius_m >= settings.club_run_path_tolerance_m
    v = club_runs.judge(_row(mine_shared_m=0, theirs_shared_m=0))
    assert v["reason"] == club_runs.REASON_ROUTE_OVERLAP


def test_joining_after_the_run_began_is_still_excluded():
    sql = club_runs.partner_sql()
    assert "cm.joined_at <= r.started_at" in sql
    assert "mine_cm.joined_at <= mine.started_at" in sql


class _Db:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, statement, params=None):
        return SimpleNamespace(fetchall=lambda: self.rows)


def test_each_comparison_is_logged_with_its_reason(caplog):
    caplog.set_level(logging.INFO, logger="app.club_runs")
    db = _Db([_row(run_id="good"), _row(run_id="late", theirs_trace=_trace(offset_s=240))])
    found = club_runs.partners_for(db, "mine", "me", "clan")
    assert [p["run_id"] for p in found] == ["good"]
    lines = [r.getMessage() for r in caplog.records if "CLUB_RUN_MATCH" in r.getMessage()]
    assert len(lines) == 2
    assert any("run_b=good" in l and "result=QUALIFIED" in l for l in lines)
    assert any("run_b=late" in l and "reason=TEMPORAL_PROXIMITY" in l for l in lines)
    assert all("run_a=mine" in l for l in lines)


def test_a_partner_carries_its_measured_shared_metres():
    found = club_runs.partners_for(_Db([_row()]), "mine", "me", "clan")
    assert found[0]["shared_m"] == 4700.0


# ---------------------------------------------------------------------------
# 3. the group is written down
# ---------------------------------------------------------------------------

class _LogDb:
    def __init__(self, rows, already=()):
        self.rows = rows
        self.already = set(already)
        self.inserted = []
        self.statements = []

    def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}
        self.statements.append((sql, params))
        if "INSERT INTO club_run_logs" in sql:
            new = params["run_id"] not in self.already
            self.already.add(params["run_id"])
            self.inserted.append(params)
            return SimpleNamespace(fetchone=lambda: (new,))
        if "club_run_sessions" in sql or "SET session_id" in sql:
            return SimpleNamespace(fetchall=lambda: [], scalar=lambda: "s1")
        if "pg_advisory_xact_lock" in sql:
            return SimpleNamespace()
        return SimpleNamespace(fetchall=lambda: self.rows)


def test_a_three_runner_group_is_one_session_with_everybody_in_it():
    db = _LogDb([_row(run_id="b", user_id="ub"), _row(run_id="c", user_id="uc")])
    clan, partners, newly = club_runs.log_run(db, "a", "ua", "clan")
    assert clan == "clan" and {p["run_id"] for p in partners} == {"b", "c"}
    assert {p["run_id"] for p in newly} == {"b", "c"}
    attach = [p for s, p in db.statements if "SET session_id = CAST(:sid" in s and "clan_id" in s]
    assert attach and set(attach[-1]["ids"]) == {"a", "b", "c"}


def test_logging_is_serialised_per_club():
    db = _LogDb([_row()])
    club_runs.log_run(db, "a", "ua", "clan")
    locks = [p for s, p in db.statements if "pg_advisory_xact_lock" in s]
    assert locks == [{"k": "club_run:clan"}]


def test_a_later_finisher_reuses_an_existing_session_and_merges_the_rest():
    src = inspect.getsource(club_runs.attach_session)
    assert "ORDER BY s.created_at" in src          # the oldest survives
    assert "DELETE FROM club_run_sessions" in src   # the others are folded in


def test_a_second_sighting_never_pays_again():
    db = _LogDb([_row(run_id="b")], already=["b"])
    _clan, partners, newly = club_runs.log_run(db, "a", "ua", "clan")
    assert [p["run_id"] for p in partners] == ["b"] and newly == []


def test_shared_metres_only_ever_go_up_and_only_in_the_same_club():
    sql = inspect.getsource(club_runs._log_one)
    assert "GREATEST(COALESCE(club_run_logs.shared_m, 0)" in sql
    assert "WHERE club_run_logs.clan_id = EXCLUDED.clan_id" in sql


def test_a_solo_run_writes_nothing():
    db = _LogDb([])
    assert club_runs.log_run(db, "a", "ua", "clan") == (None, [], [])
    assert not any("club_run_logs" in s or "club_run_sessions" in s for s, _ in db.statements)


# ---------------------------------------------------------------------------
# 4. status and notifications
# ---------------------------------------------------------------------------

class _StatusDb:
    def __init__(self, logged=None, waiting=()):
        self.logged = logged
        self.waiting = list(waiting)

    def execute(self, statement, params=None):
        sql = str(statement)
        if "SELECT session_id::text FROM club_run_logs" in sql:
            return SimpleNamespace(fetchone=lambda: (self.logged,) if self.logged else None)
        return SimpleNamespace(fetchall=lambda: self.waiting)


def test_an_unlogged_run_with_nobody_out_is_solo():
    run = SimpleNamespace(id="r", user_id="u", verified=True, tier=economy.CLAIMABLE,
                          ended_at=datetime.utcnow(), path="LINESTRING")
    st = club_runs.status_for_run(_StatusDb(), run, "u", member_clan_id="c")
    assert st["state"] == "solo" and not st["qualified"] and st["participants"] == []


def test_a_clubmate_still_out_nearby_makes_it_potential_never_confirmed():
    run = SimpleNamespace(id="r", user_id="u", verified=True, tier=economy.CLAIMABLE,
                          ended_at=datetime.utcnow(), path="LINESTRING")
    st = club_runs.status_for_run(_StatusDb(waiting=[("m", "ryan", None)]), run, "u", member_clan_id="c")
    assert st["state"] == "potential" and st["qualified"] is False
    assert st["waiting_for"][0]["username"] == "ryan"


def test_waiting_stops_after_a_few_hours():
    run = SimpleNamespace(id="r", user_id="u", verified=True, tier=economy.CLAIMABLE,
                          ended_at=datetime.utcnow() - timedelta(hours=4), path="LINESTRING")
    assert club_runs.still_running_with(_StatusDb(waiting=[("m", "x", None)]), run, "c") == []


def test_an_ineligible_run_is_never_potential():
    run = SimpleNamespace(id="r", user_id="u", verified=True, tier=economy.UNQUALIFIED,
                          ended_at=datetime.utcnow(), path="LINESTRING")
    st = club_runs.status_for_run(_StatusDb(waiting=[("m", "x", None)]), run, "u", member_clan_id="c")
    assert st["state"] == "solo"


class _Bg:
    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *args):
        self.tasks.append(args)


class _HumanDb:
    def __init__(self, humans):
        self.humans = humans

    def execute(self, statement, params=None):
        return SimpleNamespace(fetchall=lambda: [(h,) for h in self.humans])


def test_each_earlier_finisher_is_told_once_and_bots_never():
    bg = _Bg()
    newly = [{"user_id": "human", "run_id": "r1"}, {"user_id": "bot", "run_id": "r2"}]
    club_runs.notify_confirmed(bg, _HumanDb(["human"]), "me", "Jonathan", newly)
    assert len(bg.tasks) == 1
    recipients, category, title, body, data, actor = bg.tasks[0]
    assert recipients == ["human"] and category == "club_run"
    assert data == {"screen": "club_run", "run_id": "r1"} and actor == "me"
    assert "Jonathan" in body and "—" not in body and "–" not in body


def test_nobody_newly_logged_means_no_notification():
    bg = _Bg()
    club_runs.notify_confirmed(bg, _HumanDb([]), "me", "J", [])
    assert bg.tasks == []


def test_presence_never_reports_a_verdict():
    src = inspect.getsource(club_runs.presence)
    assert "confirmed" not in src and "qualified" not in src
