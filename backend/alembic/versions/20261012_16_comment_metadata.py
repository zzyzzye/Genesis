"""为评论增加可选 QQ 头像和粗粒度来源信息，不保存原始 IP 与 UA。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261012_16"
down_revision: str | None = "20261012_15"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """旧评论保持空来源信息，不推断历史设备和地区。"""
    fields = (("qq_number", 11), ("region", 100), ("browser", 100), ("operating_system", 100))
    for name, length in fields:
        op.add_column("blog_comments", sa.Column(name, sa.String(length), nullable=True))


def downgrade() -> None:
    """移除来源信息，保留评论正文和审核状态。"""
    for name in ("operating_system", "browser", "region", "qq_number"):
        op.drop_column("blog_comments", name)
