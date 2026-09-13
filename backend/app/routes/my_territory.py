"""GET /me/territory — your land, plot by plot, and what has happened to it.

Ground in PASER ends one of three ways: the clock runs out, a rival takes it,
or it holds. The map shows the first as a fade and the other two not at all
once the cutscene has played, and the stat wall only counts what is left. This
is the one place that says which of your ground is about to go and what has
been thrown at it.

WHAT A PLOT IS. One territory row. A holding that looks like one blob on the
map is often several rows, because the claim engine keeps each run's footprint
separable (see `_claim_territory`): ground re-run on Wednesday becomes a new row
with a new clock, and the Monday ground beside it keeps its own. Each row is a
timer, so each row is a plot here. Merging them for display would hide exactly
the thing the runner opened this to find out.

IT AGREES WITH THE STAT WALL. Same live predicate as /me/stats and no
`verified` filter, so `summary.area_m2` is "Area held" and `summary.plots` is
"Zones", to the square metre. The owner sees their own shadow-flagged land on
the map too, and nothing here says which plots those are: a flagged claim is
shown to its owner as ordinary ground on purpose.

HISTORY IS THE EVENT LOG (0038): `steal` and `defend` rows where the runner is
the victim, and `expire` rows (0045) where they are the owner. Not the rivalry
ledger, which is written per territory ROW rather than per person and has no
geometry.

TIMES ARE TAKEN AS DISTANCES FROM NOW, inside SQL, and turned into instants
here. Territory timestamps are written by Postgres' `now()` in the database's
own zone while Python stamps naive UTC, and the two only agree where the
server runs in UTC. A difference taken inside one clock is right everywhere.

FREE, all of it. Everything here is a fact about the runner's own ground: what
they hold, when it fades, who took what. PRO sells the reading of history,
never the history itself (config/pro.js, routes/rivals.py).
"""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import elo, models, schemas
from ..config import settings
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..reminders import TERRITORY_EXPIRING_HOURS
from ..security import current_user

log = logging.getLogger(__name__)

router = APIRouter(tags=["territory"])

# "This week", for the per-plot defence count and the summary line.
WINDOW_DAYS = 7
# How far back the history reaches. Longer than any plot lives (nine days at
# most), so ground that faded is still listed after its last neighbour went.
HISTORY_DAYS = 14
HISTORY_LIMIT = 40
# Soonest to fade first. A runner holding more than this is not reading the
# list one row at a time, and the rows at the top are the ones that matter.
PLOT_LIMIT = 100
# The thumbnail budget: three outlines of twenty four points draw any plot
# recognisably at 48pt and keep a big holding well inside the client cache's
# per entry cap.
RINGS_PER_PLOT = 3
POINTS_PER_RING = 24
# A defence counts against a plot where the contested ground OVERLAPS it, not
# where it merely touches the border with the plot next door.
HELD_MIN_OVERLAP_M2 = 1.0

# When a plot expires: its stored clock, or the legacy strength formula for a
# row that predates one (0022). The same expression /me/stats and /map-polygons
# decide "live" with, restated because this module reads territories directly.
_EXPIRY = (
    "COALESCE(t.expires_at, t.created_at + make_interval("
    "secs => GREATEST(t.strength, 0.1) * :life_per * 86400))"
)

# The runner's own beats in the event log: ground taken off them, attacks on
# their ground that bounced, and their ground running out.
_MINE = (
    "((e.victim_id = :u AND e.kind IN ('steal', 'defend')) "
    "OR (e.actor_id = :u AND e.kind = 'expire'))"
)

_BEAT_KIND = {"steal": "lost", "defend": "held", "expire": "faded"}


def _thin(ring):
    """A ring cut to the thumbnail budget: evenly sampled, about 1 m precise."""
    pts = [(round(float(x), 5), round(float(y), 5)) for x, y in ring]
    if len(pts) > POINTS_PER_RING:
        step = len(pts) / POINTS_PER_RING
        pts = [pts[int(i * step)] for i in range(POINTS_PER_RING)]
    return pts


def _outlines(wkt):
    """The largest outlines of a stored shape, thinned — or nothing at all."""
    if not wkt:
        return []
    try:
        geom = shapely_wkt.loads(wkt)
    except Exception:  # noqa: BLE001 — a shape we cannot read is one we do not draw
        return []
    if geom.is_empty:
        return []
    return [_thin(r) for r in geometry_to_rings(geom)[:RINGS_PER_PLOT] if len(r) >= 3]


def _held_by_plot(db: Session, ids: list[str]) -> dict:
    """Attacks that bounced off each plot this week → {plot_id: (count, secs_ago)}.

    Measured by OVERLAP, not by touching. A defence's ground is the part of the
    attacker's claim that sat on your plot, and the plot next door shares a
    border with it, so `ST_Intersects` alone would put one fight on both.

    Best effort, inside a SAVEPOINT: this is the only overlay (ST_Intersection)
    here, and GEOS can throw on a shape the claim engine left slightly invalid.
    A throw must cost the counts, not the page, and without the savepoint it
    would abort the transaction every later query on this request runs in.
    """
    if not ids:
        return {}
    try:
        with db.begin_nested():
            rows = db.execute(
                text(
                    """
                    SELECT t.id::text, COUNT(*),
                           EXTRACT(EPOCH FROM (now() - MAX(e.created_at)))
                    FROM territories t
                    JOIN territory_events e
                      ON e.victim_id = t.user_id
                     AND e.kind = 'defend'
                     AND e.created_at > now() - make_interval(days => :days)
                     AND e.ground && t.polygon
                    WHERE t.id = ANY(CAST(:ids AS uuid[]))
                      AND ST_Intersects(e.ground, t.polygon)
                      AND ST_Area(ST_Intersection(e.ground, t.polygon)::geography) >= :min_m2
                    GROUP BY t.id
                    """
                ),
                {"ids": ids, "days": WINDOW_DAYS, "min_m2": HELD_MIN_OVERLAP_M2},
            ).fetchall()
    except Exception:  # noqa: BLE001 — deliberately swallowed, see docstring
        log.warning("per plot defence counts failed", exc_info=True)
        return {}
    return {r[0]: (int(r[1] or 0), float(r[2] or 0)) for r in rows}


@router.get("/me/territory", response_model=schemas.MyTerritoryOut)
def my_territory(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Every plot you hold, soonest to fade first, and the last two weeks of
    what happened to your ground."""
    now = datetime.utcnow()
    life = {"life_per": settings.territory_life_days_per_strength}
    soon_s = TERRITORY_EXPIRING_HOURS * 3600

    # Totals over EVERY live plot, not just the ones the list sends, so the
    # summary is the stat wall's number even for a runner past PLOT_LIMIT.
    totals = db.execute(
        text(
            f"""
            SELECT COUNT(*), COALESCE(SUM(t.area_m2), 0),
                   COUNT(*) FILTER (WHERE {_EXPIRY} <= now() + make_interval(secs => :soon_s)),
                   COALESCE(SUM(t.area_m2) FILTER (
                       WHERE {_EXPIRY} <= now() + make_interval(secs => :soon_s)), 0),
                   EXTRACT(EPOCH FROM (MIN({_EXPIRY}) - now()))
            FROM territories t
            WHERE t.user_id = :u AND now() < {_EXPIRY}
            """
        ),
        {"u": user.id, "soon_s": soon_s, **life},
    ).fetchone()

    rows = db.execute(
        text(
            f"""
            SELECT t.id::text, t.area_m2, t.strength, t.reinforcements,
                   (t.clan_id IS NOT NULL), t.run_id::text, r.distance_m,
                   EXTRACT(EPOCH FROM (now() - t.created_at)),
                   EXTRACT(EPOCH FROM ({_EXPIRY} - now())),
                   EXTRACT(EPOCH FROM ({_EXPIRY} - t.created_at)),
                   -- ON the plot, which a centroid is not for a crescent.
                   ST_Y(ST_PointOnSurface(t.polygon)), ST_X(ST_PointOnSurface(t.polygon)),
                   ST_XMin(t.polygon), ST_YMin(t.polygon), ST_XMax(t.polygon), ST_YMax(t.polygon),
                   ST_AsText(ST_SimplifyPreserveTopology(t.polygon, :tol))
            FROM territories t
            LEFT JOIN runs r ON r.id = t.run_id
            WHERE t.user_id = :u AND now() < {_EXPIRY}
            ORDER BY {_EXPIRY} ASC
            LIMIT :lim
            """
        ),
        {"u": user.id, "tol": settings.map_tol_high, "lim": PLOT_LIMIT, **life},
    ).fetchall()

    held = _held_by_plot(db, [r[0] for r in rows])

    plots = []
    for (pid, area, strength, reinforcements, club, run_id, run_m,
         age_s, left_s, life_s, lat, lon, x0, y0, x1, y1, wkt) in rows:
        left_s, life_s = float(left_s or 0), float(life_s or 0)
        n_held, held_ago = held.get(pid, (0, None))
        plots.append(
            schemas.TerritoryPlot(
                id=pid,
                area_m2=float(area or 0),
                claimed_at=now - timedelta(seconds=float(age_s or 0)),
                expires_at=now + timedelta(seconds=left_s),
                fading=left_s <= soon_s,
                life_left=max(0.0, min(1.0, left_s / life_s)) if life_s > 0 else 0.0,
                strength=float(strength or 1.0),
                reinforcements=int(reinforcements or 0),
                club=bool(club),
                held=n_held,
                last_held_at=now - timedelta(seconds=held_ago) if held_ago is not None else None,
                run_id=run_id,
                run_distance_m=float(run_m) if run_m is not None else None,
                lat=float(lat) if lat is not None else None,
                lon=float(lon) if lon is not None else None,
                bbox=[float(x0), float(y0), float(x1), float(y1)] if x0 is not None else [],
                rings=_outlines(wkt),
            )
        )

    week = db.execute(
        text(
            f"""
            SELECT COUNT(*) FILTER (WHERE e.kind = 'steal'),
                   COALESCE(SUM(e.area_m2) FILTER (WHERE e.kind = 'steal'), 0),
                   COUNT(*) FILTER (WHERE e.kind = 'defend'),
                   COUNT(*) FILTER (WHERE e.kind = 'expire'),
                   COALESCE(SUM(e.area_m2) FILTER (WHERE e.kind = 'expire'), 0)
            FROM territory_events e
            WHERE {_MINE}
              AND e.created_at > now() - make_interval(days => :days)
            """
        ),
        {"u": user.id, "days": WINDOW_DAYS},
    ).fetchone()

    beats = db.execute(
        text(
            f"""
            SELECT e.kind, e.area_m2, EXTRACT(EPOCH FROM (now() - e.created_at)),
                   e.lat, e.lon, u.id::text, u.username, u.avatar, u.solo_elo
            FROM territory_events e
            -- The rival is whoever ACTED. On an expire row that is the runner
            -- themself, who is not their own rival.
            LEFT JOIN users u ON u.id = e.actor_id AND e.kind <> 'expire'
            WHERE {_MINE}
              AND e.created_at > now() - make_interval(days => :days)
            ORDER BY e.created_at DESC
            LIMIT :lim
            """
        ),
        {"u": user.id, "days": HISTORY_DAYS, "lim": HISTORY_LIMIT},
    ).fetchall()

    history = [
        schemas.TerritoryBeat(
            kind=_BEAT_KIND[kind],
            area_m2=float(area or 0),
            at=now - timedelta(seconds=float(ago_s or 0)),
            lat=lat,
            lon=lon,
            rival_id=rid,
            rival_username=username,
            rival_avatar=avatar,
            rival_rank_key=elo.key_for(rating) if rid else None,
        )
        for kind, area, ago_s, lat, lon, rid, username, avatar, rating in beats
        if kind in _BEAT_KIND
    ]

    next_left = totals[4]
    return schemas.MyTerritoryOut(
        summary=schemas.TerritorySummary(
            plots=int(totals[0] or 0),
            area_m2=float(totals[1] or 0),
            fading_plots=int(totals[2] or 0),
            fading_m2=float(totals[3] or 0),
            next_expiry_at=now + timedelta(seconds=float(next_left)) if next_left is not None else None,
            lost_times=int(week[0] or 0),
            lost_m2=float(week[1] or 0),
            held_times=int(week[2] or 0),
            faded_times=int(week[3] or 0),
            faded_m2=float(week[4] or 0),
        ),
        plots=plots,
        history=history,
        fading_hours=TERRITORY_EXPIRING_HOURS,
        window_days=WINDOW_DAYS,
        history_days=HISTORY_DAYS,
    )
