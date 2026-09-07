"""add blog categories

Revision ID: 20260907_03
Revises: 20260903_02
Create Date: 2026-09-07 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_03"
down_revision: str | None = "20260903_02"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "blog_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_blog_categories_slug"), "blog_categories", ["slug"], unique=True)
    op.add_column("blog_posts", sa.Column("category_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_blog_posts_category_id"), "blog_posts", ["category_id"], unique=False)
    op.create_foreign_key(
        "fk_blog_posts_category_id_blog_categories",
        "blog_posts",
        "blog_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_blog_posts_category_id_blog_categories", "blog_posts", type_="foreignkey"
    )
    op.drop_index(op.f("ix_blog_posts_category_id"), table_name="blog_posts")
    op.drop_column("blog_posts", "category_id")
    op.drop_index(op.f("ix_blog_categories_slug"), table_name="blog_categories")
    op.drop_table("blog_categories")
