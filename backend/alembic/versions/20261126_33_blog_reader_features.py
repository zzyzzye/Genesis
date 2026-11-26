"""增加文章历史、评论回复和站内通知。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261126_33"
down_revision: str | None = "20261116_32"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """添加独立历史表和通知索引，旧评论继续作为顶层留言。"""
    op.create_table(
        "blog_post_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "post_id", sa.Uuid(), sa.ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.UniqueConstraint("post_id", "version"),
    )
    op.create_index("ix_blog_post_revisions_post_id", "blog_post_revisions", ["post_id"])
    op.add_column("blog_comments", sa.Column("parent_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_blog_comment_parent",
        "blog_comments",
        "blog_comments",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_blog_comments_parent_id", "blog_comments", ["parent_id"])
    op.create_table(
        "blog_notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "recipient_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "comment_id",
            sa.Uuid(),
            sa.ForeignKey("blog_comments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("recipient_id", "comment_id"),
    )
    op.create_index("ix_blog_notifications_recipient_id", "blog_notifications", ["recipient_id"])
    op.create_index("ix_blog_notifications_comment_id", "blog_notifications", ["comment_id"])


def downgrade() -> None:
    """移除新增索引及历史功能，保留文章与评论正文。"""
    op.drop_table("blog_notifications")
    op.drop_index("ix_blog_comments_parent_id", table_name="blog_comments")
    op.drop_constraint("fk_blog_comment_parent", "blog_comments", type_="foreignkey")
    op.drop_column("blog_comments", "parent_id")
    op.drop_table("blog_post_revisions")
