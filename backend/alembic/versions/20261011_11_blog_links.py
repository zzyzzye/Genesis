"""新增博客链接，不修改既有文章与账号数据。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_11"
down_revision: str | None = "20261010_10"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """创建链接表及可见状态索引；已有站点保持空链接列表。"""
    op.create_table(
        "blog_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("description", sa.String(240), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_visible", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_blog_links_is_visible", "blog_links", ["is_visible"])


def downgrade() -> None:
    """删除链接表；回退会移除全部链接数据。"""
    op.drop_index("ix_blog_links_is_visible", table_name="blog_links")
    op.drop_table("blog_links")
