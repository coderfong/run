"""
Run lifecycle: /start-run, /submit-path, /end-run, /claim-territory.

CIRCLE-CLAIM MODEL: a run's distance converts to a circle whose CIRCUMFERENCE
equals that distance (r = d/2π, area = d²/4π). /end-run finalises the run and
returns the claim radius/area; the territory itself is only created when the
runner places the circle along their trail via /claim-territory. /submit-path
remains a pure streaming endpoint for partial GPS traces.
"""

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from geoalchemy2.shape import from_shape
from shapely.geometry import LineString
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import coins as coins_mod
from .. import energy as energy_mod
from .. import ranks
from .. import fitness, models, schemas
from ..anticheat import is_verified, validate_run
from ..notifications import notify
from .clans import add_clan_xp, clan_member_ids, record_clan_activity
from .progression import sync_level_rewards
from ..config import settings
from ..database import get_db
from ..geospatial import (
    circle_polygon_wgs,
    claim_area_m2,
    claim_radius_m,
    claim_shape_polygon_wgs,
    clean_path,
    detect_loop,
    geometry_to_rings,
    polygon_to_lonlat_ring,
)
from ..clans_meta import color_triple
from ..progression import SHAPE_UNLOCKS, level_from_xp, xp_for_level
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter()

# Cosmetic claim shape → minimum level required (reverse of SHAPE_UNLOCKS).
_SHAPE_MIN_LEVEL = {shape: lvl for lvl, shape in SHAPE_UNLOCKS.items()}

# Rivalry ledger floor: a clipped sliver isn't a rivalry beat (see the insert
# in claim_run and migration 0016). 25 m² ≈ a 5×5 m patch.
STEAL_LEDGER_MIN_M2 = 25.0


@router.post("/start-run", response_model=schemas.StartRunOut)
def start_run(
    payload: schemas.StartRunIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    started = payload.started_at or datetime.utcnow()
    run = models.Run(user_id=user.id, started_at=started)
    db.add(run)
    db.commit()
    db.refresh(run)
    return schemas.StartRunOut(run_id=run.id, started_at=run.started_at)


@router.post("/submit-path")
@limiter.limit(settings.rate_limit_submit_path)
def submit_path(
    request: Request,
    response: Response,
    payload: schemas.SubmitPathIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Stream-update endpoint. Returns whether a loop was detected so the
    client can give the user immediate feedback. Does NOT persist a
    territory — that only happens on /end-run, to keep the lifecycle clean."""
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")

    cleaned = clean_path(payload.points)
    if cleaned is None:
        return {"closed_loop": False, "preview_area_m2": None}

    loop = detect_loop(cleaned)
    if loop is None:
        return {"closed_loop": False, "preview_area_m2": None}

    return {
        "closed_loop": True,
        "preview_area_m2": loop.area_m2,
        "preview_polygon": polygon_to_lonlat_ring(loop.polygon_wgs),
    }


@router.post("/end-run", response_model=schemas.RunResultOut)
@limiter.limit(settings.rate_limit_end_run)
def end_run(
    request: Request,
    response: Response,
    payload: schemas.EndRunIn,
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is not None:
        raise HTTPException(409, "run already ended")

    cleaned = clean_path(payload.points)
    if cleaned is None or len(cleaned.metric_coords) < 2:
        # No usable path. Mark run ended with zero metrics rather than 500.
        run.ended_at = datetime.utcnow()
        run.distance_m = 0.0
        run.duration_s = (run.ended_at - run.started_at).total_seconds()
        db.commit()
        return schemas.RunResultOut(
            run_id=run.id,
            distance_m=0.0,
            duration_s=run.duration_s,
            closed_loop=False,
            territory=None,
        )

    # Persist the full cleaned path (in WGS84) for visualisation/debugging.
    line_wgs = LineString(cleaned.wgs_coords)
    run.path = from_shape(line_wgs, srid=4326)
    run.ended_at = datetime.utcnow()
    run.distance_m = cleaned.distance_m
    run.duration_s = (run.ended_at - run.started_at).total_seconds()

    # Anti-cheat on the RAW submitted points (clean_path scrubs exactly the
    # samples that betray a spoof). Shadow-flag: the response below looks
    # identical either way; flag_reasons never leaves the server.
    reasons = validate_run(payload.points, cleaned.distance_m, payload.step_count)
    run.flag_reasons = reasons or None
    run.verified = is_verified(reasons)

    # Circle claim earned by this run (placed later via /claim-territory).
    # Area is deterministic from distance, so PRs can record it now.
    eligible = run.distance_m >= settings.min_claim_distance_m
    radius = claim_radius_m(run.distance_m) if eligible else 0.0
    area = claim_area_m2(run.distance_m) if eligible else 0.0

    # Server-side splits + personal records (records only on verified runs).
    achievements = fitness.record_splits_and_prs(
        db, run.id, run.user_id, cleaned, run.distance_m, area, run.verified
    )

    # Advance the runner's clan weekly goal + season stats (no-op if clanless).
    # Flagged (unverified) runs never contribute to clan stats, goals, or XP.
    # Claim + steal credit lands at /claim-territory when the circle is placed.
    goal_reached, clan_id = (False, None)
    xp_gain = 0
    if run.verified:
        goal_reached, clan_id = record_clan_activity(
            db, user, distance_m=run.distance_m, closed_loop=False, stolen=0.0
        )
        xp_gain = round((run.distance_m / 1000.0) * settings.xp_per_km)
        if xp_gain > 0:
            db.execute(
                text("UPDATE users SET xp = xp + :g WHERE id = :uid"),
                {"g": xp_gain, "uid": user.id},
            )
            # Distance XP also advances the runner's club.
            add_clan_xp(db, clan_id or user.clan_id, xp_gain)
        # Finishing a run refills a little energy — exercise powers the meter.
        energy_mod.grant(db, user.id, settings.energy_per_run)
        # ...and pays coins, so the cosmetics shop is reachable by running.
        coins_mod.grant(db, user.id, coins_mod.COINS_PER_RUN, "run", str(run.id))

    db.commit()

    # Grant any level-up rewards (lootboxes) now that XP is committed.
    if run.verified and xp_gain > 0:
        sync_level_rewards(db, user.id)

    if goal_reached and clan_id:
        background.add_task(
            notify, clan_member_ids(db, clan_id, exclude=user.id), "clan_goal",
            "Weekly goal reached!", "Your club hit this week's goal. Badge frame unlocked.",
        )

    return schemas.RunResultOut(
        run_id=run.id,
        distance_m=run.distance_m,
        duration_s=run.duration_s,
        claim_radius_m=radius,
        claim_area_m2=area,
        achievements=achievements,
        xp_gained=xp_gain,
    )


@router.post("/claim-territory", response_model=schemas.ClaimOut)
@limiter.limit(settings.rate_limit_end_run)
def claim_territory(
    request: Request,
    response: Response,
    payload: schemas.ClaimIn,
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Place the run's circle claim. The centre must lie on the run's trail
    (within claim_snap_tolerance_m); the circle's circumference equals the
    run distance. One claim per run, ever."""
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is None:
        raise HTTPException(409, "run not finished yet")
    if run.claimed_at is not None:
        raise HTTPException(409, "claim already placed for this run")
    if run.path is None or not run.distance_m or run.distance_m < settings.min_claim_distance_m:
        raise HTTPException(422, "run too short to claim territory")

    on_trail = db.execute(
        text(
            """
            SELECT ST_DWithin(
                path::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                :tol
            )
            FROM runs WHERE id = :rid
            """
        ),
        {"lon": payload.lon, "lat": payload.lat, "tol": settings.claim_snap_tolerance_m, "rid": run.id},
    ).scalar()
    if not on_trail:
        raise HTTPException(422, "claim centre must be on your route")

    # Claiming costs energy (runs are always free — this is the game-layer
    # limiter). Check affordability BEFORE any mutation so a blocked claim
    # costs nothing; the actual deduction happens once the claim lands.
    if not energy_mod.can_afford(db, user.id, settings.energy_cost_claim):
        st = energy_mod.status(db, user.id)
        db.commit()
        raise HTTPException(
            402,
            f"Not enough energy to claim — {st['energy']}/{settings.energy_cost_claim}. "
            "It refills over time, or top up in the shop.",
        )

    # Sweep decayed land first: expired territories free up (and stop
    # defending). Lifetime = strength × life_days_per_strength.
    db.execute(
        text(
            "DELETE FROM territories WHERE now() >= created_at "
            "+ make_interval(secs => GREATEST(strength, 0.1) * :life_per * 86400)"
        ),
        {"life_per": settings.territory_life_days_per_strength},
    )

    area = claim_area_m2(run.distance_m)

    # Cosmetic claim shape (equal-area), gated by level — circle is always
    # allowed; an un-unlocked shape silently falls back to a circle.
    shape = (payload.shape or "circle").lower()
    if shape != "circle":
        xp = db.execute(text("SELECT COALESCE(xp,0) FROM users WHERE id = :u"), {"u": user.id}).scalar()
        if level_from_xp(int(xp or 0)) < _SHAPE_MIN_LEVEL.get(shape, 999):
            shape = "circle"
    claim_poly = claim_shape_polygon_wgs(payload.lat, payload.lon, area, shape)

    territory_out, stolen_m2, stolen_from, steal_events = _claim_territory(
        db=db,
        user_id=run.user_id,
        run_id=run.id,
        polygon_wgs=claim_poly,
        initial_area_m2=area,
        strength=claim_strength(run.distance_m, run.duration_s),
        verified=run.verified,
        clan_id=user.clan_id,
    )
    run.claimed_at = datetime.utcnow()

    # Rivalry ledger (migration 0016) — one row per victim, takes AND bounced
    # attacks. Slivers are dropped: a 3 m² clip off a polygon edge is a
    # rounding artefact, not a rivalry beat, and would drown the real ones.
    for ev in steal_events:
        if ev["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        db.execute(
            text(
                """
                INSERT INTO territory_steals
                    (attacker_id, victim_id, run_id, area_m2, defended, lat, lon)
                VALUES (:a, :v, :r, :area, :defended, :lat, :lon)
                """
            ),
            {
                "a": user.id,
                "v": ev["victim_id"],
                "r": run.id,
                "area": ev["area_m2"],
                "defended": ev["defended"],
                "lat": payload.lat,
                "lon": payload.lon,
            },
        )

    # The claim landed — deduct its energy cost.
    energy_mod.spend(db, user.id, settings.energy_cost_claim)

    # ---- rank points -------------------------------------------------------
    # Territorial only: claiming, taking and defending ground. Distance is
    # already paid in XP, so ranks stay a measure of standing, not mileage.
    ranks.award(db, user.id, ranks.POINTS_CLAIM, "claim")
    for ev in steal_events:
        if ev["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        if ev["defended"]:
            # The attack bounced — the DEFENDER is the one who earned here.
            ranks.award(db, ev["victim_id"], ranks.POINTS_DEFEND, "defend")
        else:
            # A steal moves points BOTH ways: the attacker gains, the victim
            # loses. Without the loss side, rank could only ever go up and
            # would just be a slower level.
            ranks.award(db, user.id, ranks.POINTS_STEAL, "steal")
            ranks.award(db, ev["victim_id"], ranks.POINTS_LOST, "lost_ground")

    goal_reached, clan_id = (False, None)
    xp_gain = 0
    # Snapshot XP before the award so the payoff screen can fill the bar from
    # where it was, and know whether this claim crossed a level.
    xp_before = int(
        db.execute(text("SELECT COALESCE(xp, 0) FROM users WHERE id = :u"), {"u": user.id}).scalar()
        or 0
    )
    if run.verified:
        goal_reached, clan_id = record_clan_activity(
            db, user, distance_m=0.0, closed_loop=True, stolen=stolen_m2
        )
        # Area-scaled reward: bigger claims — and bigger steals — earn more.
        # `claim_area_m2` is the ground this run's circle covers (not the
        # merged total), so re-claiming your own land can't farm XP.
        area_taken = claim_area_m2(run.distance_m)
        xp_gain = settings.xp_per_claim + round((area_taken / 1e6) * settings.xp_per_km2_claimed)
        if stolen_m2 > 0:
            xp_gain += settings.xp_per_steal + round((stolen_m2 / 1e6) * settings.xp_per_km2_stolen)
        db.execute(
            text("UPDATE users SET xp = xp + :g WHERE id = :uid"),
            {"g": xp_gain, "uid": user.id},
        )
        # Claims + steals also advance the runner's club.
        add_clan_xp(db, clan_id or user.clan_id, xp_gain)

    db.commit()

    # Hand out any level-up rewards (lootboxes) unlocked by this claim's XP.
    if run.verified and xp_gain > 0:
        sync_level_rewards(db, user.id)

    # Best-effort push notifications, off the request path. BOTH sides of a
    # take are notified: the victim who lost land ("stolen") and the attacker
    # who took it ("captured").
    if stolen_m2 > 0 and stolen_from:
        victim = db.execute(
            text("SELECT id::text FROM users WHERE username = :u"), {"u": stolen_from}
        ).fetchone()
        if victim:
            background.add_task(
                notify, [victim[0]], "stolen", "Your land is under attack",
                f"{user.username} took {round(stolen_m2):,} m² of your territory.",
            )
    if stolen_m2 > 0:
        from_str = f" from {stolen_from}" if stolen_from else ""
        background.add_task(
            notify, [str(user.id)], "captured", "Territory captured",
            f"You took {round(stolen_m2):,} m²{from_str} · +{xp_gain} XP.",
        )
    if goal_reached and clan_id:
        background.add_task(
            notify, clan_member_ids(db, clan_id, exclude=user.id), "clan_goal",
            "Weekly goal reached!", "Your club hit this week's goal. Badge frame unlocked.",
        )

    new_xp = xp_before + xp_gain
    level_before, new_level = level_from_xp(xp_before), level_from_xp(new_xp)

    est = energy_mod.status(db, user.id)
    db.commit()
    return schemas.ClaimOut(
        territory=territory_out,
        stolen_m2=stolen_m2,
        stolen_from=stolen_from,
        victims=_claim_victims(db, user.id, steal_events),
        xp_gained=xp_gain,
        level=new_level,
        xp=new_xp,
        next_level_xp=xp_for_level(new_level + 1),
        leveled_up=new_level > level_before,
        energy=est["energy"],
        energy_max=est["energy_max"],
    )


def _claim_victims(db: Session, attacker_id, events) -> list[schemas.ClaimVictim]:
    """Turn this claim's steal events into cards for the payoff screen.

    `reclaimed` is the good bit: it marks victims who had ALREADY taken land
    off this runner, which is what turns "territory claimed" into "you took it
    back". It reads the same ledger the rivals list does, so the two can never
    tell different stories.
    """
    if not events:
        return []
    by_id: dict[str, dict] = {}
    for ev in events:
        vid = str(ev["victim_id"])
        cur = by_id.setdefault(vid, {"area_m2": 0.0, "defended": True})
        cur["area_m2"] += ev["area_m2"]
        # One successful take is enough to call the whole encounter a take.
        if not ev["defended"]:
            cur["defended"] = False

    rows = db.execute(
        text(
            """
            SELECT u.id::text, u.username, u.avatar, c.color_key,
                   EXISTS (
                       SELECT 1 FROM territory_steals s
                       WHERE s.attacker_id = u.id
                         AND s.victim_id = :me
                         AND NOT s.defended
                   ) AS took_from_me
            FROM users u
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            WHERE u.id = ANY(CAST(:ids AS uuid[]))
            """
        ),
        {"me": attacker_id, "ids": list(by_id.keys())},
    ).fetchall()

    out = []
    for r in rows:
        agg = by_id.get(r[0])
        if not agg:
            continue
        out.append(
            schemas.ClaimVictim(
                user_id=r[0],
                username=r[1],
                avatar=r[2],
                clan_color=schemas.ClanColor(**color_triple(r[3])) if r[3] else None,
                area_m2=agg["area_m2"],
                defended=agg["defended"],
                reclaimed=bool(r[4]),
            )
        )
    # Biggest loss first; runners who held their ground sink to the bottom.
    out.sort(key=lambda v: (v.defended, -v.area_m2))
    return out


# Reference pace for strength: 7:00/km. Faster runs earn a stronger claim,
# clamped so a jog is never useless and a sprint can't be unbeatable.
STRENGTH_REF_PACE_S_PER_KM = 420.0
STRENGTH_MIN, STRENGTH_MAX = 0.6, 2.0


def claim_strength(distance_m: float, duration_s: float | None) -> float:
    """Pace-based strength of a single claim (~1.0 at 7:00/km, 2.0 capped)."""
    if not duration_s or not distance_m:
        return 1.0
    pace = duration_s / (distance_m / 1000.0)  # s per km
    mult = STRENGTH_REF_PACE_S_PER_KM / max(pace, 1.0)
    return round(min(STRENGTH_MAX, max(STRENGTH_MIN, mult)), 2)


def _claim_territory(
    db: Session,
    user_id: str,
    run_id: str,
    polygon_wgs,
    initial_area_m2: float,
    strength: float = 1.0,
    verified: bool = True,
    clan_id: str | None = None,
):  # -> (TerritoryOut | None, stolen_m2, stolen_from, events)
    """Insert the new polygon, resolving overlaps with existing territories.

    Rules (strength model):
      * Every claim carries a pace-based `strength`.
      * RIVALS = other users OUTSIDE the claimer's club. For each rival
        overlap, the attack succeeds only if the claim's strength beats the
        rival's strength PLUS the summed strength of the rival's clubmates'
        territories overlapping the same spot (stacked defense). Beaten
        rivals lose the overlap (ST_Difference); successful defenses carve
        the defended land OUT of the new claim instead.
      * CLUBMATES' land is never stolen — overlapping club claims coexist,
        which is exactly what makes their defense stack.
      * Where this polygon overlaps the SAME USER's territory, the rows are
        unioned and their strengths SUM — re-running the same block makes it
        stronger.
      * SHADOW-FLAGGED runs (verified=False) get a standalone unverified
        row: no stealing from rivals, no merging into verified land. The
        submitter still sees a normal-looking territory in the response.

    All overlap math is done in PostGIS (server-side) to keep it
    transactional and to use the GIST index on territories.polygon.
    The returned area is recomputed via ST_Area on a geography cast,
    which handles WGS84 properly.
    """
    new_geom_wkt = polygon_wgs.wkt  # WGS84

    if not verified:
        # Flagged: insert the row for the owner's eyes only and stop —
        # a cheat must not damage anyone else's land.
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified, clan_id, strength)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    false,
                    :clan_id,
                    :strength
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {"uid": user_id, "rid": run_id, "wkt": new_geom_wkt, "clan_id": clan_id, "strength": strength},
        ).fetchone()
        return _territory_out(db, new_row[0]), 0.0, None, []

    # Pull rivals that intersect: other users OUTSIDE the claimer's club.
    rivals = db.execute(
        text(
            """
            SELECT id, user_id
            FROM territories
            WHERE user_id <> :uid
              AND verified
              AND (CAST(:clan_id AS uuid) IS NULL OR clan_id IS NULL OR clan_id <> :clan_id)
              AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {"uid": user_id, "wkt": new_geom_wkt, "clan_id": clan_id},
    ).fetchall()

    # Steal summary for the Result screen: total area taken from rivals + the
    # rival who lost the most. `defended_ids` collects rivals whose strength
    # held — their land is carved out of the new claim afterwards.
    # `events` is the per-victim ledger the caller persists (rivalries) —
    # successful takes AND bounced attacks, since a defence is a rivalry beat
    # too.
    stolen_total = 0.0
    best_steal = 0.0
    stolen_from = None
    defended_ids = []
    events = []

    for rid, _ruid in rivals:
        steal = db.execute(
            text(
                """
                SELECT ST_Area(ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))::geography),
                       u.username,
                       t.strength,
                       COALESCE((
                           SELECT SUM(t2.strength) FROM territories t2
                           WHERE t.clan_id IS NOT NULL
                             AND t2.clan_id = t.clan_id
                             AND t2.id <> t.id
                             AND t2.verified
                             AND ST_Intersects(
                                   t2.polygon,
                                   ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))
                                 )
                       ), 0) AS club_support
                FROM territories t JOIN users u ON u.id = t.user_id
                WHERE t.id = :rid
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid},
        ).fetchone()
        if not steal or not steal[0]:
            continue

        defense = float(steal[2] or 1.0) + float(steal[3] or 0.0)
        if strength <= defense:
            # The land holds: attacker's claim will be carved around it.
            defended_ids.append(rid)
            events.append({"victim_id": _ruid, "area_m2": float(steal[0]), "defended": True})
            continue

        stolen_total += float(steal[0])
        if float(steal[0]) > best_steal:
            best_steal = float(steal[0])
            stolen_from = steal[1]
        events.append({"victim_id": _ruid, "area_m2": float(steal[0]), "defended": False})

        # Subtract the new polygon from the rival's territory. ALL surviving
        # fragments are kept as one MultiPolygon — only sub-1m² slivers are
        # dropped. A rival row that loses everything is deleted below.
        db.execute(
            text(
                """
                WITH diff AS (
                    SELECT ST_MakeValid(
                        ST_Difference(polygon, ST_GeomFromText(:wkt, 4326))
                    ) AS g
                    FROM territories WHERE id = :rid
                ),
                parts AS (
                    SELECT (ST_Dump(ST_CollectionExtract(g, 3))).geom AS g FROM diff
                ),
                kept AS (
                    SELECT ST_Multi(ST_Collect(g)) AS g
                    FROM parts
                    WHERE ST_Area(g::geography) >= :min_area
                )
                UPDATE territories t
                SET polygon = kept.g,
                    area_m2 = ST_Area(kept.g::geography)
                FROM kept
                WHERE t.id = :rid AND kept.g IS NOT NULL
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, "min_area": 1.0},
        )
        # Fully consumed (nothing above the sliver floor survived): the
        # UPDATE above no-ops, so remove the row explicitly.
        db.execute(
            text(
                """
                DELETE FROM territories
                WHERE id = :rid
                  AND ST_Area(
                        ST_MakeValid(
                            ST_Difference(polygon, ST_GeomFromText(:wkt, 4326))
                        )::geography
                      ) < :min_area
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, "min_area": 1.0},
        )

    # Drop rival rows that became empty/sliver after subtraction.
    db.execute(
        text(
            """
            DELETE FROM territories
            WHERE user_id <> :uid
              AND verified
              AND (polygon IS NULL OR ST_IsEmpty(polygon) OR area_m2 < :min_area)
            """
        ),
        {"uid": user_id, "min_area": 1.0},
    )

    # Land that successfully DEFENDED gets carved out of the new claim.
    for rid in defended_ids:
        carved = db.execute(
            text(
                """
                SELECT ST_AsText(ST_CollectionExtract(ST_MakeValid(
                    ST_Difference(ST_GeomFromText(:wkt, 4326), polygon)
                ), 3))
                FROM territories WHERE id = :rid
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid},
        ).scalar()
        if carved:
            new_geom_wkt = carved
    if defended_ids:
        remaining = db.execute(
            text("SELECT ST_Area(ST_GeomFromText(:wkt, 4326)::geography)"),
            {"wkt": new_geom_wkt},
        ).scalar()
        if not remaining or float(remaining) < 1.0:
            raise HTTPException(
                409, "that land is too strong to take — run faster or stack claims with your club"
            )

    # Union with same-user existing territories so the runner's land grows;
    # their strengths SUM (re-claiming the same block stacks it stronger).
    same_user = db.execute(
        text(
            """
            SELECT ST_AsText(ST_Union(polygon)), COALESCE(SUM(strength), 0)
            FROM territories
            WHERE user_id = :uid
              AND verified
              AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {"uid": user_id, "wkt": new_geom_wkt},
    ).fetchone()
    same_user_union = same_user[0] if same_user else None
    merged_strength = round(strength + float(same_user[1] or 0.0), 2) if same_user else strength

    if same_user_union is not None:
        # Replace existing same-user overlapping rows with a single merged row.
        db.execute(
            text(
                """
                DELETE FROM territories
                WHERE user_id = :uid
                  AND verified
                  AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
                """
            ),
            {"uid": user_id, "wkt": new_geom_wkt},
        )
        # Union new polygon with the existing same-user union. ST_Union may
        # naturally yield a MultiPolygon (e.g. the new run doesn't bridge
        # two previously disjoint territories) — we keep every piece.
        new_row = db.execute(
            text(
                """
                WITH merged AS (
                    SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(
                        ST_GeomFromText(:new_wkt, 4326),
                        ST_GeomFromText(:old_wkt, 4326)
                    )), 3)) AS g
                )
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified, clan_id, strength)
                SELECT gen_random_uuid(), :uid, :rid, g,
                       ST_Area(g::geography), now(), true, :clan_id, :strength
                FROM merged
                RETURNING id, area_m2, created_at
                """
            ),
            {
                "uid": user_id,
                "rid": run_id,
                "new_wkt": new_geom_wkt,
                "old_wkt": same_user_union,
                "clan_id": clan_id,
                "strength": merged_strength,
            },
        ).fetchone()
    else:
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified, clan_id, strength)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    true,
                    :clan_id,
                    :strength
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {"uid": user_id, "rid": run_id, "wkt": new_geom_wkt, "clan_id": clan_id, "strength": strength},
        ).fetchone()

    return _territory_out(db, new_row[0]), stolen_total, stolen_from, events


def _territory_out(db: Session, tid) -> schemas.TerritoryOut | None:
    """Read a territory back and shape it for the API response."""
    row = db.execute(
        text(
            """
            SELECT t.id::text, t.user_id::text, u.username, t.area_m2, t.created_at,
                   ST_AsText(t.polygon), t.strength
            FROM territories t
            JOIN users u ON u.id = t.user_id
            WHERE t.id = :tid
            """
        ),
        {"tid": tid},
    ).fetchone()

    if row is None:
        return None

    _id, uid, username, a, created, wkt, strength = row
    from shapely import wkt as shapely_wkt

    geom = shapely_wkt.loads(wkt)
    rings = geometry_to_rings(geom)  # largest-first

    return schemas.TerritoryOut(
        id=_id,
        user_id=uid,
        username=username,
        area_m2=float(a),
        created_at=created,
        polygon=rings[0] if rings else [],  # legacy: largest ring
        rings=rings,
        strength=float(strength or 1.0),
    )
