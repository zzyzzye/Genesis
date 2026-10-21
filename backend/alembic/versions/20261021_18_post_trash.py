"""为文章增加可恢复的回收站状态。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021_18"
down_revision: str | None = "20261021_17"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """已有文章保持有效，仅新增可空的删除时间。"""
    op.add_column("blog_posts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_blog_posts_deleted_at", "blog_posts", ["deleted_at"])


def downgrade() -> None:
    """移除标记前转为草稿，避免降级后意外公开回收站内容。"""
    op.execute(
        "UPDATE blog_posts SET status = 'draft', published_at = NULL WHERE deleted_at IS NOT NULL"
    )
    op.drop_index("ix_blog_posts_deleted_at", table_name="blog_posts")
    op.drop_column("blog_posts", "deleted_at")
