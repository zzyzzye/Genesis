"""embed agent runtime and persist resumable requests

Revision ID: 20260922_06
Revises: 20260910_05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260922_06"
down_revision: str | None = "20260910_05"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_chat_runs",
        sa.Column("request_payload", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ai_chat_runs", "request_payload")
