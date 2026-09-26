"""Writing to the territory event log (migration 0038).

This is instrumentation, and it shipped DARK. The rows were written for weeks
before anything read them, because the history they describe cannot be
recovered later: `territories` is current state, the claim engine deletes and
rewrites rows as it goes, and a timeline of a place has no source anywhere
else. The first reader is the runner's own land page (routes/my_territory.py):
the ground taken off them, the attacks that bounced, the ground that faded.

WHERE IT IS CALLED FROM, and why that matters: inside `_claim_territory` in
routes/runs.py, not from its callers. That function is the single point where
land changes hands — the claim endpoint, the dev tools, the bot activity loop
and the world seeder all go through it — so recording there means the log is
complete by construction. Recording in the caller instead would have quietly
left three of the four paths unlogged, and a history with holes in it is worse
than no history, because nothing about it looks wrong.

READING THIS LATER — one thing to know. A claim writes the actor's own event
covering ALL the ground they ended up on, and a separate `steal`/`defend` row
per rival covering just the ground contested with that rival. So at a point
that was taken off somebody, two rows share a `run_id` and a timestamp: the
actor's `claim`, and the `steal` naming who lost it. The steal is the specific
truth and should win; the claim is the one to fall back on where no steal
exists. They are not duplicates, they are the same beat at two resolutions.

WHICH CLUBS WERE INVOLVED (migration 0047). `victim_clan_id` is written here,
from the defender's membership at the moment of the beat. The attacker's club
is NOT: it is the club the run counted for, which `club_run_logs` answers
through `run_id`, and for the first finisher of a club run that answer only
exists once a clubmate comes in. app/game_events.py is the one reader that
puts the two together.

FAILURE POLICY: never break a claim. A run that finished and a claim that
landed are the product; the history of it is not worth losing either one over.
Every write is wrapped in a SAVEPOINT, which is what makes "best effort" true
rather than merely intended — PostgreSQL aborts the ENTIRE transaction on a
failed statement, so catching the exception without a savepoint would leave
the session poisoned and take the claim down anyway, one statement later and
somewhere much harder to read.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

CLAIM = "claim"
STEAL = "steal"
DEFEND = "defend"
REINFORCE = "reinforce"
# Ground that ran out of time (0045). Written by the two sweeps that delete
# expired land (`_collect_expired` in routes/runs.py), never by `record`: it is
# a by-product of that DELETE and has to be written in the same statement, or
# the row it describes is already gone. The actor is the runner whose ground it
# was; there is no victim, because nobody took it.
EXPIRE = "expire"

# Below this, a row is a rounding artefact rather than a beat in anyone's
# history — the same floor the rivalry ledger uses, for the same reason: a
# 3 m² clip off a polygon edge would drown the real events in a timeline.
MIN_AREA_M2 = 25.0


def record(
    db: Session,
    *,
    kind: str,
    actor_id,
    area_m2: float,
    ground_wkt: str | None,
    run_id=None,
    victim_id=None,
) -> None:
    """Append one beat. Best effort: a failure here must never cost a claim.

    `ground_wkt` is the polygon that actually changed hands — for a steal that
    is the intersection with the victim's land, NOT the whole claim. It may be
    None if the geometry could not be resolved, in which case the row still
    carries who/what/when and simply cannot answer a "what happened here"
    question. That is worth keeping: the analytics feeds never touch geometry.

    `area_m2` is a FLOOR CHECK and a fallback, not the stored value: where a
    ground polygon is given, the area is measured from it in SQL. A caller
    holding a merged territory's total would otherwise credit one reinforcing
    claim with every square metre it had already been holding for weeks.
    """
    if area_m2 is None or area_m2 < MIN_AREA_M2:
        return
    try:
        # SAVEPOINT. Rolling this back leaves the surrounding claim's
        # transaction alive and usable; without it, a bad geometry here would
        # abort everything the claim has already done.
        with db.begin_nested():
            db.execute(
                text(
                    """
                    WITH g AS (
                        SELECT CASE
                            WHEN CAST(:wkt AS text) IS NULL THEN NULL
                            ELSE ST_Multi(ST_CollectionExtract(
                                ST_MakeValid(ST_GeomFromText(:wkt, 4326)), 3))
                        END AS geom
                    )
                    INSERT INTO territory_events
                        (actor_id, victim_id, run_id, kind, area_m2, ground, lat, lon,
                         victim_clan_id)
                    SELECT :actor, :victim, :run, :kind,
                           COALESCE(ST_Area(g.geom::geography), :area), g.geom,
                           ST_Y(ST_Centroid(g.geom)), ST_X(ST_Centroid(g.geom)),
                           -- The defender's club as it stands NOW, which is
                           -- the only moment it can be read: a runner can
                           -- change clubs later (migration 0047).
                           (SELECT u.clan_id FROM users u
                            WHERE u.id = CAST(:victim AS uuid))
                    FROM g
                    """
                ),
                {
                    "actor": actor_id, "victim": victim_id, "run": run_id,
                    "kind": kind, "area": float(area_m2), "wkt": ground_wkt,
                },
            )
    except Exception:  # noqa: BLE001 — deliberately swallowed, see module docstring
        # The claim itself is still good. Losing one history row costs a line
        # in a timeline nobody is reading yet; raising here would cost the run.
        log.warning("territory_events write failed (kind=%s)", kind, exc_info=True)
