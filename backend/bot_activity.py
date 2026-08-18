"""Scheduled: let seeded bot players go on runs.

Run by the `territory-run-bots` cron in render.yaml, on the same "talk to the
database directly" pattern as sweep.py — no HTTP hop, no shared secret, and it
does not care whether the web service is up.

Each tick, every bot whose `bot_accounts.next_run_at` has passed (capped at
BATCH_SIZE per tick so one slow tick can't starve the rest of the schedule)
"goes on a run": a plausible recreational distance/pace produces a claim via
the exact same overlap-resolution helper (`_claim_territory`) a real run's
/claim uses, so strength, decay, clan defense-stacking and the rivalry ledger
all behave identically to a human claim. Most runs reinforce/expand near the
bot's own home patch. A small fraction of eligible "attacker" bots instead
raid TARGET_USERNAME's current territory — see ATTACK_CHANCE below for the
frequency math. A real victim (never a bot one) gets the same "stolen"
notification a human attacker would have triggered.

    python bot_activity.py

Idempotent per tick in the sense that matters: a bot only becomes due again
after this tick pushes its next_run_at forward, so a cron firing every 30
minutes cannot double-run the same bot in one pass.
"""

from __future__ import annotations

import math
import random
import sys
from datetime import datetime, timedelta

from sqlalchemy import text

from app.database import SessionLocal
from app.geospatial import circle_polygon_wgs, claim_area_m2, claim_radius_m
from app.notifications import notify
from app.routes.runs import STEAL_LEDGER_MIN_M2, _claim_territory, claim_lifetime_days, claim_strength

TARGET_USERNAME = "jonfong78"

# How many due bots to process in one cron tick. At the recommended 30-minute
# schedule with ~120 bots each running every 1-2 days, the average tick has
# ~2-3 due bots; this just bounds the worst case (a missed tick or two).
BATCH_SIZE = 20

# A bot goes on its next run in [MIN_GAP, MAX_GAP] hours — "about once every
# 1-2 days", matching how often a real casual player runs.
MIN_GAP_HOURS = 20.0
MAX_GAP_HOURS = 56.0

# Of every DUE RUN from an attacker-eligible bot (~22% of the roster, set at
# seed time), this fraction targets TARGET_USERNAME's own territory instead
# of the bot's home turf. With ~26 eligible bots each running ~once every 38h
# average, the pool produces roughly 26 * (24/38) ≈ 16 runs/day ≈ 115/week;
# 0.035 * 115 ≈ 4 raids/week — "a few times a week", tune this one constant
# to change that cadence.
ATTACK_CHANCE = 0.035

# A bot's home-turf run stays within this radius of its home point, so its
# territory drifts and occasionally bumps a neighbour rather than teleporting.
HOME_JITTER_M = 350.0


def _due_bots(db, limit: int):
    return db.execute(
        text(
            """
            SELECT b.user_id, u.username, u.clan_id, u.avatar, b.home_lat, b.home_lon, b.attacker
            FROM bot_accounts b
            JOIN users u ON u.id = b.user_id
            WHERE b.next_run_at <= now()
            ORDER BY b.next_run_at
            LIMIT :n
            """
        ),
        {"n": limit},
    ).fetchall()


def _target_territory(db):
    """A random one of TARGET_USERNAME's currently-live territories, or None."""
    rows = db.execute(
        text(
            """
            SELECT ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon))
            FROM territories t JOIN users u ON u.id = t.user_id
            WHERE u.username = :n AND t.verified
              AND (t.expires_at IS NULL OR t.expires_at > now())
            """
        ),
        {"n": TARGET_USERNAME},
    ).fetchall()
    if not rows:
        return None
    return random.choice(rows)


def _meters_to_degrees(lat: float, dx_m: float, dy_m: float) -> tuple[float, float]:
    dlat = dy_m / 111_320.0
    dlon = dx_m / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
    return dlat, dlon


def _run_one(db, bot_row, background_notifies: list) -> None:
    user_id, username, clan_id, avatar, home_lat, home_lon, attacker = bot_row

    distance_m = random.triangular(1800, 8000, 3500)
    pace_s_per_km = random.triangular(300, 480, 380)
    duration_s = distance_m / 1000.0 * pace_s_per_km

    is_attack = False
    lat, lon = home_lat, home_lon
    if attacker and random.random() < ATTACK_CHANCE:
        target = _target_territory(db)
        if target is not None:
            is_attack = True
            t_lat, t_lon = target
            dlat, dlon = _meters_to_degrees(
                t_lat, random.uniform(-150, 150), random.uniform(-150, 150)
            )
            lat, lon = t_lat + dlat, t_lon + dlon
    if not is_attack:
        dlat, dlon = _meters_to_degrees(
            home_lat, random.uniform(-HOME_JITTER_M, HOME_JITTER_M),
            random.uniform(-HOME_JITTER_M, HOME_JITTER_M),
        )
        lat, lon = home_lat + dlat, home_lon + dlon

    poly = circle_polygon_wgs(lat, lon, claim_radius_m(distance_m))
    territory_out, _stolen_m2, _stolen_from, steal_events, _ground = _claim_territory(
        db=db,
        user_id=user_id,
        run_id=None,
        polygon_wgs=poly,
        initial_area_m2=claim_area_m2(distance_m),
        strength=claim_strength(distance_m, duration_s),
        verified=True,
        clan_id=clan_id,
        lifetime_for=lambda r: claim_lifetime_days(distance_m, duration_s, r),
    )

    centre = poly.centroid
    for ev in steal_events:
        if ev["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        db.execute(
            text(
                """
                INSERT INTO territory_steals (attacker_id, victim_id, run_id, area_m2, defended, lat, lon)
                VALUES (:a, :v, NULL, :area, :defended, :lat, :lon)
                """
            ),
            {
                "a": user_id, "v": ev["victim_id"], "area": ev["area_m2"],
                "defended": ev["defended"], "lat": centre.y, "lon": centre.x,
            },
        )
        # Only a REAL victim gets a push — a bot losing land to another bot is
        # invisible noise nobody needs woken up for.
        if ev["defended"]:
            continue
        victim_is_real = db.execute(
            text("SELECT NOT is_bot FROM users WHERE id = :v"), {"v": ev["victim_id"]}
        ).scalar()
        if victim_is_real:
            background_notifies.append(
                (
                    [str(ev["victim_id"])],
                    "stolen",
                    "Your land was captured",
                    f"{username} took {ev['area_m2'] / 1_000_000:.3f} km² of your territory.",
                    {
                        "capture_id": f"bot:{user_id}:{ev['victim_id']}:{centre.x:.5f},{centre.y:.5f}",
                        "taken_m2": ev["area_m2"],
                        "lat": centre.y,
                        "lon": centre.x,
                        "attacker_id": str(user_id),
                        "attacker_username": username,
                        "attacker_avatar": avatar or {},
                        "territory_id": str(territory_out.id) if territory_out else None,
                    },
                    str(user_id),
                )
            )

    next_run_at = datetime.utcnow() + timedelta(hours=random.uniform(MIN_GAP_HOURS, MAX_GAP_HOURS))
    db.execute(
        text("UPDATE bot_accounts SET next_run_at = :n WHERE user_id = :u"),
        {"n": next_run_at, "u": user_id},
    )


def main() -> int:
    db = SessionLocal()
    processed = 0
    failed = 0
    notifies: list = []
    try:
        due = _due_bots(db, BATCH_SIZE)
        for row in due:
            try:
                _run_one(db, row, notifies)
                db.commit()
                processed += 1
            except Exception as exc:  # noqa: BLE001 — one bad bot must not sink the tick
                db.rollback()
                failed += 1
                print(f"bot run FAILED for {row[1]}: {exc}", file=sys.stderr)
    finally:
        db.close()

    # Notifications are best-effort and fire after every claim is committed,
    # same ordering the real /claim endpoint uses.
    for args in notifies:
        try:
            notify(*args)
        except Exception as exc:  # noqa: BLE001
            print(f"notify FAILED: {exc}", file=sys.stderr)

    print(f"bot_activity ok — {processed} bots ran, {failed} failed, {len(notifies)} raid notifications sent")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
