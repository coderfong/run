"""Store timed GPS evidence for club run verification."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("runs", sa.Column("together_trace", JSONB(), nullable=True))


def downgrade():
    op.drop_column("runs", "together_trace")
