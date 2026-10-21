"""持久化定时发布计划及文章操作回执。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021_19"
down_revision: str | None = "20261021_18"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """保留已有文章和发布状态，新计划默认为空。"""
    op.add_column("blog_posts", sa.Column("scheduled_at", sa.DateTime(timezone=True)))
    op.create_index("ix_blog_posts_scheduled_at", "blog_posts", ["scheduled_at"])
    op.create_table(
        "blog_operations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    """仅移除计划与回执，计划文章仍为未公开草稿。"""
    op.drop_table("blog_operations")
    op.drop_index("ix_blog_posts_scheduled_at", table_name="blog_posts")
    op.drop_column("blog_posts", "scheduled_at")
