"""保存助手工具调用的安全展示记录。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261022_21"
down_revision: str | None = "20261022_20"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """旧任务不伪造调用记录，新任务按工具回调保存。"""
    op.add_column("ai_chat_runs", sa.Column("tool_calls", sa.JSON(), nullable=True))


def downgrade() -> None:
    """移除工具展示历史，不改变执行 checkpoint。"""
    op.drop_column("ai_chat_runs", "tool_calls")
