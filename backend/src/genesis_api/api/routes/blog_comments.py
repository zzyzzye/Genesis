"""登录读者提交评论，站点作者审核；公开查询严格过滤草稿和非公开评论。"""

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import AwareDatetime
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from genesis_api.api.dependencies import CurrentUserDependency, OwnerDependency, SessionDependency
from genesis_api.blog.comments import (
    CommentAdmin,
    CommentAdminPage,
    CommentModerate,
    CommentPage,
    CommentReceipt,
    CommentWrite,
    admin_comment,
    list_comments,
    public_comment,
    utc,
)
from genesis_api.blog.models import BlogComment, BlogCommentState, BlogPost, BlogPostStatus
from genesis_api.identity.models import User

public_router = APIRouter(prefix="/blog", tags=["博客评论"])
admin_router = APIRouter(prefix="/admin/blog/comments", tags=["博客管理"])


@public_router.get("/posts/{slug}/comments", response_model=CommentPage)
def get_comments(
    slug: str,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CommentPage:
    """只返回已发布文章的公开评论，隐藏项不进入计数。"""
    if (
        session.scalar(
            select(BlogPost.id).where(
                BlogPost.slug == slug, BlogPost.status == BlogPostStatus.PUBLISHED
            )
        )
        is None
    ):
        raise HTTPException(404, "文章不存在或尚未发布")
    items, total = list_comments(session, slug=slug, limit=limit, offset=offset)
    return CommentPage(items=[public_comment(item) for item in items], total=total)


@public_router.post("/posts/{slug}/comments", response_model=CommentReceipt, status_code=201)
def submit_comment(
    slug: str, data: CommentWrite, session: SessionDependency, user: CurrentUserDependency
) -> CommentReceipt:
    """登录后提交待审核评论；同一提交标识重试不重复写入，每分钟最多五条。"""
    # 锁定读者行，串行检查该读者的提交标识及频率，避免并发绕过限制。
    session.scalar(select(User).where(User.id == user.id).with_for_update())
    post = session.scalar(
        select(BlogPost)
        .where(BlogPost.slug == slug, BlogPost.status == BlogPostStatus.PUBLISHED)
        .with_for_update()
    )
    if post is None:
        raise HTTPException(404, "文章不存在或尚未发布")
    previous = session.scalar(
        select(BlogComment).where(BlogComment.submission_id == data.submission_id)
    )
    if previous is not None:
        if (previous.author_id, previous.post_id, previous.content) != (
            user.id,
            post.id,
            data.content,
        ):
            raise HTTPException(409, "提交标识已使用，请重新提交")
        return CommentReceipt(id=previous.id, state=previous.state)
    now = datetime.now(UTC)
    recent = (
        session.scalar(
            select(func.count())
            .select_from(BlogComment)
            .where(
                BlogComment.author_id == user.id,
                BlogComment.created_at > now - timedelta(minutes=1),
            )
        )
        or 0
    )
    if recent >= 5:
        raise HTTPException(429, "提交过于频繁，请一分钟后重试", headers={"Retry-After": "60"})
    item = BlogComment(
        submission_id=data.submission_id,
        author_id=user.id,
        post_id=post.id,
        content=data.content,
        state=BlogCommentState.PENDING,
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "提交标识已使用，请重新提交") from exc
    return CommentReceipt(id=item.id, state=item.state)


@admin_router.get("", response_model=CommentAdminPage)
def get_admin_comments(
    session: SessionDependency,
    _: OwnerDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    state: BlogCommentState | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
) -> CommentAdminPage:
    """分页查询评论，不通过公开响应泄露待审核内容。"""
    items, total = list_comments(session, limit=limit, offset=offset, state=state, query=q)
    return CommentAdminPage(items=[admin_comment(item) for item in items], total=total)


def locked_comment(session: SessionDependency, item_id: UUID, expected: datetime) -> BlogComment:
    """行锁配合版本检查，阻止过期页面覆盖审核结果或删除新版本。"""
    item = session.scalar(select(BlogComment).where(BlogComment.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(404, "评论不存在")
    if utc(item.updated_at) != expected.astimezone(UTC):
        raise HTTPException(409, "评论状态已更新，请关闭确认并刷新列表后重试")
    return item


@admin_router.put("/{item_id}", response_model=CommentAdmin)
def moderate_comment(
    item_id: UUID, data: CommentModerate, session: SessionDependency, _: OwnerDependency
) -> CommentAdmin:
    """作者明确确认后修改审核状态，正文保持不变。"""
    item = locked_comment(session, item_id, data.expected_updated_at)
    item.state = data.state
    item.updated_at = datetime.now(UTC)
    session.commit()
    session.refresh(item)
    return admin_comment(item)


@admin_router.delete("/{item_id}", status_code=204)
def delete_comment(
    item_id: UUID,
    expected_updated_at: AwareDatetime,
    session: SessionDependency,
    _: OwnerDependency,
) -> Response:
    """作者确认后永久删除评论，不删除文章或账户。"""
    item = locked_comment(session, item_id, expected_updated_at)
    session.delete(item)
    session.commit()
    return Response(status_code=204)
