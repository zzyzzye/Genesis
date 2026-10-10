"""持久化模型输出用量和服务端测速，旧任务保持统计不可用。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261010_09"
down_revision: str | None = "20261010_08"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """新增可空统计字段，不为旧回复伪造耗时或 token 用量。"""
    op.add_column("ai_chat_runs", sa.Column("generation_metrics", sa.JSON(), nullable=True))


def downgrade() -> None:
    """移除展示统计，保留聊天正文及执行状态。"""
    op.drop_column("ai_chat_runs", "generation_metrics")
