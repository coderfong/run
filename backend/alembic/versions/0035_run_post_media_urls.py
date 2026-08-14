"""Serve run post photos by URL instead of inlining them in the feed.

The photos still live in `runs.post_media`; what changes is what the API hands
out. A base64 photo inside every feed row made one page of the feed several
megabytes, which blew straight past the client's 256 KB cache ceiling — so the
feed stopped being cached at all the moment anybody added a picture, and Home
went back to loading from scratch on every visit.

`post_media_etag` is a short token rewritten on every edit, so each photo gets
an immutable `/runs/{id}/post-photo/{index}?v=<etag>` URL the client can cache
to disk forever.

Revision ID: 0035
Revises: 0034
Create Date: 2026-08-14
"""

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS post_media_etag TEXT")
    # Existing posts predate the token; give them one so their photos get a
    # URL rather than being dropped from the feed.
    op.execute(
        "UPDATE runs SET post_media_etag = encode(gen_random_bytes(6), 'hex') "
        "WHERE post_media_etag IS NULL "
        "AND jsonb_array_length(COALESCE(post_media, '[]'::jsonb)) > 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS post_media_etag")
