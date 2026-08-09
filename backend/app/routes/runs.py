"""
Run lifecycle: /start-run, /submit-path, /end-run, /claim-territory.

ROUTE-GROWN CLAIM MODEL: a run's distance decides how MUCH land it earns
(linear — see geospatial.claim_area_m2); the route decides what that land
LOOKS like. /end-run finalises the run and returns both the area and
`claim_ring`, the territory grown around the middle of the trail, so the result
screen can show the ground before it is taken.

WHERE that land goes is the runner's move: /runs/{id}/claim-options returns the
positions along the route the earned area could be deployed to, each with what
it would take, and /claim-territory takes the one at the index it is given.
Only the index travels — the shapes are always rebuilt server-side from the
stored route. /submit-path remains a pure streaming endpoint for partial GPS
traces.
"""

import math
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from geoalchemy2.shape import from_shape
from shapely import wkt as shapely_wkt
from shapely.geometry import LineString
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import coins as coins_mod
from .. import economy
from .. import energy as energy_mod
from .. import paserby
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
    claim_placements,
    claim_radius_m,
    claim_rotation_offsets,
    claim_window_frac,
    clean_path,
    metric_frame,
    rotate_claim_polygon_wgs,
    route_attachment,
    route_corridor,
    route_unique_length_m,
    detect_loop,
    geometry_to_rings,
    polygon_to_lonlat_ring,
    route_claim_polygon_wgs,
)
from ..clans_meta import color_triple
from ..progression import level_from_xp, xp_for_level
from ..ratelimit import limiter
from ..security import current_user, require_admin

router = APIRouter()

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
    # Run timestamps are naive UTC: the column carries no timezone and every
    # duration in this file is measured against `datetime.utcnow()`. An ISO
    # string ending in Z is the ordinary way for a client to write a time, and
    # it parses AWARE — which lands in a column with nowhere to keep the offset
    # and makes the next `utcnow() - started_at` raise. Normalise at the door.
    if started.tzinfo is not None:
        started = started.astimezone(timezone.utc).replace(tzinfo=None)
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
    """Stream-update endpoint. Does NOT persist a territory — that only happens
    on /end-run, to keep the lifecycle clean.

    It also carries the LIVE economy estimate, which is the point of it now:
    the running screen used to keep its own copy of the claim formula and had
    drifted onto a model the server retired, promising ~5x the land it would
    actually grant. `daily_claim_distance_m` is the anchor the client needs —
    territory comes off a CUMULATIVE daily curve, so what a run is worth
    depends on what else was run today, and only the server knows that.
    """
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")

    banked = economy.claim_distance_today(db, user.id, exclude_run_id=run.id)
    out = {
        "closed_loop": False,
        "preview_area_m2": None,
        "economy_version": economy.ECONOMY_VERSION,
        "daily_claim_distance_m": banked,
    }

    cleaned = clean_path(payload.points)
    if cleaned is None:
        return out

    duration_s = max(0.0, (datetime.utcnow() - run.started_at).total_seconds())
    unique_m = route_unique_length_m(cleaned.wgs_coords)
    tier = economy.run_tier(cleaned.distance_m, duration_s, unique_m)
    out.update(
        {
            "distance_m": cleaned.distance_m,
            "duration_s": duration_s,
            "qualification_tier": tier,
            "qualification_reason": economy.gate_reason_for(
                tier, cleaned.distance_m, duration_s, unique_m
            ),
            "estimated_claim_area_m2": (
                economy.entitled_area_m2(banked, cleaned.distance_m)
                if tier == economy.CLAIMABLE
                else 0.0
            ),
        }
    )

    loop = detect_loop(cleaned)
    if loop is not None:
        out["closed_loop"] = True
        out["preview_area_m2"] = loop.area_m2
        out["preview_polygon"] = polygon_to_lonlat_ring(loop.polygon_wgs)
    return out


def _lock_user(db: Session, user_id) -> None:
    """Serialise one user's economy for the rest of the transaction.

    Daily caps, the territorial entitlement, the neutral-expansion limit and
    the first-claim discount are all "how much has this person already used
    today" questions. Two concurrent requests would each read the same answer
    and each spend it. A row lock on the user is the smallest thing that makes
    those reads authoritative — application-level checks alone cannot.
    """
    db.execute(text("SELECT id FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})


def _end_run_replay(db: Session, run) -> schemas.RunResultOut:
    """The stored outcome of a run that has already finished.

    Rebuilt from what was persisted, never recomputed — recomputing would pay
    a second time and, for a run whose day has since rolled over, would pay a
    different amount. The claim ring is regrown from the stored route and
    stored area, which are both frozen, so it is identical every time.
    """
    tier = run.tier or economy.CLAIMABLE
    eligible = economy.claim_allowed(tier) and run.claimed_at is None
    area = float(run.claim_area_m2 or 0.0)
    claim_ring = []
    if eligible and area > 0:
        route = _run_route(db, run)
        if route:
            half = claim_window_frac(route) / 2.0
            preview = route_claim_polygon_wgs(route, area, window=(0.5 - half, 0.5 + half))
            if preview is not None:
                claim_ring = polygon_to_lonlat_ring(preview)
    return schemas.RunResultOut(
        run_id=run.id,
        distance_m=run.distance_m or 0.0,
        duration_s=run.duration_s or 0.0,
        claim_radius_m=claim_radius_m(run.distance_m or 0.0) if eligible else 0.0,
        claim_area_m2=area,
        claim_ring=claim_ring,
        achievements=[],
        xp_gained=int(run.reward_xp or 0),
        tier=tier,
        qualification_reason=run.gate_reason,
        claim_eligible=eligible,
        verification_state=economy.verification_state(tier),
        coins_gained=int(run.reward_coins or 0),
        energy_gained=int(run.reward_energy or 0),
        replayed=True,
    )


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

    # A finished run REPLAYS rather than 409s. A client that lost its response
    # — flaky network, backgrounded app, an impatient second tap — otherwise
    # had no way to recover the result of a run it can never repeat. Rewards
    # are not recomputed: the stored answer is the answer.
    if run.ended_at is not None:
        return _end_run_replay(db, run)

    # Serialise this user's economy for the length of the transaction. Two
    # runs ending at once would otherwise read the same daily totals and both
    # be paid in full against the same allowance.
    _lock_user(db, user.id)

    cleaned = clean_path(payload.points)
    if cleaned is None or len(cleaned.metric_coords) < 2:
        # No usable path. Mark run ended with zero metrics rather than 500.
        run.ended_at = datetime.utcnow()
        run.distance_m = 0.0
        run.duration_s = (run.ended_at - run.started_at).total_seconds()
        run.tier = economy.UNQUALIFIED
        run.gate_reason = economy.REASON_MIN_REWARD_DISTANCE
        run.reward_coins = run.reward_energy = run.reward_xp = 0
        run.claim_distance_m = 0.0
        run.claim_area_m2 = 0.0
        db.commit()
        return _end_run_replay(db, run)

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

    # Is this a run at all? Three bars, not one: enough distance, enough time,
    # and enough DISTINCT ground (so laps of a corridor, or a phone on a
    # shaking desk, clear none of them). Everything below is gated on the
    # answer — a flat payout for any finished activity made a 20 m walk the
    # best coins-per-minute in the game.
    unique_m = route_unique_length_m(cleaned.wgs_coords)
    tier = economy.run_tier(run.distance_m, run.duration_s, unique_m, verified=run.verified)
    gate_reason = economy.gate_reason_for(tier, run.distance_m, run.duration_s, unique_m)
    run.tier = tier
    run.gate_reason = gate_reason

    # Land earned by this run, as a slice of the DAY's diminishing curve
    # rather than a fresh curve per run — otherwise ten 1 km runs earn ten
    # untapered first kilometres and splitting a run beats running it.
    # Frozen here: the claim uses this stored number, so the preview and the
    # claim can never disagree, and a later run can never change what an
    # earlier one was worth.
    eligible = economy.claim_allowed(tier)
    if economy.consumes_entitlement(tier):
        before_m = economy.claim_distance_today(db, user.id, exclude_run_id=run.id)
        run.claim_distance_m = run.distance_m
        area = economy.entitled_area_m2(before_m, run.distance_m)
    elif eligible:
        # Shadow-flagged: it gets a shape so the submitter sees a normal
        # result, but it banks no entitlement — the day's real allowance is
        # untouched, so a spoof cannot shrink a later honest run's claim.
        run.claim_distance_m = 0.0
        area = claim_area_m2(run.distance_m)
    else:
        run.claim_distance_m = 0.0
        area = 0.0
    run.claim_area_m2 = area
    radius = claim_radius_m(run.distance_m) if eligible else 0.0
    claim_ring = []
    if eligible:
        # The MIDDLE placement, not the whole route: since the earned land is
        # deployed onto a window of the run, that window is what the result
        # screen must show. Built directly rather than via `claim_placements`
        # so /end-run still grows exactly one polygon — the full list of
        # candidates is /claim-options' job, once the runner asks to aim.
        half = claim_window_frac(cleaned.wgs_coords) / 2.0
        preview = route_claim_polygon_wgs(
            cleaned.wgs_coords, area, window=(0.5 - half, 0.5 + half)
        )
        if preview is not None:
            claim_ring = polygon_to_lonlat_ring(preview)

    # Server-side splits + personal records (records only on verified runs).
    achievements = fitness.record_splits_and_prs(
        db, run.id, run.user_id, cleaned, run.distance_m, area, run.verified
    )

    # Advance the runner's clan weekly goal + season stats (no-op if clanless).
    # Flagged (unverified) runs never contribute to clan stats, goals, or XP.
    # Claim + steal credit lands at /claim-territory when the ground is taken.
    goal_reached, clan_id = (False, None)
    xp_gain = 0
    award = {"coins": 0, "energy": 0, "coins_capped": False, "energy_capped": False}
    if economy.rewards_earned(tier):
        goal_reached, clan_id = record_clan_activity(
            db, user, distance_m=run.distance_m, closed_loop=False, stolen=0.0
        )
        xp_gain = round((run.distance_m / 1000.0) * settings.xp_per_km)
        # Every payout is reserved against a run-derived key before any
        # balance moves. A retry collides on the key and pays nothing; the
        # decision never depends on what the balance happens to be.
        if xp_gain > 0 and economy.claim_grant(
            db, user.id, run.id, economy.KIND_RUN_XP, xp_gain
        ):
            db.execute(
                text("UPDATE users SET xp = xp + :g WHERE id = :uid"),
                {"g": xp_gain, "uid": user.id},
            )
            # Distance XP also advances the runner's club.
            add_clan_xp(db, clan_id or user.clan_id, xp_gain)
        # Both scale with the run and are capped daily, so going further is
        # worth more and going out ten times is not worth more than going far.
        award = economy.award_for_run(
            db, user.id, run.id, run.distance_m, run.duration_s, tier
        )
        if award["energy"] > 0 and economy.claim_grant(
            db, user.id, run.id, economy.KIND_ENERGY, award["energy"]
        ):
            energy_mod.grant(db, user.id, award["energy"])
        if award["coins"] > 0 and economy.claim_grant(
            db, user.id, run.id, economy.KIND_COINS, award["coins"]
        ):
            coins_mod.grant(db, user.id, award["coins"], "run", str(run.id))

    run.reward_coins = award["coins"]
    run.reward_energy = award["energy"]
    run.reward_xp = xp_gain

    # PASERBY: sample this route into the short-lived trace table so a later
    # run can be matched against it. A no-op unless the run is verified, past
    # the reward bar, and the runner has Crossed Paths switched on — so every
    # anti-cheat rule above gates the social feature for free. Committed with
    # the rest of the run.
    paserby.record_trace(db, run, cleaned)
    db.commit()

    # ...and then look for company, off the request path. Both runs have to
    # have ENDED for a crossing to exist, which is exactly what this is: the
    # one that just finished, against everyone who finished before it.
    background.add_task(paserby.process_run_task, str(run.id))

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
        claim_ring=claim_ring,
        achievements=achievements,
        xp_gained=xp_gain,
        tier=tier,
        qualification_reason=gate_reason,
        claim_eligible=eligible,
        verification_state=economy.verification_state(tier),
        coins_gained=award["coins"],
        energy_gained=award["energy"],
        coins_capped=award["coins_capped"],
        energy_capped=award["energy_capped"],
    )


def run_expiry_sweep(db: Session) -> dict:
    """The sweep itself, callable without a request.

    Lives apart from the route so the scheduled job (`backend/sweep.py`) can
    run it in-process against the database instead of calling its own API over
    HTTP with a shared secret. One implementation, and the cron has no network
    dependency on the web service being up.

    Claims used to run an unqualified `DELETE` over the whole territories table,
    so one runner pressing Claim did the map's housekeeping and paid for it in
    latency. A claim now only sweeps the ground it is standing on; this is what
    tidies everywhere else.

    It also credits HOLDS. Rank measured taking and losing but never keeping,
    because `POINTS_HOLD` had no job to award it from. Land that has survived
    `hold_credit_hours` since its last credit earns its owner a couple of
    points, capped per sweep so someone sitting on sixty zones cannot out-earn
    every contested outcome in the game by doing nothing.

    Left open for a scheduled trigger; lock it down before production, exactly
    like /admin/recompute-season.
    """
    params = {"life_per": settings.territory_life_days_per_strength}
    expired = db.execute(
        text("DELETE FROM territories t WHERE NOT (" + _live("t") + ")"), params
    ).rowcount

    # UPDATE ... RETURNING is both the worklist and the guard: the rows that
    # were actually stamped are exactly the ones this run may pay for, so a
    # double-fired job cannot credit the same 48 hours twice.
    credited = db.execute(
        text(
            "UPDATE territories t SET hold_credited_at = now() "
            "WHERE t.verified AND " + _live("t") + " "
            "AND COALESCE(t.hold_credited_at, t.created_at) "
            # `secs`, not `hours`: make_interval's hours parameter is an int, so
            # a fractional setting (or a plain float 48.0) fails to resolve the
            # function at all. Every other interval in this file is built the
            # same way for the same reason.
            "    <= now() - make_interval(secs => :hold_secs) "
            "RETURNING t.user_id::text"
        ),
        {**params, "hold_secs": settings.hold_credit_hours * 3600.0},
    ).fetchall()

    from collections import Counter

    held = Counter(r[0] for r in credited)
    for uid, n in held.items():
        ranks.award(
            db, uid, min(n, settings.hold_credit_max_per_sweep) * ranks.POINTS_HOLD, "hold"
        )
    db.commit()
    return {
        "ok": True,
        "expired_removed": expired,
        "territories_credited": len(credited),
        "runners_credited": len(held),
    }


@router.post("/admin/sweep-expired", dependencies=[Depends(require_admin)])
def sweep_expired(db: Session = Depends(get_db)):
    """Manual trigger for the expiry sweep. The scheduled path is
    `backend/sweep.py`; this exists so it can also be kicked by hand.

    Gated on `X-Admin-Token` — it deletes territory and awards rank across
    every account, so it was never something to leave open."""
    return run_expiry_sweep(db)


def _run_route(db: Session, run) -> list[tuple[float, float]]:
    """The run's stored route as [(lon, lat), ...]. Everything about a claim's
    shape and position comes from here — never from the client."""
    path_wkt = db.execute(
        text("SELECT ST_AsText(path) FROM runs WHERE id = :rid"), {"rid": run.id}
    ).scalar()
    try:
        return [(x, y) for x, y in shapely_wkt.loads(path_wkt).coords] if path_wkt else []
    except Exception:
        return []


# A placement overlap smaller than this is a clipped edge, not a battle. Same
# floor the rivalry ledger uses, so the preview and the payoff agree.
PLACEMENT_MIN_M2 = STEAL_LEDGER_MIN_M2


def _live(alias: str) -> str:
    """SQL for "this territory has not expired yet".

    Expired rows are swept lazily — a scheduled job, plus a LOCAL sweep at
    claim time (see `/admin/sweep-expired`). Nothing may assume the sweep has
    run, so every query that asks who holds a piece of ground treats an expired
    row as already neutral. Otherwise dead land goes on defending until
    somebody happens to claim near it.
    """
    return (
        f"now() < COALESCE({alias}.expires_at, {alias}.created_at + "
        f"make_interval(secs => GREATEST({alias}.strength, 0.1) * :life_per * 86400))"
    )


def _club_support_sql(owner: str, overlap_expr: str, source: str = "territories") -> str:
    """The strengths of every clubmate territory overlapping this ground.

    Returns the RAW list, ordered strongest first — the weighting lives in
    `club_support_falloff` and nowhere else. Doing the arithmetic in SQL would
    have meant two copies of the rule, one of them untestable without a
    database, which is exactly the split that let the client and server drift
    apart over the claim formula.
    """
    extra = "" if source != "territories" else f" AND t2.verified AND {_live('t2')}"
    return f"""COALESCE((
        SELECT array_agg(t2.strength ORDER BY t2.strength DESC)
        FROM {source} t2
        WHERE {owner}.clan_id IS NOT NULL
          AND t2.clan_id = {owner}.clan_id
          AND t2.id <> {owner}.id{extra}
          AND ST_Intersects(t2.polygon, {overlap_expr})
    ), ARRAY[]::double precision[])"""


def _defence_params() -> dict:
    """Bind parameters every defence query needs."""
    return {"life_per": settings.territory_life_days_per_strength}


def club_support_falloff(strengths) -> float:
    """What a defender's clubmates actually add, with falloff.

    Strongest counts in full, second at half, third at a quarter, everyone
    after that at a tenth each. A flat sum — what this replaced — meant every
    additional member contributed their whole strength, so a large enough club
    held ground that no solo runner could ever take. Club size is supposed to
    be an advantage, not immunity.
    """
    ordered = sorted(
        (float(s) for s in (strengths or []) if s is not None), reverse=True
    )
    weights = (
        settings.club_defence_w1,
        settings.club_defence_w2,
        settings.club_defence_w3,
    )
    return sum(
        s * (weights[i] if i < len(weights) else settings.club_defence_rest)
        for i, s in enumerate(ordered)
    )


def effective_defence(own_strength, club_support) -> float:
    """Owner strength plus club support, capped.

    The cap is the difference between "hard to take" and "cannot be taken":
    an attacker's strength tops out at `strength_max`, so without a ceiling a
    big club's overlap produced a number no claim could ever exceed. Land above
    the attacker's reach is handled by chip damage instead — see
    `_chip_defence`.
    """
    return min(
        settings.max_effective_defence,
        float(own_strength or 1.0) + max(0.0, float(club_support or 0.0)),
    )


def _chip_defence(db: Session, territory_id, attacker_strength: float) -> None:
    """A bounced attack still wears the land down.

    Attacker strength tops out at `strength_max` (1.20) while reinforcement
    carries defence to `strength_ceiling` (2.0) and club support beyond it, so
    a purely threshold-based fight makes well-held ground permanently
    untakeable — no number of attackers changes the answer. Chipping is what
    turns that into a siege: every failed attack takes a slice off the
    defender's strength, so a coordinated push gets through eventually while a
    lone runner throwing themselves at a fortress still does not.
    """
    db.execute(
        text(
            "UPDATE territories SET strength = GREATEST(:floor, strength - :chip) "
            "WHERE id = :tid"
        ),
        {
            "floor": settings.defence_chip_floor,
            "chip": max(0.0, attacker_strength) * settings.defence_chip_frac,
            "tid": territory_id,
        },
    )


def _claim_grid(route, area: float):
    """Every shape this run could claim: each position along the route, turned
    to each available heading.

    Rotation is applied to the ALREADY-GROWN polygon rather than re-growing the
    territory at an angle — growing is the expensive half (a bisection over
    buffer operations) and a rotation cannot change the area, so turning nine
    shapes eight ways costs nine grows, not seventy-two.

    Returns [(placement_index, rotation_index, degrees, t, polygon, attachment)]
    laid out position-major, which is the order the API indexes into.

    `attachment` is the share of the candidate sitting on ground the runner
    actually covered (geospatial.route_attachment). The grid stays rectangular
    — the client's two rails index straight into it — but a candidate that has
    swung off the trail is marked unavailable by the caller and can never be
    claimed."""
    placed = claim_placements(route, area)
    if not placed:
        return []
    angles = claim_rotation_offsets()
    # One projection for the whole grid. Building a transformer costs more than
    # every rotation put together, so this is the difference between a snappy
    # response and a ten-second one.
    frame = metric_frame(route)
    # ...and one corridor, for the same reason: it is a buffer over the entire
    # trail, so rebuilding it per candidate would dominate the response.
    corridor = route_corridor(route, frame)
    grid = []
    for pi, (t, poly) in enumerate(placed):
        for ri, deg in enumerate(angles):
            turned = rotate_claim_polygon_wgs(poly, deg, frame)
            # Heading 0 is the shape as it was RUN — it cannot be detached from
            # the route it was grown around, so it is never measured against it.
            attach = 1.0 if ri == 0 else route_attachment(turned, corridor, frame)
            grid.append((pi, ri, deg, t, turned, attach))
    return grid


def _is_attached(entry) -> bool:
    """Is this candidate on ground the runner covered?"""
    return entry[5] >= settings.claim_min_route_attachment


def _attached_at(grid, placement: int, rotation: int):
    """The chosen candidate, or the nearest heading at that position that is
    still on the route.

    Indices arrive off the wire, so this never fails: a detached or made-up
    heading falls back to the closest attached one, preferring the shape as it
    was run. The worst a forged index can do is claim their own route straight.
    """
    chosen = _grid_pick(grid, placement, rotation)
    if chosen is None or _is_attached(chosen):
        return chosen
    same_place = [g for g in grid if g[0] == chosen[0] and _is_attached(g)]
    if not same_place:
        return _grid_pick(grid, chosen[0], 0)
    # Closest heading to the one they asked for, then closest to the route's own.
    want = chosen[2]
    return min(
        same_place,
        key=lambda g: (
            min(abs(g[2] - want), 360 - abs(g[2] - want)),
            min(abs(g[2]), 360 - abs(g[2])),
        ),
    )


def _grid_pick(grid, placement, rotation):
    """The shape at (placement, rotation), or the middle position unturned.

    Indices come off the wire, so anything out of range falls back rather than
    failing a claim the runner already ran for — the worst a made-up index can
    do is claim a different part of their own run."""
    if not grid:
        return None
    placements = max(g[0] for g in grid) + 1
    rotations = max(g[1] for g in grid) + 1
    p = placement if placement is not None and 0 <= placement < placements else placements // 2
    r = rotation if rotation is not None and 0 <= rotation < rotations else 0
    return grid[p * rotations + r]


def _placement_breakdown(db: Session, user, polys, strength: float):
    """What each candidate placement would actually do to the map.

    Two queries for the whole list rather than two per candidate: the claim
    chooser is on screen while the runner is still catching their breath, and
    nine round trips through PostGIS would show. The rules mirror
    `_claim_territory` exactly — same strength-versus-stacked-defence test —
    so the preview can never promise a steal the claim won't make."""
    wkts = [p.wkt for p in polys]
    out = [
        {
            "area_m2": 0.0, "new_m2": 0.0, "enemy_m2": 0.0, "defended_m2": 0.0,
            "mine_m2": 0.0, "ally_m2": 0.0, "rivals": {},
        }
        for _ in polys
    ]
    if not wkts:
        return out

    clan_id = str(user.clan_id) if user.clan_id else None

    # Ground nobody holds: the candidate minus the union of everything under
    # it. Done as a difference rather than "area minus overlaps" because two
    # rivals can hold the same spot, and subtracting both would invent land.
    #
    # The union is built ONCE, over everything inside the whole grid's
    # envelope, instead of per candidate. Unioning per candidate re-does the
    # same work for every position and heading and costs seconds; the grid
    # covers one neighbourhood, so one union serves all of it.
    for row in db.execute(
        text(
            """
            WITH cand AS (
                SELECT idx::int AS idx, ST_GeomFromText(wkt, 4326) AS g
                FROM unnest(CAST(:wkts AS text[])) WITH ORDINALITY AS c(wkt, idx)
            ),
            env AS (SELECT ST_Envelope(ST_Collect(g)) AS e FROM cand),
            near AS (
                SELECT ST_Union(t.polygon) AS g
                FROM territories t, env
                WHERE t.verified AND """ + _live("t") + """
                  AND ST_Intersects(t.polygon, env.e)
            )
            SELECT c.idx,
                   ST_Area(c.g::geography),
                   ST_Area(COALESCE(ST_Difference(c.g, near.g), c.g)::geography)
            FROM cand c CROSS JOIN near
            """
        ),
        {"wkts": wkts, **_defence_params()},
    ).fetchall():
        out[row[0] - 1]["area_m2"] = float(row[1] or 0.0)
        out[row[0] - 1]["new_m2"] = float(row[2] or 0.0)

    # Everyone already standing on each candidate, with the defence they can
    # muster there (their own strength plus their clubmates' overlapping land).
    rows = db.execute(
        text(
            """
            WITH cand AS (
                SELECT idx::int AS idx, ST_GeomFromText(wkt, 4326) AS g
                FROM unnest(CAST(:wkts AS text[])) WITH ORDINALITY AS c(wkt, idx)
            ),
            env AS (SELECT ST_Envelope(ST_Collect(g)) AS e FROM cand),
            -- Narrow to the neighbourhood ONCE, so the per-candidate join
            -- walks a handful of rows instead of re-probing the whole table
            -- for every position and heading.
            local AS MATERIALIZED (
                SELECT t.id, t.user_id, t.clan_id, t.strength, t.polygon
                FROM territories t, env
                WHERE t.verified AND """ + _live("t") + """
                  AND ST_Intersects(t.polygon, env.e)
            ),
            hits AS (
                SELECT c.idx, t.id, t.user_id, t.clan_id, t.strength,
                       ST_Intersection(t.polygon, c.g) AS ov
                FROM cand c
                JOIN local t ON ST_Intersects(t.polygon, c.g)
            )
            SELECT h.idx, h.user_id::text, u.username, u.avatar,
                   h.clan_id::text, h.strength,
                   ST_Area(h.ov::geography) AS area,
                   """ + _club_support_sql("h", "h.ov", source="local") + """ AS support
            FROM hits h JOIN users u ON u.id = h.user_id
            WHERE ST_Area(h.ov::geography) >= :min_area
            """
        ),
        {"wkts": wkts, "min_area": PLACEMENT_MIN_M2, **_defence_params()},
    ).fetchall()

    me = str(user.id)
    for idx, uid, username, avatar, t_clan, t_strength, area, support in rows:
        slot = out[idx - 1]
        area = float(area or 0.0)
        if uid == me:
            # Re-running your own ground is reinforcement, not expansion.
            slot["mine_m2"] += area
            continue
        if clan_id and t_clan == clan_id:
            # Clubmates' land is never taken — it coexists and stacks defence.
            slot["ally_m2"] += area
            continue
        defended = strength <= effective_defence(t_strength, club_support_falloff(support))
        if defended:
            slot["defended_m2"] += area
        else:
            slot["enemy_m2"] += area
        r = slot["rivals"].setdefault(
            uid,
            {"user_id": uid, "username": username, "avatar": avatar,
             "area_m2": 0.0, "defended": True},
        )
        r["area_m2"] += area
        if not defended:
            r["defended"] = False
    return out


# ---------------------------------------------------------------------------
# claim-options cache
# ---------------------------------------------------------------------------
# Building the grid is the expensive half: nine territory grows, seventy-two
# rotations and two PostGIS passes over the neighbourhood — around 1.8 s warm.
# It is also DETERMINISTIC from the stored route, the area the run froze, and
# the land around it, so a runner scrolling away from the result screen and
# back pays the whole cost again for a byte-identical answer.
#
# Only the geometry is cached. Energy, the day's allowances and the first-claim
# discount are re-read on every request, because those move for reasons that
# have nothing to do with this run and a stale energy meter is worse than a
# slow one.
#
# In-process and bounded: this is a latency cache, not a source of truth. A
# restart, a second worker or an eviction simply recomputes.
_OPTIONS_CACHE: "OrderedDict[str, tuple]" = OrderedDict()


def _territory_revision(db: Session, route) -> str:
    """A cheap fingerprint of the land around this run.

    Count catches inserts and deletes, the newest timestamp catches a re-claim,
    and the strength sum catches chip damage — which changes who can be taken
    without changing any row count.
    """
    if not route:
        return "none"
    lons = [p[0] for p in route]
    lats = [p[1] for p in route]
    row = db.execute(
        text(
            "SELECT COUNT(*), COALESCE(MAX(created_at), 'epoch'), COALESCE(SUM(strength), 0) "
            "FROM territories t WHERE t.verified AND ST_Intersects(t.polygon, "
            "ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326))"
        ),
        {
            "min_lon": min(lons) - 0.01, "min_lat": min(lats) - 0.01,
            "max_lon": max(lons) + 0.01, "max_lat": max(lats) + 0.01,
        },
    ).fetchone()
    return f"{row[0]}:{row[1]}:{round(float(row[2] or 0), 3)}:{economy.ECONOMY_VERSION}"


def _cached_cells(db: Session, user, run, route, area: float, strength: float):
    """(cells, breakdowns) for this run, rebuilt only when the map has moved.

    Cells are plain dicts holding the ROUNDED ring, not shapely polygons: the
    response only ever needs the ring, and keeping live geometry for hundreds of
    runs would be tens of megabytes of resident memory to save a recompute.
    """
    limit = settings.claim_options_cache_size
    key = str(run.id)
    revision = _territory_revision(db, route) if limit > 0 else None
    if limit > 0:
        hit = _OPTIONS_CACHE.get(key)
        if hit and hit[0] == revision:
            _OPTIONS_CACHE.move_to_end(key)
            return hit[1], hit[2]

    grid = _claim_grid(route, area)
    breakdowns = _placement_breakdown(db, user, [g[4] for g in grid], strength) if grid else []
    cells = [
        {
            "placement": pi,
            "rotation": ri,
            "rotation_deg": deg,
            "t": round(t, 4),
            # Trimmed to ~0.1 m: the grid is dozens of rings and full float
            # precision would be most of the response, for detail no map draws.
            "ring": [(round(x, 6), round(y, 6)) for x, y in polygon_to_lonlat_ring(poly)],
            "attachment": round(attach, 4),
        }
        for pi, ri, deg, t, poly, attach in grid
    ]
    if limit > 0:
        _OPTIONS_CACHE[key] = (revision, cells, breakdowns)
        _OPTIONS_CACHE.move_to_end(key)
        while len(_OPTIONS_CACHE) > limit:
            _OPTIONS_CACHE.popitem(last=False)
    return cells, breakdowns


@router.get("/runs/{run_id}/claim-options", response_model=schemas.ClaimOptionsOut)
def claim_options(
    run_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Where this run could deploy its land — the "choose your attack" step.

    The run earns one fixed amount of ground; this returns the positions along
    the route it could land on, each with what it would take, plus the indices
    of the placements that win the most land, steal the most, and reinforce the
    most. The client picks an INDEX and sends that to /claim-territory; the
    shape itself never travels, so nothing here can be edited into a claim on
    the other side of town."""
    run = db.get(models.Run, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is None:
        raise HTTPException(409, "run not finished yet")
    if run.claimed_at is not None:
        raise HTTPException(409, economy.REASON_ALREADY_CLAIMED)

    # The area /end-run froze — the run's slice of the day's entitlement, not a
    # fresh curve. An empty one means this activity never qualified, and the
    # response says so rather than returning an empty list the client has to
    # interpret.
    area = float(run.claim_area_m2 or 0.0)
    if area <= 0:
        return schemas.ClaimOptionsOut(
            run_id=str(run.id),
            claim_area_m2=0.0,
            tier=run.tier or economy.UNQUALIFIED,
            qualification_reason=run.gate_reason or economy.REASON_MIN_CLAIM_DISTANCE,
            claim_eligible=False,
            neutral_claims_remaining=economy.neutral_claims_remaining(db, user.id),
        )

    route = _run_route(db, run)
    strength = claim_strength(run.distance_m, run.duration_s)
    # Geometry only — the pricing below is re-read every time. See _cached_cells.
    cells, breakdowns = _cached_cells(db, user, run, route, area, strength)
    if not cells:
        # No usable route: the circle fallback is the only placement there is.
        return schemas.ClaimOptionsOut(run_id=str(run.id), claim_area_m2=area)

    out = []
    for i, (cell, b) in enumerate(zip(cells, breakdowns)):
        out.append(
            schemas.ClaimPlacement(
                index=i,
                placement=cell["placement"],
                rotation=cell["rotation"],
                t=cell["t"],
                rotation_deg=cell["rotation_deg"],
                route_attachment=cell["attachment"],
                ring=cell["ring"],
                # What the claim covers (identical everywhere — the run earns
                # one amount of land) versus what survives the carve.
                area_m2=b["area_m2"],
                held_m2=b["new_m2"] + b["enemy_m2"] + b["mine_m2"] + b["ally_m2"],
                new_m2=b["new_m2"],
                enemy_m2=b["enemy_m2"],
                defended_m2=b["defended_m2"],
                mine_m2=b["mine_m2"],
                ally_m2=b["ally_m2"],
                rivals=[
                    schemas.PlacementRival(**r)
                    for r in sorted(
                        b["rivals"].values(), key=lambda r: (r["defended"], -r["area_m2"])
                    )
                ],
            )
        )

    # Price every move up front, and say what it would pay. The cost is part
    # of how a placement reads — "storming that border costs 24, expanding
    # east costs 16" is a decision; one flat 25 was a toll. Everything here is
    # computed server-side so the client displays rather than derives.
    first_of_day = economy.claims_today(db, user.id) == 0
    est = energy_mod.status(db, user.id)
    neutral_left = economy.neutral_claims_remaining(db, user.id)
    xp_left = economy.claim_xp_allowance(db, user.id)
    rank_left = economy.neutral_rank_allowance(db, user.id)
    run_xp = round((run.distance_m / 1000.0) * settings.xp_per_km)
    for p in out:
        p.action = economy.claim_action(p.area_m2, p.enemy_m2, p.defended_m2, p.mine_m2)
        p.base_energy_cost = economy.claim_cost(p.action, first_of_day=False)
        p.energy_cost = economy.claim_cost(p.action, first_of_day)
        p.applied_discounts = ["first_claim_of_day"] if first_of_day else []
        p.energy_before = est["energy"]
        p.energy_after = max(0, est["energy"] - p.energy_cost)

        # Same arithmetic the claim will do, against the same allowances.
        xp = settings.xp_per_claim + round((p.area_m2 / 1e6) * settings.xp_per_km2_claimed)
        xp = min(xp, round(run_xp * settings.xp_claim_max_frac_of_run))
        if p.enemy_m2 > 0:
            steal = settings.xp_per_steal + round((p.enemy_m2 / 1e6) * settings.xp_per_km2_stolen)
            xp += min(steal, round(run_xp * settings.xp_steal_max_frac_of_run))
        p.expected_xp = max(0, min(xp, xp_left))
        p.expected_rank_points = (
            min(ranks.POINTS_CLAIM, rank_left)
            if p.action == economy.ACTION_EMPTY
            else ranks.POINTS_CLAIM
        ) + (ranks.POINTS_STEAL if p.enemy_m2 > PLACEMENT_MIN_M2 else 0)

        # Why this particular move is closed, in the words the claim endpoint
        # would refuse with — so the button explains itself before it is
        # pressed rather than after.
        if p.rotation != 0 and p.route_attachment < settings.claim_min_route_attachment:
            # Turned so far it is mostly on streets this run never touched.
            # Checked FIRST: it is a property of the shape itself, and saying
            # "you need 6 more Energy" for a claim that could never be placed
            # would send the runner off to buy energy for nothing.
            p.available = False
            p.unavailable_reason = economy.REASON_OFF_ROUTE
        elif p.action == economy.ACTION_EMPTY and neutral_left <= 0:
            p.available = False
            p.unavailable_reason = economy.REASON_NEUTRAL_LIMIT
        elif est["energy"] < p.energy_cost:
            short = p.energy_cost - est["energy"]
            p.available = False
            p.unavailable_reason = f"You need {short} more Energy for this attack."

    n_place = cells[-1]["placement"] + 1
    n_rot = cells[-1]["rotation"] + 1
    mid_place = (n_place - 1) / 2.0
    # The unturned middle of the run: what the runner gets for tapping nothing.
    plain = (n_place // 2) * n_rot

    # Ties are the norm, not the exception — most of a long run is empty
    # ground, so every position away from the action wins exactly the same
    # land, and so does every heading. Break toward the shape as it was RUN
    # (no turn, middle of the route) instead of letting float noise pick, or
    # the recommendation jumps between answers that are literally identical.
    def rank(key):
        return lambda p: (
            round(key(p)),
            -min(abs(p.rotation_deg), 360 - abs(p.rotation_deg)),
            -abs(p.placement - mid_place),
        )

    def best(key, minimum=1.0):
        top = max(out, key=rank(key))
        return top.index if key(top) > minimum else None

    # Prefer a move the player can actually make: recommending a border storm
    # they cannot afford, or an expansion the day has no room for, is worse
    # than recommending nothing.
    most_land = best(lambda p: (p.new_m2 + p.enemy_m2) if p.available else 0.0)
    return schemas.ClaimOptionsOut(
        run_id=str(run.id),
        claim_area_m2=area,
        window_frac=claim_window_frac(route),
        placement_count=n_place,
        rotation_count=n_rot,
        placements=out,
        # Land grabbed is the sane default — the recommendations are there to
        # be chosen, not to be defaulted into a fight nobody asked for.
        default_index=most_land if most_land is not None else plain,
        most_land_index=most_land,
        biggest_steal_index=best(
            lambda p: p.enemy_m2 if p.available else 0.0, PLACEMENT_MIN_M2
        ),
        best_defence_index=best(
            lambda p: p.mine_m2 if p.available else 0.0, PLACEMENT_MIN_M2
        ),
        energy=est["energy"],
        energy_max=est["energy_max"],
        first_claim_of_day=first_of_day,
        neutral_claims_remaining=neutral_left,
        min_route_attachment=settings.claim_min_route_attachment,
        tier=run.tier or economy.CLAIMABLE,
        qualification_reason=run.gate_reason,
        claim_eligible=True,
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
    """Place the run's claim. The distance decides how much land is earned and
    the ROUTE decides its shape; `placement` decides WHERE along that route the
    land lands — an index into the list /claim-options returned, rebuilt here
    from the stored path so the shape is always the server's. One claim per
    run, ever."""
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is None:
        raise HTTPException(409, "run not finished yet")
    if run.path is None:
        raise HTTPException(422, "run has no usable route to claim from")

    # Lock the RUN first, then the user. Two requests for the same run
    # serialise here, so the second one sees a committed `claimed_at` and
    # replays instead of claiming again; locking the user as well makes the
    # energy, neutral-expansion and discount reads authoritative against
    # claims from OTHER runs racing alongside. Always in this order — run then
    # user — so two claims can never deadlock against each other.
    db.execute(text("SELECT id FROM runs WHERE id = :r FOR UPDATE"), {"r": run.id})
    db.refresh(run)
    _lock_user(db, user.id)

    # An already-claimed run replays its stored result rather than 409ing. The
    # run is spent either way; what a retry needs is the answer, not an error.
    if run.claimed_at is not None:
        if run.claim_result:
            return schemas.ClaimOut(**run.claim_result)
        raise HTTPException(409, economy.REASON_ALREADY_CLAIMED)

    # The route, as stored. Everything about the claim's SHAPE comes from here.
    route = _run_route(db, run)

    # The same bars /end-run applied, re-checked rather than trusted — a claim
    # is the thing worth forging. `verified` is included so a shadow-flagged
    # run is refused here too, with wording that gives nothing away.
    unique_m = route_unique_length_m(route)
    tier = economy.run_tier(run.distance_m, run.duration_s, unique_m, verified=run.verified)
    if not economy.claim_allowed(tier):
        raise HTTPException(
            422,
            economy.gate_reason_for(tier, run.distance_m, run.duration_s, unique_m)
            or economy.REASON_MIN_CLAIM_DISTANCE,
        )

    # Sweep decayed land — but ONLY where this claim is about to land.
    #
    # This used to be an unqualified DELETE over the whole table, so one
    # runner pressing Claim did cleanup work for the entire map: latency grew
    # with the size of the territory table rather than with the size of the
    # claim, and an unrelated player's action could block on rows nowhere near
    # them. The scheduled job (`POST /admin/sweep-expired`) handles the rest of
    # the world; this transaction only touches what it is standing on.
    #
    # Correctness does not depend on either sweep running: every query that
    # asks who holds ground also filters on `_live`, so an expired row that has
    # not been collected yet is already treated as neutral.
    if route:
        lons = [p[0] for p in route]
        lats = [p[1] for p in route]
        db.execute(
            text(
                "DELETE FROM territories t WHERE NOT (" + _live("t") + ") "
                "AND ST_Intersects(t.polygon, ST_MakeEnvelope("
                "  :min_lon, :min_lat, :max_lon, :max_lat, 4326))"
            ),
            {
                # Padded by roughly a kilometre of degrees so the envelope
                # covers every candidate placement, not just the trail itself.
                "min_lon": min(lons) - 0.01, "min_lat": min(lats) - 0.01,
                "max_lon": max(lons) + 0.01, "max_lat": max(lats) + 0.01,
                "life_per": settings.territory_life_days_per_strength,
            },
        )

    # The area /end-run froze for this run, which is its slice of the day's
    # entitlement. Recomputing here would let a run claimed tomorrow be sized
    # by tomorrow's allowance, and would let the claim disagree with the
    # preview the runner just looked at.
    area = float(run.claim_area_m2 or 0.0)
    if area <= 0:
        raise HTTPException(422, economy.REASON_MIN_CLAIM_DISTANCE)

    # Deploy the earned land onto the chosen stretch of the route, turned the
    # chosen way. The grid is rebuilt here rather than trusted from the client:
    # two indices are all that travel, so the shape is always the server's.
    # `_attached_at`, not `_grid_pick`: a heading turned so far that the claim
    # would land on streets this run never touched is snapped back to the
    # nearest one that is still on the trail. The chooser already greys those
    # candidates out, but the enforcement has to be here — indices arrive off
    # the wire and a client is free to send one the UI would not offer.
    chosen = _attached_at(_claim_grid(route, area), payload.placement, payload.rotation)
    claim_poly = chosen[4] if chosen else None

    # Price the move the runner actually chose, from the SERVER's reading of
    # what it does — a client that says "this is only a quiet expansion" must
    # not get the cheap rate for storming a border. Affordability is checked
    # before any mutation, so a blocked claim costs nothing.
    first_of_day = economy.claims_today(db, user.id) == 0
    action = economy.ACTION_EMPTY
    if claim_poly is not None:
        b = _placement_breakdown(
            db, user, [claim_poly], claim_strength(run.distance_m, run.duration_s)
        )[0]
        action = economy.claim_action(
            b["area_m2"], b["enemy_m2"], b["defended_m2"], b["mine_m2"]
        )

    # Neutral expansion is rationed; fighting and upkeep are not. Checked
    # before any mutation, so a refused expansion costs no energy and burns no
    # allowance. Flagged runs are exempt because their claims are private and
    # never counted.
    neutral_left = economy.neutral_claims_remaining(db, user.id)
    if action == economy.ACTION_EMPTY and run.verified and neutral_left <= 0:
        raise HTTPException(409, economy.REASON_NEUTRAL_LIMIT)

    cost = economy.claim_cost(action, first_of_day)
    if not energy_mod.can_afford(db, user.id, cost):
        st = energy_mod.status(db, user.id)
        db.commit()
        short = cost - st["energy"]
        mins = max(1, round(short * settings.energy_regen_seconds / 60))
        raise HTTPException(
            402,
            f"You need {short} more Energy for this attack ({st['energy']}/{cost}). "
            f"Wait about {mins} minutes, choose another position, or use a refill.",
        )

    # The circle is the fallback for a run whose trail can't carry a shape at
    # all (a couple of GPS points, degenerate geometry) — it centres on the
    # route's own midpoint, or on the point the client sent if there is no
    # usable route left.
    if claim_poly is None:
        if route:
            mid = route[len(route) // 2]
            lon, lat = mid[0], mid[1]
        elif payload.lat is not None and payload.lon is not None:
            lat, lon = payload.lat, payload.lon
        else:
            raise HTTPException(422, "run has no usable route to claim from")
        claim_poly = circle_polygon_wgs(lat, lon, claim_radius_m(run.distance_m))

    territory_out, stolen_m2, stolen_from, steal_events = _claim_territory(
        db=db,
        user_id=run.user_id,
        run_id=run.id,
        polygon_wgs=claim_poly,
        initial_area_m2=area,
        strength=claim_strength(run.distance_m, run.duration_s),
        verified=run.verified,
        clan_id=user.clan_id,
        lifetime_for=lambda r: claim_lifetime_days(run.distance_m, run.duration_s, r),
    )
    run.claimed_at = datetime.utcnow()
    # The run is spent, so its cached grid is dead weight. Everyone ELSE's
    # cached grids invalidate on their own: this claim moves the count,
    # timestamp and strength sum that `_territory_revision` fingerprints.
    _OPTIONS_CACHE.pop(str(run.id), None)
    # What the move turned out to be — this is what the neutral-expansion
    # limit counts, and it is written only now, so a claim that failed
    # anywhere above never consumed the allowance.
    run.claim_action = action

    # Rivalry ledger (migration 0016) — one row per victim, takes AND bounced
    # attacks. Slivers are dropped: a 3 m² clip off a polygon edge is a
    # rounding artefact, not a rivalry beat, and would drown the real ones.
    # There is no placed centre any more, so a steal is pinned to the middle
    # of the ground that changed hands.
    claim_centre = claim_poly.centroid
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
                "lat": claim_centre.y,
                "lon": claim_centre.x,
            },
        )

    # The claim landed — deduct the price of the move it actually made. The
    # spend is conditional in SQL, so if two claims raced for the last of the
    # meter only one of them can have got here with the energy still present.
    if not energy_mod.spend(db, user.id, cost):
        db.rollback()
        raise HTTPException(402, "Not enough Energy for this move.")

    # ---- rank points -------------------------------------------------------
    # Territorial only: claiming, taking and defending ground. Distance is
    # already paid in XP, so ranks stay a measure of standing, not mileage.
    #
    # The flat per-claim award is rationed daily: it is the one territorial
    # reward a player can repeat at will, and until rank is scored against the
    # opponent it would otherwise be a treadmill. Taking and defending ground
    # are contested outcomes and stay uncapped.
    claim_points = ranks.POINTS_CLAIM
    if action == economy.ACTION_EMPTY:
        claim_points = min(claim_points, economy.neutral_rank_allowance(db, user.id))
        if claim_points > 0:
            economy.claim_grant(
                db, user.id, run.id, economy.KIND_NEUTRAL_RANK, claim_points
            )
    if claim_points > 0:
        ranks.award(db, user.id, claim_points, "claim")
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
        # `claim_area_m2` is the ground this run's claim covers (not the merged
        # total), so re-claiming your own land can't farm XP.
        #
        # Both halves are then capped against what the RUN itself paid. Without
        # that, a 1 km jog with a surgical claim out-earns an honest 10 km, and
        # the fastest way to level is to stop running and start aiming.
        run_xp = round((run.distance_m / 1000.0) * settings.xp_per_km)
        claim_xp = settings.xp_per_claim + round((area / 1e6) * settings.xp_per_km2_claimed)
        claim_xp = min(claim_xp, round(run_xp * settings.xp_claim_max_frac_of_run))
        xp_gain = claim_xp
        if stolen_m2 > 0:
            steal_xp = settings.xp_per_steal + round((stolen_m2 / 1e6) * settings.xp_per_km2_stolen)
            xp_gain += min(steal_xp, round(run_xp * settings.xp_steal_max_frac_of_run))
        # ...and then against the DAY. The per-run bound stops one claim
        # out-earning its run; this stops many claims out-earning a day of
        # running, which is the shape farming actually takes.
        xp_gain = max(0, min(xp_gain, economy.claim_xp_allowance(db, user.id)))
        if xp_gain > 0 and economy.claim_grant(
            db, user.id, run.id, economy.KIND_CLAIM_XP, xp_gain
        ):
            db.execute(
                text("UPDATE users SET xp = xp + :g WHERE id = :uid"),
                {"g": xp_gain, "uid": user.id},
            )
            # Claims + steals also advance the runner's club.
            add_clan_xp(db, clan_id or user.clan_id, xp_gain)

    new_xp = xp_before + xp_gain
    level_before, new_level = level_from_xp(xp_before), level_from_xp(new_xp)

    est = energy_mod.status(db, user.id)
    out = schemas.ClaimOut(
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
        action=action,
        energy_cost=cost,
        neutral_claims_remaining=economy.neutral_claims_remaining(db, user.id),
    )
    run.claim_result = out.model_dump(mode="json")

    # ONE commit for the whole claim: ownership changes, the energy spend, the
    # rivalry ledger, XP, rank, the recorded action AND the stored result land
    # together. Committing earlier (as this did) released the row locks in the
    # middle and left a window where the run read as claimed but had no result
    # yet — a concurrent retry hitting that window got a 409 for a claim that
    # had in fact succeeded.
    db.commit()

    # Everything below is after the fact and must not be able to fail the
    # claim: level rewards commit on their own, and notifications are
    # best-effort and off the request path.
    if run.verified and xp_gain > 0:
        sync_level_rewards(db, user.id)

    # BOTH sides of a take are notified: the victim who lost land ("stolen")
    # and the attacker who took it ("captured").
    if stolen_m2 > 0 and stolen_from:
        victim = db.execute(
            text("SELECT id::text FROM users WHERE username = :u"), {"u": stolen_from}
        ).fetchone()
        if victim:
            background.add_task(
                notify, [victim[0]], "stolen", "Your land is under attack",
                f"{user.username} took {round(stolen_m2):,} m² of your territory.",
                None, str(user.id),
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

    return out


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
                   ) AS took_from_me,
                   COALESCE(u.rank_points, 0), u.rank_points_at
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
                rank_key=ranks.key_for(r[5], r[6]),
                clan_color=schemas.ClanColor(**color_triple(r[3])) if r[3] else None,
                area_m2=agg["area_m2"],
                defended=agg["defended"],
                reclaimed=bool(r[4]),
            )
        )
    # Biggest loss first; runners who held their ground sink to the bottom.
    out.sort(key=lambda v: (v.defended, -v.area_m2))
    return out


# Reference pace: 7:00/km scores 1.0.
STRENGTH_REF_PACE_S_PER_KM = 420.0


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _pace_score(distance_m: float, duration_s: float | None) -> float:
    """Pace as a multiplier, in a deliberately narrow band.

    This used to be the whole story: 420/pace clamped to 0.6-2.0, which meant a
    fast runner beat every solo defender in the game and a slow one could hold
    nothing. Now the extremes are ~1.4x apart rather than 3.3x, and the way to
    make land genuinely strong is to keep running it."""
    if not duration_s or not distance_m:
        return 1.0
    pace = duration_s / (distance_m / 1000.0)  # s per km
    return _clamp(
        STRENGTH_REF_PACE_S_PER_KM / max(pace, 1.0),
        settings.strength_pace_min,
        settings.strength_pace_max,
    )


def _distance_score(distance_m: float) -> float:
    """Distance as a multiplier. Logarithmic, so going further always helps a
    little and never runs away with it."""
    km = max(0.0, distance_m or 0.0) / 1000.0
    return _clamp(
        0.90 + math.log1p(km) * 0.08,
        settings.strength_distance_min,
        settings.strength_distance_max,
    )


def claim_strength(distance_m: float, duration_s: float | None) -> float:
    """Strength of a single fresh claim: mostly pace, partly distance."""
    w = settings.strength_pace_weight
    base = w * _pace_score(distance_m, duration_s) + (1 - w) * _distance_score(distance_m)
    return round(_clamp(base, settings.strength_min, settings.strength_max), 2)


def claim_lifetime_days(distance_m: float, duration_s: float | None, reinforcements: int = 0) -> float:
    """How long this claim should live.

    Effort and upkeep, not pace. Pace is worth at most half a day here — it
    already decides strength, and letting it also triple lifetime was what made
    a slower runner's land worse in every dimension at once."""
    days = settings.territory_life_days_base
    days += min(
        settings.territory_life_distance_cap_days,
        (max(0.0, distance_m or 0.0) / 1000.0) / settings.territory_life_km_per_day,
    )
    days += min(settings.territory_life_reinforce_cap_days, max(0, reinforcements))
    # Map the pace band onto 0..half a day.
    span = settings.strength_pace_max - settings.strength_pace_min
    if span > 0:
        frac = (_pace_score(distance_m, duration_s) - settings.strength_pace_min) / span
        days += settings.territory_life_pace_bonus_days * _clamp(frac, 0.0, 1.0)
    return min(settings.territory_life_days_max, days)


def _claim_territory(
    db: Session,
    user_id: str,
    run_id: str,
    polygon_wgs,
    initial_area_m2: float,
    strength: float = 1.0,
    verified: bool = True,
    clan_id: str | None = None,
    lifetime_days: float | None = None,
    lifetime_for=None,
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

    # How long the land lives. A callable rather than a number because merging
    # into existing land REINFORCES it, and reinforcements buy days — the row
    # that comes out of a merge is entitled to a longer life than the fresh
    # claim that triggered it.
    if lifetime_for is None:
        fixed = lifetime_days if lifetime_days is not None else settings.territory_life_days_base
        def lifetime_for(_reinforcements):  # noqa: E306 — deliberately local
            return fixed

    if not verified:
        # Flagged: insert the row for the owner's eyes only and stop —
        # a cheat must not damage anyone else's land.
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at,
                                         verified, clan_id, strength, reinforcements, expires_at)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    false,
                    :clan_id,
                    :strength,
                    0,
                    now() + make_interval(secs => :life_secs)
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {
                "uid": user_id, "rid": run_id, "wkt": new_geom_wkt,
                "clan_id": clan_id, "strength": strength,
                "life_secs": lifetime_for(0) * 86400,
            },
        ).fetchone()
        return _territory_out(db, new_row[0]), 0.0, None, []

    # Pull rivals that intersect: other users OUTSIDE the claimer's club.
    rivals = db.execute(
        text(
            """
            SELECT t.id, t.user_id
            FROM territories t
            WHERE t.user_id <> :uid
              AND t.verified
              AND (CAST(:clan_id AS uuid) IS NULL OR t.clan_id IS NULL OR t.clan_id <> :clan_id)
              AND """ + _live("t") + """
              AND ST_Intersects(t.polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {"uid": user_id, "wkt": new_geom_wkt, "clan_id": clan_id, **_defence_params()},
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
                       """
                + _club_support_sql(
                    "t", "ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))"
                )
                + """ AS club_support
                FROM territories t JOIN users u ON u.id = t.user_id
                WHERE t.id = :rid
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, **_defence_params()},
        ).fetchone()
        if not steal or not steal[0]:
            continue

        defense = effective_defence(steal[2], club_support_falloff(steal[3]))
        if strength <= defense:
            # The land holds — but not for free. The claim is carved around it
            # and the defence is chipped, so the same wall cannot be leaned on
            # forever by ground that is simply out of the attacker's reach.
            defended_ids.append(rid)
            _chip_defence(db, rid, strength)
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
    # their strengths SUM (re-claiming the same block stacks it stronger),
    # bounded by `strength_ceiling` — an unbounded sum meant a commute run
    # daily for a month became land nobody in the game could ever touch.
    same_user = db.execute(
        text(
            """
            SELECT ST_AsText(ST_Union(polygon)),
                   COALESCE(SUM(strength), 0),
                   COALESCE(MAX(reinforcements), 0)
            FROM territories
            WHERE user_id = :uid
              AND verified
              AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {"uid": user_id, "wkt": new_geom_wkt},
    ).fetchone()
    same_user_union = same_user[0] if same_user else None
    merged_strength = (
        round(min(settings.strength_ceiling, strength + float(same_user[1] or 0.0)), 2)
        if same_user
        else strength
    )
    # Coming back to the same ground is what buys life, so it is counted.
    merged_reinforcements = int(same_user[2] or 0) + 1 if same_user else 0

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
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at,
                                         verified, clan_id, strength, reinforcements, expires_at)
                SELECT gen_random_uuid(), :uid, :rid, g,
                       ST_Area(g::geography), now(), true, :clan_id, :strength,
                       :reinforcements,
                       now() + make_interval(secs => :life_secs)
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
                "reinforcements": merged_reinforcements,
                "life_secs": lifetime_for(merged_reinforcements) * 86400,
            },
        ).fetchone()
    else:
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at,
                                         verified, clan_id, strength, reinforcements, expires_at)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    true,
                    :clan_id,
                    :strength,
                    0,
                    now() + make_interval(secs => :life_secs)
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {
                "uid": user_id, "rid": run_id, "wkt": new_geom_wkt,
                "clan_id": clan_id, "strength": strength,
                "life_secs": lifetime_for(0) * 86400,
            },
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
