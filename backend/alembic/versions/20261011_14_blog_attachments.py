"""新增私有附件与逻辑文件夹，共用现有持久化存储卷。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_14"
down_revision: str | None = "20261011_13"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    """创建附件树及同层名称约束，根目录另设部分唯一索引。"""
    op.create_table(
        "blog_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "parent_id", sa.Uuid(), sa.ForeignKey("blog_attachments.id", ondelete="RESTRICT")
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(6), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64)),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_blog_attachments_parent_id", "blog_attachments", ["parent_id"])
    op.create_index(
        "uq_blog_attachment_child",
        "blog_attachments",
        ["owner_id", "parent_id", "name"],
        unique=True,
    )
    op.create_index(
        "uq_blog_attachment_root",
        "blog_attachments",
        ["owner_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
        sqlite_where=sa.text("parent_id IS NULL"),
    )


def downgrade() -> None:
    """删除附件元数据；持久化文件由部署管理员另行处理。"""
    op.drop_table("blog_attachments")
