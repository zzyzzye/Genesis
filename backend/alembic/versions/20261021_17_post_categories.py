"""增加文章多分类关联，并保留已有分类。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021_17"
down_revision: str | None = "20261012_16"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """创建多对多关系并回填原有单分类，不修改文章正文。"""
    op.create_table(
        "blog_post_categories",
        sa.Column(
            "post_id", sa.Uuid(), sa.ForeignKey("blog_posts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "category_id", sa.Uuid(), sa.ForeignKey("blog_categories.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.execute(
        "INSERT INTO blog_post_categories (post_id, category_id) "
        "SELECT id, category_id FROM blog_posts WHERE category_id IS NOT NULL"
    )


def downgrade() -> None:
    """移除多分类关系，文章与旧版首分类字段保持不变。"""
    op.drop_table("blog_post_categories")
