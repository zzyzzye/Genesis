"""为共享用户增加独立的密码哈希与最后登录时间记录。

Revision ID: 20260903_02
Revises: 20260903_01
Create Date: 2026-09-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260903_02"
down_revision: str | None = "20260903_01"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """建立与用户一对一的凭据表，删除用户时级联删除其凭据。"""
    op.create_table(
        "user_credentials",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("password_hash", sa.String(length=500), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    """删除凭据表，会丢弃已存密码哈希与登录时间。"""
    op.drop_table("user_credentials")
