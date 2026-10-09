"""增加后台恢复所需的原始请求载荷，历史任务使用空对象回填。

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
    """添加非空请求 JSON 字段，不为历史记录伪造缺失的对话与用户上下文。"""
    op.add_column(
        "ai_chat_runs",
        sa.Column(
            "request_payload", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False
        ),
    )


def downgrade() -> None:
    """删除请求载荷字段，已有任务将失去依赖该字段的后台恢复数据。"""
    op.drop_column("ai_chat_runs", "request_payload")
