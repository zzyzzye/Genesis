"""新增文章评论与审核状态，既有文章保持无评论。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_12"
down_revision: str | None = "20261011_11"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """创建评论表，删除文章时由数据库级联清理评论。"""
    op.create_table(
        "blog_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("submission_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "post_id", sa.Uuid(), sa.ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("content", sa.String(2000), nullable=False),
        sa.Column("state", sa.String(7), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for field in ("post_id", "author_id", "state"):
        op.create_index(f"ix_blog_comments_{field}", "blog_comments", [field])


def downgrade() -> None:
    """回退会删除评论，不修改文章。"""
    op.drop_table("blog_comments")
