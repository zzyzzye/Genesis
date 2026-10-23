"""保存图片生成请求与多图结果关联。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261023_23"
down_revision: str | None = "20261023_22"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """新增图片任务表，支持页面恢复和失败后单独保存图片。"""
    op.create_table(
        "media_image_generations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("media_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("reference_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("error", sa.String(500), nullable=False),
        sa.Column("asset_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    for column in ("owner_id", "project_id"):
        op.create_index(f"ix_media_image_generations_{column}", "media_image_generations", [column])


def downgrade() -> None:
    """删除任务记录，保留已生成素材。"""
    op.drop_table("media_image_generations")
