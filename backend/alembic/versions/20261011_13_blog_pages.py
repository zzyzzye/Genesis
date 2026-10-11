"""新增独立页面，不改变既有文章与评论。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_13"
down_revision: str | None = "20261011_12"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """创建独立页面表，公开和管理查询使用各自的状态边界。"""
    op.create_table(
        "blog_pages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("slug", sa.String(160), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("excerpt", sa.String(500), nullable=False),
        sa.Column("content_markdown", sa.Text(), nullable=False),
        sa.Column("status", sa.String(9), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_blog_pages_slug", "blog_pages", ["slug"], unique=True)
    op.create_index("ix_blog_pages_status", "blog_pages", ["status"])


def downgrade() -> None:
    """回退会删除独立页面，不修改文章。"""
    op.drop_table("blog_pages")
