"""为作品增加独立保存的封面图片引用。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261116_32"
down_revision: str | None = "20261103_31"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """添加可空封面引用，删除图片时安全恢复自动选图。"""
    op.add_column("media_projects", sa.Column("cover_asset_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_media_projects_cover_asset",
        "media_projects",
        "media_assets",
        ["cover_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """移除封面设置，保留作品和所有素材。"""
    op.drop_constraint("fk_media_projects_cover_asset", "media_projects", type_="foreignkey")
    op.drop_column("media_projects", "cover_asset_id")
