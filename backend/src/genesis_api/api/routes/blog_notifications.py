"""当前账户的评论回复收件箱，隐藏或撤回内容立即从收件箱过滤。"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import selectinload

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.blog.comments import CommentPublic, public_comment, utc
from genesis_api.blog.models import (
    BlogComment,
    BlogCommentState,
    BlogNotification,
    BlogPost,
    BlogPostStatus,
)

router = APIRouter(prefix="/blog/notifications", tags=["评论通知"])


class NotificationRead(BaseModel):
    """每条通知只包含仍公开的回复及文章入口。"""

    id: UUID
    post_title: str
    post_slug: str
    comment: CommentPublic
    created_at: datetime
    read_at: datetime | None


class NotificationPage(BaseModel):
    """收件箱分页与有效未读数量。"""

    items: list[NotificationRead]
    total: int
    unread: int


def visible_notifications(user_id: UUID) -> Select[tuple[BlogNotification]]:
    """所有读取共用授权与公开范围，避免待审核内容通过通知泄露。"""
    return (
        select(BlogNotification)
        .join(BlogNotification.comment)
        .join(BlogComment.post)
        .where(
            BlogNotification.recipient_id == user_id,
            BlogComment.state == BlogCommentState.PUBLIC,
            BlogComment.parent.has(BlogComment.state == BlogCommentState.PUBLIC),
            BlogPost.status == BlogPostStatus.PUBLISHED,
            BlogPost.deleted_at.is_(None),
        )
    )


@router.get("", response_model=NotificationPage)
def notifications(
    session: SessionDependency,
    user: CurrentUserDependency,
    response: Response,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> NotificationPage:
    """每次读取二十条，按发布时间倒序排列。"""
    response.headers["Cache-Control"] = "no-store"
    query = visible_notifications(user.id)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    unread = (
        session.scalar(
            select(func.count()).select_from(
                query.where(BlogNotification.read_at.is_(None)).subquery()
            )
        )
        or 0
    )
    items = session.scalars(
        query.options(
            selectinload(BlogNotification.comment).selectinload(BlogComment.author),
            selectinload(BlogNotification.comment).selectinload(BlogComment.post),
            selectinload(BlogNotification.comment)
            .selectinload(BlogComment.parent)
            .selectinload(BlogComment.author),
        )
        .order_by(BlogNotification.created_at.desc(), BlogNotification.id)
        .offset(offset)
        .limit(20)
    )
    return NotificationPage(
        total=total,
        unread=unread,
        items=[
            NotificationRead(
                id=item.id,
                post_title=item.comment.post.title,
                post_slug=item.comment.post.slug,
                comment=public_comment(item.comment),
                created_at=utc(item.created_at),
                read_at=utc(item.read_at) if item.read_at else None,
            )
            for item in items
        ],
    )


@router.put("/{item_id}/read", status_code=204)
def read_notification(
    item_id: UUID, session: SessionDependency, user: CurrentUserDependency
) -> Response:
    """幂等标记自己的通知，未知或别人的 ID 均返回 404。"""
    item = session.scalar(visible_notifications(user.id).where(BlogNotification.id == item_id))
    if item is None:
        raise HTTPException(404, "通知不存在")
    if item.read_at is None:
        item.read_at = datetime.now(UTC)
        session.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
