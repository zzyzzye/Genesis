"""所有者专用博客管理接口，编排事务、唯一性错误与编辑版本检查。

各路由通过 OwnerDependency 校验权限；service.py 负责文章字段与关联写入。
"""

from datetime import UTC
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog.models import BlogCategory, BlogPost, BlogTag
from genesis_api.blog.schemas import (
    BlogCategoryRead,
    BlogCategoryWrite,
    BlogPostAdminRead,
    BlogPostWrite,
    BlogTagRead,
    BlogTagWrite,
)
from genesis_api.blog.service import (
    apply_post_data,
    get_blog_post_by_id,
    list_admin_categories,
    list_admin_posts,
    list_admin_tags,
)

router = APIRouter(prefix="/admin/blog", tags=["博客管理"])


def save_taxonomy(session: Session, item: BlogTag | BlogCategory, name: str, slug: str) -> None:
    """更新分类或标签的名称与标识，保留实体 ID 及文章关联。

    Args:
        session: 当前事务会话，此处提交并刷新实体。
        item: 已查询到的分类或标签。
        name: 规范化前的展示名称，去除首尾空白后保存。
        slug: 已通过请求契约校验的稳定标识。

    Raises:
        HTTPException: 数据库唯一性冲突时回滚并返回 409。
    """
    item.name = name.strip()
    item.slug = slug
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="名称或标识已存在，请使用其他名称或标识"
        ) from None
    session.refresh(item)


def delete_taxonomy(session: Session, item: BlogTag | BlogCategory) -> Response:
    """删除未被文章使用的分类或标签，提交成功后返回空响应。

    Args:
        session: 当前事务会话，调用方已锁定目标记录。
        item: 待删除实体，关联文章会重新加载以检查当前引用。

    Returns:
        204 无内容响应。

    Raises:
        HTTPException: 仍有文章使用该项时返回 409。
    """
    # 使用中的分类、标签不能删除，避免悄悄改变已有文章。
    session.expire(item, ["posts"])
    if item.posts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="仍有文章使用此项，请先在文章设置中移除关联后再删除",
        )
    session.delete(item)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def post_not_found() -> HTTPException:
    """构造文章不存在的 404 异常，由调用方显式抛出。"""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文章不存在")


def duplicate_slug_error() -> HTTPException:
    """构造文章唯一性冲突的 409 异常，由调用方显式抛出。"""
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="文章 slug 已被使用")


@router.get("/tags", response_model=list[BlogTagRead])
def get_admin_tags(session: SessionDependency, _: OwnerDependency) -> list[BlogTagRead]:
    """返回所有者可管理的全部共享标签，包含未使用的标签。"""
    return [BlogTagRead.model_validate(tag) for tag in list_admin_tags(session)]


@router.post("/tags", response_model=BlogTagRead, status_code=status.HTTP_201_CREATED)
def create_admin_tag(
    data: BlogTagWrite,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogTagRead:
    """创建共享标签，要求所有者权限。

    Args:
        data: 已校验的标签名称与 slug。
        session: 当前请求会话，此处提交创建结果。
        _: 所有者权限依赖。

    Returns:
        新标签的展示数据。

    Raises:
        HTTPException: 标签名称或 slug 冲突，回滚并返回 409。
    """
    tag = BlogTag(name=data.name.strip(), slug=data.slug)
    session.add(tag)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="标签名称或 slug 已存在"
        ) from None
    session.refresh(tag)
    return BlogTagRead.model_validate(tag)


@router.get("/categories", response_model=list[BlogCategoryRead])
def get_admin_categories(session: SessionDependency, _: OwnerDependency) -> list[BlogCategoryRead]:
    """返回所有者可管理的全部分类，供后台选择与管理。"""
    return [
        BlogCategoryRead.model_validate(category) for category in list_admin_categories(session)
    ]


@router.post("/categories", response_model=BlogCategoryRead, status_code=status.HTTP_201_CREATED)
def create_admin_category(
    data: BlogCategoryWrite,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogCategoryRead:
    """创建博客分类，要求所有者权限。

    Args:
        data: 已校验的分类名称与 slug。
        session: 当前请求会话，此处提交创建结果。
        _: 所有者权限依赖。

    Returns:
        新分类的展示数据。

    Raises:
        HTTPException: 分类名称或 slug 冲突，回滚并返回 409。
    """
    category = BlogCategory(name=data.name.strip(), slug=data.slug)
    session.add(category)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="分类名称或 slug 已存在"
        ) from None
    session.refresh(category)
    return BlogCategoryRead.model_validate(category)


@router.put("/tags/{item_id}", response_model=BlogTagRead)
def update_admin_tag(
    item_id: UUID, data: BlogTagWrite, session: SessionDependency, _: OwnerDependency
) -> BlogTagRead:
    """更新共享标签，保留原 ID 与关联文章。

    Args:
        item_id: 标签 UUID。
        data: 新名称与 slug。
        session: 当前请求会话。
        _: 所有者权限依赖。

    Returns:
        更新后的标签数据。

    Raises:
        HTTPException: 标签不存在返回 404，唯一性冲突返回 409。
    """
    item = session.get(BlogTag, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    save_taxonomy(session, item, data.name, data.slug)
    return BlogTagRead.model_validate(item)


@router.delete("/tags/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_tag(item_id: UUID, session: SessionDependency, _: OwnerDependency) -> Response:
    """锁定并删除未使用的标签；不存在返回 404，仍被引用返回 409。"""
    item = session.scalar(select(BlogTag).where(BlogTag.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    return delete_taxonomy(session, item)


@router.put("/categories/{item_id}", response_model=BlogCategoryRead)
def update_admin_category(
    item_id: UUID, data: BlogCategoryWrite, session: SessionDependency, _: OwnerDependency
) -> BlogCategoryRead:
    """更新分类，保留原 ID 与关联文章。

    Args:
        item_id: 分类 UUID。
        data: 新名称与 slug。
        session: 当前请求会话。
        _: 所有者权限依赖。

    Returns:
        更新后的分类数据。

    Raises:
        HTTPException: 分类不存在返回 404，唯一性冲突返回 409。
    """
    item = session.get(BlogCategory, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    save_taxonomy(session, item, data.name, data.slug)
    return BlogCategoryRead.model_validate(item)


@router.delete("/categories/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_category(
    item_id: UUID, session: SessionDependency, _: OwnerDependency
) -> Response:
    """锁定并删除未使用的分类；不存在返回 404，仍被引用返回 409。"""
    item = session.scalar(select(BlogCategory).where(BlogCategory.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    return delete_taxonomy(session, item)


@router.get("/posts", response_model=list[BlogPostAdminRead])
def get_admin_posts(session: SessionDependency, _: OwnerDependency) -> list[BlogPostAdminRead]:
    """返回包含草稿的完整后台文章列表，按更新时间倒序，不在此分页。"""
    return [BlogPostAdminRead.model_validate(post) for post in list_admin_posts(session)]


@router.get("/posts/{post_id}", response_model=BlogPostAdminRead)
def get_admin_post(
    post_id: UUID,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogPostAdminRead:
    """读取任意状态的后台文章，要求所有者权限。

    Args:
        post_id: 文章内部 UUID。
        session: 当前请求会话。
        _: 所有者权限依赖。

    Returns:
        含正文与更新时间的文章数据。

    Raises:
        HTTPException: 文章不存在时返回 404。
    """
    post = get_blog_post_by_id(session, post_id)
    if post is None:
        raise post_not_found()
    return BlogPostAdminRead.model_validate(post)


@router.post("/posts", response_model=BlogPostAdminRead, status_code=status.HTTP_201_CREATED)
def create_admin_post(
    data: BlogPostWrite,
    session: SessionDependency,
    owner: OwnerDependency,
) -> BlogPostAdminRead:
    """创建当前所有者的文章，按完整写入契约处理字段与关联。

    Args:
        data: 已校验的完整文章数据，发布状态已通过必要文本校验。
        session: 当前请求会话，此处提交；已捕获的业务或唯一性错误会回滚。
        owner: 权限依赖认证的站点所有者，作为文章作者。

    Returns:
        新文章的后台详情。

    Raises:
        HTTPException: 分类等业务参数无效返回 400，唯一性冲突返回 409。
    """
    post = BlogPost(author=owner)
    session.add(post)
    try:
        with session.no_autoflush:
            apply_post_data(session, post, data)
        session.commit()
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from None
    except IntegrityError:
        session.rollback()
        raise duplicate_slug_error() from None
    return BlogPostAdminRead.model_validate(post)


@router.put("/posts/{post_id}", response_model=BlogPostAdminRead)
def update_admin_post(
    post_id: UUID,
    data: BlogPostWrite,
    session: SessionDependency,
    _: OwnerDependency,
) -> BlogPostAdminRead:
    """锁定文章并完整更新，可携带客户端版本防止覆盖新编辑。

    Args:
        post_id: 目标文章 UUID。
        data: 完整文章数据；expected_updated_at 为空时不执行版本比较。
        session: 当前事务会话，行锁覆盖版本检查与提交。
        _: 所有者权限依赖。

    Returns:
        更新后的后台文章详情，包含新的更新时间。

    Raises:
        HTTPException: 文章不存在返回 404，版本或唯一性冲突返回 409，
            分类等业务参数无效返回 400。
    """
    post = get_blog_post_by_id(session, post_id, for_update=True)
    if post is None:
        raise post_not_found()

    if data.expected_updated_at is not None:
        # 文章行已锁定；统一时区后比较客户端读取版本，避免覆盖其他页面的新编辑。
        current_version = post.updated_at
        expected_version = data.expected_updated_at
        if current_version.tzinfo is None:
            current_version = current_version.replace(tzinfo=UTC)
        if expected_version.tzinfo is None:
            expected_version = expected_version.replace(tzinfo=UTC)
        if current_version != expected_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="文章已在其他页面或助手中更新。当前输入已保留，请重新打开文章核对后再保存。",
            )

    try:
        with session.no_autoflush:
            # 完整应用文章和标签后再提交，避免处理中间状态触发提前写入。
            apply_post_data(session, post, data)
        session.commit()
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from None
    except IntegrityError:
        session.rollback()
        raise duplicate_slug_error() from None
    return BlogPostAdminRead.model_validate(post)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_post(
    post_id: UUID,
    session: SessionDependency,
    _: OwnerDependency,
) -> Response:
    """删除文章并提交，关联表由数据库外键清理，共享分类和标签保留。

    Args:
        post_id: 待删除文章 UUID。
        session: 当前请求会话。
        _: 所有者权限依赖，用户确认由调用方界面负责。

    Returns:
        204 无内容响应。

    Raises:
        HTTPException: 文章不存在时返回 404。
    """
    post = get_blog_post_by_id(session, post_id)
    if post is None:
        raise post_not_found()
    session.delete(post)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
