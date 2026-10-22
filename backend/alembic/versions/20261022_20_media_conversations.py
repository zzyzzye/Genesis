"""为影音助手复用会话目录，并隔离博客与影音历史。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261022_20"
down_revision: str | None = "20261021_19"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """旧会话继续归属博客，新增影音会话显式指定模块。"""
    op.add_column(
        "ai_conversations",
        sa.Column("surface", sa.String(20), server_default="studio", nullable=False),
    )
    op.create_index("ix_ai_conversations_surface", "ai_conversations", ["surface"])


def downgrade() -> None:
    """移除模块字段；降级前应先导出影音历史。"""
    op.drop_index("ix_ai_conversations_surface", table_name="ai_conversations")
    op.drop_column("ai_conversations", "surface")
