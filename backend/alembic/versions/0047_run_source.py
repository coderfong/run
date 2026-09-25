"""Mark which runs were recorded standalone on the Apple Watch and submitted
to PASER after the fact, rather than tracked live by the phone.

A watch run reaches /start-run long after it actually began (the watch
records it, then hands the finished route to the phone — see
frontend/targets/watch/WorkoutManager.swift and
frontend/modules/paser-watch/ios/PhoneWatchSession.swift), so /start-run has
to honour a client-supplied `started_at` for it, which is ordinarily refused
(see the comment on start_run in app/routes/runs.py — that refusal exists
specifically to stop a client declaring a two-second submission a forty-minute
run). `source` is what lets /end-run apply EXTRA scrutiny only to that one
narrow path — the submitted points' own first/last timestamps must agree with
the claimed started_at/ended_at within a small tolerance — without touching
the validation every ordinary phone run already goes through.

Nullable, and NULL means "phone" (every existing run): this is additional
scrutiny for a new path, never a relaxation of an old one.

Revision ID: 0047
Revises: 0046
"""
from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS source TEXT")


def downgrade():
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS source")
