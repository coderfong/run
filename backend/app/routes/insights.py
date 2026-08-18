"""GET /runs/{run_id}/insights — what a run actually achieved.

This is the "show the accomplishment, paywall the rabbit hole" surface, and
the split is load bearing:

  FREE — everything the runner just DID. Land taken, who lost it, the biggest
  capture, and where they now stand on the board. Nobody should ever have to
  pay to be told what happened in their own run, or whether they are winning.

  PRO  — the analysis. How this run compares to their recent form, what it was
  worth per kilometre, which of their land is about to decay, whether it was
  their best ever. Depth, never advantage; nothing here changes what they can
  claim next.

WHY IT IS NOT PART OF THE CLAIM RESPONSE. `/claim-territory` is the hottest
path in the app and already does a great deal of PostGIS under a lock. These
numbers are read-only, wanted a beat later (the payoff animation plays first),
and several of them scan the runner's history — so they are fetched separately
and can be slow, cached or skipped without touching the claim.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..config import settings
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["insights"])

# How soon counts as "about to go". Territory decays continuously, so any
# threshold is a choice: three days is close enough to still be worth a run
# this week, far enough that the list is not empty most of the time.
AT_RISK_DAYS = 3

# The live-territory predicate used everywhere else in the app, restated here
# because this module reads territories directly.
_LIVE = (
    "now() < COALESCE(t.expires_at, t.created_at + make_interval("
    "secs => GREATEST(t.strength, 0.1) * :life_per * 86400))"
)


def _pro_block(db: Session, user: models.User, run) -> schemas.RunInsightsPro:
    life = {"life_per": settings.territory_life_days_per_strength}

    risk = db.execute(
        text(
            f"""
            SELECT COALESCE(SUM(t.area_m2), 0), COUNT(*), MIN(t.expires_at)
            FROM territories t
            WHERE t.user_id = :u AND t.verified AND {_LIVE}
              AND t.expires_at IS NOT NULL
              AND t.expires_at < now() + make_interval(days => :days)
            """
        ),
        {"u": user.id, "days": AT_RISK_DAYS, **life},
    ).fetchone()

    # `runs.started_at` is naive UTC (written by Python), so the window has to
    # be UTC too — `now()` here is the server's LOCAL time and would shift this
    # by the server's offset. Zero on Render, hours anywhere else.
    recent = db.execute(
        text(
            """
            SELECT COUNT(*) FILTER (WHERE r.claimed_at IS NOT NULL),
                   COALESCE(SUM(r.distance_m), 0)
            FROM runs r
            WHERE r.user_id = :u AND r.verified
              AND r.started_at > timezone('utc', now()) - interval '30 days'
            """
        ),
        {"u": user.id},
    ).fetchone()

    stolen_30d = db.execute(
        text(
            """
            SELECT COALESCE(SUM(s.area_m2), 0) FROM territory_steals s
            WHERE s.attacker_id = :u AND NOT s.defended
              AND s.created_at > now() - interval '30 days'
            """
        ),
        {"u": user.id},
    ).scalar()

    # The biggest single claim this runner has produced, and the land they have
    # produced in the last 30 days. Both read the stored claim result, because
    # the territories themselves get merged and cut — the row a claim created
    # is long gone.
    #
    # GAINED, not the merged territory. These are "how much land did that run
    # win", and the merged total answers a different question: a short run
    # placed on top of a big holding would post a personal best every time and
    # drag the per-kilometre baseline somewhere no real week could reach. The
    # fallback keeps runs claimed before `gained_m2` existed in the picture at
    # the only figure they ever recorded.
    #
    # THIS RUN IS EXCLUDED from the record. It is already in the table by the
    # time these insights are fetched, so comparing against a maximum that
    # includes it would make every run either a tie or a "personal best",
    # depending on which way the comparison rounded.
    won = (
        "COALESCE((r.claim_result ->> 'gained_m2')::float, "
        "(r.claim_result -> 'territory' ->> 'area_m2')::float)"
    )
    history = db.execute(
        text(
            f"""
            SELECT
                MAX({won}) FILTER (WHERE r.id <> :run_id),
                COALESCE(SUM({won})
                    FILTER (WHERE r.started_at > timezone('utc', now()) - interval '30 days'), 0)
            FROM runs r
            WHERE r.user_id = :u AND r.claim_result IS NOT NULL
            """
        ),
        {"u": user.id, "run_id": run.id},
    ).fetchone()

    result = run.claim_result or {}
    best = history[0]
    land_30d = float(history[1] or 0)
    territory_m2 = float(
        result.get("gained_m2")
        if result.get("gained_m2") is not None
        else ((result.get("territory") or {}).get("area_m2") or 0)
    )
    distance_km = (run.distance_m or 0) / 1000.0
    distance_30d = float(recent[1] or 0)

    return schemas.RunInsightsPro(
        at_risk_m2=float(risk[0] or 0),
        at_risk_count=int(risk[1] or 0),
        soonest_expiry_at=risk[2],
        # Guarded on distance: a 20 metre GPS wobble that somehow claimed
        # would otherwise report millions of square metres per kilometre.
        m2_per_km=(territory_m2 / distance_km) if distance_km > 0.05 else None,
        # Land over DISTANCE across the whole window, not the mean of per-run
        # ratios — one very short claimed run would otherwise drag the
        # baseline somewhere no real week could reach.
        m2_per_km_30d=(land_30d / (distance_30d / 1000.0)) if distance_30d > 50 else None,
        claims_30d=int(recent[0] or 0),
        stolen_m2_30d=float(stolen_30d or 0),
        distance_m_30d=distance_30d,
        best_territory_m2=float(best) if best is not None else None,
        # A first-ever claim has no record to beat, and a tie is not a record:
        # running the same loop again produces the same area and should not be
        # celebrated every single time.
        is_personal_best=best is not None and territory_m2 > float(best),
    )


@router.get("/runs/{run_id}/insights", response_model=schemas.RunInsights)
def run_insights(
    run_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """What this run achieved. The runner's own run only."""
    run = db.query(models.Run).filter(models.Run.id == run_id).first()
    if not run or str(run.user_id) != str(user.id):
        # Same answer for "not yours" as for "not there" — a run id is
        # guessable and this should not confirm one exists.
        raise HTTPException(404, "run not found")

    result = run.claim_result or {}
    victims = result.get("victims") or []
    taken = [v for v in victims if not v.get("defended")]
    held = [v for v in victims if v.get("defended")]

    # Land actually gained. Straight off the claim now (`gained_m2` is measured
    # in the claim engine, in the last moment the new ground is still separable
    # from the land it merged into); the event log answers for runs claimed
    # before that field existed. `kind = 'claim'` and not the reinforce rows
    # with it: reinforcement moves no border, and counting it here is the exact
    # inflation this number exists to avoid.
    #
    # NULL — not zero — for runs older than the log: the claim's own footprint
    # was never recorded then, and the merged territory's area is a different
    # number. The client hides the line rather than showing a wrong one.
    gained = (run.claim_result or {}).get("gained_m2")
    if gained is None:
        gained = db.execute(
            text(
                "SELECT SUM(area_m2) FROM territory_events "
                "WHERE run_id = :r AND kind = 'claim'"
            ),
            {"r": run.id},
        ).scalar()

    # The land board position — the same never-gated answer /leaderboard/standing
    # gives, so the two can never tell the runner different things.
    standing = db.execute(
        text(
            f"""
            WITH scored AS (
                SELECT u.id AS uid,
                       COALESCE((SELECT SUM(t.area_m2) FROM territories t
                                 WHERE t.user_id = u.id
                                   AND (t.verified OR t.user_id = :u)
                                   AND {_LIVE}), 0) AS value
                FROM users u
            ),
            ranked AS (
                SELECT uid, RANK() OVER (ORDER BY value DESC) AS place,
                       COUNT(*) OVER () AS field_size
                FROM scored WHERE value > 0
            )
            SELECT place, field_size FROM ranked WHERE uid = :u
            """
        ),
        {"u": user.id, **{"life_per": settings.territory_life_days_per_strength}},
    ).fetchone()

    out = schemas.RunInsights(
        run_id=str(run.id),
        distance_m=float(run.distance_m or 0),
        duration_s=float(run.duration_s or 0),
        # The claim's own footprint. `territory.area_m2` is the merged holding
        # it landed in, which is a different question and a much bigger number.
        territory_m2=float(
            result.get("claimed_m2")
            if result.get("claimed_m2") is not None
            else ((result.get("territory") or {}).get("area_m2") or 0)
        ),
        land_gained_m2=float(gained) if gained is not None else None,
        stolen_m2=float(result.get("stolen_m2") or 0),
        rivals_taken=len(taken),
        rivals_held=len(held),
        biggest_capture_m2=max((float(v.get("area_m2") or 0) for v in taken), default=0.0),
        standing_rank=int(standing[0]) if standing else None,
        standing_field=int(standing[1]) if standing else 0,
    )

    if entitlements.is_pro(user):
        out.pro = _pro_block(db, user, run)

    return out
