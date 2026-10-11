"""独立页面的公开读取与作者管理，发布和撤回使用同一版本校验。"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import AwareDatetime
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogPage, BlogPostStatus
from genesis_api.blog.pages import (
    PageAdmin,
    PageAdminList,
    PageCreate,
    PageList,
    PagePreview,
    PagePublic,
    PageUpdate,
    PageWrite,
    read_page,
)
from genesis_api.identity.models import User

public_router = APIRouter(prefix="/blog/pages", tags=["博客页面"])
admin_router = APIRouter(prefix="/admin/blog/pages", tags=["博客管理"])


@public_router.get("", response_model=PageList)
def public_pages(
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PageList:
    """只列出已发布页面，按标题和 ID 稳定分页。"""
    stmt = select(BlogPage).where(BlogPage.status == BlogPostStatus.PUBLISHED)
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = session.scalars(stmt.order_by(BlogPage.title, BlogPage.id).offset(offset).limit(limit))
    return PageList(
        items=[PagePreview(**read_page(item).model_dump()) for item in items], total=total
    )


@public_router.get("/{slug}", response_model=PagePublic)
def public_page(slug: str, session: SessionDependency) -> PagePublic:
    """不存在与草稿统一返回 404，不泄露隐藏记录。"""
    item = session.scalar(
        select(BlogPage).where(BlogPage.slug == slug, BlogPage.status == BlogPostStatus.PUBLISHED)
    )
    if item is None:
        raise HTTPException(404, "页面不存在或尚未发布")
    return PagePublic(**read_page(item).model_dump())


@admin_router.get("", response_model=PageAdminList)
def admin_pages(
    session: SessionDependency,
    _: OwnerDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str, Query(max_length=200)] = "",
    status: BlogPostStatus | None = None,
) -> PageAdminList:
    """作者按标题、摘要和地址搜索页面，正文不参与列表搜索。"""
    stmt = select(BlogPage)
    if status is not None:
        stmt = stmt.where(BlogPage.status == status)
    if q.strip():
        term = q.strip()
        stmt = stmt.where(
            BlogPage.title.icontains(term, autoescape=True)
            | BlogPage.excerpt.icontains(term, autoescape=True)
            | BlogPage.slug.icontains(term, autoescape=True)
        )
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = session.scalars(
        stmt.order_by(BlogPage.updated_at.desc(), BlogPage.id).offset(offset).limit(limit)
    )
    return PageAdminList(items=[read_page(item) for item in items], total=total)


def find_page(
    session: SessionDependency, item_id: UUID, expected: datetime | None = None
) -> BlogPage:
    """写入时加行锁并核对版本；不存在和冲突使用明确的业务响应。"""
    stmt = select(BlogPage).where(BlogPage.id == item_id)
    if expected is not None:
        stmt = stmt.with_for_update()
    item = session.scalar(stmt)
    if item is None:
        raise HTTPException(404, "页面不存在")
    if expected is not None and utc(item.updated_at) != expected.astimezone(UTC):
        raise HTTPException(409, "页面已更新，当前输入已保留，请核对站点版本后重试")
    return item


def apply_page(item: BlogPage, data: PageWrite) -> None:
    """只写入可编辑字段，首次发布记时间，撤回清除公开时间。"""
    now = datetime.now(UTC)
    for field in ("slug", "title", "excerpt", "content_markdown", "status"):
        setattr(item, field, getattr(data, field))
    item.published_at = (
        (item.published_at or now) if data.status == BlogPostStatus.PUBLISHED else None
    )
    item.updated_at = now


def commit_page(session: SessionDependency) -> None:
    """统一处理地址唯一性冲突，保留客户端输入供修改重试。"""
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "页面地址或创建标识已使用，请修改地址或重新打开已有页面") from None


@admin_router.get("/{item_id}", response_model=PageAdmin)
def admin_page(item_id: UUID, session: SessionDependency, _: OwnerDependency) -> PageAdmin:
    """读取管理详情，允许作者查看草稿。"""
    return read_page(find_page(session, item_id))


@admin_router.post("", response_model=PageAdmin, status_code=201)
def create_page(data: PageCreate, session: SessionDependency, owner: OwnerDependency) -> PageAdmin:
    """同一作者串行创建；同一 UUID 与原始内容重试返回已有记录。"""
    session.scalar(select(User).where(User.id == owner.id).with_for_update())
    item = session.get(BlogPage, data.id)
    if item is not None:
        if item.author_id != owner.id or any(
            getattr(item, field) != getattr(data, field) for field in PageWrite.model_fields
        ):
            raise HTTPException(409, "此页面已创建且内容发生变化，请从页面列表重新打开核对")
        return read_page(item)
    item = BlogPage(id=data.id, author_id=owner.id, created_at=datetime.now(UTC))
    apply_page(item, data)
    session.add(item)
    commit_page(session)
    return read_page(item)


@admin_router.put("/{item_id}", response_model=PageAdmin)
def update_page(
    item_id: UUID, data: PageUpdate, session: SessionDependency, _: OwnerDependency
) -> PageAdmin:
    """完整更新页面，包括发布和撤回，必须匹配读取版本。"""
    item = find_page(session, item_id, data.expected_updated_at)
    apply_page(item, data)
    commit_page(session)
    return read_page(item)


@admin_router.delete("/{item_id}", status_code=204)
def delete_page(
    item_id: UUID,
    expected_updated_at: AwareDatetime,
    session: SessionDependency,
    _: OwnerDependency,
) -> Response:
    """确认后永久删除对应版本，不影响文章或其他页面。"""
    item = find_page(session, item_id, expected_updated_at)
    session.delete(item)
    session.commit()
    return Response(status_code=204)
