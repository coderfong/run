"""Database contract for transactional solo + club Elo updates.

    .venv/Scripts/python.exe test_elo_flow.py
"""

import uuid

from sqlalchemy import text

from app import elo
from app.database import SessionLocal
from app import models
from app.routes.clans import _clan_out, clan_elo_leaderboard
from app.routes.leaderboard import rank_leaderboard
from app.routes.profile import me_stats


db = SessionLocal()
tag = uuid.uuid4().hex[:8]
user_ids = []
clan_ids = []


def make_clan(suffix):
    cid = db.execute(
        text(
            "INSERT INTO clans (id,name,tag,created_at) "
            "VALUES (gen_random_uuid(),:name,:tag,now()) RETURNING id::text"
        ),
        {"name": f"Elo {suffix} {tag}", "tag": f"{suffix}{tag[:3]}".upper()},
    ).scalar()
    clan_ids.append(cid)
    return cid


def make_user(suffix, clan_id):
    uid = db.execute(
        text(
            "INSERT INTO users (id,username,created_at,clan_id) "
            "VALUES (gen_random_uuid(),:name,now(),CAST(:clan AS uuid)) RETURNING id::text"
        ),
        {"name": f"elo{suffix}{tag}", "clan": clan_id},
    ).scalar()
    user_ids.append(uid)
    return uid


try:
    clan_a, clan_b = make_clan("A"), make_clan("B")
    runner_a, runner_b = make_user("a", clan_a), make_user("b", clan_b)
    db.commit()

    won = elo.record_claim_matches(
        db,
        runner_a,
        None,
        [{"victim_id": runner_b, "area_m2": 1000, "defended": False}],
        attacker_clan_id=clan_a,
    )
    db.commit()
    assert won == {"solo_rating": 1005, "solo_delta": 5, "club_rating": 1016, "club_delta": 16}
    assert elo.solo_status(db, runner_b)["rating"] == 994
    assert elo.club_status(db, clan_b)["rating"] == 984

    held = elo.record_claim_matches(
        db,
        runner_a,
        None,
        [{"victim_id": runner_b, "area_m2": 1000, "defended": True}],
        attacker_clan_id=clan_a,
    )
    db.commit()
    assert held["solo_delta"] < 0 and held["club_delta"] < 0
    assert held["solo_rating"] + elo.solo_status(db, runner_b)["rating"] == 1999
    assert held["club_rating"] + elo.club_status(db, clan_b)["rating"] == 2000
    assert elo.solo_status(db, runner_a)["matches"] == 2
    assert elo.solo_status(db, runner_a)["wins"] == 1
    assert elo.solo_status(db, runner_a)["losses"] == 1
    event_count = db.execute(
        text(
            "SELECT COUNT(*) FROM elo_events WHERE user_a_id=CAST(:a AS uuid) "
            "OR user_b_id=CAST(:b AS uuid) OR clan_a_id=CAST(:ca AS uuid) OR clan_b_id=CAST(:cb AS uuid)"
        ),
        {"a": runner_a, "b": runner_b, "ca": clan_a, "cb": clan_b},
    ).scalar()
    assert event_count == 4

    # Non-combat changes preserve match counts and roll back with territory work.
    before = elo.solo_status(db, runner_a)
    assert elo.apply_land_delta(db, runner_a, elo.open_claim_reward(200000)) == before["rating"] + 3
    elo.record_expired_land(db, [(runner_a, 100000), (runner_a, 100000)])
    assert elo.solo_status(db, runner_a)["rating"] == before["rating"] - 2
    elo.record_expired_land(db, [])
    assert elo.solo_status(db, runner_a)["matches"] == before["matches"]
    assert elo.apply_land_delta(db, runner_a, -10000) == elo.MIN_RATING
    db.rollback()
    assert elo.solo_status(db, runner_a)["rating"] == before["rating"]

    # Public API serializers carry the same live rating and progression data.
    runner = db.get(models.User, runner_a)
    stats = me_stats(user=runner, db=db)
    assert stats.solo_elo == held["solo_rating"]
    assert stats.solo_elo_next_label
    club = _clan_out(db, clan_a, runner_a, full=False)
    assert club.elo_rating == held["club_rating"]
    assert club.elo_next_label
    assert any(row.user_id == runner_a for row in rank_leaderboard(db=db, limit=500))
    assert any(row.clan_id == clan_a for row in clan_elo_leaderboard(db=db, limit=200))
    print("ALL PASSED - solo and club ratings move atomically and reach every API surface")
finally:
    db.rollback()
    if user_ids:
        db.execute(text("DELETE FROM users WHERE id::text = ANY(:ids)"), {"ids": user_ids})
    if clan_ids:
        db.execute(text("DELETE FROM clans WHERE id::text = ANY(:ids)"), {"ids": clan_ids})
    db.commit()
    db.close()
