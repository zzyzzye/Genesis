"""评论的数据契约与查询，身份及事务由路由编排。"""

from datetime import UTC, datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from genesis_api.blog.models import BlogComment, BlogCommentState, BlogPost, BlogPostStatus
from genesis_api.identity.models import User


def utc(value: datetime) -> datetime:
    """SQLite 不保留时区，统一恢复为 UTC 后比较版本与序列化。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class CommentWrite(BaseModel):
    """纯文本内容与客户端提交标识，不接受客户端指定身份或审核状态。"""

    model_config = {"extra": "forbid"}
    content: str = Field(min_length=1, max_length=2000)
    submission_id: UUID

    @field_validator("content", mode="before")
    @classmethod
    def trim(cls, value: object) -> object:
        """去除首尾空白，再验证非空和长度。"""
        return value.strip() if isinstance(value, str) else value


class CommentPublic(BaseModel):
    """公开字段不含用户标识、账号、联系方式或审核元数据。"""

    id: UUID
    content: str
    author_name: str
    created_at: datetime


class CommentAdmin(CommentPublic):
    """作者审核时补充所属文章、状态与并发版本。"""

    post_title: str
    post_slug: str
    post_status: BlogPostStatus
    state: BlogCommentState
    updated_at: datetime


class CommentPage(BaseModel):
    """公开评论分页，数量只包含可见项。"""

    items: list[CommentPublic]
    total: int


class CommentAdminPage(BaseModel):
    """审核列表分页，数量为筛选后的总数。"""

    items: list[CommentAdmin]
    total: int


class CommentModerate(BaseModel):
    """审核只修改可见状态，不能改写读者正文或身份。"""

    state: BlogCommentState
    expected_updated_at: AwareDatetime


class CommentReceipt(BaseModel):
    """提交回执不回显评论正文或用户资料。"""

    id: UUID
    state: BlogCommentState


def public_comment(item: BlogComment) -> CommentPublic:
    """只投影展示必需的数据。"""
    return CommentPublic(
        id=item.id,
        content=item.content,
        author_name=item.author.display_name,
        created_at=utc(item.created_at),
    )


def admin_comment(item: BlogComment) -> CommentAdmin:
    """复用公开投影并补充管理信息。"""
    return CommentAdmin(
        **public_comment(item).model_dump(),
        post_title=item.post.title,
        post_slug=item.post.slug,
        post_status=item.post.status,
        state=item.state,
        updated_at=utc(item.updated_at),
    )


def list_comments(
    session: Session,
    *,
    limit: int,
    offset: int,
    slug: str | None = None,
    state: BlogCommentState | None = None,
    query: str = "",
) -> tuple[list[BlogComment], int]:
    """公开查询强制文章与评论均公开；后台按状态和字面量搜索稳定分页。"""
    stmt = select(BlogComment).join(BlogComment.post).join(BlogComment.author)
    if slug is not None:
        stmt = stmt.where(
            BlogPost.slug == slug,
            BlogPost.status == BlogPostStatus.PUBLISHED,
            BlogComment.state == BlogCommentState.PUBLIC,
        )
    elif state is not None:
        stmt = stmt.where(BlogComment.state == state)
    if query.strip():
        term = query.strip()
        stmt = stmt.where(
            BlogComment.content.icontains(term, autoescape=True)
            | BlogPost.title.icontains(term, autoescape=True)
            | User.display_name.icontains(term, autoescape=True)
        )
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = BlogComment.created_at.asc() if slug is not None else BlogComment.created_at.desc()
    items = session.scalars(
        stmt.options(selectinload(BlogComment.author), selectinload(BlogComment.post))
        .order_by(order, BlogComment.id)
        .offset(offset)
        .limit(limit)
    ).all()
    return list(items), total
