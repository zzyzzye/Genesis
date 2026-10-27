"""持久化官方 AG-UI 公开事件，支持独立订阅与断线重放。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261027_29"
down_revision: str | None = "20261027_28"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """追加事件表，不修改既有任务、账务与 checkpoint 数据。"""
    op.create_table(
        "ai_chat_run_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("ai_chat_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_ai_chat_run_events_run_id", "ai_chat_run_events", ["run_id"])


def downgrade() -> None:
    """只移除展示事件日志，任务历史与执行状态仍保留。"""
    op.drop_table("ai_chat_run_events")
