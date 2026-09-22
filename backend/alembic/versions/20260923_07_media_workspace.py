"""Persist media projects, assets and canvas documents."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_07"
down_revision: str | None = "20260922_06"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_projects",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("canvas", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_media_projects_owner_id", "media_projects", ["owner_id"])
    op.create_table(
        "media_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("in_library", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_media_assets_owner_id", "media_assets", ["owner_id"])
    op.create_table(
        "media_project_assets",
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("media_projects.id"), primary_key=True),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("media_assets.id"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("media_project_assets")
    op.drop_table("media_assets")
    op.drop_table("media_projects")
