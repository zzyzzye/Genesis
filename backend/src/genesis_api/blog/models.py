"""博客持久化模型；字段校验由 schemas 定义，写入规则由 service 维护。"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from genesis_api.database.base import Base
from genesis_api.identity.models import User


class BlogPostStatus(StrEnum):
    """文章持久化状态；公开查询只返回 published，草稿由后台管理。"""

    DRAFT = "draft"
    PUBLISHED = "published"


# 联合主键避免同一文章重复关联标签；删除任一端只级联清理关联记录。
blog_post_tags = Table(
    "blog_post_tags",
    Base.metadata,
    Column(
        "post_id",
        Uuid,
        ForeignKey("blog_posts.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        Uuid,
        ForeignKey("blog_tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class BlogTag(Base):
    """多篇文章共用的标签，以唯一 slug 区分身份，名称可修改。"""

    __tablename__ = "blog_tags"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    posts: Mapped[list[BlogPost]] = relationship(
        secondary=blog_post_tags,
        back_populates="tags",
    )


class BlogCategory(Base):
    """文章的可选分类；删除分类时文章保留，category_id 置空。"""

    __tablename__ = "blog_categories"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    posts: Mapped[list[BlogPost]] = relationship(back_populates="category")


class BlogPost(Base):
    """文章记录：单一作者、可选分类和多个共享标签。"""

    __tablename__ = "blog_posts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    # RESTRICT 阻止删除仍有关联文章的作者，避免文章失去归属。
    author_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    excerpt: Mapped[str] = mapped_column(String(500))
    content_markdown: Mapped[str] = mapped_column(Text)
    cover_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("blog_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[BlogPostStatus] = mapped_column(
        Enum(
            BlogPostStatus,
            native_enum=False,
            # 数据库存储 draft/published 值，与 API 一致，不存 Python 枚举成员名。
            values_callable=lambda enum: [member.value for member in enum],
        ),
        default=BlogPostStatus.DRAFT,
        index=True,
    )
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    read_time_minutes: Mapped[int] = mapped_column(Integer, default=1)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    author: Mapped[User] = relationship(back_populates="blog_posts")
    category: Mapped[BlogCategory | None] = relationship(back_populates="posts")
    tags: Mapped[list[BlogTag]] = relationship(
        secondary=blog_post_tags,
        back_populates="posts",
    )
