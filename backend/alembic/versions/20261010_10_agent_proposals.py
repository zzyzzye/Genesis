"""独立持久化工具返回的待确认操作提议。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261010_10"
down_revision: str | None = "20261010_09"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """新增可空提议列表，旧会话不补造提议。"""
    op.add_column("ai_chat_runs", sa.Column("proposals", sa.JSON(), nullable=True))


def downgrade() -> None:
    """移除提议展示数据，保留聊天正文。"""
    op.drop_column("ai_chat_runs", "proposals")
