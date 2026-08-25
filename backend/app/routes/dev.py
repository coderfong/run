"""Allowlisted development scenarios that exercise real rivalry state.

These endpoints deliberately mutate the same territory, rivalry and crossed-
paths tables as normal play. They are never exposed to an ordinary account:
every route enforces the server-side DEV_RUN_ACCOUNTS allowlist used by the run
simulator.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from shapely import wkt as shapely_wkt
from shapely.ops import unary_union
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, paserby, ranks, schemas
from ..database import get_db
from ..devtools import is_dev_account
from ..notifications import notify
from ..security import current_user
from .runs import (
    STEAL_LEDGER_MIN_M2,
    _claim_territory,
    _decimate_ring,
    _run_route,
    _run_stamp,
)

router = APIRouter(prefix="/dev", tags=["dev"])


def _require_dev(user) -> None:
    # Hide the harness rather than advertising a privileged mutation surface.
    if not is_dev_account(user):
        raise HTTPException(404, "not found")


def _dev_rival(db: Session, user) -> models.User:
    """One deterministic, non-login rival account per allowed developer."""
    rival_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"paser-dev-rival:{user.id}"))
    rival = db.get(models.User, rival_id)
    if rival is not None:
        return rival
    compact = str(user.id).replace("-", "")[:12]
    rival = models.User(
        id=rival_id,
        username=f"DevRival_{compact}",
        password_hash=None,
        clan_id=None,
        avatar={},
    )
    db.add(rival)
    db.flush()
    return rival


@router.post("/runs/{run_id}/seed-rival")
def seed_rival_for_run(
    run_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Put weak rival land under this run's default claim pose.

    The result screen still performs the real preview and claim. This endpoint
    only arranges the board so that path has an opponent to take land from.
    """
    _require_dev(user)
    run = db.get(models.Run, run_id)
    if run is None or str(run.user_id) != str(user.id):
        raise HTTPException(404, "run not found")
    if run.ended_at is None or run.claimed_at is not None:
        raise HTTPException(409, "run must be finished and unclaimed")

    route = _run_route(db, run)
    stamp = _run_stamp(route, float(run.claim_area_m2 or 0.0))
    if stamp is None:
        raise HTTPException(422, "run has no usable claim shape")

    rival = _dev_rival(db, user)

    # Under EVERY pose the result screen might open on, not just one of them.
    #
    # This used to seed a single claim-shaped polygon at t = 0.5, on the
    # assumption that the middle of the route is where the claim starts. It is
    # not, and there are two different poses in play before the runner touches
    # anything: /end-run draws the shape at its RESTING pose (`stamp.t0`, which
    # for a lap is nowhere near 0.5), and /claim-options then moves it to
    # whichever sample it recommends. Seeding one and opening on the other put
    # the rival's land a quarter of a lap from the claim — measured on the
    # simulator's own presets, the overlap was 26% at 1.2 km and 0% from 3 km
    # up. Nothing to take means no victims, which means the capture beat
    # correctly plays the empty-ground landing and the scenario silently does
    # not do the one thing it exists for.
    #
    # The union of both poses costs nothing here and makes the harness
    # deterministic: wherever the claim opens, there is a rival underneath it.
    poses = {round(stamp.t0, 4), 0.5}
    polygon = unary_union([stamp.at(t, 0.0) for t in sorted(poses)])
    if polygon.geom_type == "GeometryCollection" or polygon.is_empty:
        polygon = stamp.at(stamp.t0, 0.0)
    # Each scenario starts clean for this developer's bot. This does not touch
    # any real runner's rows, including the developer's own territory.
    db.execute(text("DELETE FROM territories WHERE user_id = :u"), {"u": rival.id})
    row = db.execute(
        text(
            """
            INSERT INTO territories
                (id, user_id, run_id, polygon, area_m2, created_at, verified,
                 clan_id, strength, reinforcements, expires_at)
            VALUES
                (gen_random_uuid(), :uid, NULL,
                 ST_Multi(ST_GeomFromText(:wkt, 4326)),
                 ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                 now(), true, NULL, 0.05, 0, :expires)
            RETURNING id::text, area_m2,
                      ST_Y(ST_Centroid(polygon)), ST_X(ST_Centroid(polygon))
            """
        ),
        {
            "uid": rival.id,
            "wkt": polygon.wkt,
            "expires": datetime.utcnow() + timedelta(days=30),
        },
    ).fetchone()
    db.commit()
    return {
        "ok": True,
        "rival_id": str(rival.id),
        "rival_username": rival.username,
        "territory_id": row[0],
        "area_m2": float(row[1] or 0.0),
        "lat": float(row[2]),
        "lon": float(row[3]),
    }


@router.post("/rival-takes-mine")
def rival_takes_mine(
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Run a real, overpowering rival claim against the developer's land."""
    _require_dev(user)
    mine = db.execute(
        text(
            """
            SELECT id::text, ST_AsText(polygon), area_m2
            FROM territories
            WHERE user_id = :u AND verified
              AND (expires_at IS NULL OR expires_at > now())
            ORDER BY area_m2 DESC
            LIMIT 1
            """
        ),
        {"u": user.id},
    ).fetchone()
    if mine is None:
        raise HTTPException(409, "claim some territory first, then run this scenario")

    rival = _dev_rival(db, user)
    polygon = shapely_wkt.loads(mine[1])
    territory, _stolen, _from, events, _ground = _claim_territory(
        db=db,
        user_id=str(rival.id),
        run_id=None,
        polygon_wgs=polygon,
        initial_area_m2=float(mine[2] or 0.0),
        # Deliberately above any normal stacked defence: this scenario is for
        # reaching the loss UI reliably, not balancing a simulated workout.
        strength=1000.0,
        verified=True,
        clan_id=None,
        lifetime_days=30.0,
    )

    centre = polygon.centroid
    taken_from_me = 0.0
    for event in events:
        if event["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        db.execute(
            text(
                """
                INSERT INTO territory_steals
                    (attacker_id, victim_id, run_id, area_m2, defended, lat, lon)
                VALUES (:a, :v, NULL, :area, :defended, :lat, :lon)
                """
            ),
            {
                "a": rival.id,
                "v": event["victim_id"],
                "area": event["area_m2"],
                "defended": event["defended"],
                "lat": centre.y,
                "lon": centre.x,
            },
        )
        if str(event["victim_id"]) == str(user.id) and not event["defended"]:
            taken_from_me += float(event["area_m2"])

    db.commit()
    if taken_from_me <= 0:
        raise HTTPException(409, "the dev rival did not take any of your land")

    capture_id = f"dev:{uuid.uuid4()}"
    # Same outline the real claim path sends, so the dev alert exercises the
    # real-area box + "ZOOM TO THE LAND" fit rather than the fan fallback.
    territory_ring = (
        _decimate_ring(territory.rings[0])
        if territory and territory.rings else None
    )
    # The rival's tier, on the same terms every other payload that carries an
    # avatar states it (see ranks.key_for): the alert draws the attacker's
    # portrait frame from this, and a portrait with no tier renders bare.
    # Read with raw SQL because the rank columns are deliberately NOT mapped on
    # the User model — see the note beside `premium_pass` in models.py.
    rank_row = db.execute(
        text(f"SELECT {ranks.SELECT_COLS} FROM users u WHERE u.id = :u"), {"u": rival.id}
    ).first()
    rival_rank_key = ranks.key_for(rank_row[0], rank_row[1]) if rank_row else "wood"
    event_data = {
        "capture_id": capture_id,
        "taken_m2": taken_from_me,
        "lat": centre.y,
        "lon": centre.x,
        "attacker_id": str(rival.id),
        "attacker_username": rival.username,
        "attacker_avatar": rival.avatar or {},
        "attacker_rank_key": rival_rank_key,
        "territory_id": str(territory.id) if territory else None,
        **({"territory_ring": territory_ring} if territory_ring else {}),
    }
    background.add_task(
        notify,
        [str(user.id)],
        "stolen",
        "Your land was captured",
        f"{rival.username} took {taken_from_me / 1_000_000:.3f} km² of your territory.",
        event_data,
        str(rival.id),
    )
    return {
        "ok": True,
        "rival_id": str(rival.id),
        "rival_username": rival.username,
        "rival_avatar": rival.avatar or {},
        "rival_rank_key": rival_rank_key,
        "taken_m2": taken_from_me,
        "territory_id": str(territory.id) if territory else None,
        "territory_ring": territory_ring,
        "lat": centre.y,
        "lon": centre.x,
        "capture_id": capture_id,
    }


# ---------------------------------------------------------------------------
# Crossroads (PASERBY) — populate the plaza from a desk
# ---------------------------------------------------------------------------
#
# Crossroads only has anything in it after two runners cross paths in the real
# world, so at a desk it is empty and there is no way in (the entry button is
# hidden until there is at least one encounter). This seeds REAL encounter rows
# against a set of throwaway bot runners, the same rows the matcher would write
# — so what the plaza draws is the real screen reading the real tables, not a
# mock. It is the crossed-paths analogue of the run simulator: the client
# builds the synthetic input (the runners' cosmetic loadouts) and the server
# does the real, allowlisted mutation.
#
# It is scoped entirely to the caller: the bots belong to this developer, and
# nothing here touches another runner's encounters.

# How many runners a seed defaults to when the client names no count. Comfortably
# more than one plaza-full (twenty) so paging is exercised out of the box.
_CROSSROADS_DEFAULT = 24
# A hard ceiling so a fat-fingered count cannot mint hundreds of bot users.
_CROSSROADS_MAX = 60

# Spread across the ladder so every familiarity rung and its colour is present:
# Crossed Paths (1), Familiar Face (2-4), Running Regular (5-9), Local Legend
# (10+). Cycled by index.
_CROSS_COUNTS = [1, 1, 2, 3, 5, 8, 12, 2, 1, 6]
# Broad-date spread so `when` shows every phrase it can ("Earlier today",
# "Yesterday", "This week", "A while back"). Days back, cycled by index.
_CROSS_DAY_OFFSETS = [0, 0, 1, 2, 5, 9]
# Rank-point rungs, so the portrait borders vary across the plaza. Straddles the
# tier thresholds from migration 0019 (250 / 700 / 1500 / 3000 / ...).
_CROSS_RANK_POINTS = [0, 300, 800, 1600, 3200, 6000, 10000, 22000]


def _crossroads_prefix(user) -> str:
    """The username stem every one of this developer's Crossroads bots shares,
    so a re-seed or a clear can find exactly them and nobody else."""
    compact = str(user.id).replace("-", "")[:12]
    return f"DevCross_{compact}_"


def _wipe_crossroads_bots(db: Session, user) -> int:
    """Delete this developer's Crossroads bots. Their encounters and pair rows
    go with them — both tables reference users ON DELETE CASCADE — so this both
    clears the plaza and keeps a re-seed from stacking duplicates."""
    n = db.execute(
        text("DELETE FROM users WHERE username LIKE :p AND is_bot"),
        {"p": _crossroads_prefix(user) + "%"},
    ).rowcount
    return int(n or 0)


@router.post("/paserby/seed")
def seed_crossroads(
    background: BackgroundTasks,
    payload: schemas.DevCrossroadsSeedIn | None = None,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Fill the caller's Crossroads with synthetic crossings for testing."""
    _require_dev(user)

    avatars = (payload.avatars if payload else None) or []
    count = (payload.count if payload else None) or (len(avatars) or _CROSSROADS_DEFAULT)
    count = max(1, min(int(count), _CROSSROADS_MAX))

    # Start clean so the count is exactly what was asked for rather than an
    # accumulation across taps.
    _wipe_crossroads_bots(db, user)

    # A few real clubs, if the world has been seeded, so some cards carry a clan
    # tag and colour. Absent on a bare local DB — then the bots simply have no
    # club, which is a valid card too.
    clan_ids = [
        r[0]
        for r in db.execute(text("SELECT id::text FROM clans ORDER BY created_at LIMIT 12")).fetchall()
    ]

    me = str(user.id)
    prefix = _crossroads_prefix(user)
    today = paserby.local_today()
    created = 0

    for i in range(count):
        bot_id = str(uuid.uuid4())
        # Level 1..30 via _level(xp) = floor(sqrt(xp/100)); a clean square keeps
        # the displayed level exact.
        level = 1 + (i % 30)
        xp = level * level * 100
        rank_points = _CROSS_RANK_POINTS[i % len(_CROSS_RANK_POINTS)]
        # Roughly half wear a club, cycling through whatever clubs exist.
        clan_id = clan_ids[i % len(clan_ids)] if clan_ids and i % 2 == 0 else None
        avatar = avatars[i % len(avatars)] if avatars else {}

        db.execute(
            text(
                """
                INSERT INTO users
                    (id, username, password_hash, created_at, clan_id, avatar,
                     is_bot, xp, rank_points, rank_points_at)
                VALUES
                    (:id, :u, NULL, now(), :cid, CAST(:avatar AS jsonb),
                     true, :xp, :rp, now())
                """
            ),
            {
                "id": bot_id,
                "u": f"{prefix}{i}",
                "cid": clan_id,
                "avatar": json.dumps(avatar or {}),
                "xp": xp,
                "rp": rank_points,
            },
        )
        if clan_id is not None:
            db.execute(
                text(
                    "INSERT INTO clan_members (clan_id, user_id, role) "
                    "VALUES (:cid, :uid, 'member')"
                ),
                {"cid": clan_id, "uid": bot_id},
            )

        # The encounter is stored with the pair ORDERED (user_a_id < user_b_id),
        # exactly as the matcher writes it — the CHECK constraint enforces it.
        a, b = sorted([me, bot_id])
        bot_is_a = a == bot_id
        # An incoming high five (the OTHER runner waved at me) lives on the bot's
        # side of the row. One in four, so both the "they waved" and the plain
        # states are on screen.
        incoming = i % 4 == 0
        a_hf = "now()" if (incoming and bot_is_a) else "NULL"
        b_hf = "now()" if (incoming and not bot_is_a) else "NULL"
        day = today - timedelta(days=_CROSS_DAY_OFFSETS[i % len(_CROSS_DAY_OFFSETS)])
        db.execute(
            text(
                f"""
                INSERT INTO paserby_encounters
                    (user_a_id, user_b_id, run_a_id, run_b_id, encounter_date,
                     user_a_high_five_at, user_b_high_five_at)
                VALUES
                    (CAST(:a AS uuid), CAST(:b AS uuid), NULL, NULL, :d,
                     {a_hf}, {b_hf})
                """
            ),
            {"a": a, "b": b, "d": day},
        )
        # The familiar-faces counter and the cooldown share this row; it is what
        # `times_crossed` and the familiarity label are read from.
        db.execute(
            text(
                """
                INSERT INTO paserby_pairs
                    (lower_user_id, higher_user_id, encounter_count, last_encounter_at)
                VALUES (CAST(:a AS uuid), CAST(:b AS uuid), :cnt, now())
                """
            ),
            {"a": a, "b": b, "cnt": _CROSS_COUNTS[i % len(_CROSS_COUNTS)]},
        )
        created += 1

    db.commit()
    summary = paserby.summary_for(db, user.id)
    # The seed stands in for a real run's matching pass, so it fires the same
    # notification that pass would — otherwise the only way to see the push and
    # the in-app banner is to go outside and run past somebody.
    if created:
        background.add_task(
            notify,
            [str(user.id)],
            "paserby",
            "Crossroads",
            paserby.crossroads_waiting_line(created),
            {"kind": "paserby_arrival", "screen": "crossroads", "count": created},
        )
    return {
        "ok": True,
        "created": created,
        "total": summary["total"],
        "unseen": summary["unseen"],
    }


@router.post("/paserby/clear")
def clear_crossroads(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Remove everything a previous seed put in the caller's Crossroads."""
    _require_dev(user)
    removed = _wipe_crossroads_bots(db, user)
    db.commit()
    return {"ok": True, "removed": removed}
