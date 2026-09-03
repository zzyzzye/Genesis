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
    DRAFT = "draft"
    PUBLISHED = "published"


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
    __tablename__ = "blog_tags"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    posts: Mapped[list[BlogPost]] = relationship(
        secondary=blog_post_tags,
        back_populates="tags",
    )


class BlogPost(Base):
    __tablename__ = "blog_posts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
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
    status: Mapped[BlogPostStatus] = mapped_column(
        Enum(
            BlogPostStatus,
            native_enum=False,
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
    tags: Mapped[list[BlogTag]] = relationship(
        secondary=blog_post_tags,
        back_populates="posts",
    )
