"""保存文章当前版本的 AI 导读及可恢复生成状态。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261012_15"
down_revision: str | None = "20261011_14"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """导读随文章删除，不改动既有文章内容与编辑版本。"""
    op.create_table(
        "blog_article_guides",
        sa.Column(
            "post_id",
            sa.Uuid(),
            sa.ForeignKey("blog_posts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("payload", sa.JSON()),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("generated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_blog_article_guides_state", "blog_article_guides", ["state"])


def downgrade() -> None:
    """只移除导读缓存，保留文章。"""
    op.drop_table("blog_article_guides")
