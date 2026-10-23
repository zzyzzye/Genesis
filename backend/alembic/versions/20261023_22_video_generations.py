"""保存可恢复的视频生成任务与素材关联。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261023_22"
down_revision: str | None = "20261022_21"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """新增视频任务表，保留创建标识避免未知结果自动重提。"""
    op.create_table(
        "media_video_generations",
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
        sa.Column("upstream_id", sa.String(200)),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(500), nullable=False),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("media_assets.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_media_video_generations_owner_id", "media_video_generations", ["owner_id"])
    op.create_index(
        "ix_media_video_generations_project_id", "media_video_generations", ["project_id"]
    )


def downgrade() -> None:
    """删除任务记录，不删除已经生成的作品素材。"""
    op.drop_table("media_video_generations")
