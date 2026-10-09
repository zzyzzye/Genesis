"""增加与浏览器连接解耦的 AI 任务及可重放文本快照。

Revision ID: 20260908_04
Revises: 20260907_03
Create Date: 2026-09-08 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260908_04"
down_revision: str | None = "20260907_03"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """建立后台任务表和归属、状态索引，删除用户时级联清理任务记录。"""
    op.create_table(
        "ai_chat_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("surface", sa.String(length=20), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "running",
                "completed",
                "failed",
                name="ai_chat_run_status",
                native_enum=False,
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("sequence", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_chat_runs_status"), "ai_chat_runs", ["status"], unique=False)
    op.create_index(op.f("ix_ai_chat_runs_user_id"), "ai_chat_runs", ["user_id"], unique=False)


def downgrade() -> None:
    """删除任务索引与表，会丢弃任务状态及已生成文本。"""
    op.drop_index(op.f("ix_ai_chat_runs_user_id"), table_name="ai_chat_runs")
    op.drop_index(op.f("ix_ai_chat_runs_status"), table_name="ai_chat_runs")
    op.drop_table("ai_chat_runs")
