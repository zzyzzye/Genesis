"""所有者读取文章历史，分页摘要与单版本内容分开，避免一次加载全部正文。"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import load_only

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogPostRevision
from genesis_api.blog.service import get_blog_post_by_id

router = APIRouter(prefix="/admin/blog/posts", tags=["文章历史"])


class RevisionSummary(BaseModel):
    """版本列表只提供标题和保存时间。"""

    id: UUID
    title: str
    version: datetime


class RevisionPage(BaseModel):
    """稳定分页的历史摘要。"""

    items: list[RevisionSummary]
    total: int


class RevisionDetail(RevisionSummary):
    """历史内容不携带旧的发布计划与并发版本，避免恢复时意外发布。"""

    payload: dict[str, object]


@router.get("/{post_id}/revisions", response_model=RevisionPage)
def revisions(
    post_id: UUID,
    session: SessionDependency,
    _: OwnerDependency,
    response: Response,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RevisionPage:
    """只允许所有者读取未删除文章的历史。"""
    response.headers["Cache-Control"] = "no-store"
    if get_blog_post_by_id(session, post_id) is None:
        raise HTTPException(404, "文章不存在")
    query = select(BlogPostRevision).where(BlogPostRevision.post_id == post_id)
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = session.scalars(
        query.order_by(BlogPostRevision.version.desc(), BlogPostRevision.id)
        .options(load_only(BlogPostRevision.id, BlogPostRevision.title, BlogPostRevision.version))
        .offset(offset)
        .limit(20)
    )
    return RevisionPage(
        items=[
            RevisionSummary(id=item.id, title=item.title, version=utc(item.version))
            for item in items
        ],
        total=total,
    )


@router.get("/{post_id}/revisions/{revision_id}", response_model=RevisionDetail)
def revision(
    post_id: UUID,
    revision_id: UUID,
    session: SessionDependency,
    _: OwnerDependency,
    response: Response,
) -> RevisionDetail:
    """读取绑定于当前文章的快照，不能跨文章获取内容。"""
    response.headers["Cache-Control"] = "no-store"
    item = session.get(BlogPostRevision, revision_id)
    if get_blog_post_by_id(session, post_id) is None or item is None or item.post_id != post_id:
        raise HTTPException(404, "历史版本不存在")
    return RevisionDetail(
        id=item.id, title=item.title, version=utc(item.version), payload=item.payload
    )
