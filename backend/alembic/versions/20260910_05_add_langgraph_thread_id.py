"""bind application AI runs to LangGraph threads"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "20260910_05"
down_revision: str | None = "20260908_04"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_chat_runs", sa.Column("thread_id", sa.String(length=255), nullable=True))
    op.execute("UPDATE ai_chat_runs SET thread_id = id::text WHERE thread_id IS NULL")
    op.alter_column("ai_chat_runs", "thread_id", nullable=False)
    op.create_index("ix_ai_chat_runs_thread_id", "ai_chat_runs", ["thread_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_ai_chat_runs_thread_id", table_name="ai_chat_runs")
    op.drop_column("ai_chat_runs", "thread_id")
