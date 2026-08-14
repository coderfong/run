"""Give a club an uploaded profile photo.

The image itself lives in `photo` as a data URI (same shape run posts use).
`photo_etag` is a short random token rewritten on every upload: list endpoints
select only the etag and hand clients an immutable
`/clans/{id}/photo?v=<etag>` URL, so a directory of 30 clubs costs 30 cached
image fetches instead of 30 inlined base64 blobs.

Revision ID: 0034
Revises: 0033
Create Date: 2026-08-14
"""

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE clans ADD COLUMN IF NOT EXISTS photo TEXT")
    op.execute("ALTER TABLE clans ADD COLUMN IF NOT EXISTS photo_etag TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE clans DROP COLUMN IF EXISTS photo_etag")
    op.execute("ALTER TABLE clans DROP COLUMN IF EXISTS photo")
