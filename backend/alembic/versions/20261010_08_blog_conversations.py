"""建立博客会话目录并关联现有生成任务，不复制正文。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261010_08"
down_revision: str | None = "20260923_07"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """新增会话表和可空关联，保留其他模块的既有任务行为。"""
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("title_source", sa.String(20), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])
    op.add_column("ai_chat_runs", sa.Column("conversation_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_ai_chat_runs_conversation", "ai_chat_runs", "ai_conversations",
        ["conversation_id"], ["id"],
    )
    op.create_index("ix_ai_chat_runs_conversation_id", "ai_chat_runs", ["conversation_id"])


def downgrade() -> None:
    """移除会话关联，不删除已有生成任务。"""
    op.drop_index("ix_ai_chat_runs_conversation_id", table_name="ai_chat_runs")
    op.drop_constraint("fk_ai_chat_runs_conversation", "ai_chat_runs", type_="foreignkey")
    op.drop_column("ai_chat_runs", "conversation_id")
    op.drop_index("ix_ai_conversations_user_id", table_name="ai_conversations")
    op.drop_table("ai_conversations")
