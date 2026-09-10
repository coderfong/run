"""
Run lifecycle: /start-run, /submit-path, /end-run, /claim-territory.

ROUTE-GROWN CLAIM MODEL: a run's distance decides how MUCH land it earns
(linear — see geospatial.claim_area_m2); the route decides what that land
LOOKS like. /end-run finalises the run and returns both the area and
`claim_ring`, the territory grown around the middle of the trail, so the result
screen can show the ground before it is taken.

WHERE that land goes is the runner's move: /runs/{id}/claim-options returns a
route and a coarse survey of what the earned shape could take. /claim-territory
accepts the continuous pose (route fraction + heading); the shape is always
rebuilt server-side from the stored route. /submit-path remains a pure
streaming endpoint for partial GPS traces.
"""

import math
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from geoalchemy2.shape import from_shape
from shapely import wkt as shapely_wkt
from shapely.geometry import LineString
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import club_runs
from .. import coins as coins_mod
from .. import economy
from .. import elo
from .. import energy as energy_mod
from .. import paserby
from .. import ranks
from .. import territory_history
from .. import fitness, models, schemas
from ..anticheat import is_verified, validate_run
from ..notifications import notify
from .clans import clan_member_ids
from .progression import sync_level_rewards
from ..config import settings
from ..database import get_db
from ..geospatial import (
    build_claim_stamp,
    circle_polygon_wgs,
    claim_area_m2,
    claim_placement_samples,
    claim_radius_m,
    claim_rotation_offsets,
    clamp_t,
    clean_path,
    metric_frame,
    normalise_rotation,
    route_unique_length_m,
    detect_loop,
    geometry_to_rings,
    polygon_to_lonlat_ring,
    route_claim_polygon_wgs,
)
from ..clans_meta import color_triple
from ..devtools import is_dev_account
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
    # A backdated start is the run simulator's, and only the run simulator's.
    # Duration is measured from THIS row, so honouring it for anybody would let
    # a caller declare a two-second submission to be a forty-minute run and
    # clear the claim bar without moving. It is dropped silently rather than
    # refused: the server clocking its own start is the documented behaviour,
    # and a 403 would only tell a prober that the field does something.
    started = datetime.utcnow()
    if payload.started_at is not None and is_dev_account(user):
        started = payload.started_at
        # Run timestamps are naive UTC: the column carries no timezone and
        # every duration in this file is measured against `datetime.utcnow()`.
        # An ISO string ending in Z is the ordinary way for a client to write a
        # time and it parses AWARE, which lands in a column with nowhere to
        # keep the offset and makes the next subtraction raise.
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
            # The route-centred resting pose. This is the same polygon
            # /claim-options calls `base_ring`, so loading controls cannot
            # move the preview sideways on a closed loop.
            stamp = _run_stamp(route, area)
            preview = (
                stamp.at(stamp.t0, 0.0)
                if stamp is not None
                else route_claim_polygon_wgs(route, area)
            )
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

    # Match claim_run's lock order. Refresh after waiting so a concurrent
    # finalizer's committed rewards are replayed rather than paid again.
    db.execute(text("SELECT id FROM runs WHERE id = :r FOR UPDATE"), {"r": run.id})
    db.refresh(run)

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
    run.together_trace = club_runs.record_trace(payload.points)
    run.ended_at = datetime.utcnow()
    run.distance_m = cleaned.distance_m
    run.duration_s = (run.ended_at - run.started_at).total_seconds()

    # Anti-cheat on the RAW submitted points (clean_path scrubs exactly the
    # samples that betray a spoof). Shadow-flag: the response below looks
    # identical either way; flag_reasons never leaves the server.
    reasons = validate_run(
        payload.points, cleaned.distance_m, payload.step_count,
        started_at=run.started_at, ended_at=run.ended_at,
    )
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
    # The simulator exists to exercise this flow repeatedly. Its synthetic runs
    # used to consume the same daily diminishing entitlement as real runs, so
    # after enough test passes /end-run correctly but unhelpfully returned
    # 0.000 km² for every subsequent scenario. Only a server-allowlisted dev
    # account may activate this marker; for everyone else it is ignored.
    dev_simulated = bool(payload.simulated and is_dev_account(user))
    if economy.consumes_entitlement(tier):
        if dev_simulated:
            run.claim_distance_m = 0.0
            area = claim_area_m2(run.distance_m)
        else:
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
        # The route-centred resting pose, so the result screen can draw the
        # real ground immediately and loading /claim-options never changes
        # the placement model underneath it.
        stamp = _run_stamp(cleaned.wgs_coords, area)
        preview = (
            stamp.at(stamp.t0, 0.0)
            if stamp is not None
            else route_claim_polygon_wgs(cleaned.wgs_coords, area)
        )
        if preview is not None:
            claim_ring = polygon_to_lonlat_ring(preview)

    # Server-side splits + personal records (records only on verified runs).
    achievements = fitness.record_splits_and_prs(
        db, run.id, run.user_id, cleaned, run.distance_m, area, run.verified
    )

    # Was this a CLUB run? Only a route the club ran together counts for the
    # club (app/club_runs.py) — a solo run still earns the runner everything
    # below, and earns their club nothing. Logged before the credit is paid,
    # so clubmates who finished earlier, and so had nobody to match when they
    # came in, are caught up by `sync_credit` further down.
    #
    # Gated on the REWARD BAR as well as the flag, exactly like every other
    # payout below: a run too short or too slow to earn its own runner
    # anything cannot earn their club anything either, or walking fifty metres
    # with a clubmate ten times a day would be the cheapest club goal in the
    # game. Every anti-cheat rule already folded into `tier` gates this too.
    club_id, club_partners = (None, [])
    if run.verified and economy.rewards_earned(tier):
        # The probe reads `runs` in SQL and the session does not autoflush, so
        # the path and the end time this handler just set are still sitting in
        # the identity map. Unflushed, the run has no route to match on and
        # every club run in the game would come back solo.
        db.flush()
        club_id, club_partners, _newly = club_runs.log_run(
            db, run.id, run.user_id, user.clan_id
        )

    # Advance the club's weekly goal + season stats (no-op if this was not a
    # club run). Flagged (unverified) runs never contribute to clan stats,
    # goals, or XP. Claim + steal credit lands at /claim-territory when the
    # ground is taken.
    xp_gain = 0
    award = {"coins": 0, "energy": 0, "coins_capped": False, "energy_capped": False}
    if economy.rewards_earned(tier):
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
    db.flush()
    # One place pays the club, for BOTH finishers, once each: the runner who
    # came in first had nobody to match at the time and is caught up here.
    goal_reached, clan_id = club_runs.sync_credit(
        db, [run.id] + [p["run_id"] for p in club_partners], club_id
    )

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
        text("DELETE FROM territories t WHERE NOT (" + _live("t") + ") RETURNING user_id, area_m2"), params
    ).fetchall()
    elo.record_expired_land(db, expired)
    expired = len(expired)

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


def _rank_scope_sql(tier: int, alias: str, prefix: str) -> tuple[str, dict]:
    """SQL + bind values selecting users in exactly one live rank tier.

    Territory rows do not freeze the rank they were created in: every plot
    follows its owner's live Elo rating. Combat must use that same reading
    as ``/map-polygons`` or a runner could see one board and fight another.
    """
    floor, ceil = elo.tier_bounds(tier)
    points = elo.rating_sql(alias)
    clause = f"({points}) >= :{prefix}_floor"
    params = {f"{prefix}_floor": floor}
    if ceil is not None:
        clause += f" AND ({points}) < :{prefix}_ceil"
        params[f"{prefix}_ceil"] = ceil
    return clause, params


def _club_support_sql(
    owner: str,
    overlap_expr: str,
    source: str = "territories",
    rank_clause: str = "",
    owner_clan: str | None = None,
    support_clan: str | None = None,
) -> str:
    """The strengths of every clubmate territory overlapping this ground.

    Returns the RAW list, ordered strongest first — the weighting lives in
    `club_support_falloff` and nowhere else. Doing the arithmetic in SQL would
    have meant two copies of the rule, one of them untestable without a
    database, which is exactly the split that let the client and server drift
    apart over the claim formula.

    CLUBMATES ARE PEOPLE, NOT PLOTS. Both sides of the comparison are a
    RUNNER's club, read off `users`, never the club denormalized onto the
    territory row. Those stopped being the same thing when club land became
    something a club has to run together for (app/club_runs.py): most of a
    club's members hold ground with no club on it at all, and comparing the
    rows would have quietly turned every clubmate into a rival with no
    defence to lend.
    """
    extra = "" if source != "territories" else f" AND t2.verified AND {_live('t2')}"
    # ``local`` is already rank-filtered by _placement_breakdown, and carries
    # its owner's club. The live territory table needs its owner's user row,
    # both for that club and so cross-tier clubmates cannot lend defence into
    # a fight they are not eligible to join.
    needs_user = source == "territories"
    rank_join = " JOIN users support_u ON support_u.id = t2.user_id" if needs_user else ""
    rank_filter = f" AND {rank_clause}" if rank_clause else ""
    owner_clan = owner_clan or f"{owner}.clan_id"
    support_clan = support_clan or ("support_u.clan_id" if needs_user else "t2.clan_id")
    return f"""COALESCE((
        SELECT array_agg(t2.strength ORDER BY t2.strength DESC)
        FROM {source} t2{rank_join}
        WHERE {owner_clan} IS NOT NULL
          AND {support_clan} = {owner_clan}
          AND t2.id <> {owner}.id{extra}
          {rank_filter}
          AND ST_Intersects(t2.polygon, {overlap_expr})
    ), ARRAY[]::double precision[])"""


def _defence_params() -> dict:
    """Bind parameters every defence query needs."""
    return {"life_per": settings.territory_life_days_per_strength}


def _record_beats(db, beats: dict, *, actor_id, run_id) -> None:
    """Write one history row per PERSON a claim took ground from, not one per
    row it took it out of.

    A runner's holding is several territory rows now — the claim engine keeps
    each run's footprint separable so a solo run's ground and a club run's
    ground never merge into one indivisible plot. That is a fact about
    storage. Reading it back out of the log would say a single claim raided
    the same neighbour twice, which is not a thing that happened.

    The geometries were captured before the differences below removed them
    from the victim's rows, and they are unioned here as literals, so this
    can run after the loop without asking the table for ground that is gone.
    """
    for (kind, victim_id), beat in beats.items():
        wkts = [w for w in beat["wkts"] if w]
        ground = wkts[0] if len(wkts) == 1 else None
        if len(wkts) > 1:
            ground = db.execute(
                text(
                    "SELECT ST_AsText(ST_Union(ARRAY(SELECT ST_GeomFromText(w, 4326) "
                    "FROM unnest(CAST(:wkts AS text[])) AS w)))"
                ),
                {"wkts": wkts},
            ).scalar()
        territory_history.record(
            db, kind=kind, actor_id=actor_id, victim_id=victim_id,
            run_id=run_id, area_m2=beat["area_m2"], ground_wkt=ground,
        )


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


def _claim_grid(route, area: float, stamp=None):
    """A coarse SAMPLE of the poses this run could claim: positions along the
    route, each turned to a spread of headings.

    This is no longer the set of choices. Position and heading are continuous
    now — the runner drags the shape along the route and turns it to any angle,
    and anything between two samples is priced by /claim-preview. What the grid
    is still for is the two things a continuous control cannot do for itself:
    seed the first breakdown before the runner has touched anything, and back
    the one-tap "most land / biggest steal / best defence" recommendations,
    which need somebody to have looked at the whole space.

    One shape, moved rigidly. Growing the territory is the expensive half (a
    bisection over buffer operations); a rigid move cannot change its area or
    its silhouette, so sampling nine positions at eight headings costs ONE
    grow rather than seventy-two.

    Returns [(placement_index, rotation_index, degrees, t, polygon)] laid out
    position-major, which is the order the API indexes into.
    """
    stamp = stamp if stamp is not None else _run_stamp(route, area)
    if stamp is None:
        return []
    angles = claim_rotation_offsets()
    positions = claim_placement_samples()
    return [
        (pi, ri, deg, t, stamp.at(t, deg))
        for pi, t in enumerate(positions)
        for ri, deg in enumerate(angles)
    ]


def _run_stamp(route, area: float):
    """This run's one claim shape, ready to be placed. None when the route
    can't carry a shape at all — the caller falls back to the circle."""
    if not route or area <= 0:
        return None
    try:
        return build_claim_stamp(route, area, metric_frame(route))
    except Exception:
        return None


def _grid_pick(grid, placement, rotation):
    """The sample at (placement, rotation), or the middle position unturned.

    Only reached by a client still speaking the old grid indices; anything out
    of range falls back rather than failing a claim the runner already ran for.
    """
    if not grid:
        return None
    placements = max(g[0] for g in grid) + 1
    rotations = max(g[1] for g in grid) + 1
    p = placement if placement is not None and 0 <= placement < placements else placements // 2
    r = rotation if rotation is not None and 0 <= rotation < rotations else 0
    return grid[p * rotations + r]


def _pose_from_payload(payload):
    """The (t, degrees) this claim is being placed at.

    New clients send the pose directly. A client built against the superseded
    grid sends two indices instead, and those are converted here rather than
    anywhere else, so the rest of the claim path only ever deals in a pose.
    """
    if payload.t is not None or payload.rotation_deg is not None:
        return clamp_t(payload.t), normalise_rotation(payload.rotation_deg)
    if payload.placement is None and payload.rotation is None:
        # Nothing chosen at all: the middle of the route, exactly as run.
        return 0.5, 0.0
    positions = claim_placement_samples()
    angles = claim_rotation_offsets()
    p = payload.placement if payload.placement is not None else len(positions) // 2
    r = payload.rotation if payload.rotation is not None else 0
    t = positions[p] if 0 <= p < len(positions) else 0.5
    deg = angles[r] if 0 <= r < len(angles) else 0.0
    return clamp_t(t), normalise_rotation(deg)


def _placement_breakdown(
    db: Session, user, polys, strength: float, rank_tier: int | None = None
):
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
    if rank_tier is None:
        rank_tier = elo.solo_status(db, user.id)["tier"]
    rank_clause, rank_params = _rank_scope_sql(rank_tier, "u", "claim_rank")

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
                FROM territories t
                JOIN users u ON u.id = t.user_id
                CROSS JOIN env
                WHERE t.verified AND """ + _live("t") + """
                  AND """ + rank_clause + """
                  AND ST_Intersects(t.polygon, env.e)
            )
            SELECT c.idx,
                   ST_Area(c.g::geography),
                   ST_Area(COALESCE(ST_Difference(c.g, near.g), c.g)::geography)
            FROM cand c CROSS JOIN near
            """
        ),
        {"wkts": wkts, **_defence_params(), **rank_params},
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
            -- `u.clan_id`, not `t.clan_id`: who a runner's clubmates are is a
            -- fact about the runner, not about the ground. See
            -- `_club_support_sql`.
            local AS MATERIALIZED (
                SELECT t.id, t.user_id, u.clan_id, t.strength, t.polygon
                FROM territories t
                JOIN users u ON u.id = t.user_id
                CROSS JOIN env
                WHERE t.verified AND """ + _live("t") + """
                  AND """ + rank_clause + """
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
        {
            "wkts": wkts,
            "min_area": PLACEMENT_MIN_M2,
            **_defence_params(),
            **rank_params,
        },
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


# The grown shape itself, kept apart from the sampled grid above.
#
# Two caches rather than one because they expire on different things. The grid
# is a statement about the neighbourhood and goes stale when the land around
# the run changes hands; the stamp is a statement about the RUN — its route and
# the area /end-run froze — and neither of those can change while the run is
# unclaimed. So the stamp survives every territory revision, which is what
# makes /claim-preview cheap: a preview is then one rigid move and two PostGIS
# passes, with no bisection over buffers in the middle of a drag.
_STAMP_CACHE: "OrderedDict[str, tuple]" = OrderedDict()


def _cached_stamp(run, route, area: float):
    """This run's claim shape, grown at most once per process."""
    limit = settings.claim_options_cache_size
    key = str(run.id)
    if limit > 0:
        hit = _STAMP_CACHE.get(key)
        if hit and hit[0] == area:
            _STAMP_CACHE.move_to_end(key)
            return hit[1]
    stamp = _run_stamp(route, area)
    if limit > 0:
        _STAMP_CACHE[key] = (area, stamp)
        _STAMP_CACHE.move_to_end(key)
        while len(_STAMP_CACHE) > limit:
            _STAMP_CACHE.popitem(last=False)
    return stamp


def _cached_cells(
    db: Session, user, run, route, area: float, strength: float, stamp=None,
    rank_tier: int | None = None,
):
    """(cells, breakdowns) for this run, rebuilt only when the map has moved.

    Cells are plain dicts holding the ROUNDED ring, not shapely polygons: the
    response only ever needs the ring, and keeping live geometry for hundreds of
    runs would be tens of megabytes of resident memory to save a recompute.
    """
    limit = settings.claim_options_cache_size
    key = str(run.id)
    if rank_tier is None:
        rank_tier = elo.solo_status(db, user.id)["tier"]
    # A tier change moves every eligible opponent at once even if no territory
    # row changed. Keep it in the cache fingerprint so an options screen opened
    # across a promotion cannot replay the previous division's fights.
    revision = (
        f"rank={rank_tier}:{_territory_revision(db, route)}" if limit > 0 else None
    )
    if limit > 0:
        hit = _OPTIONS_CACHE.get(key)
        if hit and hit[0] == revision:
            _OPTIONS_CACHE.move_to_end(key)
            return hit[1], hit[2]

    grid = _claim_grid(route, area, stamp)
    breakdowns = (
        _placement_breakdown(
            db, user, [g[4] for g in grid], strength, rank_tier=rank_tier
        )
        if grid
        else []
    )
    cells = [
        {
            "placement": pi,
            "rotation": ri,
            "rotation_deg": deg,
            "t": round(t, 4),
            # Trimmed to ~0.1 m: the grid is dozens of rings and full float
            # precision would be most of the response, for detail no map draws.
            "ring": [(round(x, 6), round(y, 6)) for x, y in polygon_to_lonlat_ring(poly)],
        }
        for pi, ri, deg, t, poly in grid
    ]
    if limit > 0:
        _OPTIONS_CACHE[key] = (revision, cells, breakdowns)
        _OPTIONS_CACHE.move_to_end(key)
        while len(_OPTIONS_CACHE) > limit:
            _OPTIONS_CACHE.popitem(last=False)
    return cells, breakdowns


def _claim_energy_cost(user, action: str, first_of_day: bool) -> int:
    """Authoritative claim price, including the server-owned dev exception."""
    if is_dev_account(user):
        return 0
    return economy.claim_cost(action, first_of_day)


def _price_placements(
    db: Session, user, run, placements: List[schemas.ClaimPlacement],
    rank_tier: int | None = None,
):
    """Fill in the action, the price and the expected reward for each entry.

    Shared by /claim-options and /claim-preview so a dragged pose is described
    in exactly the same terms as a sampled one — the chooser must not change
    its story about what a move costs just because the runner moved it a metre.

    Everything here is re-read per request rather than cached with the
    geometry: energy, the day's allowances and the first-claim discount all
    move for reasons that have nothing to do with this run, and a stale energy
    meter is worse than a slow one.
    """
    first_of_day = economy.claims_today(db, user.id) == 0
    unlimited_energy = is_dev_account(user)
    est = energy_mod.status_for_user(db, user)
    neutral_left = economy.neutral_claims_remaining(db, user.id)
    xp_left = economy.claim_xp_allowance(db, user.id)
    rank_left = economy.neutral_rank_allowance(db, user.id)
    # Same tier the claim itself will fight on (see the note on `rank_tier` in
    # /claim-territory) — the preview must quote the tier-scaled steal reward,
    # or a runner near Mythic sees a bigger number than the claim will pay.
    if rank_tier is None:
        rank_tier = elo.solo_status(db, user.id)["tier"]
    run_xp = round((run.distance_m / 1000.0) * settings.xp_per_km)

    for p in placements:
        p.action = economy.claim_action(p.area_m2, p.enemy_m2, p.defended_m2, p.mine_m2)
        p.base_energy_cost = _claim_energy_cost(user, p.action, first_of_day=False)
        p.energy_cost = _claim_energy_cost(user, p.action, first_of_day)
        p.applied_discounts = (
            ["dev_account"] if unlimited_energy
            else (["first_claim_of_day"] if first_of_day else [])
        )
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
        ) + (ranks.steal_reward(rank_tier) if p.enemy_m2 > PLACEMENT_MIN_M2 else 0)

        # Why this particular move is closed, in the words the claim endpoint
        # would refuse with — so the button explains itself before it is
        # pressed rather than after.
        #
        # There is no longer an off-route reason to give. Under the window
        # model a turn could swing a claim grown around one stretch of road
        # onto streets that were never run, and headings past that point had to
        # be closed. A rigid stamp slides with the route and turns about its
        # own centre, so every pose is on the run by construction and the whole
        # 360 is open.
        #
        # `neutral_limit_active()` and not just `neutral_left <= 0`: the ration
        # is off by default and the remaining-count is then a sentinel, not a
        # count. See economy.neutral_claims_remaining.
        if economy.neutral_limit_active() and p.action == economy.ACTION_EMPTY and neutral_left <= 0:
            p.available = False
            p.unavailable_reason = economy.REASON_NEUTRAL_LIMIT
        elif not unlimited_energy and est["energy"] < p.energy_cost:
            short = p.energy_cost - est["energy"]
            p.available = False
            p.unavailable_reason = f"You need {short} more Energy for this attack."

    return est, first_of_day, neutral_left


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

    # The band this claim fights in. Read ONCE here and threaded through, so
    # the breakdown, the reward quote and the tier the client scopes its map to
    # are all the same number — a second read could land either side of a
    # promotion and describe a fight against a division the claim will not
    # meet. Stated in the response too, because the placement map has to be
    # drawn from the same board or it shows land the claim cannot touch.
    rank_tier = elo.solo_status(db, user.id)["tier"]

    # The area /end-run froze — the run's slice of the day's entitlement, not a
    # fresh curve. An empty one means this activity never qualified, and the
    # response says so rather than returning an empty list the client has to
    # interpret.
    area = float(run.claim_area_m2 or 0.0)
    if area <= 0:
        return schemas.ClaimOptionsOut(
            run_id=str(run.id),
            claim_area_m2=0.0,
            rank_tier=rank_tier,
            tier=run.tier or economy.UNQUALIFIED,
            qualification_reason=run.gate_reason or economy.REASON_MIN_CLAIM_DISTANCE,
            claim_eligible=False,
            neutral_claims_remaining=economy.neutral_claims_remaining(db, user.id),
        )

    route = _run_route(db, run)
    strength = claim_strength(run.distance_m, run.duration_s)
    stamp = _cached_stamp(run, route, area)
    # Geometry only — the pricing below is re-read every time. See _cached_cells.
    cells, breakdowns = _cached_cells(
        db, user, run, route, area, strength, stamp, rank_tier=rank_tier
    )
    if not cells:
        # No usable route: the circle fallback is the only placement there is.
        return schemas.ClaimOptionsOut(
            run_id=str(run.id), claim_area_m2=area, rank_tier=rank_tier
        )

    out = []
    for i, (cell, b) in enumerate(zip(cells, breakdowns)):
        out.append(
            schemas.ClaimPlacement(
                index=i,
                placement=cell["placement"],
                rotation=cell["rotation"],
                t=cell["t"],
                rotation_deg=cell["rotation_deg"],
                ring=cell["ring"],
                # What the claim covers (identical everywhere — the run earns
                # one amount of land) versus what survives the carve.
                area_m2=b["area_m2"],
                # Capped at the footprint: two runners can hold the same square
                # (a clubmate's land coexists with yours, and rivals can be
                # standing on ground you also hold), so the four parts overlap
                # and their sum can exceed the land the run actually earned.
                held_m2=min(
                    b["area_m2"],
                    b["new_m2"] + b["enemy_m2"] + b["mine_m2"] + b["ally_m2"],
                ),
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
    est, first_of_day, neutral_left = _price_placements(
        db, user, run, out, rank_tier=rank_tier
    )

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

    # Recommendations describe the BOARD, not the current meter. Running out
    # of Energy used to erase Most land and Best defence from the picker even
    # though those poses were still the useful answers the runner wanted to
    # inspect (and would become available after a refill). Keep them visible;
    # only the automatic default prefers a move that can be claimed now.
    # MOST LAND means the most UNCLAIMED land — ground nobody holds. It used to
    # add rival ground to that, which made it a second attack recommendation
    # sitting next to the actual one, and (worse) let it point at a pose that
    # takes a rival's border while a quieter pose beside it wins more open
    # ground. Rival ground is what ATTACK is for; this is expansion.
    #
    # Own land is not in it either, and never was: running back over your own
    # block reinforces it, but no border moves and nothing is gained.
    most_land = best(lambda p: p.new_m2)
    available_most_land = best(lambda p: p.new_m2 if p.available else 0.0)
    # ATTACK points at the fight, and there is still a fight when the runner
    # would lose it. Where a border can actually be taken it points at the
    # biggest steal; where every rival on this stretch out-defends the runner
    # it points at the most rival ground instead of going dead. A closed
    # button hid the one pose the runner wanted to look at — who is holding
    # this ground and how much of it holds — and read as "no rivals here",
    # which is the opposite of the truth. The breakdown does the explaining
    # from there.
    biggest_steal = best(lambda p: p.enemy_m2, PLACEMENT_MIN_M2)
    if biggest_steal is None:
        biggest_steal = best(lambda p: p.defended_m2, PLACEMENT_MIN_M2)
    # The shape itself, at rest and unturned, plus the pivot it turns about and
    # the route it slides along. This is what makes the control continuous: the
    # client transforms these three locally at gesture speed and only asks the
    # server for the NUMBERS, so dragging never waits on a round trip.
    base_ring = []
    base_centre = None
    base_route = []
    if stamp is not None:
        base_ring = [
            (round(x, 6), round(y, 6))
            for x, y in polygon_to_lonlat_ring(stamp.at(stamp.t0, 0.0))
        ]
        cx, cy = stamp.centre_wgs(stamp.t0)
        base_centre = (round(cx, 6), round(cy, 6))
        base_route = [(round(x, 6), round(y, 6)) for x, y in route]

    return schemas.ClaimOptionsOut(
        run_id=str(run.id),
        claim_area_m2=area,
        base_ring=base_ring,
        base_centre=base_centre,
        base_t=round(stamp.t0, 4) if stamp is not None else 0.5,
        route=base_route,
        placement_count=n_place,
        rotation_count=n_rot,
        placements=out,
        # Open ground is the sane default — the recommendations are there to
        # be chosen, not to be defaulted into a fight nobody asked for, and not
        # into re-covering land the runner already holds either.
        default_index=available_most_land if available_most_land is not None else plain,
        most_land_index=most_land,
        biggest_steal_index=biggest_steal,
        best_defence_index=best(
            lambda p: p.mine_m2, PLACEMENT_MIN_M2
        ),
        energy=est["energy"],
        energy_max=est["energy_max"],
        first_claim_of_day=first_of_day,
        neutral_claims_remaining=neutral_left,
        # No heading is closed any more — a rigid stamp turns about its own
        # centre and slides with the route, so every pose is on the run by
        # construction. Sent as 0 rather than dropped so an older client's
        # "is this stop open" comparison passes for every stop instead of
        # silently greying out most of the rail.
        min_route_attachment=0.0,
        rank_tier=rank_tier,
        tier=run.tier or economy.CLAIMABLE,
        qualification_reason=run.gate_reason,
        claim_eligible=True,
    )


@router.post("/runs/{run_id}/claim-preview", response_model=schemas.ClaimPlacement)
def claim_preview(
    run_id: str,
    payload: schemas.ClaimPreviewIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """What an arbitrary pose would take, without taking it.

    Placement is continuous, so /claim-options can only ever SAMPLE the space;
    once the runner drags the claim between two samples there is no cell to
    read the breakdown out of. This prices the exact pose instead.

    It is deliberately geometry-light: the shape was grown when the options
    were built and is held in `_STAMP_CACHE`, so a preview is one rigid move
    plus the same two PostGIS passes every sampled cell paid for. The client
    calls it debounced — while the finger is still moving, the last answer is
    shown dimmed rather than a spinner, because the picture on the map is
    already correct and only the numbers are behind.
    """
    run = db.get(models.Run, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is None:
        raise HTTPException(409, "run not finished yet")
    if run.claimed_at is not None:
        raise HTTPException(409, economy.REASON_ALREADY_CLAIMED)

    area = float(run.claim_area_m2 or 0.0)
    if area <= 0:
        raise HTTPException(422, run.gate_reason or economy.REASON_MIN_CLAIM_DISTANCE)

    route = _run_route(db, run)
    stamp = _cached_stamp(run, route, area)
    if stamp is None:
        raise HTTPException(422, "run has no usable route to claim from")

    t = clamp_t(payload.t)
    deg = normalise_rotation(payload.rotation_deg)
    poly = stamp.at(t, deg)
    b = _placement_breakdown(
        db, user, [poly], claim_strength(run.distance_m, run.duration_s)
    )[0]

    out = schemas.ClaimPlacement(
        index=-1,  # not a member of the sampled grid
        t=round(t, 4),
        rotation_deg=round(deg, 2),
        ring=[(round(x, 6), round(y, 6)) for x, y in polygon_to_lonlat_ring(poly)],
        area_m2=b["area_m2"],
        # Capped at the footprint: two runners can hold the same square
        # (a clubmate's land coexists with yours, and rivals can be
        # standing on ground you also hold), so the four parts overlap
        # and their sum can exceed the land the run actually earned.
        held_m2=min(
            b["area_m2"],
            b["new_m2"] + b["enemy_m2"] + b["mine_m2"] + b["ally_m2"],
        ),
        new_m2=b["new_m2"],
        enemy_m2=b["enemy_m2"],
        defended_m2=b["defended_m2"],
        mine_m2=b["mine_m2"],
        ally_m2=b["ally_m2"],
        rivals=[
            schemas.PlacementRival(**r)
            for r in sorted(b["rivals"].values(), key=lambda r: (r["defended"], -r["area_m2"]))
        ],
    )
    _price_placements(db, user, run, [out])
    return out


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
    the ROUTE decides its shape; the POSE (`t` along the route, `rotation_deg`
    about the shape's own centre) decides where that shape ends up. The shape
    is rebuilt here from the stored path and moved rigidly, so it is always the
    server's — a pose is two numbers and cannot describe a claim anywhere but
    along the run that earned it, at the size it earned. One claim per run,
    ever."""
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
            replay = schemas.ClaimOut(**run.claim_result)
            if is_dev_account(user):
                est = energy_mod.status_for_user(db, user)
                replay.energy = est["energy"]
                replay.energy_max = est["energy_max"]
                replay.energy_cost = 0
            return replay
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
        expired_rows = db.execute(
            text(
                "DELETE FROM territories t WHERE NOT (" + _live("t") + ") "
                "AND ST_Intersects(t.polygon, ST_MakeEnvelope("
                "  :min_lon, :min_lat, :max_lon, :max_lat, 4326)) RETURNING user_id, area_m2"
            ),
            {
                # Padded by roughly a kilometre of degrees so the envelope
                # covers every candidate placement, not just the trail itself.
                "min_lon": min(lons) - 0.01, "min_lat": min(lats) - 0.01,
                "max_lon": max(lons) + 0.01, "max_lat": max(lats) + 0.01,
                "life_per": settings.territory_life_days_per_strength,
            },
        ).fetchall()
        elo.record_expired_land(db, expired_rows)

    # The area /end-run froze for this run, which is its slice of the day's
    # entitlement. Recomputing here would let a run claimed tomorrow be sized
    # by tomorrow's allowance, and would let the claim disagree with the
    # preview the runner just looked at.
    area = float(run.claim_area_m2 or 0.0)
    if area <= 0:
        raise HTTPException(422, economy.REASON_MIN_CLAIM_DISTANCE)

    # Deploy the earned land at the chosen pose. The SHAPE is grown here from
    # the stored route rather than trusted from the client — only two numbers
    # travel — and moving it rigidly cannot change its area or walk it off the
    # run, so both are safe to clamp and use rather than validate against a
    # whitelist of poses. `clamp_t`/`normalise_rotation` fold anything that
    # arrives, including nonsense, into the legal range.
    t_pose, deg_pose = _pose_from_payload(payload)
    stamp = _cached_stamp(run, route, area)
    claim_poly = stamp.at(t_pose, deg_pose) if stamp is not None else None

    # Price the move the runner actually chose, from the SERVER's reading of
    # what it does — a client that says "this is only a quiet expansion" must
    # not get the cheap rate for storming a border. Affordability is checked
    # before any mutation, so a blocked claim costs nothing.
    first_of_day = economy.claims_today(db, user.id) == 0
    # The runner's live rank tier, read once and used for every overlap query
    # from here down: the price breakdown, and the claim itself. Both must
    # score the fight against the same division the runner is on.
    rank_tier = elo.solo_status(db, user.id)["tier"]
    action = economy.ACTION_EMPTY
    if claim_poly is not None:
        b = _placement_breakdown(
            db, user, [claim_poly], claim_strength(run.distance_m, run.duration_s),
            rank_tier=rank_tier,
        )[0]
        action = economy.claim_action(
            b["area_m2"], b["enemy_m2"], b["defended_m2"], b["mine_m2"]
        )

    # Neutral expansion CAN be rationed, but is not by default — Energy is the
    # cap on claiming and this was a second one on the same decision (see
    # `max_neutral_claims_per_game_day`). When it is switched back on: checked
    # before any mutation, so a refused expansion costs no energy and burns no
    # allowance, and flagged runs are exempt because their claims are private
    # and never counted.
    neutral_left = economy.neutral_claims_remaining(db, user.id)
    if (
        economy.neutral_limit_active()
        and action == economy.ACTION_EMPTY
        and run.verified
        and neutral_left <= 0
    ):
        raise HTTPException(409, economy.REASON_NEUTRAL_LIMIT)

    unlimited_energy = is_dev_account(user)
    cost = _claim_energy_cost(user, action, first_of_day)
    if not unlimited_energy and not energy_mod.can_afford(db, user.id, cost):
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

    # Whose land is this? The runner's always; their CLUB's only if the club
    # ran the route together (app/club_runs.py). Re-checked here rather than
    # trusted from /end-run because a clubmate can cross the line in between:
    # this is the last moment before the ground is written, so it is the
    # moment with the most of the group in it.
    club_id, club_partners = (None, [])
    if run.verified:
        club_id, club_partners, _newly = club_runs.log_run(
            db, run.id, run.user_id, user.clan_id
        )
        # Land a partner already claimed off the same route, handed to the
        # club now that there is a group to hand it to. Only ever fills a
        # blank: land that already belongs to a club stays where it is.
        if club_id:
            club_runs.attribute_territories(
                db, [p["run_id"] for p in club_partners], club_id
            )

    territory_out, stolen_m2, stolen_from, steal_events, ground = _claim_territory(
        db=db,
        user_id=run.user_id,
        run_id=run.id,
        polygon_wgs=claim_poly,
        initial_area_m2=area,
        strength=claim_strength(run.distance_m, run.duration_s),
        verified=run.verified,
        clan_id=club_id,
        member_clan_id=user.clan_id,
        rank_tier=rank_tier,
        lifetime_for=lambda r: claim_lifetime_days(run.distance_m, run.duration_s, r),
    )
    run.claimed_at = datetime.utcnow()
    # The run is spent, so its cached grid is dead weight. Everyone ELSE's
    # cached grids invalidate on their own: this claim moves the count,
    # timestamp and strength sum that `_territory_revision` fingerprints.
    _OPTIONS_CACHE.pop(str(run.id), None)
    _STAMP_CACHE.pop(str(run.id), None)
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
    if not unlimited_energy and not energy_mod.spend(db, user.id, cost):
        db.rollback()
        raise HTTPException(402, "Not enough Energy for this move.")

    # ---- legacy rank points -----------------------------------------------
    # Kept for already-shipped builds and historical rewards. The live ladder
    # is Elo below; these additive points are no longer exposed as rank.
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
    # Both sides of every steal_events row are in `rank_tier`'s bracket by
    # construction (combat is rank-scoped — see the note on `rank_tier`
    # above), so it alone picks the tier-scaled rate for both attacker and
    # victim. See ranks.steal_reward/loss_penalty/defend_reward: flat through
    # Gold, then the exchange tilts toward the defender as the tier rises, so
    # the top of the ladder has to be held, not just reached.
    for ev in steal_events:
        if ev["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        if ev["defended"]:
            # The attack bounced — the DEFENDER is the one who earned here.
            ranks.award(db, ev["victim_id"], ranks.defend_reward(rank_tier), "defend")
        else:
            # A steal moves points BOTH ways: the attacker gains, the victim
            # loses. Without the loss side, rank could only ever go up and
            # would just be a slower level.
            ranks.award(db, user.id, ranks.steal_reward(rank_tier), "steal")
            ranks.award(db, ev["victim_id"], ranks.loss_penalty(rank_tier), "lost_ground")

    # One weighted solo encounter per rival, plus one per opposing club.
    # This stays inside the claim transaction: a rating can never move for a
    # territory update that later rolls back.
    elo_result = elo.record_claim_matches(
        db, user.id, run.id, steal_events, attacker_clan_id=club_id,
        club_match=bool(club_id),
    )
    open_area = max(0.0, ground["gained_m2"] - stolen_m2)
    open_points = elo.open_claim_reward(open_area)
    if open_points:
        elo_result["solo_rating"] = elo.apply_land_delta(db, user.id, open_points)
        elo_result["solo_delta"] += open_points
    # Did that claim cross a tier boundary? Worked out from the rating either
    # side of the encounter rather than by re-reading the row, so it cannot
    # disagree with the numbers reported below.
    rank_after = elo.tier_for_rating(elo_result["solo_rating"])
    rank_before = elo.tier_for_rating(elo_result["solo_rating"] - elo_result["solo_delta"])

    xp_gain = 0
    # Snapshot XP before the award so the payoff screen can fill the bar from
    # where it was, and know whether this claim crossed a level.
    xp_before = int(
        db.execute(text("SELECT COALESCE(xp, 0) FROM users WHERE id = :u"), {"u": user.id}).scalar()
        or 0
    )
    if run.verified:
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
            # Claims + steals also advance the club — when the club ran it.


    new_xp = xp_before + xp_gain
    level_before, new_level = level_from_xp(xp_before), level_from_xp(new_xp)

    est = energy_mod.status_for_user(db, user)
    out = schemas.ClaimOut(
        territory=territory_out,
        claimed_m2=ground["claimed_m2"],
        gained_m2=ground["gained_m2"],
        reinforced_m2=ground["reinforced_m2"],
        claim_rings=_rings_of(ground["claim_wkt"]),
        gained_rings=_rings_of(ground["gained_wkt"]),
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
        solo_elo=elo_result["solo_rating"],
        solo_elo_delta=elo_result["solo_delta"],
        club_elo=elo_result["club_rating"],
        club_elo_delta=elo_result["club_delta"],
        rank_up=rank_after["tier"] > rank_before["tier"],
        rank_down=rank_after["tier"] < rank_before["tier"],
        rank_key_before=rank_before["key"],
        rank_key_after=rank_after["key"],
    )
    run.claim_result = out.model_dump(mode="json")
    db.flush()
    goal_reached, clan_id = club_runs.sync_credit(
        db, [run.id] + [p["run_id"] for p in club_partners], club_id
    )

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

    # Every side of the fight is notified: each victim who lost land
    # ("stolen"), each owner whose defence held ("defended"), and the attacker
    # who actually took ground ("captured"). `stolen_from` is only the headline
    # victim, so aggregate the real event list instead.
    taken_by_victim: dict[str, float] = {}
    defended_by_victim: dict[str, float] = {}
    for ev in steal_events:
        if ev["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        victim_id = str(ev["victim_id"])
        bucket = defended_by_victim if ev["defended"] else taken_by_victim
        bucket[victim_id] = bucket.get(victim_id, 0.0) + float(ev["area_m2"])

    # The attacker's own territory outline, so the victim's alert can box the
    # EXACT ground the rival ran instead of the seeded-fan stand-in. Only the
    # largest ring, decimated and rounded — a full multipolygon would blow past
    # Expo's ~4KB push limit, and this is a plaback overlay, not a survey.
    territory_ring = (
        _decimate_ring(territory_out.rings[0])
        if territory_out and territory_out.rings else None
    )

    for victim_id, taken_m2 in taken_by_victim.items():
        capture_id = f"{run.id}:{victim_id}"
        background.add_task(
            notify,
            [victim_id],
            "stolen",
            "Your land was captured",
            f"{user.username} took {taken_m2 / 1_000_000:.3f} km² of your territory.",
            {
                "kind": "territory_captured",
                "screen": "map",
                "capture_id": capture_id,
                "taken_m2": taken_m2,
                "lat": claim_centre.y,
                "lon": claim_centre.x,
                "attacker_id": str(user.id),
                "attacker_username": user.username,
                "attacker_avatar": user.avatar or {},
                # Lets the victim's device pick the exact same capture-style
                # animation the attacker's screen played — pickCaptureStyle
                # and pickCaptureVariant are pure hashes of this id, so no
                # further server round-trip is needed to keep the two in sync.
                "territory_id": str(territory_out.id),
                # [[lon, lat], ...] of the attacker's land — the alert projects
                # this into its stage to box the real area, and "ZOOM TO THE
                # LAND" fits the live map to it. Omitted when unavailable so the
                # client keeps its point-and-fan fallback.
                **({"territory_ring": territory_ring} if territory_ring else {}),
            },
            str(user.id),
        )
    for victim_id, defended_m2 in defended_by_victim.items():
        background.add_task(
            notify,
            [victim_id],
            "defended",
            "Your defense held",
            f"{user.username} attacked {defended_m2 / 1_000_000:.3f} km², but your territory held.",
            {
                "kind": "territory_defended",
                "screen": "map",
                "defended_m2": defended_m2,
                "lat": claim_centre.y,
                "lon": claim_centre.x,
                "attacker_id": str(user.id),
                "attacker_username": user.username,
                "attacker_avatar": user.avatar or {},
            },
            str(user.id),
        )
    if stolen_m2 > 0:
        from_str = f" from {stolen_from}" if stolen_from else ""
        background.add_task(
            notify, [str(user.id)], "captured", "Territory captured",
            f"You took {stolen_m2 / 1_000_000:.3f} km²{from_str} · +{xp_gain} XP.",
            {
                "kind": "territory_captured",
                "screen": "map",
                "taken_m2": stolen_m2,
                "lat": claim_centre.y,
                "lon": claim_centre.x,
                "territory_id": str(territory_out.id),
                **({"territory_ring": territory_ring} if territory_ring else {}),
            },
        )
    if goal_reached and clan_id:
        background.add_task(
            notify, clan_member_ids(db, clan_id, exclude=user.id), "clan_goal",
            "Weekly goal reached!", "Your club hit this week's goal. Badge frame unlocked.",
            {"kind": "clan_goal_reached", "screen": "club"},
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
                   COALESCE(u.solo_elo, 1000), NULL::timestamp
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
                rank_key=elo.key_for(r[5], r[6]),
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


def _rings_of(wkt: str | None) -> list:
    """Exterior rings of a stored WKT, largest first — or nothing at all.

    Empty is a real answer here and not a failure: a claim placed entirely on
    the runner's own land gains no ground, and the honest shape for that is no
    shape.
    """
    if not wkt:
        return []
    try:
        geom = shapely_wkt.loads(wkt)
    except Exception:  # noqa: BLE001 — a shape we can't read is one we don't send
        return []
    if geom.is_empty:
        return []
    return [
        [(round(x, 6), round(y, 6)) for x, y in ring]
        for ring in geometry_to_rings(geom)
        if len(ring) >= 3
    ]


def _claim_ground(
    db: Session,
    claim_wkt: str,
    own_wkt: str | None,
    taken_wkts: list[str] | None = None,
) -> dict:
    """Split a landed claim into the ground it GAINED and the ground it only
    reinforced.

    This is the difference between "your territory is now 2.4 km²" and "this
    run took 0.06 km²", and it is the whole reason it is measured here: a
    minute later the two polygons are one merged row and the question has no
    answer. Running the same block twice moves no borders, and a result screen
    that celebrates the merged total for it is congratulating a runner for land
    they already owned.

    `claim_wkt` is the claim AFTER any defended ground has been carved out of
    it, so this is what actually landed, not what was aimed. `own_wkt` is the
    union of the runner's existing land under it, or None if there was none.

    `taken_wkts` is the ground just taken off beaten rivals, and it is removed
    from `own_wkt` before the split. Two runners can hold the same spot — a
    clubmate's land coexists with yours and becomes rival land the day they
    leave the club, and the seeded world plants rivals on ground that is
    already held — so a takeback lands on a square that is BOTH theirs and
    yours. Measured against `own_wkt` alone that square is reinforcement, and
    the screen reads "+0.000 km² / 0.63 km² reinforced" under a headline
    that says you took land off somebody. Ground that changed hands is ground
    this claim won, whether or not the runner also stood on it: the chooser
    counts it in GAIN before the run, and the two numbers have to be the same
    number.

    Areas come from PostGIS on a geography cast, like every other area in the
    claim path, so they agree with the numbers the chooser previewed.
    """
    row = db.execute(
        text(
            """
            WITH c AS (SELECT ST_GeomFromText(:claim_wkt, 4326) AS g),
                 taken AS (
                    SELECT ST_UnaryUnion(ST_Collect(ST_GeomFromText(w, 4326))) AS g
                    FROM unnest(CAST(:taken_wkts AS text[])) AS t(w)
                 ),
                 -- The runner's own land MINUS what just changed hands: land
                 -- they held and a rival also held is not reinforcement, it
                 -- is the takeback. Empty when the whole overlap was won.
                 o AS (
                    SELECT CASE
                        WHEN CAST(:own_wkt AS text) IS NULL THEN NULL
                        WHEN taken.g IS NULL THEN ST_GeomFromText(:own_wkt, 4326)
                        ELSE ST_CollectionExtract(ST_MakeValid(
                            ST_Difference(ST_GeomFromText(:own_wkt, 4326), taken.g)), 3)
                    END AS g
                    FROM taken
                 ),
                 parts AS (
                    SELECT
                        c.g AS claim,
                        CASE WHEN o.g IS NULL OR ST_IsEmpty(o.g) THEN c.g
                             ELSE ST_CollectionExtract(
                                ST_MakeValid(ST_Difference(c.g, o.g)), 3) END AS gained,
                        CASE WHEN o.g IS NULL OR ST_IsEmpty(o.g) THEN NULL
                             ELSE ST_CollectionExtract(
                                ST_MakeValid(ST_Intersection(c.g, o.g)), 3) END AS reinforced
                    FROM c CROSS JOIN o
                 )
            SELECT ST_Area(claim::geography),
                   ST_AsText(gained), COALESCE(ST_Area(gained::geography), 0),
                   ST_AsText(reinforced), COALESCE(ST_Area(reinforced::geography), 0)
            FROM parts
            """
        ),
        {"claim_wkt": claim_wkt, "own_wkt": own_wkt, "taken_wkts": list(taken_wkts or [])},
    ).fetchone()
    if row is None:
        return {
            "claimed_m2": 0.0, "gained_m2": 0.0, "reinforced_m2": 0.0,
            "claim_wkt": claim_wkt, "gained_wkt": claim_wkt, "reinforced_wkt": None,
        }
    return {
        "claimed_m2": float(row[0] or 0.0),
        "gained_wkt": row[1],
        "gained_m2": float(row[2] or 0.0),
        "reinforced_wkt": row[3],
        "reinforced_m2": float(row[4] or 0.0),
        "claim_wkt": claim_wkt,
    }


def _claim_territory(
    db: Session,
    user_id: str,
    run_id: str,
    polygon_wgs,
    initial_area_m2: float,
    strength: float = 1.0,
    verified: bool = True,
    clan_id: str | None = None,
    member_clan_id: str | None = None,
    lifetime_days: float | None = None,
    lifetime_for=None,
    rank_tier: int | None = None,
):  # -> (TerritoryOut | None, stolen_m2, stolen_from, events, ground)
    """Insert the new polygon, resolving overlaps with existing territories.

    Rules (strength model):
      * Every claim carries a pace-based `strength`.
      * TWO CLANS, TWO JOBS. `clan_id` is what this claim is WORTH to a club:
        it is written onto the row, it is what the club board draws, and it is
        None unless the club ran the route together (app/club_runs.py).
        `member_clan_id` is who the claimer's CLUBMATES are, which is a fact
        about the runner and has nothing to do with what any run was worth. It
        is the second one that decides who may be attacked and whose defence
        stacks; passing the first would make clubmates rivals the moment
        either of them went out alone.
      * RIVALS = other users OUTSIDE the claimer's club AND inside the
        claimer's live rank tier. Each rank is its own board — the same board
        `/map-polygons` draws — so a claim never sees, steals from, or is
        defended by land held by a runner in another division. Cross-tier
        polygons simply coexist with the new one, the way a clubmate's does.
        For each in-tier rival overlap, the attack succeeds only if the
        claim's strength beats the rival's strength PLUS the summed strength
        of the rival's clubmates' territories overlapping the same spot
        (stacked defense). Beaten rivals lose the overlap (ST_Difference);
        successful defenses carve the defended land OUT of the new claim
        instead.
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

    The fifth return value, `ground`, is what THIS claim did, as opposed to
    what the runner now holds — see `_claim_ground`. The territory row cannot
    answer that: once the union above has run, the merged polygon has no memory
    of which parts of it arrived today.
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
        # A flagged claim never merges with anything, so all of it is new.
        return (
            _territory_out(db, new_row[0]), 0.0, None, [],
            _claim_ground(db, new_geom_wkt, None),
        )

    # The claimer's live rank decides which board this fight happens on. Read
    # once here and threaded through every overlap query below, so a promotion
    # mid-transaction cannot land the attacker on two boards at once.
    if rank_tier is None:
        rank_tier = elo.solo_status(db, user_id)["tier"]
    rival_rank_clause, rival_rank_params = _rank_scope_sql(rank_tier, "ru", "fight_rank")
    support_rank_clause, support_rank_params = _rank_scope_sql(
        rank_tier, "support_u", "fight_sup_rank"
    )

    # Pull rivals that intersect: other users OUTSIDE the claimer's club and
    # INSIDE the claimer's rank tier. `ru.clan_id` — the OWNER's club, not the
    # club stamped on the plot. Most land carries no club now (see the
    # docstring), and reading it off the row would put every clubmate's
    # ordinary solo territory on the target list.
    rivals = db.execute(
        text(
            """
            SELECT t.id, t.user_id
            FROM territories t
            JOIN users ru ON ru.id = t.user_id
            WHERE t.user_id <> :uid
              AND t.verified
              AND (CAST(:member_clan_id AS uuid) IS NULL
                   OR ru.clan_id IS NULL
                   OR ru.clan_id <> CAST(:member_clan_id AS uuid))
              AND """ + rival_rank_clause + """
              AND """ + _live("t") + """
              AND ST_Intersects(t.polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {
            "uid": user_id, "wkt": new_geom_wkt, "member_clan_id": member_clan_id,
            **_defence_params(), **rival_rank_params,
        },
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
    # (kind, victim) -> the whole of what this claim did to that person. See
    # `_record_beats`: the loop below walks ROWS, the log records PEOPLE.
    beats: dict = {}
    # Ground won off rivals, in claim coordinates. Fed to `_claim_ground` so a
    # takeback on a square the runner also held reads as won, not reinforced.
    taken_wkts = []

    for rid, _ruid in rivals:
        steal = db.execute(
            text(
                """
                SELECT ST_Area(ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))::geography),
                       u.username,
                       t.strength,
                       ST_AsText(ST_CollectionExtract(ST_MakeValid(
                           ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))
                       ), 3)) AS contested,
                       """
                + _club_support_sql(
                    "t", "ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))",
                    rank_clause=support_rank_clause,
                    owner_clan="u.clan_id",
                )
                + """ AS club_support
                FROM territories t JOIN users u ON u.id = t.user_id
                WHERE t.id = :rid
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, **_defence_params(), **support_rank_params},
        ).fetchone()
        if not steal or not steal[0]:
            continue

        # `contested` is the ground the two claims actually share — the only
        # geometry the history log should ever attribute to this pair. The
        # whole claim polygon would credit a rival with land they never
        # touched.
        contested = steal[3]
        defense = effective_defence(steal[2], club_support_falloff(steal[4]))
        if strength <= defense:
            # The land holds — but not for free. The claim is carved around it
            # and the defence is chipped, so the same wall cannot be leaned on
            # forever by ground that is simply out of the attacker's reach.
            defended_ids.append(rid)
            _chip_defence(db, rid, strength)
            events.append({"victim_id": _ruid, "area_m2": float(steal[0]), "defended": True})
            beat = beats.setdefault(
                (territory_history.DEFEND, _ruid), {"area_m2": 0.0, "wkts": []}
            )
            beat["area_m2"] += float(steal[0])
            beat["wkts"].append(contested)
            continue

        stolen_total += float(steal[0])
        # The geometry that changed hands, kept for the gained/reinforced
        # split at the end: this is the only place it exists as its own shape.
        if contested:
            taken_wkts.append(contested)
        if float(steal[0]) > best_steal:
            best_steal = float(steal[0])
            stolen_from = steal[1]
        events.append({"victim_id": _ruid, "area_m2": float(steal[0]), "defended": False})
        # Captured BEFORE the difference below removes it from the victim's
        # row: after that statement the geometry this event describes no
        # longer exists in the table to be read back. Written out by
        # `_record_beats` once the loop has seen every row of every victim.
        beat = beats.setdefault(
            (territory_history.STEAL, _ruid), {"area_m2": 0.0, "wkts": []}
        )
        beat["area_m2"] += float(steal[0])
        beat["wkts"].append(contested)

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

    _record_beats(db, beats, actor_id=user_id, run_id=run_id)

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
    #
    # Each pass feeds its own output back in as the next pass's input, via
    # WKT, so anything degenerate that survives one subtraction becomes the
    # next one's problem. ST_MakeValid and CollectionExtract are not enough on
    # their own: subtracting a neighbour along a shared edge leaves hairline
    # rings of no area, they survive as typed polygons, and the NEXT
    # ST_Difference throws outright — "GEOS Error: TopologyException: Input
    # geom 0 is invalid: Too few points in geometry component" — rather than
    # returning something wrong. That aborts the whole claim.
    #
    # So each pass is dumped to parts and anything under a square metre is
    # discarded, which is the same threshold the sliver deletes above already
    # use. A fragment that small is not land anybody ran, and carrying it
    # forward can only break the next operation.
    #
    # COALESCE to an explicit empty geometry matters too: when nothing
    # survives, the claim really was fully defended, and the area check below
    # has to see zero and raise. The previous `if carved:` treated a null as
    # "leave the claim as it was", which silently skipped carving out the
    # ground that had just successfully defended itself.
    for rid in defended_ids:
        carved = db.execute(
            text(
                """
                WITH src AS (
                    SELECT ST_CollectionExtract(ST_MakeValid(
                        ST_Difference(ST_GeomFromText(:wkt, 4326), polygon)
                    ), 3) AS g
                    FROM territories WHERE id = :rid
                ),
                parts AS (SELECT (ST_Dump(g)).geom AS geom FROM src)
                SELECT ST_AsText(COALESCE(
                    ST_Multi(ST_Collect(geom)),
                    ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)
                ))
                FROM parts
                WHERE ST_Area(geom::geography) >= :min_area
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, "min_area": 1.0},
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
                   COALESCE(MAX(reinforcements), 0),
                   MAX(clan_id::text)
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

    # Measured HERE, in the last moment it is still measurable: the union below
    # replaces both polygons with one and the claim stops being separable from
    # the land it joined.
    ground = _claim_ground(db, new_geom_wkt, same_user_union, taken_wkts)

    # Keep each run's footprint separable. Merging the whole holding under
    # the latest run would promote old solo land when a clubmate finishes.
    # Preserve existing club attribution where a solo claim reinforces it.
    new_row = db.execute(text("""
        WITH footprint AS (
            SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                ST_GeomFromText(:wkt, 4326)), 3)) AS g
        ), old AS MATERIALIZED (
            SELECT t.* FROM territories t, footprint f
            WHERE t.user_id = :uid AND t.verified
              AND ST_Intersects(t.polygon, f.g)
        ), kept_clubs AS (
            SELECT o.clan_id, ST_Union(ST_Intersection(o.polygon, f.g)) AS g
            FROM old o CROSS JOIN footprint f
            WHERE o.clan_id IS NOT NULL AND CAST(:cid AS uuid) IS NULL
            GROUP BY o.clan_id
        ), pieces AS (
            SELECT CAST(:cid AS uuid) AS clan_id,
                   ST_Difference(f.g, COALESCE(
                       (SELECT ST_Union(g) FROM kept_clubs),
                       ST_GeomFromText('MULTIPOLYGON EMPTY', 4326))) AS g
            FROM footprint f
            UNION ALL SELECT clan_id, g FROM kept_clubs
        ), removed AS (
            DELETE FROM territories WHERE id IN (SELECT id FROM old)
        ), remainder AS (
            INSERT INTO territories (id, user_id, run_id, polygon, area_m2,
                created_at, verified, clan_id, strength, reinforcements, expires_at)
            -- `d.g`, qualified: `footprint` is in scope here too and also
            -- names its geometry `g`, so a bare one is ambiguous and Postgres
            -- refuses the whole statement — which is every claim in the game.
            SELECT gen_random_uuid(), o.user_id, o.run_id, d.g,
                   ST_Area(d.g::geography), o.created_at, o.verified, o.clan_id,
                   o.strength, o.reinforcements, o.expires_at
            FROM old o CROSS JOIN footprint f
            CROSS JOIN LATERAL (SELECT ST_Multi(ST_CollectionExtract(
                ST_Difference(o.polygon, f.g), 3)) AS g) d
            WHERE NOT ST_IsEmpty(d.g)
        )
        INSERT INTO territories (id, user_id, run_id, polygon, area_m2,
            created_at, verified, clan_id, strength, reinforcements, expires_at)
        SELECT gen_random_uuid(), :uid, :rid,
               ST_Multi(ST_CollectionExtract(g, 3)), ST_Area(g::geography),
               now(), true, clan_id, :strength, :reinforcements,
               now() + make_interval(secs => :life_secs)
        FROM pieces WHERE NOT ST_IsEmpty(g)
        RETURNING id, area_m2, created_at
    """), {
        "uid": user_id, "rid": run_id, "wkt": new_geom_wkt, "cid": clan_id,
        "strength": merged_strength if same_user_union else strength,
        "reinforcements": merged_reinforcements if same_user_union else 0,
        "life_secs": lifetime_for(merged_reinforcements if same_user_union else 0) * 86400,
    }).fetchone()

    # The actor's own beat — as TWO rows where the claim did two things.
    #
    # It used to be one row for the whole footprint, typed `reinforce` the
    # moment any part of it touched the runner's own land. A claim that took a
    # hectare of open ground and happened to clip its own border was therefore
    # filed entirely as reinforcement, and "new ground" read back as the whole
    # footprint including the half already held. Split, each row means what the
    # migration says it means: `claim` is ground that was not the actor's,
    # `reinforce` is ground that already was. Either can be absent, and both
    # are dropped below the log's sliver floor by `record` itself.
    territory_history.record(
        db, kind=territory_history.CLAIM, actor_id=user_id, run_id=run_id,
        area_m2=ground["gained_m2"], ground_wkt=ground["gained_wkt"],
    )
    territory_history.record(
        db, kind=territory_history.REINFORCE, actor_id=user_id, run_id=run_id,
        area_m2=ground["reinforced_m2"], ground_wkt=ground["reinforced_wkt"],
    )

    return _territory_out(db, new_row[0]), stolen_total, stolen_from, events, ground


def _decimate_ring(ring, max_pts: int = 28):
    """Cap a [lon, lat] ring to a push-safe vertex count and precision.

    A capture alert boxes the shape at thumbnail scale, so 28 points and ~1m
    precision (5 decimals) are more than enough — and keep the whole payload
    well under Expo's ~4KB push ceiling. Evenly sampled, so the outline stays
    recognisable rather than collapsing to one arc."""
    if not ring:
        return None
    if len(ring) > max_pts:
        step = len(ring) / max_pts
        ring = [ring[int(i * step)] for i in range(max_pts)]
    return [[round(float(lon), 5), round(float(lat), 5)] for lon, lat in ring]


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
