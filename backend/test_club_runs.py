"""A club run is a run the club did TOGETHER.

    .venv/Scripts/python.exe -m pytest test_club_runs.py

Almost none of this needs a database. The rule is two pure predicates over
numbers a query hands back (`shared_fraction`, `ran_together`) plus one probe
whose guards can be read off the SQL, and keeping it that way is the point: a
club board that silently reverts to "everyone with a badge" looks entirely
normal on a map, and it is a map you would have to stare at for a week to
notice was wrong.

The two tests that DO touch a db use a stub, because what they are checking is
the glue — which rows survive the filter, and what gets written once — not
PostGIS.
"""

import inspect
from types import SimpleNamespace

import pytest

from app import club_runs
from app.config import settings
from app.routes.runs import _claim_territory, _club_support_sql


def _row(mine_shared, theirs_shared, mine_len, theirs_len, run="r1", user="u1", dist=5000.0):
    return SimpleNamespace(
        run_id=run, user_id=user, distance_m=dist,
        mine_shared_m=mine_shared, theirs_shared_m=theirs_shared,
        mine_len_m=mine_len, theirs_len_m=theirs_len,
        mine_trace=[[t, 1.3, 103.8 + t / 100000] for t in range(0, 601, 5)],
        theirs_trace=[[t, 1.3, 103.8 + t / 100000] for t in range(0, 601, 5)],
    )


class _FakeDb:
    """Answers the probe with fixed rows and records every insert."""

    def __init__(self, rows=(), already_logged=()):
        self.rows = list(rows)
        self.already_logged = set(already_logged)
        self.logged = []
        self.updates = []

    def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}
        if "club_run_logs" in sql:
            run_id = params["run_id"]
            self.logged.append(params)
            if run_id in self.already_logged:
                return SimpleNamespace(fetchone=lambda: None)
            self.already_logged.add(run_id)
            return SimpleNamespace(fetchone=lambda: (run_id,))
        if "UPDATE territories" in sql:
            self.updates.append((sql, params))
            return SimpleNamespace(rowcount=len(params.get("ids", [])))
        return SimpleNamespace(fetchall=lambda: self.rows)


# ---------------------------------------------------------------------------
# the rule
# ---------------------------------------------------------------------------

def test_two_people_is_one_partner():
    """"2 or more people" is stated from one runner's side, so the number the
    code holds is the number of OTHERS. Off by one here and a club run needs
    three."""
    assert settings.club_run_min_partners == 1
    assert club_runs.enough([{"run_id": "a", "user_id": "u"}])
    assert not club_runs.enough([])


def test_timed_positions_confirm_running_together():
    trace = [[t, 1.3, 103.8 + t / 100000] for t in range(0, 601, 5)]
    assert club_runs.nearby_in_time(trace, trace)
    assert club_runs.nearby_in_time(trace, [[t, lat + .0001, lon] for t, lat, lon in trace])


def test_same_route_at_different_times_does_not_qualify():
    trace = [[t, 1.3, 103.8 + t / 100000] for t in range(0, 601, 5)]
    assert not club_runs.nearby_in_time(trace, [[t + 120, lat, lon] for t, lat, lon in trace])
    assert not club_runs.nearby_in_time(trace, [[t, lat, 207.606 - lon] for t, lat, lon in trace])


def test_missing_or_sparse_evidence_does_not_qualify():
    trace = [[t, 1.3, 103.8] for t in range(0, 601, 5)]
    assert not club_runs.nearby_in_time(trace, None)
    assert not club_runs.nearby_in_time(trace, [trace[0], trace[-1]])


def test_running_the_same_route_together_is_a_club_run():
    assert club_runs.ran_together(0.95, 0.92, 5000.0)


def test_a_solo_run_is_not():
    assert not club_runs.ran_together(0.0, 0.0, 0.0)


def test_the_test_is_symmetric():
    """A 10 km run that happens to contain a clubmate's 2 km loop is not two
    people running together. Measured only from the short run's side it looks
    like a perfect match, which is exactly the trap."""
    short_side, long_side = 1.0, 0.2
    assert not club_runs.ran_together(long_side, short_side, 2000.0)
    assert not club_runs.ran_together(short_side, long_side, 2000.0)


def test_a_shared_stretch_has_to_be_long_enough_to_mean_anything():
    """Two 200 m shuffles round the same block share 100% of themselves."""
    assert not club_runs.ran_together(1.0, 1.0, 200.0)
    assert club_runs.ran_together(1.0, 1.0, settings.club_run_min_shared_m)


def test_the_threshold_is_inclusive_at_both_ends():
    frac = settings.club_run_min_shared_frac
    assert club_runs.ran_together(frac, frac, settings.club_run_min_shared_m)
    assert not club_runs.ran_together(frac - 0.01, frac, settings.club_run_min_shared_m)


def test_a_run_with_no_length_shares_nothing():
    """0/0 is not 1. A degenerate two point trace must not be a club run with
    everybody who was out at the time."""
    assert club_runs.shared_fraction(0.0, 0.0) == 0.0
    assert club_runs.shared_fraction(500.0, 0) == 0.0


@pytest.mark.parametrize("shared,length,expected", [
    (500.0, 1000.0, 0.5),
    (1000.0, 1000.0, 1.0),
    (1200.0, 1000.0, 1.0),   # clipped: a run cannot share more than itself
    (None, 1000.0, 0.0),
])
def test_shared_fraction(shared, length, expected):
    assert club_runs.shared_fraction(shared, length) == pytest.approx(expected)


# ---------------------------------------------------------------------------
# the probe
# ---------------------------------------------------------------------------

def test_the_probe_only_looks_at_this_club():
    sql = club_runs.partner_sql()
    assert "u.clan_id = CAST(:clan_id AS uuid)" in sql


def test_the_probe_never_matches_you_with_yourself():
    """Both guards matter: the run id alone would still let a runner pair with
    their OWN earlier run of the same route."""
    sql = club_runs.partner_sql()
    assert "r.user_id <> CAST(:user_id AS uuid)" in sql
    assert "r.id <> CAST(:run_id AS uuid)" in sql


def test_the_probe_ignores_flagged_and_unfinished_runs():
    """A shadow-flagged run earns its owner nothing anyone else can see, so it
    cannot hand a club a route either; an unfinished one has no window yet."""
    sql = club_runs.partner_sql()
    assert "r.verified" in sql
    assert "r.ended_at IS NOT NULL" in sql


def test_the_probe_checks_the_windows_overlap_both_ways():
    """One sided, "started before I finished" would match a run from last year."""
    sql = club_runs.partner_sql()
    assert "r.started_at <= mine.ended_at + make_interval(secs => :grace)" in sql
    assert "r.ended_at >= mine.started_at - make_interval(secs => :grace)" in sql


def test_the_probe_measures_metres_not_degrees():
    """Every length in the probe is taken on a geography cast. A bare
    ST_Length here would compare a tolerance in metres against a number in
    degrees and quietly match nobody."""
    sql = club_runs.partner_sql()
    assert "ST_Length(r.path::geography)" in sql
    assert "ST_Length(path::geography)" in sql
    assert sql.count("::geography)") >= 4


def test_the_probe_is_bounded():
    sql = club_runs.partner_sql()
    assert "LIMIT :cap" in sql


# ---------------------------------------------------------------------------
# the glue
# ---------------------------------------------------------------------------

def test_a_clubless_runner_never_probes():
    db = _FakeDb(rows=[_row(5000, 5000, 5000, 5000)])
    assert club_runs.partners_for(db, "run", "user", None) == []


def test_only_rows_that_clear_the_rule_come_back():
    db = _FakeDb(rows=[
        _row(4800, 4800, 5000, 5000, run="together"),
        _row(2000, 2000, 10000, 2100, run="incidental"),
        _row(300, 300, 300, 300, run="tiny"),
    ])
    found = club_runs.partners_for(db, "run", "user", "clan")
    assert [p["run_id"] for p in found] == ["together"]


def test_a_run_with_nobody_is_not_logged_at_all():
    """No club, and no row written: a solo run must leave no trace in the club
    ledger, or a later clubmate would find it already logged."""
    db = _FakeDb(rows=[])
    assert club_runs.log_run(db, "run", "user", "clan") == (None, [], [])
    assert db.logged == []


def test_a_club_run_logs_the_whole_group():
    db = _FakeDb(rows=[_row(4800, 4800, 5000, 5000, run="partner", user="mate")])
    clan, partners, newly = club_runs.log_run(db, "mine", "me", "clan")
    assert clan == "clan"
    assert [p["run_id"] for p in partners] == ["partner"]
    assert {p["run_id"] for p in db.logged} == {"mine", "partner"}
    # The partner finished first and had nobody to match, so their club credit
    # is owed and this is where it is paid.
    assert [p["run_id"] for p in newly] == ["partner"]


def test_a_partner_already_logged_is_not_paid_twice():
    """Three clubmates out together means three runs each finding the others.
    The log row, not a prior read, is what stops the earliest run being
    credited once per person who comes in after it."""
    db = _FakeDb(
        rows=[_row(4800, 4800, 5000, 5000, run="partner", user="mate")],
        already_logged=["partner"],
    )
    _clan, partners, newly = club_runs.log_run(db, "mine", "me", "clan")
    assert [p["run_id"] for p in partners] == ["partner"]
    assert newly == []


def test_attribution_only_ever_fills_a_blank():
    """Land that already belongs to a club was won by a club run of its own."""
    db = _FakeDb()
    club_runs.attribute_territories(db, ["a", "b"], "clan")
    sql, params = db.updates[0]
    assert params["ids"] == ["a", "b"]
    assert "clan_id IS NULL" in sql


def test_attribution_is_a_no_op_without_a_club_or_runs():
    db = _FakeDb()
    assert club_runs.attribute_territories(db, ["a"], None) == 0
    assert club_runs.attribute_territories(db, [], "clan") == 0
    assert db.updates == []


# ---------------------------------------------------------------------------
# clubmates are people, not plots
# ---------------------------------------------------------------------------
#
# Club LAND is now something a club has to run together for, so most of a
# club's territory carries no club at all. Everywhere combat asks "are we in
# the same club?" it therefore has to ask the RUNNERS, not the rows. Ask the
# rows and clubmates start raiding each other and lending each other no
# defence, on a map that looks completely normal while they do it.

def test_defence_stacks_by_membership_in_a_live_fight():
    sql = _club_support_sql(
        "t", "geom", rank_clause="support_u.solo_elo > 0", owner_clan="u.clan_id"
    )
    assert "support_u.clan_id = u.clan_id" in sql
    assert "t2.clan_id" not in sql


def test_defence_stacks_by_membership_on_the_placement_grid():
    """`local` carries its owner's club, so this comparison is already person
    to person — and the grid is where a player SEES what a position costs, so
    it has to agree with the fight."""
    sql = _club_support_sql("h", "h.ov", source="local")
    assert "t2.clan_id = h.clan_id" in sql
    assert "support_u" not in sql


def test_a_claim_keeps_the_two_clubs_apart():
    """One says what the ground is worth to a club, the other says who the
    claimer's clubmates are. Collapsing them back into one argument is the
    single change that would turn clubmates into rivals."""
    params = inspect.signature(_claim_territory).parameters
    assert "clan_id" in params
    assert "member_clan_id" in params
    assert params["member_clan_id"].default is None
