"""为历史 AI 任务补充唯一线程标识，先回填再收紧非空约束。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910_05"
down_revision: str | None = "20260908_04"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """增加 thread_id，将旧记录按任务 ID 回填，再建立唯一索引。"""
    op.add_column("ai_chat_runs", sa.Column("thread_id", sa.String(length=255), nullable=True))
    op.execute("UPDATE ai_chat_runs SET thread_id = id::text WHERE thread_id IS NULL")
    op.alter_column("ai_chat_runs", "thread_id", nullable=False)
    op.create_index("ix_ai_chat_runs_thread_id", "ai_chat_runs", ["thread_id"], unique=True)


def downgrade() -> None:
    """移除线程索引与字段，不清理外部 checkpoint 存储。"""
    op.drop_index("ix_ai_chat_runs_thread_id", table_name="ai_chat_runs")
    op.drop_column("ai_chat_runs", "thread_id")
