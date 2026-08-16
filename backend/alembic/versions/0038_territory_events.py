"""The territory event log — an append-only history of who held what, where.

WHY THIS CANNOT BE DERIVED. `territories` is current state and nothing else.
The claim engine unions a runner's overlapping rows into one, carves defended
ground back out of an attacker's polygon, and DELETEs any row a claim consumed
entirely (see `_claim_territory` in routes/runs.py). A territory row is
therefore not a place with a history; it is a snapshot that gets rewritten and
thrown away. Ask it "who held this corner before me" and it has no answer.

`territory_steals` (0016) is closer but deliberately narrow: it records
rivalries, so it has a NOT NULL victim and a self-check constraint, and it
never sees a claim on empty ground or a runner reinforcing their own. A
timeline built from it would read "Alex stole it, you reclaimed it" with the
beginning missing.

So: one row per beat, never updated, never deleted.

GEOMETRY, NOT A ZONE ID. There is no zone. Claims are free-placed stamps that
overlap arbitrarily, so the only honest way to ask "what happened HERE" is to
ask it of a point and let PostGIS answer. Each row stores the polygon of the
ground that actually changed hands — for a steal that is the intersection, not
the whole claim — which makes the lookup an exact `ST_Contains` rather than a
guess from a centroid and a radius. The GIST index is what keeps that cheap.
`lat`/`lon` ride along as the centroid purely so a list can be rendered
without touching geometry at all.

WHAT IS NOT IN HERE, on purpose: expiry. Land that simply decays is never
deleted by anything — the app treats a territory as dead by comparing
`expires_at`, lazily, at read time — so the end of a hold that nobody took is
already recorded on the territory row and does not need an event. Adding a
sweeper to write "expired" rows would mean running a job whose only output is
history, and getting the same answer a column already gives.

THIS SHIPS DARK. Every feature it feeds (ownership timelines, longest hold,
previous owners, defence rate, average territory lifetime) is worthless until
the log has weeks in it, and none of them can be backfilled: the past was
never recorded. So this migration and the writes that go with it land now, and
the reading of them lands later. An empty timeline is worse than no timeline.

Revision ID: 0038
Revises: 0037
Create Date: 2026-08-16
"""

from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `kind` is what the row MEANS, and the four are not interchangeable:
    #   claim      — took ground that belonged to nobody
    #   steal      — took ground off `victim_id`
    #   defend     — attacked `victim_id`'s ground and bounced; the actor
    #                gained nothing and the victim's hold continued
    #   reinforce  — reclaimed ground the actor already held
    # `defend` is the one that looks odd stored from the attacker's side, but
    # it matches territory_steals and keeps every row answering the same
    # question: who acted, on whose ground.
    #
    # `victim_id` is NULL exactly for claim and reinforce. ON DELETE SET NULL
    # rather than CASCADE on both actors: a deleted account must not erase the
    # history of the people it played against.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS territory_events (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
            victim_id  UUID REFERENCES users(id) ON DELETE SET NULL,
            run_id     UUID REFERENCES runs(id) ON DELETE SET NULL,
            kind       TEXT NOT NULL,
            area_m2    DOUBLE PRECISION NOT NULL,
            ground     geometry(MULTIPOLYGON, 4326),
            lat        DOUBLE PRECISION,
            lon        DOUBLE PRECISION,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT territory_events_kind
                CHECK (kind IN ('claim', 'steal', 'defend', 'reinforce')),
            CONSTRAINT territory_events_victim
                CHECK ((kind IN ('steal', 'defend')) = (victim_id IS NOT NULL))
        )
        """
    )
    # "What happened at this point, in order" — the whole read pattern of the
    # timeline feature. Spatial first because it is the selective half.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_terr_events_ground "
        "ON territory_events USING GIST (ground)"
    )
    # "This runner's own history" — the analytics feeds, and the only queries
    # that scan by person rather than by place.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_terr_events_actor "
        "ON territory_events (actor_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_terr_events_victim "
        "ON territory_events (victim_id, created_at DESC) WHERE victim_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS territory_events")
