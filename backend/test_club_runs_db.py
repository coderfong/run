"""Club runs against a real PostGIS: the probe, the log, the session, the
credit, the backfill.

    .venv/Scripts/python.exe -m pytest test_club_runs_db.py

Needs the local database at migration 0047 or later; skipped otherwise.
Everything runs inside one outer transaction that is rolled back, so nothing
is left behind (the code under test commits into a savepoint).
"""

import importlib.util
import os
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import club_runs, economy, models
from app.database import engine

HERE = os.path.dirname(os.path.abspath(__file__))


def _at_0047():
    try:
        with engine.connect() as c:
            c.execute(text("SELECT session_id, shared_m FROM club_run_logs LIMIT 0"))
            c.execute(text("SELECT live_lat FROM runs LIMIT 0"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _at_0047(), reason="local database is not at 0047")

# Somewhere nobody runs, fresh per test run.
_tag = uuid.uuid4().hex[:6]
LAT = -60.0 - (int(_tag, 16) % 300) * 0.01
LON = -40.0 - (int(_tag[:4], 16) % 300) * 0.01
STEP = 0.0018  # ~100 m of longitude at 60 degrees south


@pytest.fixture
def db():
    conn = engine.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        conn.close()


def _clan(db):
    return db.execute(
        text("INSERT INTO clans (id, name, tag, created_at) VALUES (gen_random_uuid(), :n, :t, now()) "
             "RETURNING id::text"),
        {"n": f"Crew {_tag} {uuid.uuid4().hex[:6]}", "t": _tag[:4].upper()},
    ).scalar()


def _user(db, name, clan_id, joined_ago_h=48, bot=False):
    uid = db.execute(
        text("INSERT INTO users (id, username, created_at, clan_id, is_bot) "
             "VALUES (gen_random_uuid(), :n, now(), :c, :b) RETURNING id::text"),
        {"n": f"{name}_{_tag}_{uuid.uuid4().hex[:4]}", "c": clan_id, "b": bot},
    ).scalar()
    if clan_id:
        db.execute(
            text("INSERT INTO clan_members (clan_id, user_id, role, joined_at) "
                 "VALUES (:c, :u, 'member', now() - make_interval(hours => :h))"),
            {"c": clan_id, "u": uid, "h": joined_ago_h},
        )
    return uid


def _run(db, uid, *, start, minutes=30, km=5.0, lat_shift=0.0, reverse=False,
         trace=True, trace_offset_s=0, tier=economy.CLAIMABLE, ended=True, verified=True,
         ref=None):
    n = int(km * 10)
    lons = [LON + i * STEP for i in range(n + 1)]
    if reverse:
        lons = lons[::-1]
    coords = [(lon, LAT + lat_shift) for lon in lons]
    wkt = "LINESTRING(" + ", ".join(f"{x} {y}" for x, y in coords) + ")"
    dur = minutes * 60
    # Positions follow a schedule anchored on `ref` (the group's start), so
    # two runners out together are at the same place at the same moment even
    # when one pressed start a little later. Without `ref` a run keeps its own.
    epoch = datetime(1970, 1, 1)
    t_start = (start - epoch).total_seconds()
    t_ref = ((ref or start) - epoch).total_seconds() + trace_offset_s
    tr = None
    if trace:
        tr = []
        for k in range(0, dur + 1, 5):
            i = max(0, min(n, int((t_start + k - t_ref) / dur * n)))
            tr.append([t_start + k, coords[i][1], coords[i][0]])
    import json
    rid = db.execute(
        text(
            """
            INSERT INTO runs (id, user_id, started_at, ended_at, path, distance_m, duration_s,
                              verified, tier, together_trace, reward_xp)
            VALUES (gen_random_uuid(), :u, :s, :e, ST_GeomFromText(:wkt, 4326), :d, :dur,
                    :v, :tier, CAST(:tr AS jsonb), :xp)
            RETURNING id::text
            """
        ),
        {"u": uid, "s": start, "e": start + timedelta(seconds=dur) if ended else None,
         "wkt": wkt, "d": km * 1000, "dur": dur, "v": verified, "tier": tier,
         "tr": json.dumps(tr) if tr is not None else None, "xp": int(km * 50)},
    ).scalar()
    return rid


def _log(db, run_id, uid, clan):
    return club_runs.log_run(db, run_id, uid, clan)


START = datetime.utcnow() - timedelta(hours=2)


def test_first_finisher_is_solo_until_the_second_finishes(db):
    clan = _clan(db)
    a, b = _user(db, "a", clan), _user(db, "b", clan)
    ra = _run(db, a, start=START)
    rb = _run(db, b, start=START + timedelta(seconds=40), ref=START, ended=False)
    assert _log(db, ra, a, clan) == (None, [], [])          # B is still out
    db.execute(text("UPDATE runs SET ended_at = started_at + interval '30 minutes' WHERE id = :r"), {"r": rb})
    got_clan, partners, newly = _log(db, rb, b, clan)
    assert got_clan == clan
    assert [p["run_id"] for p in partners] == [ra] and [p["run_id"] for p in newly] == [ra]
    sa, sb = club_runs.session_for_run(db, ra), club_runs.session_for_run(db, rb)
    assert sa and sa == sb
    detail = club_runs.describe_sessions(db, [sa], viewer_id=a)[sa]
    assert {p["user_id"] for p in detail["participants"]} == {a, b}
    assert [p["is_you"] for p in detail["participants"] if p["user_id"] == a] == [True]
    assert detail["shared_distance_m"] and detail["shared_distance_m"] > 4000


def test_three_runners_share_one_session_and_exact_participants(db):
    clan = _clan(db)
    a, b, c = (_user(db, n, clan) for n in "abc")
    ra = _run(db, a, start=START)
    rb = _run(db, b, start=START + timedelta(seconds=20), ref=START)
    rc = _run(db, c, start=START + timedelta(seconds=50), ref=START, lat_shift=0.0001)
    _log(db, ra, a, clan)
    _log(db, rb, b, clan)
    _clan_id, partners, newly = _log(db, rc, c, clan)
    assert {p["run_id"] for p in partners} == {ra, rb} and newly == []
    sid = club_runs.session_for_run(db, rc)
    assert club_runs.session_for_run(db, ra) == sid == club_runs.session_for_run(db, rb)
    assert db.execute(text("SELECT COUNT(*) FROM club_run_sessions WHERE clan_id = :c"), {"c": clan}).scalar() == 1
    people = club_runs.describe_sessions(db, [sid])[sid]["participants"]
    assert sorted(p["run_id"] for p in people) == sorted([ra, rb, rc])


def test_two_groups_joined_by_a_late_finisher_merge_into_the_older(db):
    clan = _clan(db)
    a, b, c = (_user(db, n, clan) for n in "abc")
    ra = _run(db, a, start=START)
    rb = _run(db, b, start=START + timedelta(seconds=10), ref=START)
    # Force two separate sessions, as if logged apart.
    s1 = club_runs.attach_session(db, clan, [ra]) if club_runs._log_one(db, ra, a, clan, 1, 100) else None
    s2 = club_runs.attach_session(db, clan, [rb]) if club_runs._log_one(db, rb, b, clan, 1, 100) else None
    assert s1 != s2
    rc = _run(db, c, start=START + timedelta(seconds=30), ref=START)
    _log(db, rc, c, clan)
    sids = {club_runs.session_for_run(db, r) for r in (ra, rb, rc)}
    assert sids == {s1}
    assert db.execute(text("SELECT COUNT(*) FROM club_run_sessions WHERE id = :s"), {"s": s2}).scalar() == 0


def test_opposite_direction_and_minutes_apart_do_not_qualify(db):
    clan = _clan(db)
    a, b, c = (_user(db, n, clan) for n in "abc")
    ra = _run(db, a, start=START)
    _run(db, b, start=START + timedelta(seconds=30), reverse=True)
    _run(db, c, start=START + timedelta(minutes=4), trace_offset_s=0)
    assert _log(db, ra, a, clan) == (None, [], [])


def test_joining_after_the_run_started_does_not_count(db):
    clan = _clan(db)
    a = _user(db, "a", clan)
    late = _user(db, "late", clan, joined_ago_h=1)   # joined after START
    ra = _run(db, a, start=START)
    _run(db, late, start=START + timedelta(seconds=30), ref=START)
    assert _log(db, ra, a, clan) == (None, [], [])


def test_old_runs_without_a_trace_and_unrewarded_partners_fail_safely(db):
    clan = _clan(db)
    a, b, c = (_user(db, n, clan) for n in "abc")
    ra = _run(db, a, start=START)
    _run(db, b, start=START + timedelta(seconds=30), trace=False)
    _run(db, c, start=START + timedelta(seconds=30), tier=economy.UNQUALIFIED)
    assert _log(db, ra, a, clan) == (None, [], [])


def test_credit_is_paid_once_however_often_it_is_synced(db):
    clan = _clan(db)
    a, b = _user(db, "a", clan), _user(db, "b", clan)
    ra = _run(db, a, start=START)
    rb = _run(db, b, start=START + timedelta(seconds=30), ref=START)
    _log(db, ra, a, clan)
    _clan_id, partners, _ = _log(db, rb, b, clan)
    ids = [rb] + [p["run_id"] for p in partners]
    xp0 = db.execute(text("SELECT COALESCE(xp, 0) FROM clans WHERE id = :c"), {"c": clan}).scalar()
    club_runs.sync_credit(db, ids, clan)
    xp1 = db.execute(text("SELECT COALESCE(xp, 0) FROM clans WHERE id = :c"), {"c": clan}).scalar()
    club_runs.sync_credit(db, ids, clan)       # a retry
    _log(db, rb, b, clan)                      # a duplicate match
    club_runs.sync_credit(db, ids, clan)
    xp2 = db.execute(text("SELECT COALESCE(xp, 0) FROM clans WHERE id = :c"), {"c": clan}).scalar()
    assert xp1 > xp0 and xp2 == xp1
    grants = db.execute(
        text("SELECT kind, COUNT(*) FROM reward_grants WHERE run_id = ANY(CAST(:ids AS uuid[])) "
             "AND kind LIKE 'club_%' GROUP BY kind"),
        {"ids": ids},
    ).fetchall()
    assert dict(grants) == {"club_distance": 2, "club_run_xp": 2}
    sid = club_runs.session_for_run(db, ra)
    d = club_runs.describe_sessions(db, [sid])[sid]
    assert d["club_xp_earned"] == xp1 - xp0
    assert d["week_added_distance_m"] == pytest.approx(10000.0)


def test_land_claimed_before_the_match_joins_the_club(db):
    clan = _clan(db)
    a, b = _user(db, "a", clan), _user(db, "b", clan)
    ra = _run(db, a, start=START)
    db.execute(
        text("INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified) "
             "VALUES (gen_random_uuid(), :u, :r, ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 0.001)), "
             "1000, now(), true)"),
        {"u": a, "r": ra, "lon": LON, "lat": LAT},
    )
    rb = _run(db, b, start=START + timedelta(seconds=30), ref=START)
    _clan_id, partners, _ = _log(db, rb, b, clan)
    club_runs.sync_credit(db, [rb] + [p["run_id"] for p in partners], clan)
    assert db.execute(text("SELECT clan_id::text FROM territories WHERE run_id = :r"), {"r": ra}).scalar() == clan


def test_status_moves_from_potential_to_confirmed(db):
    clan = _clan(db)
    a, b = _user(db, "a", clan), _user(db, "b", clan)
    ra = _run(db, a, start=START)
    rb = _run(db, b, start=START + timedelta(seconds=30), ref=START, ended=False)
    db.execute(
        text("UPDATE runs SET live_lat = :lat, live_lon = :lon, live_at = now() WHERE id = :r"),
        {"lat": LAT, "lon": LON + 20 * STEP, "r": rb},
    )
    db.execute(text("UPDATE runs SET ended_at = now() - interval '1 minute' WHERE id = :r"), {"r": ra})
    run_a = db.get(models.Run, ra)
    st = club_runs.status_for_run(db, run_a, a, member_clan_id=clan)
    assert st["state"] == "potential" and st["waiting_for"][0]["user_id"] == b

    db.execute(text("UPDATE runs SET ended_at = now(), started_at = :s, live_lat = NULL, live_at = NULL "
                    "WHERE id = :r"), {"r": rb, "s": run_a.started_at + timedelta(seconds=30)})
    db.execute(text("UPDATE runs SET started_at = ended_at - interval '30 minutes' WHERE id = :r"), {"r": ra})
    db.expire_all()
    # Re-time B to overlap A exactly as a real pair would.
    db.execute(text("UPDATE runs SET ended_at = (SELECT ended_at FROM runs WHERE id = :a) + interval '30 seconds', "
                    "started_at = (SELECT started_at FROM runs WHERE id = :a) + interval '30 seconds' WHERE id = :b"),
               {"a": ra, "b": rb})
    # Traces follow the new start.
    start_a = db.execute(text("SELECT started_at FROM runs WHERE id = :r"), {"r": ra}).scalar()
    ra2 = _run(db, a, start=start_a)
    rb2 = _run(db, b, start=start_a + timedelta(seconds=30), ref=start_a)
    _log(db, rb2, b, clan)
    st = club_runs.status_for_run(db, db.get(models.Run, ra2), a, member_clan_id=clan)
    assert st["state"] == "confirmed" and st["qualified"]
    assert {p["user_id"] for p in st["participants"]} == {a, b}
    assert st["shared_distance_m"] and st["shared_distance_m"] > 4000


def test_presence_sees_a_clubmate_beside_you_and_nobody_else(db):
    clan, other = _clan(db), _clan(db)
    a, b, stranger = _user(db, "a", clan), _user(db, "b", clan), _user(db, "s", other)
    now = datetime.utcnow() - timedelta(minutes=5)
    ra = _run(db, a, start=now, ended=False)
    rb = _run(db, b, start=now + timedelta(seconds=20), ended=False)
    rs = _run(db, stranger, start=now, ended=False)
    for r, dlon in ((ra, 0), (rb, 0.0001), (rs, 0.0001)):
        db.execute(text("UPDATE runs SET live_lat = :lat, live_lon = :lon, live_at = now() WHERE id = :r"),
                   {"lat": LAT, "lon": LON + dlon, "r": r})
    run_a = db.get(models.Run, ra)
    db.refresh(run_a)
    p = club_runs.presence(db, run_a, clan)
    assert p["state"] == "together"
    assert [m["user_id"] for m in p["clubmates"]] == [b]


def test_the_backfill_groups_existing_logs(db):
    clan = _clan(db)
    a, b, c = (_user(db, n, clan) for n in "abc")
    ra = _run(db, a, start=START)
    rb = _run(db, b, start=START + timedelta(seconds=30), ref=START)
    rc = _run(db, c, start=START + timedelta(seconds=60), ref=START)
    far = _run(db, c, start=START - timedelta(days=2))
    # As 0043 wrote them: A and B in one transaction, C alone later, and an
    # unrelated run two days earlier.
    for r, u, when in ((ra, a, "2026-09-10 10:00"), (rb, b, "2026-09-10 10:00"),
                       (rc, c, "2026-09-10 10:05"), (far, c, "2026-09-08 08:00")):
        db.execute(text("INSERT INTO club_run_logs (run_id, user_id, clan_id, partners, logged_at) "
                        "VALUES (:r, :u, :c, 1, :t)"), {"r": r, "u": u, "c": clan, "t": when})
    spec = importlib.util.spec_from_file_location(
        "m0047", os.path.join(HERE, "alembic", "versions", "0047_club_run_sessions.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod._backfill_sessions(db.connection())
    sids = {r: club_runs.session_for_run(db, r) for r in (ra, rb, rc, far)}
    assert sids[ra] == sids[rb] == sids[rc]
    assert sids[far] and sids[far] != sids[ra]
    # The backfill measured nothing, so it claims no "km together".
    assert club_runs.describe_sessions(db, [sids[ra]])[sids[ra]]["shared_distance_m"] is None
