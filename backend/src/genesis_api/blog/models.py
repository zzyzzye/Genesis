"""博客持久化模型；字段校验由 schemas 定义，写入规则由 service 维护。"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from genesis_api.database.base import Base
from genesis_api.identity.models import User


class BlogAttachment(Base):
    """附件目录为逻辑树，文件路径只使用 UUID，默认不对外公开。"""

    __tablename__ = "blog_attachments"
    __table_args__ = (
        Index("uq_blog_attachment_child", "owner_id", "parent_id", "name", unique=True),
        Index(
            "uq_blog_attachment_root",
            "owner_id",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NULL"),
            sqlite_where=text("parent_id IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    parent_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("blog_attachments.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(6))
    mime_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream")
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64))
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BlogPostStatus(StrEnum):
    """文章持久化状态；公开查询只返回 published，草稿由后台管理。"""

    DRAFT = "draft"
    PUBLISHED = "published"


class BlogOperation(Base):
    """记录导入和批量操作回执，网络重试沿用同一标识，不重复写入。"""

    __tablename__ = "blog_operations"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))
    digest: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class BlogPage(Base):
    """独立页面与文章分表，公开地址及草稿互不干扰。"""

    __tablename__ = "blog_pages"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    author_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    excerpt: Mapped[str] = mapped_column(String(500))
    content_markdown: Mapped[str] = mapped_column(Text)
    status: Mapped[BlogPostStatus] = mapped_column(
        Enum(BlogPostStatus, native_enum=False, values_callable=lambda e: [v.value for v in e]),
        index=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BlogCommentState(StrEnum):
    """评论先待审核，只有作者公开且文章已发布时才展示。"""

    PENDING = "pending"
    PUBLIC = "public"
    HIDDEN = "hidden"


class BlogComment(Base):
    """登录读者提交的纯文本评论，提交标识防止网络重试重复写入。"""

    __tablename__ = "blog_comments"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    submission_id: Mapped[UUID] = mapped_column(Uuid, unique=True)
    post_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("blog_posts.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    content: Mapped[str] = mapped_column(String(2000))
    qq_number: Mapped[str | None] = mapped_column(String(11), nullable=True)
    region: Mapped[str | None] = mapped_column(String(100), nullable=True)
    browser: Mapped[str | None] = mapped_column(String(100), nullable=True)
    operating_system: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[BlogCommentState] = mapped_column(
        Enum(BlogCommentState, native_enum=False, values_callable=lambda e: [v.value for v in e]),
        default=BlogCommentState.PENDING,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    author: Mapped[User] = relationship()
    post: Mapped[BlogPost] = relationship()


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


class BlogLink(Base):
    """由站点作者维护的链接；默认隐藏，显式启用后才对外展示。"""

    __tablename__ = "blog_links"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(80))
    url: Mapped[str] = mapped_column(String(2048))
    description: Mapped[str] = mapped_column(String(240), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class BlogTag(Base):
    """多篇文章共用的标签，以唯一 slug 区分身份，名称可修改。

    名称与 slug 分别有数据库唯一约束；posts 通过关联表维护多对多关系。
    删除标签只清理关联记录，不删除文章；后台另行限制删除使用中的标签。
    """

    __tablename__ = "blog_tags"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    posts: Mapped[list[BlogPost]] = relationship(
        secondary=blog_post_tags,
        back_populates="tags",
    )


blog_post_categories = Table(
    "blog_post_categories",
    Base.metadata,
    Column("post_id", Uuid, ForeignKey("blog_posts.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "category_id", Uuid, ForeignKey("blog_categories.id", ondelete="CASCADE"), primary_key=True
    ),
)


class BlogCategory(Base):
    """文章的共享分类，通过多对多关系关联文章。

    一篇文章可关联多个分类；名称与 slug 均有数据库唯一约束。
    外键描述数据库行为，后台接口仍单独检查分类是否正在被文章使用。
    """

    __tablename__ = "blog_categories"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    posts: Mapped[list[BlogPost]] = relationship(
        secondary=blog_post_categories, back_populates="categories"
    )


class BlogPost(Base):
    """文章记录：单一作者、可选分类和多个共享标签。

    slug 是公开地址的唯一标识，id 是内部关联与后台操作使用的 UUID。
    published_at 表示公开发布时间，updated_at 用于排序与后台版本比对；
    发布时间维护及应用级更新时间规则由 service.py 负责。
    ORM 字段约束不替代发布内容校验，完整输入契约见 schemas.py。
    """

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
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    author: Mapped[User] = relationship(back_populates="blog_posts")
    category: Mapped[BlogCategory | None] = relationship()
    categories: Mapped[list[BlogCategory]] = relationship(
        secondary=blog_post_categories,
        back_populates="posts",
        lazy="selectin",
        order_by="BlogCategory.name",
    )
    tags: Mapped[list[BlogTag]] = relationship(
        secondary=blog_post_tags,
        back_populates="posts",
    )
    guide: Mapped[BlogArticleGuide | None] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class BlogArticleGuide(Base):
    """每篇文章只保留当前内容的导读，生成状态与文章在同一事务中更新。"""

    __tablename__ = "blog_article_guides"

    post_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("blog_posts.id", ondelete="CASCADE"), primary_key=True
    )
    revision: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(12), default="pending", index=True)
    payload: Mapped[dict[str, object] | None] = mapped_column(JSON)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
